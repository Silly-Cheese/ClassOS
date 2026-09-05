import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const emailKey = (value = '') => String(value).trim().toLowerCase();
const isOwner = () => !!auth.currentUser?.emailVerified && emailKey(auth.currentUser?.email) === OWNER_EMAIL;

let ready = false;
let renderQueued = false;

function toast(message, type = '') {
  const region = $('toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function newId() {
  if (globalThis.crypto?.randomUUID) return `term_${crypto.randomUUID()}`;
  return `term_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function loadConfig() {
  const snapshot = await getDoc(doc(db, 'system', 'config'));
  return snapshot.exists() ? snapshot.data() : {};
}

function normalizedTerm(term) {
  return {
    id: String(term?.id || newId()),
    schoolId: String(term?.schoolId || ''),
    schoolName: String(term?.schoolName || 'School'),
    organizationId: String(term?.organizationId || ''),
    name: String(term?.name || '').trim(),
    startDate: String(term?.startDate || ''),
    endDate: String(term?.endDate || ''),
    status: ['upcoming', 'active', 'closed'].includes(term?.status) ? term.status : 'upcoming',
    createdBy: String(term?.createdBy || auth.currentUser?.uid || ''),
    createdAt: String(term?.createdAt || new Date().toISOString()),
    updatedAt: String(term?.updatedAt || new Date().toISOString())
  };
}

async function loadOwnerTerms() {
  if (!isOwner()) return [];
  const config = await loadConfig();
  const current = Array.isArray(config.termRecords) ? config.termRecords : [];
  const previous = Array.isArray(config.compatTerms) ? config.compatTerms : [];
  const map = new Map();
  [...previous, ...current].forEach((item) => {
    const term = normalizedTerm(item);
    if (term.id && term.name) map.set(term.id, term);
  });
  return [...map.values()];
}

async function saveOwnerTerms(terms) {
  if (!isOwner()) throw new Error('Term management is only available to the Platform Owner here.');
  const cleaned = terms.map(normalizedTerm);
  await setDoc(doc(db, 'system', 'config'), {
    termRecords: cleaned,
    compatTerms: [],
    termsUpdatedAt: serverTimestamp()
  }, { merge: true });
  return cleaned;
}

async function loadSchools() {
  const snapshot = await getDocs(collection(db, 'schools'));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function ensureModal() {
  let modal = $('terms-modal');
  if (modal) return modal;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="terms-modal" class="modal-backdrop hidden" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="terms-modal-title">
        <div class="modal-head">
          <div><span class="eyebrow">TERMS</span><h3 id="terms-modal-title">Term</h3></div>
          <button id="terms-modal-close" class="icon-btn" type="button" aria-label="Close">×</button>
        </div>
        <div id="terms-modal-body" class="modal-body"></div>
      </section>
    </div>`);
  modal = $('terms-modal');
  $('terms-modal-close').onclick = closeModal;
  modal.onclick = (event) => { if (event.target === modal) closeModal(); };
  return modal;
}

function closeModal() {
  $('terms-modal')?.classList.add('hidden');
  if ($('terms-modal-body')) $('terms-modal-body').innerHTML = '';
}

async function showTermForm(term = null) {
  if (!isOwner()) return;
  let schools;
  try {
    schools = await loadSchools();
  } catch (error) {
    console.error(error);
    toast('Could not load schools.', 'error');
    return;
  }
  if (!schools.length) {
    toast('Create a school before adding a term.', 'error');
    return;
  }

  const selectedSchoolId = term?.schoolId || schools[0].id;
  const modal = ensureModal();
  $('terms-modal-title').textContent = term ? 'Edit term' : 'Create term';
  $('terms-modal-body').innerHTML = `
    <form id="terms-form">
      <input type="hidden" name="id" value="${esc(term?.id || '')}">
      <div class="form-grid">
        <div class="field span-2">
          <label>School</label>
          <select name="schoolId" ${term ? 'disabled' : ''}>
            ${schools.map((school) => `<option value="${esc(school.id)}" ${school.id === selectedSchoolId ? 'selected' : ''}>${esc(school.name || 'School')}</option>`).join('')}
          </select>
          ${term ? `<input type="hidden" name="lockedSchoolId" value="${esc(term.schoolId)}">` : ''}
        </div>
        <div class="field span-2">
          <label>Term name</label>
          <input name="name" maxlength="80" required value="${esc(term?.name || '')}" placeholder="Fall 2026">
        </div>
        <div class="field">
          <label>Start date</label>
          <input name="startDate" type="date" required value="${esc(term?.startDate || '')}">
        </div>
        <div class="field">
          <label>End date</label>
          <input name="endDate" type="date" required value="${esc(term?.endDate || '')}">
        </div>
        <div class="field">
          <label>Status</label>
          <select name="status">
            <option value="upcoming" ${term?.status === 'upcoming' || !term ? 'selected' : ''}>Upcoming</option>
            <option value="active" ${term?.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="closed" ${term?.status === 'closed' ? 'selected' : ''}>Closed</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-terms-action="cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Save term</button>
      </div>
    </form>`;
  modal.classList.remove('hidden');
  window.setTimeout(() => $('terms-modal-body')?.querySelector('input[name="name"]')?.focus(), 0);
}

