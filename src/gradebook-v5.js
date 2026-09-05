import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
const emailKey = (value = '') => String(value).trim().toLowerCase();

let profile = null;
let courses = [];
let currentCourse = null;
let assignments = [];
let assessments = [];
let submissions = [];
let attempts = [];
let students = [];
let selectedCourseId = localStorage.getItem('classos-gradebook-course') || '';
let rendering = false;
let renderTimer = null;

const uid = () => auth.currentUser?.uid || '';
const role = () => profile?.role || '';
const isOwner = () => emailKey(auth.currentUser?.email) === OWNER_EMAIL;
const canEdit = () => isOwner() || ['district_admin', 'school_admin', 'teacher'].includes(role());

function toast(message, type = '') {
  const region = $('toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

async function direct(name, id) {
  const snapshot = await getDoc(doc(db, name, id));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function byField(name, field, value) {
  const snapshot = await getDocs(query(collection(db, name), where(field, '==', value)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function arrayContains(name, field, value) {
  const snapshot = await getDocs(query(collection(db, name), where(field, 'array-contains', value)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function unique(items) {
  const map = new Map();
  items.forEach((item) => item?.id && map.set(item.id, item));
  return [...map.values()];
}

async function loadProfile() {
  return auth.currentUser ? direct('users', auth.currentUser.uid) : null;
}

async function loadCourses() {
  if (isOwner()) {
    const snapshot = await getDocs(collection(db, 'courses'));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.status !== 'archived');
  }
  if (role() === 'teacher') return (await arrayContains('courses', 'teacherIds', uid())).filter((item) => item.status !== 'archived');
  if (['district_admin', 'school_admin'].includes(role())) {
    const batches = await Promise.all((profile?.schoolIds || []).map((schoolId) => byField('courses', 'schoolId', schoolId)));
    return unique(batches.flat()).filter((item) => item.status !== 'archived');
  }
  return [];
}

async function loadPerson(id) {
  try {
    return await direct('users', id) || { id, displayName: 'Student' };
  } catch {
    return { id, displayName: 'Student' };
  }
}

function categories() {
  return Array.isArray(currentCourse?.gradeCategories) && currentCourse.gradeCategories.length
    ? currentCourse.gradeCategories.map((item) => ({ id: String(item.id || 'coursework'), name: String(item.name || 'Coursework'), weight: Number(item.weight) || 0 }))
    : [{ id: 'coursework', name: 'Coursework', weight: 100 }];
}

function gradeItems() {
  const assignmentItems = assignments.map((item) => ({
    id: item.id,
    type: 'assignment',
    title: item.title,
    pointsPossible: Number(item.pointsPossible) || 0,
    categoryId: item.categoryId || 'coursework',
    dueAt: item.dueAt
  }));
  const assessmentItems = assessments.map((item) => ({
    id: item.id,
    type: 'assessment',
    title: item.title,
    pointsPossible: Number(item.pointsPossible) || 0,
    categoryId: item.categoryId || 'coursework',
    dueAt: item.dueAt
  }));
  return assignmentItems.concat(assessmentItems).sort((a, b) => {
    const aTime = Number(a.dueAt?.seconds || 0);
    const bTime = Number(b.dueAt?.seconds || 0);
    return aTime - bTime || String(a.title).localeCompare(String(b.title));
  });
}

function submissionFor(assignmentId, studentId) {
  return submissions.find((item) => item.assignmentId === assignmentId && item.studentId === studentId) || null;
}

function attemptFor(assessmentId, studentId) {
  return attempts.find((item) => item.assessmentId === assessmentId && item.studentId === studentId) || null;
}

function recordFor(item, studentId) {
  return item.type === 'assessment' ? attemptFor(item.id, studentId) : submissionFor(item.id, studentId);
}

function overall(studentId) {
  const items = gradeItems();
  const categoryRows = categories().map((category) => {
    let earned = 0;
    let possible = 0;
    items.filter((item) => item.categoryId === category.id).forEach((item) => {
      const record = recordFor(item, studentId);
      if (record?.status !== 'graded' || !Number.isFinite(Number(record.score))) return;
      earned += Number(record.score);
      possible += Number(item.pointsPossible) || 0;
    });
    return { ...category, earned, possible, percent: possible ? earned / possible * 100 : null };
  });
  const active = categoryRows.filter((item) => item.percent !== null && item.weight > 0);
  const weight = active.reduce((sum, item) => sum + item.weight, 0);
  if (active.length && weight) return active.reduce((sum, item) => sum + item.percent * item.weight / weight, 0);
  const earned = categoryRows.reduce((sum, item) => sum + item.earned, 0);
  const possible = categoryRows.reduce((sum, item) => sum + item.possible, 0);
  return possible ? earned / possible * 100 : null;
}

function gradeLabel(value) {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
}

function letterGrade(value) {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value >= 90) return 'A';
  if (value >= 80) return 'B';
  if (value >= 70) return 'C';
  if (value >= 60) return 'D';
  return 'F';
}

function cellValue(record) {
  if (!record) return '';
  if (record.status === 'graded' && record.score !== null && record.score !== undefined) return String(record.score);
  if (record.status === 'missing') return 'M';
  if (record.status === 'excused') return 'EX';
  return '';
}

function cellClass(value) {
  const upper = String(value || '').trim().toUpperCase();
  if (upper === 'M') return ' is-missing';
  if (upper === 'EX') return ' is-excused';
  return '';
}

async function loadCourse(courseId) {
  currentCourse = courses.find((item) => item.id === courseId) || null;
  if (!currentCourse) return;
  const [assignmentRows, assessmentRows, submissionRows, attemptRows] = await Promise.all([
    byField('assignments', 'courseId', courseId),
    byField('assessments', 'courseId', courseId),
    byField('submissions', 'courseId', courseId),
    byField('assessmentAttempts', 'courseId', courseId)
  ]);
  assignments = assignmentRows.filter((item) => item.status !== 'draft' && Number(item.pointsPossible) > 0);
  assessments = assessmentRows.filter((item) => item.status === 'published' && Number(item.pointsPossible) > 0);
  submissions = submissionRows;
  attempts = attemptRows;
  students = await Promise.all((currentCourse.studentIds || []).map(loadPerson));
  students.sort((a, b) => String(a.displayName || a.email || '').localeCompare(String(b.displayName || b.email || '')));
}

function courseOptions() {
  return courses.map((course) => `<option value="${esc(course.id)}" ${course.id === selectedCourseId ? 'selected' : ''}>${esc(course.name || 'Course')}${course.courseCode ? ` (${esc(course.courseCode)})` : ''}</option>`).join('');
}

function table() {
  const items = gradeItems();
  if (!students.length) return '<div class="empty-state"><strong>No students are rostered.</strong>Add students to this course before entering grades.</div>';
  if (!items.length) return '<div class="empty-state"><strong>No graded work yet.</strong>Create an assignment or publish an assessment with points.</div>';

  const headers = items.map((item) => `<th class="gb-assignment-head"><span>${esc(item.title)}</span><small><b class="gb-type ${item.type}">${item.type === 'assessment' ? 'Assessment' : 'Assignment'}</b>${item.pointsPossible} pts</small></th>`).join('');
  const rows = students.map((student) => {
    const grade = overall(student.id);
    const cells = items.map((item) => {
      const record = recordFor(item, student.id);
      const value = cellValue(record);
      if (item.type === 'assessment' && !record) {
        return `<td class="gb-grade-cell"><div class="gb-no-attempt" title="This student has not submitted this assessment yet">Not taken</div></td>`;
      }
      return `<td class="gb-grade-cell"><input class="gb-grade-input${cellClass(value)}" value="${esc(value)}" data-student-id="${esc(student.id)}" data-item-id="${esc(item.id)}" data-item-type="${item.type}" data-initial="${esc(value)}" inputmode="decimal" autocomplete="off" aria-label="${esc(student.displayName || student.email || 'Student')} — ${esc(item.title)}"></td>`;
    }).join('');
    return `<tr><td class="gb-student"><strong>${esc(student.displayName || student.email || 'Student')}</strong><small>${esc(student.email || '')}</small></td><td class="gb-overall"><strong>${esc(gradeLabel(grade))}</strong><small>${letterGrade(grade)}</small></td>${cells}</tr>`;
  }).join('');
  return `<div class="gb-table-wrap"><table class="gb-table"><thead><tr><th class="gb-student">Student</th><th class="gb-overall">Overall</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderPage() {
  const content = $('page-content');
  if (!content || $('page-title')?.textContent !== 'Gradebook' || !canEdit()) return;
  const items = gradeItems();
  const graded = students.reduce((count, student) => count + items.filter((item) => recordFor(item, student.id)?.status === 'graded').length, 0);
  const availableCells = students.reduce((count, student) => count + items.filter((item) => item.type === 'assignment' || recordFor(item, student.id)).length, 0);
  const open = Math.max(0, availableCells - graded);
  content.innerHTML = `<div class="gradebook-plus">
    <div class="toolbar gb-toolbar"><div><span class="eyebrow">GRADEBOOK</span><h2>${esc(currentCourse?.name || 'Gradebook')}</h2><p>Assignments and assessments are graded together. Assessment cells open after the student submits the assessment.</p></div><div class="toolbar-group"><button class="btn btn-secondary" data-lms-action="new-assignment" data-course-id="${esc(currentCourse?.id || '')}">New Assignment</button><button class="btn btn-secondary" data-p3-nav="assessments">Assessments</button><button class="btn btn-primary" data-gb-action="save">Save Changes</button></div></div>
    <section class="gb-course-bar"><label>Course<select id="gb-course-select">${courseOptions()}</select></label><div class="gb-legend"><span><b>Number</b> grade</span><span><b>M</b> missing</span><span><b>EX</b> excused</span><span><b>Blank</b> not graded</span></div></section>
    <section class="grid grid-3 section gb-summary"><article class="card metric"><div class="metric-top"><span>Students</span></div><div class="metric-value">${students.length}</div><div class="metric-note">Rostered in this course</div></article><article class="card metric"><div class="metric-top"><span>Grade items</span></div><div class="metric-value">${items.length}</div><div class="metric-note">${assignments.length} assignments · ${assessments.length} assessments</div></article><article class="card metric"><div class="metric-top"><span>Open cells</span></div><div class="metric-value">${open}</div><div class="metric-note">Available and not currently graded</div></article></section>
    <section class="section">${table()}</section>
    <div class="gb-save-bar"><span id="gb-save-status">No unsaved changes</span><button class="btn btn-primary" data-gb-action="save">Save Changes</button></div>
  </div>`;
}

async function renderGradebook(requestedCourseId = selectedCourseId) {
  if (rendering || $('page-title')?.textContent !== 'Gradebook' || !canEdit()) return;
  const content = $('page-content');
  if (!content) return;
  rendering = true;
  content.innerHTML = '<div class="skeleton" style="height:180px"></div>';
  try {
    courses = await loadCourses();
    if (!courses.length) {
      content.innerHTML = '<div class="empty-state"><strong>No courses available.</strong>Create or join a course before using the gradebook.</div>';
      return;
    }
    selectedCourseId = courses.some((item) => item.id === requestedCourseId) ? requestedCourseId : courses[0].id;
    localStorage.setItem('classos-gradebook-course', selectedCourseId);
    await loadCourse(selectedCourseId);
    renderPage();
  } catch (error) {
    console.error(error);
    content.innerHTML = `<div class="empty-state"><strong>Gradebook could not load.</strong>${esc(error.message || '')}</div>`;
  } finally {
    rendering = false;
  }
}

function parseGrade(value) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  if (!raw) return { type: 'clear' };
  if (upper === 'M') return { type: 'missing' };
  if (upper === 'EX' || upper === 'E') return { type: 'excused' };
  const score = Number(raw);
  if (!Number.isFinite(score) || score < 0) throw new Error(`“${raw}” is not a valid grade.`);
  return { type: 'grade', score };
}

async function saveAssignment(item, studentId, parsed) {
  const existing = submissionFor(item.id, studentId);
  const id = existing?.id || `${item.id}_${studentId}`;
  const ref = doc(db, 'submissions', id);
  if (parsed.type === 'clear') {
    if (!existing) return;
    const hasWork = String(existing.responseText || '').trim() || String(existing.linkUrl || '').trim() || existing.submittedAt;
    if (!hasWork) return deleteDoc(ref);
    return setDoc(ref, { score: null, status: 'submitted', gradedBy: null, gradedAt: null, updatedAt: serverTimestamp() }, { merge: true });
  }
  const base = {
    assignmentId: item.id,
    courseId: currentCourse.id,
    schoolId: currentCourse.schoolId,
    studentId,
    responseText: existing?.responseText || '',
    linkUrl: existing?.linkUrl || '',
    feedback: existing?.feedback || '',
    submittedAt: existing?.submittedAt || null,
    updatedAt: serverTimestamp()
  };
  if (parsed.type === 'grade') return setDoc(ref, { ...base, status: 'graded', score: parsed.score, gradedBy: uid(), gradedAt: serverTimestamp() }, { merge: true });
  return setDoc(ref, { ...base, status: parsed.type, score: null, gradedBy: uid(), gradedAt: serverTimestamp() }, { merge: true });
}

async function saveAssessment(item, studentId, parsed) {
  const attempt = attemptFor(item.id, studentId);
  if (!attempt) throw new Error(`${item.title} has not been submitted by this student yet.`);
  const ref = doc(db, 'assessmentAttempts', attempt.id);
  if (parsed.type === 'clear') return updateDoc(ref, { score: null, status: 'submitted', gradedBy: null, gradedAt: null, updatedAt: serverTimestamp() });
  if (parsed.type === 'grade') return updateDoc(ref, { score: parsed.score, status: 'graded', gradedBy: uid(), gradedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return updateDoc(ref, { score: null, status: parsed.type, gradedBy: uid(), gradedAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

async function saveCell(input) {
  const item = gradeItems().find((entry) => entry.id === input.dataset.itemId && entry.type === input.dataset.itemType);
  if (!item) return;
  const parsed = parseGrade(input.value);
  if (parsed.type === 'grade' && parsed.score > item.pointsPossible) throw new Error(`${item.title} is worth ${item.pointsPossible} points.`);
  if (item.type === 'assessment') return saveAssessment(item, input.dataset.studentId, parsed);
  return saveAssignment(item, input.dataset.studentId, parsed);
}

async function saveChanges() {
  const dirtyInputs = [...document.querySelectorAll('.gb-grade-input.is-dirty')];
  if (!dirtyInputs.length) return toast('There are no grade changes to save.');
  const buttons = [...document.querySelectorAll('[data-gb-action="save"]')];
  buttons.forEach((button) => { button.disabled = true; button.dataset.oldLabel = button.textContent; button.textContent = 'Saving…'; });
  try {
    for (const input of dirtyInputs) await saveCell(input);
    toast(`${dirtyInputs.length} grade change${dirtyInputs.length === 1 ? '' : 's'} saved.`, 'success');
    await renderGradebook(selectedCourseId);
  } catch (error) {
    console.error(error);
    toast(error?.code === 'permission-denied' ? 'Your account does not have permission to save one of these grades.' : error.message || 'Grades could not be saved.', 'error');
  } finally {
    buttons.forEach((button) => { if (document.body.contains(button)) { button.disabled = false; button.textContent = button.dataset.oldLabel || 'Save Changes'; } });
  }
}

function updateDirty(input) {
  const current = input.value.trim();
  input.classList.toggle('is-dirty', current !== String(input.dataset.initial || '').trim());
  input.classList.remove('is-missing', 'is-excused');
  input.classList.add(...cellClass(current).trim().split(/\s+/).filter(Boolean));
  const count = document.querySelectorAll('.gb-grade-input.is-dirty').length;
  if ($('gb-save-status')) $('gb-save-status').textContent = count ? `${count} unsaved change${count === 1 ? '' : 's'}` : 'No unsaved changes';
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    if ($('page-title')?.textContent === 'Gradebook' && !document.querySelector('#page-content .gradebook-plus') && canEdit()) renderGradebook().catch(console.error);
  }, 90);
}

document.addEventListener('input', (event) => {
  if (event.target.matches('.gb-grade-input')) updateDirty(event.target);
}, true);

document.addEventListener('change', (event) => {
  if (event.target.id === 'gb-course-select') renderGradebook(event.target.value);
}, true);

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-gb-action="save"]')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    saveChanges();
    return;
  }
  if (event.target.closest('[data-route="gradebook"], [data-lms-route="gradebook"], [data-lms-nav="gradebook"]')) window.setTimeout(scheduleRender, 120);
}, true);

if ($('page-content')) new MutationObserver(scheduleRender).observe($('page-content'), { childList: true, subtree: false });

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    profile = null;
    courses = [];
    return;
  }
  try {
    profile = await loadProfile();
    scheduleRender();
  } catch (error) {
    console.warn('Gradebook could not initialize', error);
  }
});
