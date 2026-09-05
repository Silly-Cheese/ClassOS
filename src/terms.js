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
  try {
    const snapshot = await getDoc(doc(db, 'system', 'config'));
    return snapshot.exists() ? snapshot.data() : {};
  } catch (error) {
    console.warn('Could not load term fallback data', error);
    return {};
  }
}

async function loadFallbackTerms() {
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

async function loadStoredTerms() {
  if (!isOwner()) return [];
  try {
    const snapshot = await getDocs(collection(db, 'terms'));
    return snapshot.docs.map((item) => normalizeTerm({ id: item.id, ...item.data() }));
  } catch (error) {
    console.warn('Could not load the terms collection', error);
    return [];
  }
}

async function loadTerms() {
  if (!isOwner()) return [];
  const [stored, fallback] = await Promise.all([loadStoredTerms(), loadFallbackTerms()]);
  const map = new Map();
  stored.forEach((term) => map.set(term.id, term));
  fallback.forEach((term) => map.set(term.id, term));
  return [...map.values()];
}

async function saveFallbackTerms(terms) {
  if (!isOwner()) throw new Error('You do not have permission to manage terms.');
  const cleaned = terms.map(normalizeTerm);
  await setDoc(doc(db, 'system', 'config'), {
    termRecords: cleaned,
    compatTerms: [],
    termsUpdatedAt: serverTimestamp()
  }, { merge: true });
  return cleaned;
}

async function writeTermDocument(term) {
  const cleaned = normalizeTerm(term);
  await setDoc(doc(db, 'terms', cleaned.id), {
    schoolId: cleaned.schoolId,
    organizationId: cleaned.organizationId,
    name: cleaned.name,
    startDate: cleaned.startDate,
    endDate: cleaned.endDate,
    status: cleaned.status,
    createdBy: cleaned.createdBy,
    createdAt: cleaned.createdAt,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function persistTerm(term) {
  const cleaned = normalizeTerm(term);
  const fallback = await loadFallbackTerms();
  const nextFallback = fallback.filter((item) => item.id !== cleaned.id);
  nextFallback.push(cleaned);

  // Write the fallback first. This makes owner term creation durable even if
  // the live Firebase rules have not caught up with the repository yet.
  await saveFallbackTerms(nextFallback);

  try {
    await writeTermDocument(cleaned);
    await saveFallbackTerms(nextFallback.filter((item) => item.id !== cleaned.id));
    return { ...cleaned, persistedToTerms: true };
  } catch (error) {
    if (error?.code !== 'permission-denied') console.warn('Primary term write failed; fallback retained', error);
    return { ...cleaned, persistedToTerms: false };
  }
}

async function migrateFallbackTerms() {
  if (!isOwner()) return;
  const fallback = await loadFallbackTerms();
  if (!fallback.length) return;
  const remaining = [];
  for (const term of fallback) {
    try {
      await writeTermDocument(term);
    } catch (error) {
      remaining.push(term);
      if (error?.code !== 'permission-denied') console.warn('Term migration failed', error);
    }
  }
  if (remaining.length !== fallback.length) await saveFallbackTerms(remaining);
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
  let schools = [];
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
  if (!form) return;
  if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
  if (button) {
    button.disabled = true;
    button.dataset.label = button.textContent;
    button.textContent = 'Saving…';
  }

  try {
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

    if (status === 'active') {
      const otherActive = terms.filter((item) => item.schoolId === schoolId && item.id !== id && item.status === 'active');
      for (const item of otherActive) {
        await persistTerm(normalizeTerm({ ...item, status: 'closed', updatedAt: new Date().toISOString() }));
      }
    }

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

    await persistTerm(term);
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
  for (const item of terms.filter((term) => term.schoolId === selected.schoolId && term.id !== id && term.status === 'active')) {
    await persistTerm(normalizeTerm({ ...item, status: 'closed', updatedAt: new Date().toISOString() }));
  }
  await persistTerm(normalizeTerm({ ...selected, status: 'active', updatedAt: new Date().toISOString() }));
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

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  window.setTimeout(async () => {
    renderQueued = false;
    try { await renderTerms(); } catch (error) { console.warn('Could not render terms', error); }
  }, 80);
}

// Any term form in ClassOS is prevented from performing native browser navigation.
document.addEventListener('submit', (event) => {
  if (event.target?.id === 'terms-form' || event.target?.id === 'p4-term-form') event.preventDefault();
}, true);

document.addEventListener('click', async (event) => {
  if (!isOwner()) return;

  const p4Action = event.target.closest('[data-p4-action]');
  if (p4Action && ['new-term', 'edit-term', 'activate-term'].includes(p4Action.dataset.p4Action)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = p4Action.dataset.p4Action;
    if (action === 'new-term') {
      await showTermForm();
      return;
    }
    const terms = await loadTerms();
    const term = terms.find((item) => item.id === p4Action.dataset.id);
    if (!term) return;
    if (action === 'edit-term') await showTermForm(term);
    else await activateTerm(term.id);
    return;
  }

  const action = event.target.closest('[data-terms-action]');
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const type = action.dataset.termsAction;
  if (type === 'cancel') closeModal();
  if (type === 'save') await saveForm(action.closest('form'), action);
  if (type === 'edit') {
    const terms = await loadTerms();
    const term = terms.find((item) => item.id === action.dataset.id);
    if (term) await showTermForm(term);
  }
  if (type === 'activate') await activateTerm(action.dataset.id);
}, true);

const content = $('page-content');
if (content) {
  // Watch only direct page replacements. Term table changes happen deeper in
  // the tree and therefore cannot trigger this observer recursively.
  const observer = new MutationObserver(() => scheduleRender());
  observer.observe(content, { childList: true, subtree: false });
}

onAuthStateChanged(auth, async (user) => {
  if (!user || !isOwner()) return;
  await migrateFallbackTerms();
  scheduleRender();
});
