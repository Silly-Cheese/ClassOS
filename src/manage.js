import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const emailKey = (value = '') => String(value).trim().toLowerCase();

const state = {
  profile: null, courses: [], assignments: [], assessments: [], terms: [], schools: [], organizations: [], users: [], route: false
};

const uid = () => auth.currentUser?.uid || '';
const role = () => state.profile?.role || '';
const isOwner = () => emailKey(auth.currentUser?.email) === OWNER_EMAIL;
const isAdmin = () => isOwner() || ['district_admin', 'school_admin'].includes(role());
const canManage = () => isAdmin() || role() === 'teacher';
const canManageCourse = (course) => !!course && (isAdmin() || (role() === 'teacher' && (course.teacherIds || []).includes(uid())));

function toast(message, type = '') {
  const region = $('toast-region'); if (!region) return;
  const node = document.createElement('div'); node.className = `toast ${type}`.trim(); node.textContent = message; region.appendChild(node);
  window.setTimeout(() => node.remove(), 4300);
}

async function direct(name, id) {
  const snap = await getDoc(doc(db, name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
async function allDocs(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}
async function byField(name, field, value) {
  const snap = await getDocs(query(collection(db, name), where(field, '==', value)));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}
async function arrayContains(name, field, value) {
  const snap = await getDocs(query(collection(db, name), where(field, 'array-contains', value)));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}
function unique(items) {
  const map = new Map(); items.forEach((item) => item?.id && map.set(item.id, item)); return [...map.values()];
}

async function loadProfile() {
  if (!auth.currentUser) return null;
  return direct('users', auth.currentUser.uid);
}

async function loadScope() {
  if (!state.profile || state.profile.status !== 'active') return;
  if (isOwner()) {
    [state.courses, state.terms, state.schools, state.organizations, state.users] = await Promise.all([
      allDocs('courses'), allDocs('terms'), allDocs('schools'), allDocs('organizations'), allDocs('users')
    ]);
  } else if (['district_admin', 'school_admin'].includes(role())) {
    const schoolIds = state.profile.schoolIds || [];
    const [courseBatches, termBatches, schoolDocs] = await Promise.all([
      Promise.all(schoolIds.map((id) => byField('courses', 'schoolId', id))),
      Promise.all(schoolIds.map((id) => byField('terms', 'schoolId', id))),
      Promise.all(schoolIds.map((id) => direct('schools', id)))
    ]);
    state.courses = unique(courseBatches.flat()); state.terms = unique(termBatches.flat()); state.schools = schoolDocs.filter(Boolean);
    state.organizations = []; state.users = [];
  } else if (role() === 'teacher') {
    state.courses = await arrayContains('courses', 'teacherIds', uid());
    state.terms = []; state.schools = []; state.organizations = []; state.users = [];
  }
  const ids = state.courses.map((course) => course.id);
  const [assignmentBatches, assessmentBatches] = await Promise.all([
    Promise.all(ids.map((id) => byField('assignments', 'courseId', id))),
    Promise.all(ids.map((id) => byField('assessments', 'courseId', id)))
  ]);
  state.assignments = unique(assignmentBatches.flat());
  state.assessments = unique(assessmentBatches.flat());
}

function schoolName(id) { return state.schools.find((item) => item.id === id)?.name || 'School'; }
function courseName(id) { return state.courses.find((item) => item.id === id)?.name || 'Course'; }

function syncNav() {
  const nav = $('primary-nav'); if (!nav) return;
  nav.querySelectorAll('.manage-nav').forEach((node) => node.remove());
  if (!canManage()) return;
  const button = document.createElement('button');
  button.className = 'nav-item manage-nav'; button.dataset.manageRoute = 'manage'; button.innerHTML = '<span>⌫</span>Manage';
  const people = nav.querySelector('[data-route="people"]'); nav.insertBefore(button, people || null);
}

function deleteButton(type, id, label = 'Delete') {
  return `<button class="btn btn-danger manage-delete-btn" data-manage-delete="${esc(type)}" data-id="${esc(id)}">${esc(label)}</button>`;
}
function row(title, subtitle, action) {
  return `<div class="manage-row"><div><strong>${esc(title)}</strong><span>${esc(subtitle)}</span></div>${action}</div>`;
}
function section(title, subtitle, body) {
  return `<section class="card manage-section"><div class="section-head"><div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div></div>${body || '<div class="empty-state">Nothing here.</div>'}</section>`;
}

function renderManage() {
  const content = $('page-content'); if (!content || !canManage()) return;
  state.route = true;
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.remove('active'));
  document.querySelector('.manage-nav')?.classList.add('active');
  if ($('page-title')) $('page-title').textContent = 'Manage';
  if ($('workspace-kicker')) $('workspace-kicker').textContent = 'CLASSOS';

  const manageableAssignments = state.assignments.filter((item) => canManageCourse(state.courses.find((course) => course.id === item.courseId)));
  const manageableAssessments = state.assessments.filter((item) => canManageCourse(state.courses.find((course) => course.id === item.courseId)));
  const assignmentsBody = manageableAssignments.sort((a,b) => String(a.title).localeCompare(String(b.title))).map((item) => row(item.title, `${courseName(item.courseId)} · ${item.pointsPossible || 0} pts`, deleteButton('assignment', item.id))).join('');
  const assessmentsBody = manageableAssessments.sort((a,b) => String(a.title).localeCompare(String(b.title))).map((item) => row(item.title, `${courseName(item.courseId)} · ${item.pointsPossible || 0} pts`, deleteButton('assessment', item.id))).join('');
  const courseBody = isAdmin() ? state.courses.sort((a,b) => String(a.name).localeCompare(String(b.name))).map((item) => row(item.name, `${item.courseCode || 'No code'} · ${schoolName(item.schoolId)}`, deleteButton('course', item.id, 'Delete class'))).join('') : '';
  const termBody = isAdmin() ? state.terms.sort((a,b) => String(a.name).localeCompare(String(b.name))).map((item) => row(item.name, `${schoolName(item.schoolId)} · ${item.startDate || '—'} to ${item.endDate || '—'}`, deleteButton('term', item.id))).join('') : '';

  let ownerSections = '';
  if (isOwner()) {
    const accounts = state.users.filter((user) => user.id !== uid() && user.status !== 'deleted').sort((a,b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
    const deleted = state.users.filter((user) => user.status === 'deleted').sort((a,b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
    const accountBody = accounts.map((user) => row(user.displayName || user.email || 'Account', `${user.email || ''} · ${(user.role || 'member').replaceAll('_',' ')}`, deleteButton('account', user.id, 'Delete account'))).join('');
    const deletedBody = deleted.map((user) => row(user.displayName || user.email || 'Account', `${user.email || ''} · deleted`, `<button class="btn btn-secondary" data-manage-restore="account" data-id="${esc(user.id)}">Restore</button>`)).join('');
    const schoolBody = state.schools.sort((a,b) => String(a.name).localeCompare(String(b.name))).map((item) => row(item.name, item.code || 'School', deleteButton('school', item.id, 'Delete school'))).join('');
    const orgBody = state.organizations.sort((a,b) => String(a.name).localeCompare(String(b.name))).map((item) => row(item.name, item.code || item.type || 'Organization', deleteButton('organization', item.id, 'Delete organization'))).join('');
    ownerSections = `${section('Accounts', 'Delete ClassOS access and remove the account from course rosters.', accountBody)}${deleted.length ? section('Deleted accounts', 'Restore an account if it was removed by mistake.', deletedBody) : ''}${section('Schools', 'Deleting a school also deletes its classes and terms.', schoolBody)}${section('Organizations', 'Deleting an organization also deletes the schools inside it.', orgBody)}`;
  }

  content.innerHTML = `<div class="manage-page"><section class="manage-hero"><div><span class="eyebrow">MANAGE</span><h2>Clean up ClassOS</h2><p>Delete old assignments, assessments, classes, terms, and other records without hunting through different screens.</p></div><input id="manage-search" class="control" type="search" placeholder="Find something to delete…" aria-label="Search manage page"></section><div class="manage-grid">${section('Assignments', 'Assignments you are allowed to manage.', assignmentsBody)}${section('Assessments', 'Published and draft assessments you are allowed to manage.', assessmentsBody)}${isAdmin() ? section('Classes', 'Deleting a class also removes its assignments, grades, attendance, assessments, and related records.', courseBody) : ''}${isAdmin() ? section('Terms', 'Remove terms that are no longer needed.', termBody) : ''}${ownerSections}</div></div>`;
}

async function render() {
  if (!canManage()) return;
  const content = $('page-content'); if (content) content.innerHTML = '<div class="skeleton" style="height:160px"></div>';
  try { await loadScope(); renderManage(); }
  catch (error) { console.error(error); if (content) content.innerHTML = `<div class="empty-state"><strong>Manage could not load.</strong>${esc(error.message || '')}</div>`; }
}

function ensureDialog() {
  if ($('manage-delete-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="manage-delete-modal" class="modal-backdrop hidden"><section class="modal manage-confirm"><div class="modal-head"><div><span class="eyebrow">CONFIRM</span><h3 id="manage-confirm-title">Delete</h3></div><button class="icon-btn" data-manage-close>×</button></div><div id="manage-confirm-body" class="modal-body"></div></section></div>`);
}
function closeDialog() { $('manage-delete-modal')?.classList.add('hidden'); if ($('manage-confirm-body')) $('manage-confirm-body').innerHTML = ''; }
function itemLabel(type, id) {
  const map = { assignment: state.assignments, assessment: state.assessments, course: state.courses, term: state.terms, school: state.schools, organization: state.organizations, account: state.users };
  const item = map[type]?.find((entry) => entry.id === id);
  return item?.title || item?.name || item?.displayName || item?.email || type;
}
function openDelete(type, id) {
  ensureDialog();
  const label = itemLabel(type, id);
  const structural = ['course','school','organization'].includes(type);
  $('manage-confirm-title').textContent = `Delete ${label}?`;
  $('manage-confirm-body').innerHTML = `<div class="callout ${structural ? 'warning' : ''}"><strong>This ${structural ? 'also deletes related records' : 'cannot be undone from this screen'}.</strong>${type === 'account' ? '<br>The Firebase sign-in identity is kept, but ClassOS access is removed.' : ''}</div>${structural ? `<div class="field" style="margin-top:16px"><label>Type DELETE to continue</label><input id="manage-confirm-input" autocomplete="off" placeholder="DELETE"></div>` : ''}<div class="modal-actions"><button class="btn btn-secondary" data-manage-close>Cancel</button><button class="btn btn-danger" data-manage-confirm="${esc(type)}" data-id="${esc(id)}" ${structural ? 'disabled' : ''}>Delete</button></div>`;
  $('manage-delete-modal').classList.remove('hidden');
}

async function deleteRows(rows) { for (const item of rows) await deleteDoc(doc(db, item.collection, item.id)); }
async function deleteWhere(name, field, value) {
  const rows = await byField(name, field, value); for (const item of rows) await deleteDoc(doc(db, name, item.id)); return rows.length;
}

async function deleteAssignment(id) {
  const item = await direct('assignments', id); if (!item) return;
  await deleteWhere('submissions', 'assignmentId', id);
  await deleteDoc(doc(db, 'assignments', id));
}
async function deleteAssessment(id) {
  const item = await direct('assessments', id); if (!item) return;
  await deleteWhere('assessmentAttempts', 'assessmentId', id);
  try { await deleteDoc(doc(db, 'assessmentKeys', id)); } catch {}
  await deleteDoc(doc(db, 'assessments', id));
}
async function deleteCourse(id) {
  const item = await direct('courses', id); if (!item) return;
  const collections = ['submissions','attendanceRecords','announcements','standards','questionBank','assessmentAttempts','assessmentKeys','interventions'];
  for (const name of collections) await deleteWhere(name, 'courseId', id);
  const assignmentRows = await byField('assignments', 'courseId', id); for (const row of assignmentRows) await deleteDoc(doc(db, 'assignments', row.id));
  const assessmentRows = await byField('assessments', 'courseId', id); for (const row of assessmentRows) await deleteDoc(doc(db, 'assessments', row.id));
  await deleteDoc(doc(db, 'courses', id));
}
async function deleteTerm(id) { await deleteDoc(doc(db, 'terms', id)); }
async function deleteAccount(id) {
  if (!isOwner() || id === uid()) throw new Error('The Platform Owner account cannot be deleted here.');
  const user = await direct('users', id); if (!user) return;
  const [studentCourses, teacherCourses, people] = await Promise.all([arrayContains('courses','studentIds',id), arrayContains('courses','teacherIds',id), allDocs('users')]);
  for (const course of unique(studentCourses.concat(teacherCourses))) {
    await updateDoc(doc(db, 'courses', course.id), {
      studentIds: (course.studentIds || []).filter((value) => value !== id),
      teacherIds: (course.teacherIds || []).filter((value) => value !== id),
      updatedAt: serverTimestamp()
    });
  }
  for (const person of people) {
    const linkedStudentIds = (person.linkedStudentIds || []).filter((value) => value !== id);
    const guardianIds = (person.guardianIds || []).filter((value) => value !== id);
    if (linkedStudentIds.length !== (person.linkedStudentIds || []).length || guardianIds.length !== (person.guardianIds || []).length) {
      await updateDoc(doc(db, 'users', person.id), { linkedStudentIds, guardianIds });
    }
  }
  if (user.email) { try { await deleteDoc(doc(db, 'invitations', emailKey(user.email))); } catch {} }
  await updateDoc(doc(db, 'users', id), { statusBeforeDelete: user.status || 'active', status: 'deleted', deletedAt: serverTimestamp(), deletedBy: uid() });
}
async function restoreAccount(id) {
  if (!isOwner()) return;
  const user = await direct('users', id); if (!user || user.status !== 'deleted') return;
  await updateDoc(doc(db, 'users', id), { status: user.statusBeforeDelete || 'pending', statusBeforeDelete: deleteField(), deletedAt: deleteField(), deletedBy: deleteField() });
}
async function deleteSchool(id) {
  if (!isOwner()) throw new Error('Only the Platform Owner can delete a school.');
  const courses = await byField('courses','schoolId',id); for (const course of courses) await deleteCourse(course.id);
  await deleteWhere('terms','schoolId',id); await deleteWhere('interventions','schoolId',id);
  const invitations = await byField('invitations','schoolId',id); for (const invite of invitations) await deleteDoc(doc(db,'invitations',invite.id));
  const users = await arrayContains('users','schoolIds',id); for (const user of users) await updateDoc(doc(db,'users',user.id), { schoolIds: (user.schoolIds || []).filter((value) => value !== id) });
  await deleteDoc(doc(db,'schools',id));
}
async function deleteOrganization(id) {
  if (!isOwner()) throw new Error('Only the Platform Owner can delete an organization.');
  const schools = await byField('schools','organizationId',id); for (const school of schools) await deleteSchool(school.id);
  const invitations = await byField('invitations','organizationId',id); for (const invite of invitations) await deleteDoc(doc(db,'invitations',invite.id));
  const users = await arrayContains('users','organizationIds',id); for (const user of users) await updateDoc(doc(db,'users',user.id), { organizationIds: (user.organizationIds || []).filter((value) => value !== id) });
  await deleteDoc(doc(db,'organizations',id));
}

async function executeDelete(type, id, button) {
  button.disabled = true; button.textContent = 'Deleting…';
  try {
    if (type === 'assignment') await deleteAssignment(id);
    if (type === 'assessment') await deleteAssessment(id);
    if (type === 'course') await deleteCourse(id);
    if (type === 'term') await deleteTerm(id);
    if (type === 'account') await deleteAccount(id);
    if (type === 'school') await deleteSchool(id);
    if (type === 'organization') await deleteOrganization(id);
    closeDialog(); toast('Deleted.', 'success'); await loadScope(); if (state.route) renderManage();
  } catch (error) {
    console.error(error); toast(error?.code === 'permission-denied' ? 'Your account does not have permission to delete that item.' : error.message || 'Could not delete.', 'error');
    button.disabled = false; button.textContent = 'Delete';
  }
}

function filterManage(value) {
  const q = String(value || '').trim().toLowerCase();
  document.querySelectorAll('.manage-row').forEach((row) => row.classList.toggle('hidden', q && !row.textContent.toLowerCase().includes(q)));
}

function decorateCorePages() {
  const title = $('page-title')?.textContent || '';
  if (title === 'People') {
    document.querySelectorAll('#page-content tbody tr').forEach((row) => {
      if ([...row.querySelectorAll('td')].some((cell) => cell.textContent.trim().toLowerCase() === 'deleted')) row.remove();
    });
  }
  if (!canManage()) return;
  if (title === 'Assignments' || title === 'Course') {
    document.querySelectorAll('[data-lms-action="grade-assignment"]').forEach((grade) => {
      const id = grade.dataset.assignmentId; if (!id || grade.parentElement?.querySelector(`[data-manage-delete="assignment"][data-id="${CSS.escape(id)}"]`)) return;
      grade.insertAdjacentHTML('afterend', `<button class="pill clickable danger" data-manage-delete="assignment" data-id="${esc(id)}">Delete</button>`);
    });
  }
  if (title === 'Assessments') {
    const manageable = state.assessments.filter((item) => canManageCourse(state.courses.find((course) => course.id === item.courseId)));
    document.querySelectorAll('#page-content .list-row').forEach((row) => {
      if (row.querySelector('[data-manage-delete="assessment"]')) return;
      const name = row.querySelector('.list-main strong')?.textContent?.trim();
      const item = manageable.find((entry) => entry.title === name); if (!item) return;
      const actionHost = row.lastElementChild;
      if (actionHost) actionHost.insertAdjacentHTML('afterend', `<button class="pill clickable danger" data-manage-delete="assessment" data-id="${esc(item.id)}">Delete</button>`);
    });
  }
}

ensureDialog();
document.addEventListener('click', async (event) => {
  const manageNav = event.target.closest('[data-manage-route="manage"]');
  if (manageNav) { event.preventDefault(); event.stopImmediatePropagation(); await render(); $('sidebar')?.classList.remove('open'); return; }
  const del = event.target.closest('[data-manage-delete]');
  if (del) { event.preventDefault(); event.stopImmediatePropagation(); openDelete(del.dataset.manageDelete, del.dataset.id); return; }
  if (event.target.closest('[data-manage-close]')) { closeDialog(); return; }
  const confirmButton = event.target.closest('[data-manage-confirm]');
  if (confirmButton) { await executeDelete(confirmButton.dataset.manageConfirm, confirmButton.dataset.id, confirmButton); return; }
  const restore = event.target.closest('[data-manage-restore="account"]');
  if (restore) { restore.disabled = true; try { await restoreAccount(restore.dataset.id); toast('Account restored.', 'success'); await loadScope(); renderManage(); } catch (error) { toast(error.message || 'Could not restore account.', 'error'); restore.disabled = false; } }
  if (event.target.closest('.nav-item[data-route], .p3-nav, .p4-nav')) state.route = false;
}, true);

document.addEventListener('input', (event) => {
  if (event.target.id === 'manage-search') filterManage(event.target.value);
  if (event.target.id === 'manage-confirm-input') {
    const button = document.querySelector('[data-manage-confirm]'); if (button) button.disabled = event.target.value.trim() !== 'DELETE';
  }
}, true);

$('manage-delete-modal')?.addEventListener('click', (event) => { if (event.target.id === 'manage-delete-modal') closeDialog(); });
const content = $('page-content'); if (content) new MutationObserver(() => window.setTimeout(decorateCorePages, 60)).observe(content, { childList: true, subtree: false });

onAuthStateChanged(auth, async (user) => {
  if (!user) { state.profile = null; state.route = false; syncNav(); return; }
  try { state.profile = await loadProfile(); if (!state.profile || state.profile.status !== 'active') return; await loadScope(); syncNav(); decorateCorePages(); }
  catch (error) { console.warn('Management tools could not initialize', error); }
});