async function saveForm(form) {
  const data = Object.fromEntries(new FormData(form));
  const schoolId = String(data.lockedSchoolId || data.schoolId || '');
  const name = String(data.name || '').trim();
  const startDate = String(data.startDate || '');
  const endDate = String(data.endDate || '');
  const status = ['upcoming', 'active', 'closed'].includes(data.status) ? data.status : 'upcoming';
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (!schoolId || !name || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw new Error('Check the term name and dates.');
  }

  const schoolSnapshot = await getDoc(doc(db, 'schools', schoolId));
  if (!schoolSnapshot.exists()) throw new Error('That school could not be found.');
  const school = schoolSnapshot.data();
  const terms = await loadOwnerTerms();
  const existing = terms.find((item) => item.id === data.id);
  const id = existing?.id || newId();
  const term = normalizedTerm({
    ...existing,
    id,
    schoolId,
    schoolName: school.name || 'School',
    organizationId: school.organizationId || '',
    name,
    startDate,
    endDate,
    status,
    createdBy: existing?.createdBy || auth.currentUser.uid,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  let next = terms.filter((item) => item.id !== id);
  if (status === 'active') {
    next = next.map((item) => item.schoolId === schoolId && item.status === 'active'
      ? normalizedTerm({ ...item, status: 'closed', updatedAt: new Date().toISOString() })
      : item);
  }
  next.push(term);
  await saveOwnerTerms(next);
  closeModal();
  toast('Term saved.', 'success');
  await renderOwnerTerms();
}

async function activateTerm(id) {
  const terms = await loadOwnerTerms();
  const selected = terms.find((item) => item.id === id);
  if (!selected) return;
  const next = terms.map((item) => {
    if (item.schoolId !== selected.schoolId) return item;
    if (item.id === id) return normalizedTerm({ ...item, status: 'active', updatedAt: new Date().toISOString() });
    if (item.status === 'active') return normalizedTerm({ ...item, status: 'closed', updatedAt: new Date().toISOString() });
    return item;
  });
  await saveOwnerTerms(next);
  toast('Active term updated.', 'success');
  await renderOwnerTerms();
}

async function renderOwnerTerms() {
  if (!ready || !isOwner() || $('page-title')?.textContent !== 'Operations') return;
  let terms;
  try {
    terms = await loadOwnerTerms();
  } catch (error) {
    console.error(error);
    return;
  }

  const heading = [...document.querySelectorAll('#page-content h3')].find((node) => ['Terms', 'Terms & school years'].includes(node.textContent.trim()));
  const section = heading?.closest('section');
  if (!section) return;

  const existingTable = section.querySelector('.table-wrap');
  const existingEmpty = section.querySelector('.empty-state');
  if (existingTable) existingTable.remove();
  if (existingEmpty) existingEmpty.remove();

  if (!terms.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<strong>No terms yet</strong>Add a term to set the school-year dates.';
    section.appendChild(empty);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `<table><thead><tr><th>Term</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody>${[...terms]
    .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))
    .map((term) => `<tr>
      <td><span class="row-title">${esc(term.name)}</span><span class="row-subtitle">${esc(term.schoolName || 'School')}</span></td>
      <td>${esc(term.startDate || '—')} → ${esc(term.endDate || '—')}</td>
      <td><span class="pill ${term.status === 'active' ? 'success' : term.status === 'upcoming' ? 'info' : ''}">${esc(term.status)}</span></td>
      <td><div class="row-actions">${term.status !== 'active' ? `<button class="pill clickable info" data-terms-action="activate" data-id="${esc(term.id)}">Activate</button>` : ''}<button class="pill clickable" data-terms-action="edit" data-id="${esc(term.id)}">Edit</button></div></td>
    </tr>`).join('')}</tbody></table>`;
  section.appendChild(wrap);
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  window.setTimeout(async () => {
    renderQueued = false;
    await renderOwnerTerms();
  }, 0);
}

document.addEventListener('click', async (event) => {
  if (!ready || !isOwner()) return;

  const productionAction = event.target.closest('[data-p4-action]');
  if (productionAction) {
    const action = productionAction.dataset.p4Action;
    if (action === 'new-term') {
      event.preventDefault();
      event.stopImmediatePropagation();
      await showTermForm();
      return;
    }
    if (action === 'edit-term' || action === 'activate-term') {
      const terms = await loadOwnerTerms();
      const term = terms.find((item) => item.id === productionAction.dataset.id);
      if (term) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (action === 'edit-term') await showTermForm(term);
        else await activateTerm(term.id);
        return;
      }
    }
  }

  const action = event.target.closest('[data-terms-action]');
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (action.dataset.termsAction === 'cancel') closeModal();
  if (action.dataset.termsAction === 'edit') {
    const terms = await loadOwnerTerms();
    const term = terms.find((item) => item.id === action.dataset.id);
    if (term) await showTermForm(term);
  }
  if (action.dataset.termsAction === 'activate') await activateTerm(action.dataset.id);
}, true);

document.addEventListener('submit', async (event) => {
  if (!ready || !isOwner() || event.target.id !== 'terms-form') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const button = event.target.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = true;
    button.dataset.label = button.textContent;
    button.textContent = 'Saving…';
  }
  try {
    await saveForm(event.target);
  } catch (error) {
    console.error(error);
    toast(error?.message || 'Could not save the term.', 'error');
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.label || 'Save term';
    }
  }
}, true);

const content = $('page-content');
if (content) {
  const observer = new MutationObserver(() => scheduleRender());
  observer.observe(content, { childList: true });
}

onAuthStateChanged(auth, async (user) => {
  ready = !!user && isOwner();
  if (!ready) return;
  try {
    const terms = await loadOwnerTerms();
    const config = await loadConfig();
    if (!Array.isArray(config.termRecords) && terms.length) await saveOwnerTerms(terms);
    scheduleRender();
  } catch (error) {
    console.warn('Term setup could not finish', error);
  }
});
