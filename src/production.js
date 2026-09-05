import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const state = {
  user: null, profile: null, organizations: [], schools: [], courses: [], users: [], terms: [],
  assignments: [], assessments: [], standards: [], messages: [], attempts: [], interventions: [],
  brand: null, route: null, ready: false
};

const ADMIN_ROLES = ['district_admin', 'school_admin'];
const SCHOOLWIDE_ROLES = ['district_admin', 'school_admin', 'counselor', 'staff'];
const BULK_ROLES = ['student', 'teacher', 'guardian', 'staff', 'counselor'];
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const emailKey = (value = '') => String(value).trim().toLowerCase();
const uid = () => state.user?.uid || '';
const role = () => state.profile?.role || 'pending';
const isOwner = () => !!state.user?.emailVerified && emailKey(state.user?.email) === OWNER_EMAIL;
const isAdmin = () => isOwner() || ADMIN_ROLES.includes(role());
const canOperate = () => isAdmin();

function toast(message, type = '') {
  const region = $('toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4300);
}

async function direct(name, id) {
  if (!id) return null;
  try {
    const snap = await getDoc(doc(db, name, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    console.warn(`ClassOS Phase 4 could not load ${name}/${id}`, error);
    return null;
  }
}

async function allDocs(name) {
  try {
    const snap = await getDocs(collection(db, name));
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.warn(`ClassOS Phase 4 could not load ${name}`, error);
    return [];
  }
}

async function byField(name, field, value) {
  try {
    const snap = await getDocs(query(collection(db, name), where(field, '==', value)));
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.warn(`ClassOS Phase 4 could not query ${name}.${field}`, error);
    return [];
  }
}

async function arrayContains(name, field, value) {
  try {
    const snap = await getDocs(query(collection(db, name), where(field, 'array-contains', value)));
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.warn(`ClassOS Phase 4 could not query ${name}.${field}`, error);
    return [];
  }
}

function unique(items) {
  const map = new Map();
  items.filter(Boolean).forEach((item) => map.set(item.id, item));
  return [...map.values()];
}

function asDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function fmt(value, includeTime = false) {
  const date = asDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function schoolName(id) { return state.schools.find((item) => item.id === id)?.name || 'School'; }
function courseName(id) { return state.courses.find((item) => item.id === id)?.name || 'Course'; }
function personName(id) {
  const item = state.users.find((user) => user.id === id);
  return item?.displayName || item?.email || 'ClassOS user';
}

async function loadProfile(user, retries = 5) {
  const profile = await direct('users', user.uid);
  if (profile || retries <= 0) return profile;
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  return loadProfile(user, retries - 1);
}

async function loadCourses() {
  if (isOwner()) return allDocs('courses');
  if (SCHOOLWIDE_ROLES.includes(role())) {
    const batches = await Promise.all((state.profile?.schoolIds || []).map((schoolId) => byField('courses', 'schoolId', schoolId)));
    return unique(batches.flat());
  }
  if (role() === 'teacher') return arrayContains('courses', 'teacherIds', uid());
  if (role() === 'student') return arrayContains('courses', 'studentIds', uid());
  if (role() === 'guardian') {
    const batches = await Promise.all((state.profile?.linkedStudentIds || []).map((studentId) => arrayContains('courses', 'studentIds', studentId)));
    return unique(batches.flat());
  }
  return [];
}

async function loadUsers() {
  if (isOwner()) return allDocs('users');
  if (['district_admin', 'school_admin', 'counselor', 'teacher'].includes(role())) {
    const batches = await Promise.all((state.profile?.schoolIds || []).map((schoolId) => arrayContains('users', 'schoolIds', schoolId)));
    return unique(batches.flat().concat(state.profile ? [{ id: uid(), ...state.profile }] : []));
  }
  const ids = new Set([uid()]);
  if (role() === 'guardian') (state.profile?.linkedStudentIds || []).forEach((id) => ids.add(id));
  state.courses.forEach((course) => (course.teacherIds || []).forEach((id) => ids.add(id)));
  return unique((await Promise.all([...ids].map((id) => direct('users', id)))).filter(Boolean));
}

async function loadCourseCollection(name) {
  if (isOwner()) return allDocs(name);
  const batches = await Promise.all(state.courses.filter((course) => course.status !== 'archived').map((course) => byField(name, 'courseId', course.id)));
  return unique(batches.flat());
}

async function loadMessages() {
  if (!uid()) return [];
  if (isOwner()) return allDocs('messages');
  const [received, sent] = await Promise.all([
    arrayContains('messages', 'recipientIds', uid()),
    byField('messages', 'senderId', uid())
  ]);
  return unique(received.concat(sent));
}

async function loadInterventions() {
  if (!['platform_owner', 'district_admin', 'school_admin', 'counselor', 'teacher'].includes(role())) return [];
  if (isOwner()) return allDocs('interventions');
  if (role() === 'teacher') {
    const batches = await Promise.all(state.courses.filter((c) => (c.teacherIds || []).includes(uid())).map((c) => byField('interventions', 'courseId', c.id)));
    return unique(batches.flat());
  }
  const batches = await Promise.all((state.profile?.schoolIds || []).map((schoolId) => byField('interventions', 'schoolId', schoolId)));
  return unique(batches.flat());
}

async function load() {
  if (!state.profile || state.profile.status !== 'active') return;
  if (isOwner()) {
    [state.organizations, state.schools] = await Promise.all([allDocs('organizations'), allDocs('schools')]);
  } else {
    state.organizations = unique((await Promise.all((state.profile.organizationIds || []).map((id) => direct('organizations', id)))).filter(Boolean));
    state.schools = unique((await Promise.all((state.profile.schoolIds || []).map((id) => direct('schools', id)))).filter(Boolean));
  }
  state.courses = await loadCourses();
  state.users = await loadUsers();
  const termBatches = isOwner()
    ? [await allDocs('terms')]
    : await Promise.all((state.profile.schoolIds || []).map((schoolId) => byField('terms', 'schoolId', schoolId)));
  state.terms = unique(termBatches.flat());
  [state.assignments, state.assessments, state.standards, state.messages, state.attempts, state.interventions] = await Promise.all([
    loadCourseCollection('assignments'), loadCourseCollection('assessments'), loadCourseCollection('standards'),
    loadMessages(), loadCourseCollection('assessmentAttempts'), loadInterventions()
  ]);
  state.brand = await direct('platformConfig', 'public');
  applyBrand();
}

function applyBrand() {
  const name = String(state.brand?.productName || 'ClassOS').trim().slice(0, 40) || 'ClassOS';
  const tagline = String(state.brand?.tagline || 'School shouldn’t be this complicated.').trim().slice(0, 140);
  const accent = String(state.brand?.accent || '').trim();
  document.querySelectorAll('.brand-lockup span').forEach((node) => { node.textContent = name; });
  const headline = document.querySelector('.auth-brand-copy h1');
  if (headline && tagline) headline.textContent = tagline;
  document.title = name;
  if (/^#[0-9a-fA-F]{6}$/.test(accent)) document.documentElement.style.setProperty('--accent', accent);
}

async function ensurePhase4() {
  if (!isOwner()) return;
  await setDoc(doc(db, 'system', 'config'), {
    version: '1.0.0', phase: 4, productionReady: true, hardenedAt: serverTimestamp(), updatedAt: serverTimestamp()
  }, { merge: true });
  const flags = [
    ['global_search', true, 'Role-aware global search'],
    ['notification_center', true, 'Derived notification center'],
    ['term_management', true, 'School year and term lifecycle'],
    ['course_lifecycle', true, 'Course duplication and archiving'],
    ['data_tools', true, 'CSV/JSON import and export tools'],
    ['appearance', true, 'Theme and density preferences'],
    ['production_hardening', true, 'Security and validation hardening']
  ];
  for (const [key, enabled, description] of flags) {
    await setDoc(doc(db, 'featureFlags', key), { key, enabled, description, updatedBy: uid(), updatedAt: serverTimestamp() }, { merge: true });
  }
  const brand = await direct('platformConfig', 'public');
  if (!brand) {
    await setDoc(doc(db, 'platformConfig', 'public'), {
      productName: 'ClassOS', tagline: 'School shouldn’t be this complicated.', accent: '#2563eb', updatedBy: uid(), updatedAt: serverTimestamp()
    });
  }
}

function ensureModal() {
  if ($('p4-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="p4-modal" class="modal-backdrop hidden" role="presentation"><section class="modal p4-modal" role="dialog" aria-modal="true" aria-labelledby="p4-modal-title"><div class="modal-head"><div><span class="eyebrow" id="p4-modal-kicker">CLASSOS</span><h3 id="p4-modal-title">Dialog</h3></div><button id="p4-modal-close" class="icon-btn" aria-label="Close">×</button></div><div id="p4-modal-body" class="modal-body"></div></section></div>`);
  $('p4-modal-close').onclick = closeModal;
  $('p4-modal').onclick = (event) => { if (event.target.id === 'p4-modal') closeModal(); };
}
function openModal(title, body, kicker = 'CLASSOS') {
  ensureModal();
  $('p4-modal-title').textContent = title;
  $('p4-modal-kicker').textContent = kicker;
  $('p4-modal-body').innerHTML = body;
  $('p4-modal').classList.remove('hidden');
  window.setTimeout(() => $('p4-modal-body')?.querySelector('input,select,textarea,button')?.focus(), 0);
}
function closeModal() {
  $('p4-modal')?.classList.add('hidden');
  if ($('p4-modal-body')) $('p4-modal-body').innerHTML = '';
}

function syncNavigation() {
  const nav = $('primary-nav');
  if (!nav) return;
  nav.querySelectorAll('.p4-nav').forEach((node) => node.remove());
  if (!canOperate()) return;
  const button = document.createElement('button');
  button.className = 'nav-item p4-nav';
  button.dataset.p4Route = 'operations';
  button.innerHTML = '<span>▣</span>Operations';
  nav.appendChild(button);
}

function metric(label, value, note) {
  return `<article class="card metric"><div class="metric-top"><span>${esc(label)}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></article>`;
}

function operationsView() {
  if (!canOperate()) return '<div class="empty-state"><strong>Restricted</strong>Production Operations is available to administrators.</div>';
  const activeCourses = state.courses.filter((course) => course.status !== 'archived');
  const archivedCourses = state.courses.filter((course) => course.status === 'archived');
  const activeTerms = state.terms.filter((term) => term.status === 'active');
  const termRows = [...state.terms].sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || ''))).map((term) => `<tr><td><span class="row-title">${esc(term.name)}</span><span class="row-subtitle">${esc(schoolName(term.schoolId))}</span></td><td>${esc(term.startDate || '—')} → ${esc(term.endDate || '—')}</td><td><span class="pill ${term.status === 'active' ? 'success' : term.status === 'upcoming' ? 'info' : ''}">${esc(term.status || 'upcoming')}</span></td><td><div class="row-actions">${term.status !== 'active' ? `<button class="pill clickable info" data-p4-action="activate-term" data-id="${esc(term.id)}">Activate</button>` : ''}<button class="pill clickable" data-p4-action="edit-term" data-id="${esc(term.id)}">Edit</button></div></td></tr>`).join('');
  const courseRows = [...state.courses].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((course) => `<tr><td><span class="row-title">${esc(course.name)}</span><span class="row-subtitle">${esc(course.courseCode || 'No code')} · ${esc(schoolName(course.schoolId))}</span></td><td>${(course.teacherIds || []).length}</td><td>${(course.studentIds || []).length}</td><td><span class="pill ${course.status === 'archived' ? 'warning' : 'success'}">${esc(course.status || 'active')}</span></td><td><div class="row-actions"><button class="pill clickable info" data-p4-action="duplicate-course" data-id="${esc(course.id)}">Duplicate</button><button class="pill clickable ${course.status === 'archived' ? 'success' : 'warning'}" data-p4-action="toggle-archive" data-id="${esc(course.id)}">${course.status === 'archived' ? 'Restore' : 'Archive'}</button></div></td></tr>`).join('');
  return `<section class="hero p4-hero"><span class="eyebrow">PRODUCTION OPERATIONS</span><h1>ClassOS 1.0</h1><p>School-year lifecycle, course operations, data portability, branding, and production controls—without adding paid backend services.</p><div class="hero-actions"><button class="btn btn-primary" data-p4-action="new-term">Create term</button><button class="btn btn-secondary" data-p4-action="export-data">Export data</button>${isOwner() ? '<button class="btn btn-secondary" data-p4-action="import-roster">CSV access import</button>' : ''}</div></section>
    <section class="section grid grid-4">${metric('Active courses', activeCourses.length, 'Instructional spaces')}${metric('Archived', archivedCourses.length, 'Retained course records')}${metric('Active terms', activeTerms.length, 'Across visible schools')}${metric('People', state.users.length, 'Visible identities')}</section>
    <section class="section card"><div class="section-head"><div><span class="eyebrow">ACADEMIC CALENDAR</span><h3>Terms & school years</h3><p>Control active instructional periods without deleting historical records.</p></div><button class="btn btn-secondary" data-p4-action="new-term">Add term</button></div>${termRows ? `<div class="table-wrap"><table><thead><tr><th>Term</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody>${termRows}</tbody></table></div>` : '<div class="empty-state"><strong>No terms yet</strong>Create the first school year or semester.</div>'}</section>
    <section class="section card"><div class="section-head"><div><span class="eyebrow">COURSE LIFECYCLE</span><h3>Duplicate, archive, restore</h3><p>Archived courses remain in Firestore but are removed from normal instructional workflows.</p></div></div>${courseRows ? `<div class="table-wrap"><table><thead><tr><th>Course</th><th>Teachers</th><th>Students</th><th>Status</th><th></th></tr></thead><tbody>${courseRows}</tbody></table></div>` : '<div class="empty-state"><strong>No courses</strong>Create a course from the Academics area first.</div>'}</section>
    <section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">DATA PORTABILITY</span><h3>Export & migration tools</h3></div></div><div class="p4-action-stack"><button class="btn btn-secondary" data-p4-action="export-data">Export visible ClassOS data (JSON)</button><button class="btn btn-secondary" data-p4-action="export-roster">Export a course roster (CSV)</button>${isOwner() ? '<button class="btn btn-secondary" data-p4-action="import-roster">Pre-register accounts from CSV</button>' : ''}</div><p class="metric-note">Exports are created locally in your browser. They are not uploaded to Firebase Storage.</p></div>
    <div class="card"><div class="section-head"><div><span class="eyebrow">PLATFORM PRESENTATION</span><h3>Brand & appearance</h3></div></div>${isOwner() ? '<button class="btn btn-secondary" data-p4-action="brand-settings">Edit ClassOS branding</button>' : '<p class="metric-note">Platform branding is controlled by the Platform Owner.</p>'}<button class="btn btn-secondary" style="margin-left:8px" data-p4-action="appearance">My appearance</button><div class="callout info" style="margin-top:18px"><strong>Production guardrail:</strong> system controls never grant roles. Identity and permissions continue to be enforced by Firebase Authentication and Firestore Security Rules.</div></div></section>`;
}

async function renderOperations() {
  if (!canOperate()) return;
  state.route = 'operations';
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.remove('active'));
  document.querySelector('.p4-nav')?.classList.add('active');
  if ($('page-title')) $('page-title').textContent = 'Operations';
  if ($('workspace-kicker')) $('workspace-kicker').textContent = 'PRODUCTION';
  if ($('page-content')) $('page-content').innerHTML = '<div class="skeleton" style="height:160px"></div>';
  await load();
  if ($('page-content')) $('page-content').innerHTML = operationsView();
}

function schoolOptions(selected = '') {
  return state.schools.map((school) => `<option value="${esc(school.id)}" ${school.id === selected ? 'selected' : ''}>${esc(school.name)}</option>`).join('');
}

function showTermForm(term = null) {
  if (!state.schools.length) return toast('Create or join a school before adding a term.', 'error');
  openModal(term ? 'Edit term' : 'Create term', `<form id="p4-term-form"><input type="hidden" name="id" value="${esc(term?.id || '')}"><div class="form-grid"><div class="field span-2"><label>School</label><select name="schoolId" ${term ? 'disabled' : ''}>${schoolOptions(term?.schoolId || state.schools[0].id)}</select>${term ? `<input type="hidden" name="lockedSchoolId" value="${esc(term.schoolId)}">` : ''}</div><div class="field span-2"><label>Term name</label><input name="name" maxlength="80" required value="${esc(term?.name || '')}" placeholder="2026–2027 School Year"></div><div class="field"><label>Start date</label><input name="startDate" type="date" required value="${esc(term?.startDate || '')}"></div><div class="field"><label>End date</label><input name="endDate" type="date" required value="${esc(term?.endDate || '')}"></div><div class="field"><label>Status</label><select name="status"><option value="upcoming" ${term?.status === 'upcoming' ? 'selected' : ''}>Upcoming</option><option value="active" ${term?.status === 'active' ? 'selected' : ''}>Active</option><option value="closed" ${term?.status === 'closed' ? 'selected' : ''}>Closed</option></select></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-p4-action="close">Cancel</button><button class="btn btn-primary" type="submit">Save term</button></div></form>`, 'ACADEMIC CALENDAR');
}

function showDuplicate(course) {
  if (!course) return;
  openModal('Duplicate course', `<form id="p4-duplicate-form"><input type="hidden" name="courseId" value="${esc(course.id)}"><div class="callout info" style="margin-bottom:16px"><strong>Safe duplication:</strong> ClassOS copies the course shell and grade categories, but starts with an empty roster. Student submissions and historical grades are never copied.</div><div class="field"><label>New course name</label><input name="name" required maxlength="120" value="${esc(`${course.name} — Copy`)}"></div><div class="field"><label>Course code</label><input name="courseCode" maxlength="40" value="${esc(course.courseCode || '')}"></div><div class="field"><label>Term</label><select name="termId"><option value="">Keep current text</option>${state.terms.filter((term) => term.schoolId === course.schoolId).map((term) => `<option value="${esc(term.id)}">${esc(term.name)}</option>`).join('')}</select></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-p4-action="close">Cancel</button><button class="btn btn-primary" type="submit">Duplicate course</button></div></form>`, 'COURSE LIFECYCLE');
}

function showExportRoster() {
  const active = state.courses.filter((course) => course.status !== 'archived');
  if (!active.length) return toast('No active courses are available.', 'error');
  openModal('Export course roster', `<form id="p4-roster-export-form"><div class="field"><label>Course</label><select name="courseId">${active.map((course) => `<option value="${esc(course.id)}">${esc(course.name)}</option>`).join('')}</select></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-p4-action="close">Cancel</button><button class="btn btn-primary" type="submit">Download CSV</button></div></form>`, 'DATA PORTABILITY');
}

function showImportRoster() {
  if (!isOwner()) return;
  if (!state.schools.length) return toast('Create a school before importing access.', 'error');
  openModal('CSV access import', `<form id="p4-roster-import-form"><div class="callout warning" style="margin-bottom:16px"><strong>Pre-registration only:</strong> this does not create Firebase Authentication accounts. It approves verified emails to claim a role when those users sign in. Privileged administrator roles cannot be bulk-imported.</div><div class="field"><label>School</label><select name="schoolId">${schoolOptions()}</select></div><div class="field"><label>CSV file</label><input name="csv" type="file" accept=".csv,text/csv" required><span class="field-help">Required columns: <code>email,role</code>. Allowed roles: student, teacher, guardian, staff, counselor.</span></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-p4-action="close">Cancel</button><button class="btn btn-primary" type="submit">Pre-register valid rows</button></div></form>`, 'DATA IMPORT');
}

function showBrandSettings() {
  if (!isOwner()) return;
  const brand = state.brand || {};
  openModal('Platform branding', `<form id="p4-brand-form"><div class="field"><label>Product name</label><input name="productName" required maxlength="40" value="${esc(brand.productName || 'ClassOS')}"></div><div class="field"><label>Tagline</label><input name="tagline" maxlength="140" value="${esc(brand.tagline || 'School shouldn’t be this complicated.')}"></div><div class="field"><label>Accent color</label><input name="accent" type="text" pattern="#[0-9A-Fa-f]{6}" value="${esc(brand.accent || '#2563eb')}" placeholder="#2563eb"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-p4-action="close">Cancel</button><button class="btn btn-primary" type="submit">Save branding</button></div></form>`, 'PLATFORM');
}

function currentAppearance() {
  return {
    theme: localStorage.getItem('classos.theme') || 'system',
    density: localStorage.getItem('classos.density') || 'comfortable'
  };
}

function showAppearance() {
  const pref = currentAppearance();
  openModal('Appearance', `<form id="p4-appearance-form"><div class="field"><label>Theme</label><select name="theme"><option value="system" ${pref.theme === 'system' ? 'selected' : ''}>Use system setting</option><option value="light" ${pref.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${pref.theme === 'dark' ? 'selected' : ''}>Dark</option></select></div><div class="field"><label>Density</label><select name="density"><option value="comfortable" ${pref.density === 'comfortable' ? 'selected' : ''}>Comfortable</option><option value="compact" ${pref.density === 'compact' ? 'selected' : ''}>Compact</option></select></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-p4-action="close">Cancel</button><button class="btn btn-primary" type="submit">Apply</button></div></form>`, 'PERSONAL PREFERENCE');
}

function applyAppearance() {
  const pref = currentAppearance();
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const dark = pref.theme === 'dark' || (pref.theme === 'system' && systemDark);
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('density-compact', pref.density === 'compact');
}

function downloadable(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(), version: 'ClassOS 1.0',
    organizations: state.organizations, schools: state.schools, terms: state.terms,
    courses: state.courses, users: state.users, assignments: state.assignments,
    assessments: state.assessments, standards: state.standards
  };
  downloadable(`classos-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  toast('ClassOS export created locally.', 'success');
}

function exportRoster(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return;
  const rows = [['role', 'name', 'email', 'course', 'school']];
  (course.teacherIds || []).forEach((id) => { const p = state.users.find((u) => u.id === id); rows.push(['teacher', p?.displayName || '', p?.email || '', course.name, schoolName(course.schoolId)]); });
  (course.studentIds || []).forEach((id) => { const p = state.users.find((u) => u.id === id); rows.push(['student', p?.displayName || '', p?.email || '', course.name, schoolName(course.schoolId)]); });
  downloadable(`${String(course.courseCode || course.name).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}-roster.csv`, rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  toast('Roster CSV created.', 'success');
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map((value) => value.trim().toLowerCase());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, String(values[index] || '').trim()])));
}

function searchEntries() {
  const entries = [];
  state.courses.filter((c) => c.status !== 'archived').forEach((item) => entries.push({ type: 'Course', title: item.name, detail: `${item.courseCode || ''} ${schoolName(item.schoolId)}`.trim(), route: 'courses' }));
  state.assignments.forEach((item) => entries.push({ type: 'Assignment', title: item.title, detail: courseName(item.courseId), route: 'assignments' }));
  state.assessments.filter((item) => item.status === 'published' || !['student', 'guardian'].includes(role())).forEach((item) => entries.push({ type: 'Assessment', title: item.title, detail: courseName(item.courseId), p3: 'assessments' }));
  state.standards.forEach((item) => entries.push({ type: 'Standard', title: `${item.code || ''} ${item.title || ''}`.trim(), detail: courseName(item.courseId), p3: 'learning' }));
  if (['platform_owner', 'district_admin', 'school_admin', 'counselor', 'teacher'].includes(role())) state.users.forEach((item) => entries.push({ type: 'Person', title: item.displayName || item.email, detail: `${item.email || ''} · ${String(item.role || '').replaceAll('_', ' ')}`, route: 'people' }));
  return entries;
}

function showSearch() {
  openModal('Search ClassOS', `<div class="field"><label for="p4-search-input">Search courses, work, standards${['platform_owner','district_admin','school_admin','counselor','teacher'].includes(role()) ? ', and people' : ''}</label><input id="p4-search-input" autocomplete="off" placeholder="Start typing…"></div><div id="p4-search-results" class="p4-search-results"><div class="empty-state"><strong>Search your ClassOS scope</strong>Results respect the same permissions as the rest of the platform.</div></div>`, 'GLOBAL SEARCH');
  const input = $('p4-search-input');
  const results = $('p4-search-results');
  const entries = searchEntries();
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.innerHTML = '<div class="empty-state"><strong>Search your ClassOS scope</strong>Enter a name, course, assignment, assessment, or standard.</div>'; return; }
    const matches = entries.filter((entry) => `${entry.title} ${entry.detail} ${entry.type}`.toLowerCase().includes(q)).slice(0, 30);
    results.innerHTML = matches.length ? matches.map((entry) => `<button class="p4-search-result" data-p4-open-route="${esc(entry.route || '')}" data-p4-open-p3="${esc(entry.p3 || '')}"><span class="pill">${esc(entry.type)}</span><div><strong>${esc(entry.title)}</strong><small>${esc(entry.detail)}</small></div></button>`).join('') : '<div class="empty-state"><strong>No results</strong>Try a broader search.</div>';
  };
  input.addEventListener('input', draw);
  window.setTimeout(() => input.focus(), 0);
}

function derivedNotifications() {
  const now = new Date();
  const soon = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const items = [];
  const unread = state.messages.filter((message) => (message.recipientIds || []).includes(uid()) && !(message.readBy || []).includes(uid()));
  unread.slice(0, 8).forEach((message) => items.push({ level: 'info', title: message.subject || 'New message', detail: `From ${personName(message.senderId)}`, route: 'inbox' }));
  if (role() === 'student') {
    state.assignments.filter((item) => item.status !== 'draft').forEach((assignment) => {
      const due = asDate(assignment.dueAt);
      if (!due || due < now || due > soon) return;
      items.push({ level: 'warning', title: assignment.title, detail: `Due ${fmt(due, true)} · ${courseName(assignment.courseId)}`, route: 'assignments' });
    });
    state.assessments.filter((item) => item.status === 'published').forEach((assessment) => {
      const due = asDate(assessment.dueAt);
      const attempted = state.attempts.some((attempt) => attempt.assessmentId === assessment.id && attempt.studentId === uid());
      if (!attempted && due && due >= now && due <= soon) items.push({ level: 'warning', title: assessment.title, detail: `Assessment due ${fmt(due, true)}`, p3: 'assessments' });
    });
  }
  if (['platform_owner', 'district_admin', 'school_admin', 'teacher'].includes(role())) {
    state.attempts.filter((attempt) => attempt.status === 'submitted').slice(0, 10).forEach((attempt) => items.push({ level: 'info', title: 'Assessment ready for review', detail: `${personName(attempt.studentId)} · ${courseName(attempt.courseId)}`, p3: 'assessments' }));
  }
  if (['platform_owner', 'district_admin', 'school_admin', 'counselor', 'teacher'].includes(role())) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    state.interventions.filter((item) => item.status !== 'resolved' && item.nextReviewDate && new Date(`${item.nextReviewDate}T00:00:00`) <= today).slice(0, 10).forEach((item) => items.push({ level: 'warning', title: item.title || 'Intervention review', detail: `${personName(item.studentId)} · review due ${item.nextReviewDate}`, p3: 'support' }));
  }
  return items.slice(0, 30);
}

function updateNotificationBadge() {
  const button = document.querySelector('.notification-btn');
  if (!button) return;
  button.querySelector('.p4-notification-badge')?.remove();
  const count = derivedNotifications().length;
  if (!count) return;
  const badge = document.createElement('span');
  badge.className = 'p4-notification-badge'; badge.textContent = count > 9 ? '9+' : String(count);
  button.appendChild(badge);
}

function showNotifications() {
  const items = derivedNotifications();
  openModal('Notifications', items.length ? `<div class="p4-notification-list">${items.map((item) => `<button class="p4-notification-item" data-p4-open-route="${esc(item.route || '')}" data-p4-open-p3="${esc(item.p3 || '')}"><span class="p4-notification-dot ${esc(item.level)}"></span><div><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></div></button>`).join('')}</div>` : '<div class="empty-state"><strong>You’re caught up.</strong>No current ClassOS alerts need your attention.</div>', 'NOTIFICATION CENTER');
}

function navigateTarget(routeName, p3Route) {
  closeModal();
  if (p3Route) {
    const target = document.querySelector(`.p3-nav[data-p3-route="${CSS.escape(p3Route)}"]`);
    if (target) target.click();
    return;
  }
  if (routeName) document.querySelector(`.nav-item[data-route="${CSS.escape(routeName)}"]`)?.click();
}

function decorateCorePages() {
  const title = $('page-title')?.textContent || '';
  if (title === 'Platform') {
    document.querySelectorAll('#page-content .pill.success').forEach((pill) => {
      if (/^Phase [23]$/.test(pill.textContent.trim())) pill.textContent = 'ClassOS 1.0';
    });
  }
  if (title === 'Settings' && !document.querySelector('.p4-settings-card')) {
    const content = $('page-content'); if (!content) return;
    const card = document.createElement('section'); card.className = 'card p4-settings-card section';
    card.innerHTML = `<div class="section-head"><div><span class="eyebrow">EXPERIENCE</span><h3>Appearance & accessibility</h3><p>Theme and density are stored only in this browser.</p></div><button class="btn btn-secondary" data-p4-action="appearance">Customize</button></div><div class="p4-setting-summary"><span class="pill success">Keyboard: Ctrl/⌘ K search</span><span class="pill">Reduced-motion aware</span><span class="pill">Visible focus states</span></div>`;
    content.appendChild(card);
  }
  if (title === 'Home' && state.profile?.status === 'active' && !document.querySelector('.p4-release-chip')) {
    const hero = document.querySelector('#page-content .hero');
    if (hero) {
      const chip = document.createElement('span'); chip.className = 'pill success p4-release-chip'; chip.textContent = 'ClassOS 1.0'; hero.appendChild(chip);
    }
  }
}

function removeTeacherStaffRosterControls() {
  if (role() !== 'teacher') return;
  const modal = $('modal-body');
  if (!modal) return;
  modal.querySelectorAll('.roster-section').forEach((section) => {
    if (section.querySelector('h4')?.textContent.trim() === 'Teachers') section.remove();
  });
}

function validExternalUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch { return false; }
}

async function handleAction(event) {
  const target = event.target.closest('[data-p4-action]');
  if (!target) return false;
  const action = target.dataset.p4Action;
  if (action === 'close') closeModal();
  if (action === 'new-term') showTermForm();
  if (action === 'edit-term') showTermForm(state.terms.find((item) => item.id === target.dataset.id));
  if (action === 'activate-term') {
    const term = state.terms.find((item) => item.id === target.dataset.id); if (!term) return true;
    for (const item of state.terms.filter((other) => other.schoolId === term.schoolId && other.id !== term.id && other.status === 'active')) await updateDoc(doc(db, 'terms', item.id), { status: 'closed', updatedAt: serverTimestamp() });
    await updateDoc(doc(db, 'terms', term.id), { status: 'active', updatedAt: serverTimestamp() });
    toast('Active term updated.', 'success'); await renderOperations();
  }
  if (action === 'duplicate-course') showDuplicate(state.courses.find((item) => item.id === target.dataset.id));
  if (action === 'toggle-archive') {
    const course = state.courses.find((item) => item.id === target.dataset.id); if (!course) return true;
    const next = course.status === 'archived' ? 'active' : 'archived';
    await updateDoc(doc(db, 'courses', course.id), { status: next, updatedAt: serverTimestamp() });
    toast(next === 'archived' ? 'Course archived.' : 'Course restored.', 'success'); await renderOperations();
  }
  if (action === 'export-data') exportData();
  if (action === 'export-roster') showExportRoster();
  if (action === 'import-roster') showImportRoster();
  if (action === 'brand-settings') showBrandSettings();
  if (action === 'appearance') showAppearance();
  return true;
}

async function handleForm(form) {
  if (!form?.id?.startsWith('p4-')) return false;
  if (form.id === 'p4-term-form') {
    const data = Object.fromEntries(new FormData(form));
    const schoolId = data.lockedSchoolId || data.schoolId;
    const start = new Date(`${data.startDate}T00:00:00`), end = new Date(`${data.endDate}T00:00:00`);
    if (!schoolId || !data.name.trim() || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new Error('Enter a valid term name and date range.');
    const school = state.schools.find((item) => item.id === schoolId); if (!school) throw new Error('School unavailable.');
    const payload = { schoolId, organizationId: school.organizationId || '', name: data.name.trim(), startDate: data.startDate, endDate: data.endDate, status: data.status, updatedAt: serverTimestamp() };
    if (data.id) await updateDoc(doc(db, 'terms', data.id), payload);
    else await addDoc(collection(db, 'terms'), { ...payload, createdBy: uid(), createdAt: serverTimestamp() });
    closeModal(); toast('Term saved.', 'success'); await renderOperations();
  }
  if (form.id === 'p4-duplicate-form') {
    const data = Object.fromEntries(new FormData(form));
    const source = state.courses.find((item) => item.id === data.courseId); if (!source) throw new Error('Source course unavailable.');
    const term = state.terms.find((item) => item.id === data.termId);
    await addDoc(collection(db, 'courses'), {
      organizationId: source.organizationId || '', schoolId: source.schoolId,
      name: data.name.trim(), courseCode: data.courseCode.trim(), term: term?.name || source.term || '', termId: term?.id || source.termId || '',
      teacherIds: [], studentIds: [], gradeCategories: Array.isArray(source.gradeCategories) ? source.gradeCategories : [{ id: 'coursework', name: 'Coursework', weight: 100 }],
      status: 'active', duplicatedFrom: source.id, createdBy: uid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    closeModal(); toast('Course shell duplicated with an empty roster.', 'success'); await renderOperations();
  }
  if (form.id === 'p4-roster-export-form') {
    const data = Object.fromEntries(new FormData(form)); exportRoster(data.courseId); closeModal();
  }
  if (form.id === 'p4-roster-import-form') {
    if (!isOwner()) throw new Error('Only the Platform Owner can bulk pre-register access.');
    const schoolId = form.elements.schoolId.value;
    const school = state.schools.find((item) => item.id === schoolId); if (!school) throw new Error('Choose a valid school.');
    const file = form.elements.csv.files?.[0]; if (!file) throw new Error('Choose a CSV file.');
    const rows = parseCsv(await file.text());
    let accepted = 0, rejected = 0;
    for (const row of rows.slice(0, 500)) {
      const email = emailKey(row.email), userRole = String(row.role || '').toLowerCase();
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!validEmail || !BULK_ROLES.includes(userRole) || email === OWNER_EMAIL) { rejected += 1; continue; }
      await setDoc(doc(db, 'invitations', email), {
        email, role: userRole, schoolId, organizationId: school.organizationId || '', status: 'active',
        invitedBy: uid(), importSource: 'csv', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      }, { merge: true });
      accepted += 1;
    }
    closeModal(); toast(`${accepted} account${accepted === 1 ? '' : 's'} pre-registered${rejected ? `; ${rejected} row${rejected === 1 ? '' : 's'} rejected` : ''}.`, accepted ? 'success' : 'error'); await renderOperations();
  }
  if (form.id === 'p4-brand-form') {
    if (!isOwner()) throw new Error('Only the Platform Owner can change platform branding.');
    const data = Object.fromEntries(new FormData(form));
    const accent = data.accent.trim(); if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new Error('Use a six-digit hex color such as #2563eb.');
    await setDoc(doc(db, 'platformConfig', 'public'), { productName: data.productName.trim(), tagline: data.tagline.trim(), accent, updatedBy: uid(), updatedAt: serverTimestamp() }, { merge: true });
    state.brand = await direct('platformConfig', 'public'); applyBrand(); closeModal(); toast('Platform branding updated.', 'success');
  }
  if (form.id === 'p4-appearance-form') {
    const data = Object.fromEntries(new FormData(form));
    if (!['system', 'light', 'dark'].includes(data.theme) || !['comfortable', 'compact'].includes(data.density)) throw new Error('Invalid appearance setting.');
    localStorage.setItem('classos.theme', data.theme); localStorage.setItem('classos.density', data.density); applyAppearance(); closeModal(); toast('Appearance updated.', 'success');
  }
  return true;
}

function wire() {
  ensureModal(); applyAppearance();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if ((localStorage.getItem('classos.theme') || 'system') === 'system') applyAppearance(); });

  document.addEventListener('click', async (event) => {
    const p4Route = event.target.closest('.p4-nav[data-p4-route]');
    if (p4Route) { event.preventDefault(); event.stopImmediatePropagation(); await renderOperations(); $('sidebar')?.classList.remove('open'); return; }
    const open = event.target.closest('[data-p4-open-route],[data-p4-open-p3]');
    if (open) { event.preventDefault(); event.stopImmediatePropagation(); navigateTarget(open.dataset.p4OpenRoute, open.dataset.p4OpenP3); return; }
    const anchor = event.target.closest('a[href]');
    if (anchor) {
      try {
        const parsed = new URL(anchor.getAttribute('href'), location.href);
        if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
          event.preventDefault(); event.stopImmediatePropagation(); toast('ClassOS blocked an unsafe link.', 'error'); return;
        }
      } catch {
        event.preventDefault(); event.stopImmediatePropagation(); toast('ClassOS blocked an invalid link.', 'error'); return;
      }
    }
    const roster = event.target.closest('[data-lms-action="roster-change"][data-field="teacherIds"]');
    if (roster && role() === 'teacher') {
      event.preventDefault(); event.stopImmediatePropagation(); toast('Teachers cannot appoint or remove course teachers. Ask a school administrator.', 'error'); return;
    }
    await handleAction(event);
  }, true);

  document.addEventListener('submit', async (event) => {
    if (event.target.id === 'lms-submission-form') {
      const link = event.target.elements.linkUrl?.value?.trim() || '';
      if (link && !validExternalUrl(link)) {
        event.preventDefault(); event.stopImmediatePropagation(); toast('Submission links must begin with http:// or https://.', 'error'); return;
      }
    }
    if (!event.target.id?.startsWith('p4-')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const button = event.target.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = 'Saving…'; }
    try { await handleForm(event.target); }
    catch (error) { console.error(error); toast(error.message || 'Could not save.', 'error'); if (button) { button.disabled = false; button.textContent = button.dataset.label || 'Save'; } }
  }, true);

  document.addEventListener('keydown', async (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); if (state.ready) { await load(); showSearch(); }
    }
    if (event.key === 'Escape') closeModal();
  });

  $('primary-nav')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-route],[data-p3-route]')) { state.route = null; document.querySelector('.p4-nav')?.classList.remove('active'); }
  });

  const searchButton = $('global-search');
  if (searchButton) searchButton.onclick = async (event) => { event.preventDefault(); event.stopPropagation(); if (state.ready) { await load(); showSearch(); } };
  const notification = document.querySelector('.notification-btn');
  notification?.addEventListener('click', async (event) => { event.preventDefault(); event.stopImmediatePropagation(); if (state.ready) { await load(); updateNotificationBadge(); showNotifications(); } }, true);

  const observer = new MutationObserver(() => {
    decorateCorePages(); removeTeacherStaffRosterControls(); updateNotificationBadge();
  });
  if ($('page-content')) observer.observe($('page-content'), { childList: true, subtree: false });
  if ($('modal-body')) observer.observe($('modal-body'), { childList: true, subtree: true });
}

wire();

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  if (!user || (user.providerData.some((provider) => provider.providerId === 'password') && !user.emailVerified)) {
    state.profile = null; state.ready = false; document.querySelectorAll('.p4-nav').forEach((node) => node.remove()); return;
  }
  try {
    state.profile = await loadProfile(user);
    if (!state.profile || state.profile.status !== 'active') return;
    await ensurePhase4();
    await load();
    state.ready = true;
    syncNavigation(); decorateCorePages(); updateNotificationBadge();
  } catch (error) {
    console.warn('ClassOS Phase 4 startup did not finish', error);
  }
});
