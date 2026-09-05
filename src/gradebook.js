import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const emailKey = (value = '') => String(value).trim().toLowerCase();

let profile = null;
let courses = [];
let selectedCourseId = localStorage.getItem('classos-gradebook-course') || '';
let currentCourse = null;
let assignments = [];
let submissions = [];
let students = [];
let renderTimer = null;

const uid = () => auth.currentUser?.uid || '';
const role = () => profile?.role || '';
const isOwner = () => emailKey(auth.currentUser?.email) === OWNER_EMAIL;
const canEditGrades = () => isOwner() || ['district_admin', 'school_admin', 'teacher'].includes(role());

function toast(message, type = '') {
  const region = $('toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

async function profileForCurrentUser() {
  if (!auth.currentUser) return null;
  const snapshot = await getDoc(doc(db, 'users', auth.currentUser.uid));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function docsByField(name, field, value) {
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

async function loadCourses() {
  if (isOwner()) {
    const snapshot = await getDocs(collection(db, 'courses'));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.status !== 'archived');
  }
  if (role() === 'teacher') {
    return (await arrayContains('courses', 'teacherIds', uid())).filter((item) => item.status !== 'archived');
  }
  if (['district_admin', 'school_admin'].includes(role())) {
    const batches = await Promise.all((profile?.schoolIds || []).map((schoolId) => docsByField('courses', 'schoolId', schoolId)));
    return unique(batches.flat()).filter((item) => item.status !== 'archived');
  }
  return [];
}

async function loadPerson(id) {
  try {
    const snapshot = await getDoc(doc(db, 'users', id));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : { id, displayName: 'Student' };
  } catch {
    return { id, displayName: 'Student' };
  }
}

function categoriesFor(course) {
  return Array.isArray(course?.gradeCategories) && course.gradeCategories.length
    ? course.gradeCategories.map((item) => ({ id: String(item.id || 'coursework'), name: String(item.name || 'Coursework'), weight: Number(item.weight) || 0 }))
    : [{ id: 'coursework', name: 'Coursework', weight: 100 }];
}

function submissionFor(assignmentId, studentId) {
  return submissions.find((item) => item.assignmentId === assignmentId && item.studentId === studentId) || null;
}

function gradeFor(studentId) {
  const categories = categoriesFor(currentCourse);
  const results = categories.map((category) => {
    const items = assignments.filter((assignment) => (assignment.categoryId || 'coursework') === category.id);
    let earned = 0;
    let possible = 0;
    items.forEach((assignment) => {
      const submission = submissionFor(assignment.id, studentId);
      if (submission?.status !== 'graded' || !Number.isFinite(Number(submission.score))) return;
      earned += Number(submission.score);
      possible += Number(assignment.pointsPossible) || 0;
    });
    return { ...category, earned, possible, percent: possible ? (earned / possible) * 100 : null };
  });
  const active = results.filter((item) => item.percent !== null && item.weight > 0);
  const activeWeight = active.reduce((sum, item) => sum + item.weight, 0);
  if (active.length && activeWeight > 0) {
    return active.reduce((sum, item) => sum + item.percent * (item.weight / activeWeight), 0);
  }
  const earned = results.reduce((sum, item) => sum + item.earned, 0);
  const possible = results.reduce((sum, item) => sum + item.possible, 0);
  return possible ? (earned / possible) * 100 : null;
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

function cellValue(submission) {
  if (!submission) return '';
  if (submission.status === 'graded' && submission.score !== null && submission.score !== undefined) return String(submission.score);
  if (submission.status === 'missing') return 'M';
  if (submission.status === 'excused') return 'EX';
  return '';
}

function cellClass(value) {
  const upper = String(value || '').trim().toUpperCase();
  if (upper === 'M') return ' is-missing';
  if (upper === 'EX') return ' is-excused';
  return '';
}

async function loadCourseData(courseId) {
  currentCourse = courses.find((item) => item.id === courseId) || null;
  if (!currentCourse) return;
  const [assignmentRows, submissionRows] = await Promise.all([
    docsByField('assignments', 'courseId', currentCourse.id),
    docsByField('submissions', 'courseId', currentCourse.id)
  ]);
  assignments = assignmentRows
    .filter((item) => item.status !== 'draft' && Number(item.pointsPossible) > 0)
    .sort((a, b) => String(a.dueAt?.seconds || a.dueAt || a.title).localeCompare(String(b.dueAt?.seconds || b.dueAt || b.title)));
  submissions = submissionRows;
  students = await Promise.all((currentCourse.studentIds || []).map(loadPerson));
  students.sort((a, b) => String(a.displayName || a.email || '').localeCompare(String(b.displayName || b.email || '')));
}

function courseOptions() {
  return courses.map((course) => `<option value="${esc(course.id)}" ${course.id === selectedCourseId ? 'selected' : ''}>${esc(course.name || 'Course')}${course.courseCode ? ` (${esc(course.courseCode)})` : ''}</option>`).join('');
}

function gradebookTable() {
  if (!students.length) return '<div class="empty-state"><strong>No students are rostered.</strong>Add students to this course before entering grades.</div>';
  if (!assignments.length) return '<div class="empty-state"><strong>No graded assignments yet.</strong>Create a published assignment with points before entering grades.</div>';

  const header = assignments.map((assignment) => `<th class="gb-assignment-head"><span>${esc(assignment.title)}</span><small>${esc(assignment.pointsPossible)} pts</small></th>`).join('');
  const rows = students.map((student) => {
    const overall = gradeFor(student.id);
    const cells = assignments.map((assignment) => {
      const submission = submissionFor(assignment.id, student.id);
      const value = cellValue(submission);
      return `<td class="gb-grade-cell"><input class="gb-grade-input${cellClass(value)}" value="${esc(value)}" data-student-id="${esc(student.id)}" data-assignment-id="${esc(assignment.id)}" data-initial="${esc(value)}" inputmode="decimal" autocomplete="off" aria-label="${esc(student.displayName || student.email || 'Student')} — ${esc(assignment.title)}" /></td>`;
    }).join('');
    return `<tr><td class="gb-student"><strong>${esc(student.displayName || student.email || 'Student')}</strong><small>${esc(student.email || '')}</small></td><td class="gb-overall"><strong>${esc(gradeLabel(overall))}</strong><small>${esc(letterGrade(overall))}</small></td>${cells}</tr>`;
  }).join('');

  return `<div class="gb-table-wrap"><table class="gb-table"><thead><tr><th class="gb-student">Student</th><th class="gb-overall">Overall</th>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderPage() {
  const content = $('page-content');
  if (!content || $('page-title')?.textContent !== 'Gradebook' || !canEditGrades()) return;
  const ungraded = students.length * assignments.length - submissions.filter((item) => item.status === 'graded' && assignments.some((assignment) => assignment.id === item.assignmentId) && students.some((student) => student.id === item.studentId)).length;
  content.innerHTML = `<div class="gradebook-plus">
    <div class="toolbar gb-toolbar">
      <div><span class="eyebrow">GRADEBOOK</span><h2>${esc(currentCourse?.name || 'Gradebook')}</h2><p>Enter grades for the whole class from one screen.</p></div>
      <div class="toolbar-group"><button type="button" class="btn btn-secondary" data-lms-action="new-assignment" data-course-id="${esc(currentCourse?.id || '')}">Create Assignment</button><button type="button" class="btn btn-primary" data-gb-action="save">Save Changes</button></div>
    </div>
    <section class="gb-course-bar"><label>Course<select id="gb-course-select">${courseOptions()}</select></label><div class="gb-legend"><span><b>Number</b> grade</span><span><b>M</b> missing</span><span><b>EX</b> excused</span><span><b>Blank</b> not graded</span></div></section>
    <section class="grid grid-3 section gb-summary"><article class="card metric"><div class="metric-top"><span>Students</span></div><div class="metric-value">${students.length}</div><div class="metric-note">Rostered in this course</div></article><article class="card metric"><div class="metric-top"><span>Assignments</span></div><div class="metric-value">${assignments.length}</div><div class="metric-note">Published graded work</div></article><article class="card metric"><div class="metric-top"><span>Open cells</span></div><div class="metric-value">${Math.max(0, ungraded)}</div><div class="metric-note">Not currently graded</div></article></section>
    <section class="section">${gradebookTable()}</section>
    <div class="gb-save-bar"><span id="gb-save-status">No unsaved changes</span><button type="button" class="btn btn-primary" data-gb-action="save">Save Changes</button></div>
  </div>`;
}

async function renderGradebook(requestedCourseId = selectedCourseId) {
  if (!canEditGrades() || $('page-title')?.textContent !== 'Gradebook') return;
  const content = $('page-content');
  if (!content) return;
  content.innerHTML = '<div class="skeleton" style="height:180px"></div>';
  try {
    courses = await loadCourses();
    if (!courses.length) {
      content.innerHTML = '<div class="empty-state"><strong>No courses available.</strong>Create or join a course before using the gradebook.</div>';
      return;
    }
    selectedCourseId = courses.some((item) => item.id === requestedCourseId) ? requestedCourseId : courses[0].id;
    localStorage.setItem('classos-gradebook-course', selectedCourseId);
    await loadCourseData(selectedCourseId);
    renderPage();
  } catch (error) {
    console.error(error);
    content.innerHTML = `<div class="empty-state"><strong>Gradebook could not load.</strong>${esc(error?.message || 'Check course access and Firestore rules.')}</div>`;
  }
}

function parseGrade(value) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  if (!raw) return { type: 'clear' };
  if (upper === 'M') return { type: 'missing' };
  if (upper === 'EX' || upper === 'E') return { type: 'excused' };
  const score = Number(raw);
  if (!Number.isFinite(score) || score < 0) throw new Error(`“${raw}” is not a valid grade. Use a number, M, EX, or leave it blank.`);
  return { type: 'grade', score };
}

async function saveCell(input) {
  const assignmentId = input.dataset.assignmentId;
  const studentId = input.dataset.studentId;
  const assignment = assignments.find((item) => item.id === assignmentId);
  if (!assignment || !currentCourse || !(currentCourse.studentIds || []).includes(studentId)) return;
  const existing = submissionFor(assignmentId, studentId);
  const parsed = parseGrade(input.value);
  const id = existing?.id || `${assignmentId}_${studentId}`;
  const ref = doc(db, 'submissions', id);

  if (parsed.type === 'clear') {
    if (!existing) return;
    const hasStudentWork = Boolean(String(existing.responseText || '').trim() || String(existing.linkUrl || '').trim() || existing.submittedAt);
    if (!hasStudentWork) {
      await deleteDoc(ref);
      return;
    }
    await setDoc(ref, {
      score: null,
      status: 'submitted',
      gradedBy: null,
      gradedAt: null,
      updatedAt: serverTimestamp()
    }, { merge: true });
    return;
  }

  const base = {
    assignmentId,
    courseId: currentCourse.id,
    schoolId: currentCourse.schoolId,
    studentId,
    responseText: existing?.responseText || '',
    linkUrl: existing?.linkUrl || '',
    feedback: existing?.feedback || '',
    submittedAt: existing?.submittedAt || null,
    updatedAt: serverTimestamp()
  };

  if (parsed.type === 'grade') {
    await setDoc(ref, { ...base, status: 'graded', score: parsed.score, gradedBy: uid(), gradedAt: serverTimestamp() }, { merge: true });
    return;
  }
  if (parsed.type === 'missing') {
    await setDoc(ref, { ...base, status: 'missing', score: null, gradedBy: uid(), gradedAt: serverTimestamp() }, { merge: true });
    return;
  }
  await setDoc(ref, { ...base, status: 'excused', score: null, gradedBy: uid(), gradedAt: serverTimestamp() }, { merge: true });
}

async function saveChanges(button) {
  const dirty = [...document.querySelectorAll('.gb-grade-input.is-dirty')];
  if (!dirty.length) {
    toast('There are no grade changes to save.');
    return;
  }
  button.disabled = true;
  const original = button.textContent;
  document.querySelectorAll('[data-gb-action="save"]').forEach((item) => { item.disabled = true; item.textContent = 'Saving…'; });
  try {
    for (const input of dirty) await saveCell(input);
    toast(`${dirty.length} grade change${dirty.length === 1 ? '' : 's'} saved.`, 'success');
    await renderGradebook(selectedCourseId);
  } catch (error) {
    console.error(error);
    toast(error?.code === 'permission-denied' ? 'Your account does not have permission to save these grades.' : error?.message || 'Grades could not be saved.', 'error');
  } finally {
    if (document.body.contains(button)) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function updateDirtyState(input) {
  const current = input.value.trim();
  input.classList.toggle('is-dirty', current !== String(input.dataset.initial || '').trim());
  input.classList.remove('is-missing', 'is-excused');
  input.classList.add(...cellClass(current).trim().split(/\s+/).filter(Boolean));
  const count = document.querySelectorAll('.gb-grade-input.is-dirty').length;
  const label = $('gb-save-status');
  if (label) label.textContent = count ? `${count} unsaved change${count === 1 ? '' : 's'}` : 'No unsaved changes';
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    if ($('page-title')?.textContent !== 'Gradebook' || !canEditGrades()) return;
    if (document.querySelector('#page-content .gradebook-plus')) return;
    renderGradebook().catch(console.error);
  }, 90);
}

document.addEventListener('input', (event) => {
  if (event.target.matches('.gb-grade-input')) updateDirtyState(event.target);
}, true);

document.addEventListener('change', async (event) => {
  if (event.target.id === 'gb-course-select') await renderGradebook(event.target.value);
}, true);

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-gb-action]');
  if (action?.dataset.gbAction === 'save') {
    event.preventDefault();
    event.stopImmediatePropagation();
    await saveChanges(action);
    return;
  }
  const gradebookNav = event.target.closest('[data-route="gradebook"], [data-lms-route="gradebook"], [data-lms-nav="gradebook"]');
  if (gradebookNav) window.setTimeout(scheduleRender, 120);
}, true);

const content = $('page-content');
if (content) {
  new MutationObserver(() => scheduleRender()).observe(content, { childList: true, subtree: false });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    profile = null;
    courses = [];
    return;
  }
  try {
    profile = await profileForCurrentUser();
    scheduleRender();
  } catch (error) {
    console.warn('Gradebook tools could not initialize', error);
  }
});