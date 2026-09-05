import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const emailKey = (value = '') => String(value).trim().toLowerCase();
const isOwner = () => !!auth.currentUser?.emailVerified && emailKey(auth.currentUser?.email) === OWNER_EMAIL;
const roleName = (value = '') => ({
  platform_owner: 'Platform Owner', district_admin: 'District Admin', school_admin: 'School Admin',
  counselor: 'Counselor', teacher: 'Teacher', staff: 'Staff', guardian: 'Parent / Guardian', student: 'Student'
})[value] || String(value || 'Member').replaceAll('_', ' ');

let profile = null;
let fallbackTerms = [];

function toast(message, type = '') {
  const region = $('toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

async function loadProfile() {
  if (!auth.currentUser) return null;
  try {
    const snapshot = await getDoc(doc(db, 'users', auth.currentUser.uid));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch {
    return null;
  }
}

async function loadFallbackTerms() {
  fallbackTerms = [];
  if (!isOwner()) return fallbackTerms;
  try {
    const snapshot = await getDoc(doc(db, 'system', 'config'));
    fallbackTerms = Array.isArray(snapshot.data()?.compatTerms) ? snapshot.data().compatTerms : [];
  } catch (error) {
    console.warn('Could not load term compatibility data', error);
  }
  return fallbackTerms;
}

async function saveFallbackTerms(terms) {
  if (!isOwner()) throw new Error('Only the Platform Owner can use term compatibility storage.');
  fallbackTerms = terms;
  await setDoc(doc(db, 'system', 'config'), {
    compatTerms: terms,
    compatTermsUpdatedAt: serverTimestamp()
  }, { merge: true });
}

function cleanTerm(term) {
  return {
    id: String(term.id || `compat_${crypto.randomUUID()}`),
    schoolId: String(term.schoolId || ''),
    schoolName: String(term.schoolName || 'School'),
    organizationId: String(term.organizationId || ''),
    name: String(term.name || '').trim(),
    startDate: String(term.startDate || ''),
    endDate: String(term.endDate || ''),
    status: ['upcoming', 'active', 'closed'].includes(term.status) ? term.status : 'upcoming',
    createdBy: String(term.createdBy || auth.currentUser?.uid || ''),
    createdAt: String(term.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString()
  };
}

async function tryMigrateFallbackTerms() {
  if (!isOwner()) return;
  const terms = await loadFallbackTerms();
  if (!terms.length) return;
  const remaining = [];
  for (const raw of terms) {
    const term = cleanTerm(raw);
    try {
      await setDoc(doc(db, 'terms', term.id), {
        schoolId: term.schoolId,
        organizationId: term.organizationId,
        name: term.name,
        startDate: term.startDate,
        endDate: term.endDate,
        status: term.status,
        createdBy: term.createdBy || auth.currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      if (error?.code === 'permission-denied' || String(error?.message || '').toLowerCase().includes('permission')) {
        remaining.push(term);
      } else {
        remaining.push(term);
        console.warn('Term migration failed', error);
      }
    }
  }
  if (remaining.length !== terms.length) await saveFallbackTerms(remaining);
}

function setPage(title, kicker = '') {
  if ($('page-title')) $('page-title').textContent = title;
  if ($('workspace-kicker')) $('workspace-kicker').textContent = kicker;
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.remove('active'));
}

async function renderSettings() {
  profile = profile || await loadProfile();
  setPage('Settings', 'ACCOUNT');
  document.querySelector('.sidebar-bottom [data-route="settings"]')?.classList.add('active');
  $('sidebar')?.classList.remove('open');
  const content = $('page-content');
  if (!content) return;
  const name = profile?.displayName || auth.currentUser?.displayName || auth.currentUser?.email || 'User';
  const email = profile?.email || auth.currentUser?.email || '';
  const ownerTools = isOwner() ? `<section class="card"><div class="section-head"><div><h3>Site settings</h3><p>Branding and administrative tools.</p></div></div><div class="p4-action-stack"><button class="btn btn-secondary" data-p4-action="brand-settings">Branding</button><button class="btn btn-secondary" data-term-fix-action="open-operations">Operations</button></div></section>` : '';
  content.innerHTML = `<div class="toolbar"><div><h2 style="margin:0">Settings</h2></div></div>
    <section class="grid grid-2">
      <div class="card"><div class="section-head"><div><h3>Account</h3></div></div><div class="list">
        <div class="list-row"><div class="list-main"><strong>Name</strong><span>${esc(name)}</span></div></div>
        <div class="list-row"><div class="list-main"><strong>Email</strong><span>${esc(email)}</span></div>${auth.currentUser?.emailVerified ? '<span class="pill success">Verified</span>' : ''}</div>
        <div class="list-row"><div class="list-main"><strong>Role</strong><span>${esc(roleName(profile?.role))}</span></div></div>
      </div></div>
      <div class="card"><div class="section-head"><div><h3>Appearance</h3><p>Theme and display density.</p></div></div><button class="btn btn-secondary" data-p4-action="appearance">Change appearance</button></div>
      ${ownerTools}
      <div class="card"><div class="section-head"><div><h3>Session</h3></div></div><button class="btn btn-secondary" data-term-fix-action="sign-out">Sign out</button></div>
    </section>`;
}

function showCompatTermForm(term) {
  const modal = $('p4-modal');
  const body = $('p4-modal-body');
  if (!modal || !body) return toast('Open Operations and try again.', 'error');
  const title = $('p4-modal-title');
  const kicker = $('p4-modal-kicker');
  if (title) title.textContent = 'Edit term';
  if (kicker) kicker.textContent = 'TERMS';
  body.innerHTML = `<form id="p4-term-form"><input type="hidden" name="id" value="${esc(term.id)}"><input type="hidden" name="lockedSchoolId" value="${esc(term.schoolId)}"><div class="form-grid"><div class="field span-2"><label>School</label><input value="${esc(term.schoolName || 'School')}" disabled></div><div class="field span-2"><label>Term name</label><input name="name" maxlength="80" required value="${esc(term.name)}"></div><div class="field"><label>Start date</label><input name="startDate" type="date" required value="${esc(term.startDate)}"></div><div class="field"><label>End date</label><input name="endDate" type="date" required value="${esc(term.endDate)}"></div><div class="field"><label>Status</label><select name="status"><option value="upcoming" ${term.status === 'upcoming' ? 'selected' : ''}>Upcoming</option><option value="active" ${term.status === 'active' ? 'selected' : ''}>Active</option><option value="closed" ${term.status === 'closed' ? 'selected' : ''}>Closed</option></select></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-p4-action="close">Cancel</button><button class="btn btn-primary" type="submit">Save term</button></div></form>`;
  modal.classList.remove('hidden');
}

async function saveTerm(form) {
  const data = Object.fromEntries(new FormData(form));
  const schoolId = String(data.lockedSchoolId || data.schoolId || '');
  const name = String(data.name || '').trim();
  const startDate = String(data.startDate || '');
  const endDate = String(data.endDate || '');
  const status = ['upcoming', 'active', 'closed'].includes(data.status) ? data.status : 'upcoming';
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (!schoolId || !name || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new Error('Check the term name and dates.');

  const schoolSnapshot = await getDoc(doc(db, 'schools', schoolId));
  if (!schoolSnapshot.exists()) throw new Error('That school could not be found.');
  const school = schoolSnapshot.data();
  const rawId = String(data.id || '');
  const id = rawId || `term_${crypto.randomUUID()}`;
  const payload = {
    schoolId,
    schoolName: school.name || 'School',
    organizationId: school.organizationId || '',
    name,
    startDate,
    endDate,
    status,
    createdBy: auth.currentUser.uid
  };

  if (rawId.startsWith('compat_')) {
    const next = fallbackTerms.filter((item) => item.id !== rawId);
    next.push(cleanTerm({ ...payload, id: rawId, createdAt: fallbackTerms.find((item) => item.id === rawId)?.createdAt }));
    await saveFallbackTerms(next);
    toast('Term saved.', 'success');
    return;
  }

  try {
    await setDoc(doc(db, 'terms', id), {
      schoolId,
      organizationId: payload.organizationId,
      name,
      startDate,
      endDate,
      status,
      createdBy: auth.currentUser.uid,
      ...(rawId ? {} : { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp()
    }, { merge: true });
    toast('Term saved.', 'success');
  } catch (error) {
    const permissionError = error?.code === 'permission-denied' || String(error?.message || '').toLowerCase().includes('permission');
    if (!permissionError || !isOwner()) throw error;
    const compatId = rawId || `compat_${crypto.randomUUID()}`;
    const next = fallbackTerms.filter((item) => item.id !== compatId);
    next.push(cleanTerm({ ...payload, id: compatId }));
    await saveFallbackTerms(next);
    toast('Term saved.', 'success');
  }
}

async function activateCompatTerm(id) {
  const term = fallbackTerms.find((item) => item.id === id);
  if (!term) return;
  const next = fallbackTerms.map((item) => {
    if (item.schoolId !== term.schoolId) return item;
    return cleanTerm({ ...item, status: item.id === id ? 'active' : item.status === 'active' ? 'closed' : item.status });
  });
  await saveFallbackTerms(next);
  toast('Active term updated.', 'success');
  document.querySelector('.p4-nav')?.click();
}

async function injectFallbackTerms() {
  if (!isOwner() || $('page-title')?.textContent !== 'Operations') return;
  await loadFallbackTerms();
  if (!fallbackTerms.length) return;
  const heading = [...document.querySelectorAll('#page-content h3')].find((node) => node.textContent.trim() === 'Terms & school years' || node.textContent.trim() === 'Terms');
  const section = heading?.closest('section');
  if (!section) return;
  section.querySelectorAll('[data-compat-term-row]').forEach((node) => node.remove());
  let tbody = section.querySelector('tbody');
  if (!tbody) {
    section.querySelector('.empty-state')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = '<table><thead><tr><th>Term</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody></tbody></table>';
    section.appendChild(wrap);
    tbody = wrap.querySelector('tbody');
  }
  fallbackTerms.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))).forEach((term) => {
    const row = document.createElement('tr');
    row.dataset.compatTermRow = term.id;
    row.innerHTML = `<td><span class="row-title">${esc(term.name)}</span><span class="row-subtitle">${esc(term.schoolName || 'School')}</span></td><td>${esc(term.startDate)} → ${esc(term.endDate)}</td><td><span class="pill ${term.status === 'active' ? 'success' : term.status === 'upcoming' ? 'info' : ''}">${esc(term.status)}</span></td><td><div class="row-actions">${term.status !== 'active' ? `<button class="pill clickable info" data-term-fix-action="activate-term" data-id="${esc(term.id)}">Activate</button>` : ''}<button class="pill clickable" data-term-fix-action="edit-term" data-id="${esc(term.id)}">Edit</button></div></td>`;
    tbody.appendChild(row);
  });
}

function naturalize() {
  const brandEyebrow = document.querySelector('.auth-brand-copy .eyebrow');
  const brandTitle = document.querySelector('.auth-brand-copy h1');
  const brandCopy = document.querySelector('.auth-brand-copy p');
  if (brandEyebrow) brandEyebrow.textContent = 'CLASSOS';
  if (brandTitle && brandTitle.textContent.includes('School shouldn')) brandTitle.textContent = 'School, all in one place.';
  if (brandCopy) brandCopy.textContent = 'Classes, assignments, grades, attendance, and messages.';

  const proof = document.querySelector('.auth-proof');
  if (proof && !proof.dataset.cleaned) {
    proof.dataset.cleaned = '1';
    proof.innerHTML = '<div><strong>Students</strong><span>See what’s due and what’s missing</span></div><div><strong>Teachers</strong><span>Manage classes and grades</span></div><div><strong>Families</strong><span>Keep up with progress</span></div>';
  }

  const p4Hero = document.querySelector('#page-content .p4-hero');
  if (p4Hero) {
    const eyebrow = p4Hero.querySelector('.eyebrow');
    const title = p4Hero.querySelector('h1');
    const copy = p4Hero.querySelector('p');
    if (eyebrow) eyebrow.textContent = 'ADMIN';
    if (title) title.textContent = 'Operations';
    if (copy) copy.textContent = 'Manage terms, courses, imports, exports, and site settings.';
  }

  document.querySelectorAll('#page-content .section-head h3').forEach((heading) => {
    const text = heading.textContent.trim();
    if (text === 'Terms & school years') heading.textContent = 'Terms';
    if (text === 'Duplicate, archive, restore') heading.textContent = 'Courses';
    if (text === 'Export & migration tools') heading.textContent = 'Data';
    if (text === 'Brand & appearance') heading.textContent = 'Site settings';
  });
  document.querySelectorAll('#page-content .section-head p').forEach((copy) => {
    const text = copy.textContent.trim();
    if (text.includes('Control active instructional periods')) copy.textContent = 'Set school-year and grading-period dates.';
    if (text.includes('Archived courses remain in Firestore')) copy.textContent = 'Duplicate, archive, or restore courses.';
  });
  document.querySelectorAll('#page-content .callout').forEach((callout) => {
    if (callout.textContent.includes('Production guardrail:')) callout.remove();
  });
  document.querySelectorAll('.p4-release-chip').forEach((chip) => chip.remove());

  const pageTitle = $('page-title')?.textContent || '';
  const heroCopy = document.querySelector('#page-content .hero > p');
  if (heroCopy && pageTitle === 'Home' && heroCopy.textContent.includes('working instructional layer')) {
    heroCopy.textContent = 'Here’s what’s happening across your classes today.';
  }
  if (heroCopy && pageTitle === 'Absent Mode') heroCopy.textContent = 'See what you missed and what still needs to be finished.';
  if (heroCopy && pageTitle === 'Family') heroCopy.textContent = 'See grades, missing work, and attendance in one place.';
}

document.addEventListener('click', async (event) => {
  const settings = event.target.closest('.sidebar-bottom [data-route="settings"]');
  if (settings) {
    event.preventDefault();
    event.stopImmediatePropagation();
    await renderSettings();
    return;
  }

  const action = event.target.closest('[data-term-fix-action]');
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (action.dataset.termFixAction === 'sign-out') await signOut(auth);
  if (action.dataset.termFixAction === 'open-operations') document.querySelector('.p4-nav')?.click();
  if (action.dataset.termFixAction === 'edit-term') {
    await loadFallbackTerms();
    const term = fallbackTerms.find((item) => item.id === action.dataset.id);
    if (term) showCompatTermForm(term);
  }
  if (action.dataset.termFixAction === 'activate-term') {
    await loadFallbackTerms();
    await activateCompatTerm(action.dataset.id);
  }
}, true);

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'p4-term-form') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const button = event.target.querySelector('button[type="submit"]');
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
  try {
    await loadFallbackTerms();
    await saveTerm(event.target);
    $('p4-modal')?.classList.add('hidden');
    if ($('p4-modal-body')) $('p4-modal-body').innerHTML = '';
    document.querySelector('.p4-nav')?.click();
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not save the term.', 'error');
    if (button) { button.disabled = false; button.textContent = 'Save term'; }
  }
}, true);

const observer = new MutationObserver(() => {
  naturalize();
  if ($('page-title')?.textContent === 'Operations') injectFallbackTerms().catch(console.warn);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

naturalize();

onAuthStateChanged(auth, async (user) => {
  profile = null;
  fallbackTerms = [];
  if (!user) return;
  profile = await loadProfile();
  if (isOwner()) {
    await tryMigrateFallbackTerms();
    await loadFallbackTerms();
  }
  naturalize();
});
