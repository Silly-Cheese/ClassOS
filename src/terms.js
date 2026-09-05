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

function normalizeTerm(term = {}) {
  return {
    id: String(term.id || newId()),
    schoolId: String(term.schoolId || ''),
    schoolName: String(term.schoolName || 'School'),
    organizationId: String(term.organizationId || ''),
    name: String(term.name || '').trim(),
    startDate: String(term.startDate || ''),
    endDate: String(term.endDate || ''),
    status: ['upcoming', 'active', 'closed'].includes(term.status) ? term.status : 'upcoming',
    createdBy: String(term.createdBy || auth.currentUser?.uid || ''),
    createdAt: String(term.createdAt || new Date().toISOString()),
    updatedAt: String(term.updatedAt || new Date().toISOString())
  };
}

async function loadConfig() {
  const snapshot = await getDoc(doc(db, 'system', 'config'));
  return snapshot.exists() ? snapshot.data() : {};
}

async function loadTerms() {
  if (!isOwner()) return [];
  const config = await loadConfig();
  const records = Array.isArray(config.termRecords) ? config.termRecords : [];
  const legacy = Array.isArray(config.compatTerms) ? config.compatTerms : [];
  const map = new Map();
  [...legacy, ...records].forEach((item) => {
    const term = normalizeTerm(item);
    if (term.id && term.name) map.set(term.id, term);
  });
  return [...map.values()];
}

async function saveTerms(terms) {
  if (!isOwner()) throw new Error('You do not have permission to manage terms.');
  const cleaned = terms.map(normalizeTerm);
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
  $('p4-modal')?.classList.add('hidden');
  if ($('terms-modal-body')) $('terms-modal-body').innerHTML = '';
  if ($('p4-modal-body')) $('p4-modal-body').innerHTML = '';
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
    <form id="terms-form" onsubmit="return false;">
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
        <button type="button" class="btn btn-primary" data-terms-action="save">Save term</button>
      </div>
    </form>`;
  modal.classList.remove('hidden');
  window.setTimeout(() => $('terms-modal-body')?.querySelector('input[name="name"]')?.focus(), 0);
}

async function saveForm(form, button = null) {
  if (!form) throw new Error('The term form could not be found.');
  if (button) {
    button.disabled = true;
    button.dataset.label = button.textContent;
    button.textContent = 'Saving…';
  }

  try {
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
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
    const terms = await loadTerms();
    const existing = terms.find((item) => item.id === data.id);
    const id = existing?.id || newId();

    const term = normalizeTerm({
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
        ? normalizeTerm({ ...item, status: 'closed', updatedAt: new Date().toISOString() })
        : item);
    }
    next.push(term);
    await saveTerms(next);
    closeModal();
    toast('Term saved.', 'success');
    await renderTerms();
  } catch (error) {
    console.error(error);
    toast(error?.message || 'Could not save the term.', 'error');
  } finally {
    if (button && document.body.contains(button)) {
      button.disabled = false;
      button.textContent = button.dataset.label || 'Save term';
    }
  }
}

async function activateTerm(id) {
  const terms = await loadTerms();
  const selected = terms.find((item) => item.id === id);
  if (!selected) return;
  const next = terms.map((item) => {
    if (item.schoolId !== selected.schoolId) return item;
    if (item.id === id) return normalizeTerm({ ...item, status: 'active', updatedAt: new Date().toISOString() });
    if (item.status === 'active') return normalizeTerm({ ...item, status: 'closed', updatedAt: new Date().toISOString() });
    return item;
  });
  await saveTerms(next);
  toast('Active term updated.', 'success');
  await renderTerms();
}

async function renderTerms() {
  if (!isOwner() || $('page-title')?.textContent !== 'Operations') return;
  const terms = await loadTerms();
  const heading = [...document.querySelectorAll('#page-content h3')]
    .find((node) => ['Terms', 'Terms & school years'].includes(node.textContent.trim()));
  const section = heading?.closest('section');
  if (!section) return;

  section.querySelector('.table-wrap')?.remove();
  section.querySelector('.empty-state')?.remove();

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
      <td><div class="row-actions">${term.status !== 'active' ? `<button type="button" class="pill clickable info" data-terms-action="activate" data-id="${esc(term.id)}">Activate</button>` : ''}<button type="button" class="pill clickable" data-terms-action="edit" data-id="${esc(term.id)}">Edit</button></div></td>
    </tr>`).join('')}</tbody></table>`;
  section.appendChild(wrap);
}

function scheduleOperationsRender() {
  window.setTimeout(() => renderTerms().catch(console.warn), 75);
  window.setTimeout(() => renderTerms().catch(console.warn), 300);
}

// Absolute safety net: neither term form may ever trigger a browser navigation.
document.addEventListener('submit', (event) => {
  if (event.target?.id === 'terms-form' || event.target?.id === 'p4-term-form') {
    event.preventDefault();
  }
}, true);

document.addEventListener('click', async (event) => {
  const p4Action = event.target.closest('[data-p4-action]');
  if (p4Action?.dataset.p4Action === 'new-term' && isOwner()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    await showTermForm();
    return;
  }

  if (event.target.closest('.p4-nav')) scheduleOperationsRender();

  const action = event.target.closest('[data-terms-action]');
  if (!action || !isOwner()) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const type = action.dataset.termsAction;
  if (type === 'cancel') {
    closeModal();
    return;
  }
  if (type === 'save') {
    await saveForm(action.closest('form'), action);
    return;
  }
  if (type === 'edit') {
    const terms = await loadTerms();
    const term = terms.find((item) => item.id === action.dataset.id);
    if (term) await showTermForm(term);
    return;
  }
  if (type === 'activate') {
    await activateTerm(action.dataset.id);
  }
}, true);

document.addEventListener('submit', async (event) => {
  if (!isOwner()) return;
  if (event.target?.id !== 'terms-form' && event.target?.id !== 'p4-term-form') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const button = event.target.querySelector('button[type="submit"], [data-terms-action="save"]');
  await saveForm(event.target, button);
}, true);

onAuthStateChanged(auth, async (user) => {
  if (!user || !isOwner()) return;
  try {
    const config = await loadConfig();
    const existing = await loadTerms();
    if (!Array.isArray(config.termRecords) && existing.length) await saveTerms(existing);
    scheduleOperationsRender();
  } catch (error) {
    console.warn('Term setup could not finish', error);
  }
});
