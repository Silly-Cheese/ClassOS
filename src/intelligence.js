import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const state = {
  user: null, profile: null, schools: [], courses: [], users: [], assignments: [], submissions: [], attendance: [],
  standards: [], questions: [], assessments: [], attempts: [], interventions: [],
  route: null, selectedCourseId: null, selectedStudentId: null, ready: false
};

const ADMIN_ROLES = ['district_admin', 'school_admin'];
const SUPPORT_ROLES = ['district_admin', 'school_admin', 'counselor'];
const MANAGER_ROLES = ['district_admin', 'school_admin', 'teacher'];

const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const emailKey = (value = '') => String(value).trim().toLowerCase();
const role = () => state.profile?.role || 'pending';
const uid = () => state.user?.uid || '';
const isOwner = () => emailKey(state.user?.email) === OWNER_EMAIL && !!state.user?.emailVerified;
const isAdmin = () => isOwner() || ADMIN_ROLES.includes(role());
const isSupport = () => isOwner() || SUPPORT_ROLES.includes(role());
const isTeacher = () => role() === 'teacher';
const isStudent = () => role() === 'student';
const isGuardian = () => role() === 'guardian';

function toast(message, type = '') {
  const region = $('toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function asDate(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value?.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, includeTime = false) {
  const date = asDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function dateTimeInput(value) {
  const date = asDate(value);
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function unique(items) {
  const map = new Map();
  items.forEach((item) => item?.id && map.set(item.id, item));
  return [...map.values()];
}

async function allDocs(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function byField(name, field, value) {
  try {
    const snap = await getDocs(query(collection(db, name), where(field, '==', value)));
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.warn(`ClassOS Phase 3 could not load ${name}`, error);
    return [];
  }
}

async function arrayContains(name, field, value) {
  try {
    const snap = await getDocs(query(collection(db, name), where(field, 'array-contains', value)));
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.warn(`ClassOS Phase 3 could not load ${name}`, error);
    return [];
  }
}

async function direct(name, id) {
  try {
    const snap = await getDoc(doc(db, name, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    console.warn(`ClassOS Phase 3 could not load ${name}/${id}`, error);
    return null;
  }
}

function school(id) { return state.schools.find((item) => item.id === id) || null; }
function course(id) { return state.courses.find((item) => item.id === id) || null; }
function person(id) { return state.users.find((item) => item.id === id) || null; }
function personName(id) { const p = person(id); return p?.displayName || p?.email || 'Student'; }
function standard(id) { return state.standards.find((item) => item.id === id) || null; }
function assessment(id) { return state.assessments.find((item) => item.id === id) || null; }

function visibleCourses() {
  if (isOwner() || ADMIN_ROLES.includes(role()) || role() === 'counselor') return state.courses;
  if (isTeacher()) return state.courses.filter((item) => (item.teacherIds || []).includes(uid()));
  if (isStudent()) return state.courses.filter((item) => (item.studentIds || []).includes(uid()));
  if (isGuardian()) {
    const linked = state.profile?.linkedStudentIds || [];
    return state.courses.filter((item) => (item.studentIds || []).some((id) => linked.includes(id)));
  }
  return [];
}

function canManageCourse(courseId) {
  const item = course(courseId);
  if (!item) return false;
  return isOwner() || ADMIN_ROLES.includes(role()) || (isTeacher() && (item.teacherIds || []).includes(uid()));
}

function visibleStudents() {
  const ids = new Set();
  if (isStudent()) ids.add(uid());
  else if (isGuardian()) (state.profile?.linkedStudentIds || []).forEach((id) => ids.add(id));
  else visibleCourses().forEach((item) => (item.studentIds || []).forEach((id) => ids.add(id)));
  return [...ids].map((id) => person(id)).filter(Boolean);
}

async function loadProfile(user, retries = 5) {
  const item = await direct('users', user.uid);
  if (item) return item;
  if (retries <= 0) return null;
  await new Promise((resolve) => setTimeout(resolve, 350));
  return loadProfile(user, retries - 1);
}

async function loadCoreData() {
  if (isOwner()) {
    [state.schools, state.courses, state.users] = await Promise.all([
      allDocs('schools'), allDocs('courses'), allDocs('users')
    ]);
    return;
  }

  const schoolIds = state.profile?.schoolIds || [];
  const schoolDocs = await Promise.all(schoolIds.map((id) => direct('schools', id)));
  state.schools = schoolDocs.filter(Boolean);
  const courseBatches = await Promise.all(schoolIds.map((id) => byField('courses', 'schoolId', id)));
  state.courses = unique(courseBatches.flat());

  if (isStudent()) {
    const teacherIds = new Set();
    visibleCourses().forEach((item) => (item.teacherIds || []).forEach((id) => teacherIds.add(id)));
    const people = await Promise.all([uid(), ...teacherIds].map((id) => direct('users', id)));
    state.users = unique(people.filter(Boolean));
  } else if (isGuardian()) {
    const ids = [uid(), ...(state.profile?.linkedStudentIds || [])];
    const people = await Promise.all(ids.map((id) => direct('users', id)));
    state.users = unique(people.filter(Boolean));
  } else {
    const batches = await Promise.all(schoolIds.map((id) => arrayContains('users', 'schoolIds', id)));
    state.users = unique(batches.flat().concat(state.profile ? [state.profile] : []));
  }
}

async function loadCourseData() {
  const courses = visibleCourses();
  const ids = courses.map((item) => item.id);
  if (!ids.length) {
    state.assignments = []; state.submissions = []; state.attendance = [];
    state.standards = []; state.questions = []; state.assessments = []; state.attempts = []; state.interventions = [];
    return;
  }

  if (isOwner()) {
    [state.assignments, state.submissions, state.attendance, state.standards, state.questions, state.assessments, state.attempts, state.interventions] = await Promise.all([
      allDocs('assignments'), allDocs('submissions'), allDocs('attendanceRecords'), allDocs('standards'),
      allDocs('questionBank'), allDocs('assessments'), allDocs('assessmentAttempts'), allDocs('interventions')
    ]);
    return;
  }

  const [assignmentBatches, attendanceBatches, standardBatches, assessmentBatches] = await Promise.all([
    Promise.all(ids.map((id) => byField('assignments', 'courseId', id))),
    Promise.all(ids.map((id) => byField('attendanceRecords', 'courseId', id))),
    Promise.all(ids.map((id) => byField('standards', 'courseId', id))),
    Promise.all(ids.map((id) => byField('assessments', 'courseId', id)))
  ]);
  state.assignments = unique(assignmentBatches.flat());
  state.attendance = unique(attendanceBatches.flat());
  state.standards = unique(standardBatches.flat());
  state.assessments = unique(assessmentBatches.flat());

  if (isStudent()) {
    [state.submissions, state.attempts] = await Promise.all([
      byField('submissions', 'studentId', uid()),
      byField('assessmentAttempts', 'studentId', uid())
    ]);
    state.questions = [];
    state.interventions = [];
    return;
  }

  if (isGuardian()) {
    const linked = state.profile?.linkedStudentIds || [];
    const [subs, attempts] = await Promise.all([
      Promise.all(linked.map((id) => byField('submissions', 'studentId', id))),
      Promise.all(linked.map((id) => byField('assessmentAttempts', 'studentId', id)))
    ]);
    state.submissions = unique(subs.flat());
    state.attempts = unique(attempts.flat());
    state.questions = [];
    state.interventions = [];
    return;
  }

  const [submissionBatches, attemptBatches] = await Promise.all([
    Promise.all(ids.map((id) => byField('submissions', 'courseId', id))),
    Promise.all(ids.map((id) => byField('assessmentAttempts', 'courseId', id)))
  ]);
  state.submissions = unique(submissionBatches.flat());
  state.attempts = unique(attemptBatches.flat());

  if (isOwner() || ADMIN_ROLES.includes(role()) || isTeacher()) {
    const questionBatches = await Promise.all(ids.filter((id) => canManageCourse(id)).map((id) => byField('questionBank', 'courseId', id)));
    state.questions = unique(questionBatches.flat());
  } else state.questions = [];

  if (isSupport()) {
    const interventionBatches = await Promise.all((state.profile?.schoolIds || []).map((id) => byField('interventions', 'schoolId', id)));
    state.interventions = unique(interventionBatches.flat());
  } else if (isTeacher()) {
    const interventionBatches = await Promise.all(ids.filter((id) => canManageCourse(id)).map((id) => byField('interventions', 'courseId', id)));
    state.interventions = unique(interventionBatches.flat());
  } else state.interventions = [];
}

async function load() {
  if (!state.profile || state.profile.status !== 'active') return;
  await loadCoreData();
  await loadCourseData();
  const courses = visibleCourses();
  if (!state.selectedCourseId || !courses.some((item) => item.id === state.selectedCourseId)) state.selectedCourseId = courses[0]?.id || null;
  const students = visibleStudents();
  if (!state.selectedStudentId || !students.some((item) => item.id === state.selectedStudentId)) {
    state.selectedStudentId = isStudent() ? uid() : isGuardian() ? (state.profile?.linkedStudentIds || [])[0] || null : students[0]?.id || null;
  }
}

async function ensurePhase3() {
  if (!isOwner()) return;
  await setDoc(doc(db, 'system', 'config'), {
    version: '0.3.0-phase3', phase: 3, intelligenceReady: true, updatedAt: serverTimestamp()
  }, { merge: true });
  const flags = [
    ['assessments', true, 'Assessment engine and secure question bank'],
    ['mastery', true, 'Standards and Learning Graph'],
    ['student_pulse', true, 'Explainable academic Student Pulse'],
    ['workload_intelligence', true, 'Upcoming workload collision detection'],
    ['interventions', true, 'Student support and intervention workflow'],
    ['teacher_command_center', true, 'Teacher Command Center'],
    ['district_pulse', true, 'School and district intelligence dashboard']
  ];
  for (const [key, enabled, description] of flags) {
    await setDoc(doc(db, 'featureFlags', key), { key, enabled, description, updatedBy: uid(), updatedAt: serverTimestamp() }, { merge: true });
  }
}

function courseCategories(item) {
  return Array.isArray(item?.gradeCategories) && item.gradeCategories.length
    ? item.gradeCategories.map((cat) => ({ id: String(cat.id), weight: Number(cat.weight) || 0 }))
    : [{ id: 'coursework', weight: 100 }];
}

function courseGrade(studentId, courseId) {
  const item = course(courseId);
  const assignments = state.assignments.filter((a) => a.courseId === courseId && a.status !== 'draft' && Number(a.pointsPossible) > 0);
  const categories = courseCategories(item).map((cat) => {
    let earned = 0; let possible = 0;
    assignments.filter((a) => (a.categoryId || 'coursework') === cat.id).forEach((a) => {
      const submission = state.submissions.find((s) => s.assignmentId === a.id && s.studentId === studentId && s.status === 'graded');
      if (submission && Number.isFinite(Number(submission.score))) {
        earned += Number(submission.score); possible += Number(a.pointsPossible) || 0;
      }
    });
    return { ...cat, percent: possible ? earned / possible * 100 : null };
  });
  const active = categories.filter((cat) => cat.percent !== null && cat.weight > 0);
  const weight = active.reduce((sum, cat) => sum + cat.weight, 0);
  if (!active.length || !weight) return null;
  return active.reduce((sum, cat) => sum + cat.percent * cat.weight / weight, 0);
}

function assignmentMissing(studentId, assignment) {
  if (assignment.status === 'draft') return false;
  const due = asDate(assignment.dueAt);
  if (!due || due >= new Date()) return false;
  const submission = state.submissions.find((item) => item.assignmentId === assignment.id && item.studentId === studentId);
  return !submission || !['submitted', 'late', 'graded', 'excused'].includes(submission.status);
}

function masteryFor(studentId, standardId) {
  let earned = 0; let possible = 0; let evidence = 0;
  const linkedAssignments = state.assignments.filter((item) => (item.standardIds || []).includes(standardId));
  linkedAssignments.forEach((item) => {
    const submission = state.submissions.find((sub) => sub.assignmentId === item.id && sub.studentId === studentId && sub.status === 'graded');
    if (submission && Number(item.pointsPossible) > 0 && Number.isFinite(Number(submission.score))) {
      earned += Number(submission.score); possible += Number(item.pointsPossible); evidence += 1;
    }
  });
  state.attempts.filter((attempt) => attempt.studentId === studentId && attempt.status === 'graded').forEach((attempt) => {
    (attempt.itemResults || []).forEach((result) => {
      if ((result.standardIds || []).includes(standardId) && Number(result.possible) > 0) {
        earned += Number(result.earned) || 0; possible += Number(result.possible) || 0; evidence += 1;
      }
    });
  });
  return { percent: possible ? earned / possible * 100 : null, evidence, earned, possible };
}

function masteryLabel(percent) {
  if (percent === null) return ['No evidence', ''];
  if (percent >= 90) return ['Advanced', 'success'];
  if (percent >= 80) return ['Mastered', 'success'];
  if (percent >= 70) return ['Developing', 'info'];
  return ['Beginning', 'warning'];
}

function workloadFor(studentId, days = 7) {
  const now = new Date(); const end = new Date(now.getTime() + days * 86400000);
  const courseIds = visibleCourses().filter((c) => (c.studentIds || []).includes(studentId)).map((c) => c.id);
  const assignmentItems = state.assignments.filter((item) => {
    const due = asDate(item.dueAt);
    if (!courseIds.includes(item.courseId) || item.status === 'draft' || !due || due < now || due > end) return false;
    const sub = state.submissions.find((s) => s.assignmentId === item.id && s.studentId === studentId);
    return !sub || !['submitted', 'late', 'graded', 'excused'].includes(sub.status);
  }).map((item) => ({ type: 'Assignment', title: item.title, courseId: item.courseId, dueAt: item.dueAt, major: Number(item.pointsPossible) >= 50 }));
  const assessmentItems = state.assessments.filter((item) => {
    const due = asDate(item.dueAt);
    if (!courseIds.includes(item.courseId) || item.status !== 'published' || !due || due < now || due > end) return false;
    return !state.attempts.some((attempt) => attempt.assessmentId === item.id && attempt.studentId === studentId);
  }).map((item) => ({ type: 'Assessment', title: item.title, courseId: item.courseId, dueAt: item.dueAt, major: true }));
  const items = assignmentItems.concat(assessmentItems).sort((a, b) => asDate(a.dueAt) - asDate(b.dueAt));
  return { items, majorCount: items.filter((item) => item.major).length, overloaded: items.filter((item) => item.major).length >= 4 };
}

function studentPulse(studentId) {
  const courseIds = visibleCourses().filter((item) => (item.studentIds || []).includes(studentId)).map((item) => item.id);
  const grades = courseIds.map((id) => courseGrade(studentId, id)).filter((value) => value !== null);
  const grade = grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : null;

  const dueAssignments = state.assignments.filter((item) => courseIds.includes(item.courseId) && item.status !== 'draft' && asDate(item.dueAt) && asDate(item.dueAt) < new Date());
  const missing = dueAssignments.filter((item) => assignmentMissing(studentId, item)).length;
  const completion = dueAssignments.length ? Math.max(0, 100 - missing / dueAssignments.length * 100) : null;

  const attendance = state.attendance.filter((item) => item.studentId === studentId && courseIds.includes(item.courseId)).sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0)).slice(0, 20);
  const attendanceScore = attendance.length ? attendance.reduce((sum, item) => sum + ({ present: 100, tardy: 70, excused: 90, absent: 0 }[item.status] ?? 100), 0) / attendance.length : null;
  const absences = attendance.filter((item) => item.status === 'absent').length;

  const standardIds = state.standards.filter((item) => courseIds.includes(item.courseId)).map((item) => item.id);
  const masteryValues = standardIds.map((id) => masteryFor(studentId, id).percent).filter((value) => value !== null);
  const mastery = masteryValues.length ? masteryValues.reduce((a, b) => a + b, 0) / masteryValues.length : null;

  const factors = [
    { key: 'Grade', value: grade, weight: 35 }, { key: 'Completion', value: completion, weight: 30 },
    { key: 'Attendance', value: attendanceScore, weight: 20 }, { key: 'Mastery', value: mastery, weight: 15 }
  ].filter((item) => item.value !== null && Number.isFinite(item.value));
  const totalWeight = factors.reduce((sum, item) => sum + item.weight, 0);
  const score = totalWeight ? factors.reduce((sum, item) => sum + item.value * item.weight / totalWeight, 0) : null;
  const workload = workloadFor(studentId);
  const reasons = [];
  if (grade !== null && grade < 70) reasons.push(`Course average is ${grade.toFixed(1)}%.`);
  if (missing >= 3) reasons.push(`${missing} past-due assignments are still missing.`);
  if (absences >= 2) reasons.push(`${absences} recent unexcused absences are recorded.`);
  if (mastery !== null && mastery < 70) reasons.push(`Measured standards mastery is ${mastery.toFixed(1)}%.`);
  if (workload.overloaded) reasons.push(`${workload.majorCount} major items are due in the next 7 days.`);
  if (!reasons.length) reasons.push('No major academic warning signal is currently active.');
  const status = score === null ? 'Not enough data' : score >= 80 ? 'On track' : score >= 65 ? 'Watch' : 'Attention';
  const cls = score === null ? '' : score >= 80 ? 'success' : score >= 65 ? 'warning' : 'danger';
  return { score, status, cls, grade, completion, attendance: attendanceScore, mastery, missing, absences, workload, reasons, factors };
}

function metric(label, value, note) {
  return `<article class="card metric"><div class="metric-top"><span>${esc(label)}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></article>`;
}

function hero(kicker, title, copy, actions = '') {
  return `<section class="hero p3-hero"><span class="eyebrow">${esc(kicker)}</span><h1>${title}</h1><p>${copy}</p>${actions ? `<div class="hero-actions">${actions}</div>` : ''}</section>`;
}

function pulseBadge(pulse) {
  return `<span class="pill ${pulse.cls}">${esc(pulse.status)}${pulse.score === null ? '' : ` · ${pulse.score.toFixed(0)}`}</span>`;
}

function coursePicker(routeName) {
  const courses = visibleCourses();
  if (courses.length <= 1) return '';
  return `<div class="course-switcher p3-switcher">${courses.map((item) => `<button class="course-chip ${item.id === state.selectedCourseId ? 'active' : ''}" data-p3-action="select-course" data-course-id="${esc(item.id)}" data-route="${esc(routeName)}">${esc(item.name)}</button>`).join('')}</div>`;
}

function studentPicker(routeName) {
  if (isStudent()) return '';
  const students = visibleStudents();
  if (students.length <= 1) return '';
  return `<div class="p3-student-picker"><label>Student</label><select data-p3-action="select-student" data-route="${esc(routeName)}">${students.map((item) => `<option value="${esc(item.id)}" ${item.id === state.selectedStudentId ? 'selected' : ''}>${esc(item.displayName || item.email)}</option>`).join('')}</select></div>`;
}

function commandView() {
  const courses = visibleCourses();
  const students = visibleStudents();
  const pulses = students.map((student) => ({ student, pulse: studentPulse(student.id) })).sort((a, b) => (a.pulse.score ?? 1000) - (b.pulse.score ?? 1000));
  const attention = pulses.filter((item) => item.pulse.status === 'Attention' || item.pulse.status === 'Watch');
  const submissionQueue = state.submissions.filter((item) => courses.some((c) => c.id === item.courseId) && ['submitted', 'late'].includes(item.status));
  const assessmentQueue = state.attempts.filter((item) => courses.some((c) => c.id === item.courseId) && item.status === 'submitted');
  const overloaded = pulses.filter((item) => item.pulse.workload.overloaded);
  const activeInterventions = state.interventions.filter((item) => item.status !== 'resolved');
  return `${hero('TEACHER COMMAND CENTER', 'The work that needs attention—before it gets buried.', 'ClassOS combines grading, missing work, attendance, mastery, workload, and support signals. Every Pulse is explainable from the records shown in the system.')}
    <section class="section grid grid-4">${metric('Students', students.length, 'Across visible courses')}${metric('To review', submissionQueue.length + assessmentQueue.length, 'Assignments + assessments')}${metric('Pulse alerts', attention.length, 'Watch or Attention')}${metric('Overload flags', overloaded.length, '4+ major items in 7 days')}</section>
    <section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">STUDENT PULSE</span><h3>Needs attention</h3></div><button class="link-button" data-p3-nav="support">Open Support Center</button></div>${attention.length ? `<div class="list">${attention.slice(0, 8).map(({ student, pulse }) => `<div class="list-row"><div class="list-main"><strong>${esc(student.displayName || student.email)}</strong><span>${esc(pulse.reasons[0])}</span></div>${pulseBadge(pulse)}</div>`).join('')}</div>` : '<div class="empty-state"><strong>No active Pulse alerts</strong>Current academic signals are stable.</div>'}</div>
    <div class="card"><div class="section-head"><div><span class="eyebrow">REVIEW QUEUE</span><h3>Waiting for feedback</h3></div></div>${submissionQueue.length || assessmentQueue.length ? `<div class="list">${submissionQueue.slice(0,4).map((item) => `<div class="list-row"><div class="list-main"><strong>${esc(personName(item.studentId))}</strong><span>${esc(state.assignments.find((a) => a.id === item.assignmentId)?.title || 'Assignment')} · ${esc(course(item.courseId)?.name || '')}</span></div><span class="pill info">Assignment</span></div>`).join('')}${assessmentQueue.slice(0,4).map((item) => `<div class="list-row"><div class="list-main"><strong>${esc(personName(item.studentId))}</strong><span>${esc(assessment(item.assessmentId)?.title || 'Assessment')} · ${esc(course(item.courseId)?.name || '')}</span></div><button class="pill clickable info" data-p3-action="review-attempt" data-attempt-id="${esc(item.id)}">Review</button></div>`).join('')}</div>` : '<div class="empty-state"><strong>Queue clear</strong>No work is waiting for review.</div>'}</div></section>
    <section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">WORKLOAD INTELLIGENCE</span><h3>Collision watch</h3></div></div>${overloaded.length ? `<div class="list">${overloaded.slice(0,8).map(({ student, pulse }) => `<div class="list-row"><div class="list-main"><strong>${esc(student.displayName || student.email)}</strong><span>${pulse.workload.majorCount} major items due in the next 7 days</span></div><span class="pill warning">Overload</span></div>`).join('')}</div>` : '<div class="empty-state"><strong>No workload collisions</strong>No student has 4 or more major items due in the next 7 days.</div>'}</div>
    <div class="card"><div class="section-head"><div><span class="eyebrow">INTERVENTIONS</span><h3>Active support plans</h3></div><button class="link-button" data-p3-nav="support">Manage</button></div>${activeInterventions.length ? `<div class="list">${activeInterventions.slice(0,8).map((item) => `<div class="list-row"><div class="list-main"><strong>${esc(item.title)}</strong><span>${esc(personName(item.studentId))} · ${esc(item.status || 'open')}</span></div><span class="pill ${item.priority === 'high' ? 'danger' : item.priority === 'medium' ? 'warning' : ''}">${esc(item.priority || 'normal')}</span></div>`).join('')}</div>` : '<div class="empty-state"><strong>No active interventions</strong>Support plans will appear here.</div>'}</div></section>`;
}

function assessmentView() {
  const selected = course(state.selectedCourseId);
  if (!selected) return '<div class="empty-state"><strong>No course available</strong>Assessments need an active course.</div>';
  const assessments = state.assessments.filter((item) => item.courseId === selected.id && (canManageCourse(selected.id) || item.status === 'published'));
  if (isStudent()) {
    const cards = assessments.filter((item) => item.status === 'published').map((item) => {
      const attempt = state.attempts.find((a) => a.assessmentId === item.id && a.studentId === uid());
      const action = !attempt ? `<button class="btn btn-primary btn-block" data-p3-action="take-assessment" data-assessment-id="${esc(item.id)}">Start assessment</button>`
        : attempt.status === 'graded' ? `<div class="p3-result"><strong>${Number(attempt.score || 0).toFixed(1)} / ${Number(attempt.pointsPossible || 0).toFixed(1)}</strong><span>Graded</span></div>`
          : '<div class="callout info"><strong>Submitted</strong><br>Your teacher will finalize the score after review.</div>';
      return `<article class="course-card p3-assessment-card"><div class="course-card-top"><span class="eyebrow">ASSESSMENT</span><span class="pill ${attempt?.status === 'graded' ? 'success' : attempt ? 'info' : ''}">${attempt ? esc(attempt.status) : 'Available'}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.description || 'Course assessment')}</p><div class="course-card-stats"><span><strong>${(item.items || []).length}</strong> questions</span><span><strong>${Number(item.pointsPossible || 0)}</strong> points</span><span><strong>${esc(formatDate(item.dueAt))}</strong> due</span></div>${action}</article>`;
    }).join('');
    return `${hero('ASSESSMENTS', 'Show what you know.', 'Published assessments appear here. Objective answers remain hidden from the browser and are scored only through the protected teacher key.')}${coursePicker('assessments')}<section class="course-grid p3-grid">${cards || '<div class="empty-state"><strong>No published assessments</strong>Nothing is waiting right now.</div>'}</section>`;
  }

  const manager = canManageCourse(selected.id);
  const questions = state.questions.filter((item) => item.courseId === selected.id);
  const attempts = state.attempts.filter((item) => item.courseId === selected.id && item.status === 'submitted');
  return `${hero('ASSESSMENTS', esc(selected.name), 'Build reusable questions, publish assessments, and review results without exposing answer keys to student accounts.', manager ? `<button class="btn btn-primary" data-p3-action="new-question">Add question</button><button class="btn btn-secondary" data-p3-action="new-assessment">Create assessment</button>` : '')}${coursePicker('assessments')}
    <section class="section grid grid-3">${metric('Question bank', questions.length, 'Reusable course questions')}${metric('Assessments', assessments.length, 'Draft + published')}${metric('Awaiting review', attempts.length, 'Submitted attempts')}</section>
    <section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">ASSESSMENTS</span><h3>Course assessments</h3></div></div>${assessments.length ? `<div class="list">${assessments.map((item) => `<div class="list-row"><div class="list-main"><strong>${esc(item.title)}</strong><span>${(item.items || []).length} questions · ${Number(item.pointsPossible || 0)} pts · ${formatDate(item.dueAt)}</span></div><div class="row-actions"><span class="pill ${item.status === 'published' ? 'success' : 'warning'}">${esc(item.status)}</span>${manager ? `<button class="pill clickable" data-p3-action="edit-assessment" data-assessment-id="${esc(item.id)}">Edit</button>` : ''}</div></div>`).join('')}</div>` : '<div class="empty-state"><strong>No assessments yet</strong>Create one from your question bank.</div>'}</div>
    <div class="card"><div class="section-head"><div><span class="eyebrow">REVIEW</span><h3>Submitted attempts</h3></div></div>${attempts.length ? `<div class="list">${attempts.map((item) => `<div class="list-row"><div class="list-main"><strong>${esc(personName(item.studentId))}</strong><span>${esc(assessment(item.assessmentId)?.title || 'Assessment')} · submitted ${formatDate(item.submittedAt, true)}</span></div><button class="pill clickable info" data-p3-action="review-attempt" data-attempt-id="${esc(item.id)}">Review</button></div>`).join('')}</div>` : '<div class="empty-state"><strong>Nothing waiting</strong>Submitted assessments will appear here.</div>'}</div></section>
    <section class="section card"><div class="section-head"><div><span class="eyebrow">QUESTION BANK</span><h3>${esc(selected.name)}</h3></div>${manager ? '<button class="link-button" data-p3-action="new-question">Add question</button>' : ''}</div>${questions.length ? `<div class="table-wrap"><table><thead><tr><th>Question</th><th>Type</th><th>Points</th><th>Standard</th>${manager ? '<th></th>' : ''}</tr></thead><tbody>${questions.map((item) => `<tr><td><span class="row-title">${esc(item.prompt)}</span></td><td>${esc(item.type.replaceAll('_', ' '))}</td><td>${Number(item.points || 0)}</td><td>${esc((item.standardIds || []).map((id) => standard(id)?.code).filter(Boolean).join(', ') || '—')}</td>${manager ? `<td><button class="pill clickable" data-p3-action="edit-question" data-question-id="${esc(item.id)}">Edit</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><strong>No questions yet</strong>Add reusable questions before creating an assessment.</div>'}</section>`;
}

function learningView() {
  const selected = course(state.selectedCourseId);
  if (!selected) return '<div class="empty-state"><strong>No course available</strong>Select a course before opening Standards & Mastery.</div>';
  const manager = canManageCourse(selected.id);
  const students = (selected.studentIds || []).map((id) => person(id)).filter(Boolean);
  if (!isStudent() && !isGuardian() && state.selectedStudentId && !(selected.studentIds || []).includes(state.selectedStudentId)) state.selectedStudentId = students[0]?.id || null;
  if (!isStudent() && !isGuardian() && !state.selectedStudentId) state.selectedStudentId = students[0]?.id || null;

  const effectiveStudent = isStudent() ? uid() : isGuardian() ? (state.profile?.linkedStudentIds || []).find((id) => (selected.studentIds || []).includes(id)) || null : state.selectedStudentId;
  const standards = state.standards.filter((item) => item.courseId === selected.id).sort((a,b) => String(a.code || '').localeCompare(String(b.code || '')));
  const mappedAssignments = state.assignments.filter((item) => item.courseId === selected.id && (item.standardIds || []).length).length;
  const mappedQuestions = state.questions.filter((item) => item.courseId === selected.id && (item.standardIds || []).length).length;

  const managerActions = manager ? `<button class="btn btn-primary" data-p3-action="manage-standards">Manage standards</button><button class="btn btn-secondary" data-p3-action="bulk-standard">Bulk add</button><button class="btn btn-secondary" data-p3-action="map-assignment">Map evidence</button>` : '';
  const pulse = effectiveStudent ? studentPulse(effectiveStudent) : null;

  const masteryCards = effectiveStudent && standards.length ? standards.map((item) => {
    const m = masteryFor(effectiveStudent, item.id);
    const [label, cls] = masteryLabel(m.percent);
    const usage = standardUsage(item.id);
    return `<article class="card mastery-card"><div class="mastery-head"><div><span class="eyebrow">${esc(item.code)}</span><h3>${esc(item.title)}</h3></div><span class="pill ${cls}">${esc(label)}</span></div><p>${esc(item.description || 'No description')}</p><div class="mastery-meter"><span style="width:${Math.max(0, Math.min(100, m.percent || 0))}%"></span></div><div class="mastery-foot"><strong>${m.percent === null ? '—' : `${m.percent.toFixed(1)}%`}</strong><span>${m.evidence} evidence item${m.evidence === 1 ? '' : 's'} · ${usage.total} mapped source${usage.total === 1 ? '' : 's'}</span></div>${manager ? `<div class="mastery-actions"><button class="link-button" data-p3-action="edit-standard" data-standard-id="${esc(item.id)}">Edit</button><button class="link-button" data-p3-action="map-standard" data-standard-id="${esc(item.id)}">Map evidence</button></div>` : ''}</article>`;
  }).join('') : '';

  return `${hero('STANDARDS & MASTERY', esc(selected.name), 'Create standards, connect evidence, and see mastery without making standards management a separate chore.', managerActions)}${coursePicker('learning')}${studentPicker('learning')}
    <section class="section grid grid-4">
      ${metric('Standards', standards.length, standards.length ? 'Course learning targets' : 'Start with one or bulk add')}
      ${metric('Mapped assignments', mappedAssignments, 'Assignments with standards')}
      ${metric('Mapped questions', mappedQuestions, 'Question-bank evidence')}
      ${metric('Students', (selected.studentIds || []).length, 'Course roster')}
    </section>
    ${manager ? `<section class="section card standards-control-center"><div class="section-head"><div><span class="eyebrow">STANDARDS CONTROL CENTER</span><h3>Build and maintain the learning targets</h3><p>Create one, paste many, then map coursework to them.</p></div><button class="btn btn-secondary" data-p3-action="manage-standards">Open manager</button></div><div class="standard-quick-actions"><button data-p3-action="new-standard"><strong>Add one standard</strong><span>Best for a quick correction or new target</span></button><button data-p3-action="bulk-standard"><strong>Bulk add standards</strong><span>Paste an entire unit or course set</span></button><button data-p3-action="map-assignment"><strong>Map assignment evidence</strong><span>Connect coursework to mastery</span></button></div></section>` : ''}
    ${pulse ? `<section class="section grid grid-4">${metric('Pulse', pulse.score === null ? '—' : pulse.score.toFixed(0), pulse.status)}${metric('Course grade', pulse.grade === null ? '—' : `${pulse.grade.toFixed(1)}%`, 'Across graded assignments')}${metric('Mastery', pulse.mastery === null ? '—' : `${pulse.mastery.toFixed(1)}%`, 'Across measured standards')}${metric('Missing', pulse.missing, 'Past-due assignments')}</section>` : ''}
    ${pulse ? `<section class="section card"><div class="section-head"><div><span class="eyebrow">EXPLAINABLE PULSE</span><h3>Why ClassOS shows ${esc(pulse.status)}</h3></div>${pulseBadge(pulse)}</div><div class="pulse-factors">${pulse.factors.map((factor) => `<div><span>${esc(factor.key)}</span><strong>${factor.value.toFixed(0)}</strong><small>${factor.weight}% base weight</small></div>`).join('')}</div><div class="p3-reasons">${pulse.reasons.map((reason) => `<span>• ${esc(reason)}</span>`).join('')}</div></section>` : manager ? '<section class="section callout info"><strong>No student selected yet.</strong><br>You can still create and manage standards now. Mastery appears when the course has students and evidence.</section>' : ''}
    <section class="section"><div class="section-head"><div><span class="eyebrow">STANDARDS</span><h3>${effectiveStudent ? `${esc(personName(effectiveStudent))} · mastery` : 'Course standards'}</h3><p>${effectiveStudent ? 'Mastery is based only on graded evidence explicitly mapped to each standard.' : 'Create and map standards before evidence exists.'}</p></div>${manager ? '<button class="link-button" data-p3-action="manage-standards">Manage standards</button>' : ''}</div>
      ${standards.length ? effectiveStudent ? `<div class="mastery-grid">${masteryCards}</div>` : `<div class="standards-table card"><div class="list">${standards.map((item) => { const usage = standardUsage(item.id); return `<div class="list-row"><div class="list-main"><strong>${esc(item.code)} — ${esc(item.title)}</strong><span>${esc(item.description || 'No description')} · ${usage.total} mapped source${usage.total === 1 ? '' : 's'}</span></div><button class="pill clickable" data-p3-action="edit-standard" data-standard-id="${esc(item.id)}">Edit</button></div>`; }).join('')}</div></div>` : '<div class="empty-state"><strong>No standards yet</strong>Use Add standard or Bulk add to create the course learning targets.</div>'}
    </section>`;
}

function supportView() {
  const students = visibleStudents();
  const pulses = students.map((student) => ({ student, pulse: studentPulse(student.id) })).sort((a, b) => (a.pulse.score ?? 1000) - (b.pulse.score ?? 1000));
  const open = state.interventions.filter((item) => item.status !== 'resolved');
  return `${hero('STUDENT SUPPORT', 'Interventions that stay connected to the evidence.', 'Counselors, administrators, and course teachers can document support plans while keeping internal notes out of student and guardian views.', '<button class="btn btn-primary" data-p3-action="new-intervention">New intervention</button>')}
    <section class="section grid grid-4">${metric('Students visible', students.length, 'Current support scope')}${metric('Attention', pulses.filter((x) => x.pulse.status === 'Attention').length, 'Pulse below 65')}${metric('Watch', pulses.filter((x) => x.pulse.status === 'Watch').length, 'Pulse 65–79')}${metric('Active plans', open.length, 'Open or monitoring')}</section>
    <section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">PRIORITY LIST</span><h3>Students to review</h3></div></div>${pulses.length ? `<div class="list">${pulses.slice(0,12).map(({ student, pulse }) => `<div class="list-row"><div class="list-main"><strong>${esc(student.displayName || student.email)}</strong><span>${esc(pulse.reasons[0])}</span></div>${pulseBadge(pulse)}</div>`).join('')}</div>` : '<div class="empty-state"><strong>No students in scope</strong>Rostered students will appear here.</div>'}</div>
    <div class="card"><div class="section-head"><div><span class="eyebrow">INTERVENTIONS</span><h3>Support plans</h3></div><button class="link-button" data-p3-action="new-intervention">Add plan</button></div>${state.interventions.length ? `<div class="list">${state.interventions.sort((a,b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0)).map((item) => `<div class="list-row"><div class="list-main"><strong>${esc(item.title)}</strong><span>${esc(personName(item.studentId))} · ${esc(item.type || 'Academic')} · next review ${formatDate(item.nextReviewAt)}</span></div><button class="pill clickable ${item.status === 'resolved' ? 'success' : item.priority === 'high' ? 'danger' : 'warning'}" data-p3-action="intervention-status" data-intervention-id="${esc(item.id)}">${esc(item.status || 'open')}</button></div>`).join('')}</div>` : '<div class="empty-state"><strong>No interventions yet</strong>Create a support plan when a student needs structured follow-up.</div>'}</div></section>`;
}

function districtView() {
  const students = visibleStudents();
  const pulses = students.map((student) => studentPulse(student.id));
  const numeric = pulses.filter((item) => item.score !== null);
  const avgPulse = numeric.length ? numeric.reduce((sum, item) => sum + item.score, 0) / numeric.length : null;
  const grades = students.flatMap((student) => visibleCourses().filter((c) => (c.studentIds || []).includes(student.id)).map((c) => courseGrade(student.id, c.id))).filter((value) => value !== null);
  const avgGrade = grades.length ? grades.reduce((a,b) => a+b, 0) / grades.length : null;
  const attendance = state.attendance;
  const attendanceRate = attendance.length ? attendance.filter((item) => item.status === 'present' || item.status === 'excused').length / attendance.length * 100 : null;
  const missing = state.assignments.reduce((sum, assignmentItem) => sum + students.filter((student) => assignmentMissing(student.id, assignmentItem)).length, 0);
  const schoolRows = state.schools.map((s) => {
    const schoolCourses = visibleCourses().filter((c) => c.schoolId === s.id);
    const schoolStudents = unique(schoolCourses.flatMap((c) => (c.studentIds || []).map((id) => person(id))).filter(Boolean));
    const schoolPulses = schoolStudents.map((student) => studentPulse(student.id)).filter((p) => p.score !== null);
    const score = schoolPulses.length ? schoolPulses.reduce((sum,p) => sum+p.score,0)/schoolPulses.length : null;
    return `<tr><td><span class="row-title">${esc(s.name)}</span><span class="row-subtitle">${schoolCourses.length} courses</span></td><td>${schoolStudents.length}</td><td>${score === null ? '—' : score.toFixed(0)}</td><td>${schoolPulses.filter((p) => p.status === 'Attention').length}</td><td>${schoolPulses.filter((p) => p.workload.overloaded).length}</td></tr>`;
  }).join('');
  return `${hero('DISTRICT PULSE', 'See the system, not just the spreadsheet.', 'District Pulse aggregates explainable academic signals from current ClassOS records. It is intended to focus attention—not to make automated high-stakes decisions.')}
    <section class="section grid grid-4">${metric('Students', students.length, 'Across visible schools')}${metric('Average Pulse', avgPulse === null ? '—' : avgPulse.toFixed(0), 'Explainable academic index')}${metric('Average grade', avgGrade === null ? '—' : `${avgGrade.toFixed(1)}%`, 'Across graded courses')}${metric('Attendance', attendanceRate === null ? '—' : `${attendanceRate.toFixed(1)}%`, `${missing} missing-work flags`)}</section>
    <section class="section card"><div class="section-head"><div><span class="eyebrow">SCHOOL PULSE</span><h3>School comparison</h3></div></div>${schoolRows ? `<div class="table-wrap"><table><thead><tr><th>School</th><th>Students</th><th>Pulse</th><th>Attention</th><th>Overload</th></tr></thead><tbody>${schoolRows}</tbody></table></div>` : '<div class="empty-state"><strong>No schools available</strong>District metrics will appear after school setup.</div>'}</section>
    <section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">SIGNAL MIX</span><h3>What District Pulse is using</h3></div></div><div class="list"><div class="list-row"><div class="list-main"><strong>Grades</strong><span>Weighted course grade evidence already recorded in ClassOS</span></div><span class="pill">35%</span></div><div class="list-row"><div class="list-main"><strong>Completion</strong><span>Past-due assignment completion</span></div><span class="pill">30%</span></div><div class="list-row"><div class="list-main"><strong>Attendance</strong><span>Recent present, tardy, excused, and absent records</span></div><span class="pill">20%</span></div><div class="list-row"><div class="list-main"><strong>Mastery</strong><span>Standards-linked graded evidence</span></div><span class="pill">15%</span></div></div></div><div class="card"><div class="section-head"><div><span class="eyebrow">GUARDRAIL</span><h3>Human review required</h3></div></div><div class="callout info"><strong>Pulse is not a disciplinary, placement, admissions, or eligibility decision.</strong><br>It summarizes academic records so educators can decide what to review. ClassOS always shows the contributing signals and keeps workload alerts separate from the score.</div></div></section>`;
}

const views = { command: commandView, assessments: assessmentView, learning: learningView, support: supportView, district: districtView };
const meta = {
  command: ['Command Center', 'INTELLIGENCE'], assessments: ['Assessments', 'ASSESSMENT ENGINE'],
  learning: ['Learning Graph', 'MASTERY'], support: ['Student Support', 'INTERVENTIONS'], district: ['District Pulse', 'SYSTEM INTELLIGENCE']
};

function routeAllowed(routeName) {
  if (!state.profile || state.profile.status !== 'active') return false;
  if (routeName === 'assessments') return isOwner() || MANAGER_ROLES.includes(role()) || isStudent();
  if (routeName === 'learning') return isOwner() || MANAGER_ROLES.includes(role()) || ['counselor','student','guardian'].includes(role());
  if (routeName === 'command') return isOwner() || MANAGER_ROLES.includes(role());
  if (routeName === 'support') return isOwner() || SUPPORT_ROLES.includes(role()) || isTeacher();
  if (routeName === 'district') return isOwner() || ADMIN_ROLES.includes(role());
  return false;
}

async function render(routeName) {
  if (!routeAllowed(routeName)) return;
  state.route = routeName;
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.remove('active'));
  document.querySelector(`.p3-nav[data-p3-route="${routeName}"]`)?.classList.add('active');
  const [title, kicker] = meta[routeName];
  if ($('page-title')) $('page-title').textContent = title;
  if ($('workspace-kicker')) $('workspace-kicker').textContent = kicker;
  if ($('page-content')) $('page-content').innerHTML = '<div class="skeleton" style="height:160px"></div>';
  try {
    await load();
    $('page-content').innerHTML = (views[routeName] || commandView)();
  } catch (error) {
    console.error(error);
    $('page-content').innerHTML = `<div class="empty-state"><strong>ClassOS Intelligence could not load.</strong>${esc(error.message || 'Unknown error')}</div>`;
  }
}

function ensureModal() {
  if ($('p3-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="p3-modal" class="modal-backdrop hidden" role="presentation"><section class="modal p3-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><span class="eyebrow" id="p3-modal-kicker">CLASSOS INTELLIGENCE</span><h3 id="p3-modal-title">Dialog</h3></div><button id="p3-modal-close" class="icon-btn" aria-label="Close">×</button></div><div id="p3-modal-body" class="modal-body"></div></section></div>`);
  $('p3-modal-close').onclick = closeModal;
  $('p3-modal').onclick = (event) => { if (event.target.id === 'p3-modal') closeModal(); };
}

function openModal(title, body, kicker = 'CLASSOS INTELLIGENCE') {
  ensureModal();
  $('p3-modal-title').textContent = title; $('p3-modal-kicker').textContent = kicker; $('p3-modal-body').innerHTML = body; $('p3-modal').classList.remove('hidden');
}
function closeModal() { $('p3-modal')?.classList.add('hidden'); if ($('p3-modal-body')) $('p3-modal-body').innerHTML = ''; }

function standardsForSelected() { return state.standards.filter((item) => item.courseId === state.selectedCourseId); }

function standardUsage(standardId) {
  const assignmentCount = state.assignments.filter((item) => (item.standardIds || []).includes(standardId)).length;
  const questionCount = state.questions.filter((item) => (item.standardIds || []).includes(standardId)).length;
  return { assignmentCount, questionCount, total: assignmentCount + questionCount };
}

function showStandardForm(standardId = '') {
  const existing = standardId ? state.standards.find((item) => item.id === standardId) : null;
  const title = existing ? 'Edit standard' : 'Add standard';
  openModal(title, `<form id="p3-standard-form">
    <input type="hidden" name="standardId" value="${esc(existing?.id || '')}">
    <div class="form-grid">
      <div class="field"><label>Code</label><input name="code" required maxlength="40" value="${esc(existing?.code || '')}" placeholder="ELA.11.R.1"></div>
      <div class="field"><label>Title</label><input name="title" required maxlength="140" value="${esc(existing?.title || '')}" placeholder="Evaluate evidence"></div>
      <div class="field span-2"><label>Description</label><textarea name="description" rows="4" placeholder="What students should know or be able to do">${esc(existing?.description || '')}</textarea></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-secondary" data-p3-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${existing ? 'Save changes' : 'Add standard'}</button></div>
  </form>`, 'STANDARDS');
}

function showBulkStandardForm() {
  openModal('Add standards in bulk', `<form id="p3-standard-bulk-form">
    <div class="callout info" style="margin-bottom:14px"><strong>Fast entry:</strong> put one standard per line using <code>CODE | Title | Description</code>. Description is optional.</div>
    <div class="field"><label>Standards</label><textarea name="standards" rows="12" required placeholder="ELA.11.R.1 | Evaluate evidence | Evaluate evidence from multiple sources&#10;ELA.11.W.2 | Informative writing"></textarea></div>
    <div class="modal-actions"><button type="button" class="btn btn-secondary" data-p3-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Add standards</button></div>
  </form>`, 'STANDARDS');
}

function showStandardManager() {
  const selected = course(state.selectedCourseId);
  if (!selected || !canManageCourse(selected.id)) return toast('Choose a course you manage.', 'error');
  const standards = standardsForSelected().sort((a,b) => String(a.code || '').localeCompare(String(b.code || '')));
  openModal(`Standards · ${selected.name}`, `
    <div class="standard-manager-head">
      <div class="callout info"><strong>Manage your course standards.</strong><br>Create, edit, map, and remove standards from one place.</div>
      <div class="toolbar-group"><button class="btn btn-secondary" data-p3-action="bulk-standard">Bulk add</button><button class="btn btn-primary" data-p3-action="new-standard">Add standard</button></div>
    </div>
    <div class="standard-manager-list">
      ${standards.length ? standards.map((item) => {
        const usage = standardUsage(item.id);
        return `<article class="standard-manager-row"><div class="standard-manager-main"><span class="eyebrow">${esc(item.code || 'STANDARD')}</span><strong>${esc(item.title)}</strong><p>${esc(item.description || 'No description')}</p><div class="standard-usage"><span>${usage.assignmentCount} assignment${usage.assignmentCount === 1 ? '' : 's'}</span><span>${usage.questionCount} question${usage.questionCount === 1 ? '' : 's'}</span></div></div><div class="row-actions"><button class="pill clickable" data-p3-action="edit-standard" data-standard-id="${esc(item.id)}">Edit</button><button class="pill clickable info" data-p3-action="map-standard" data-standard-id="${esc(item.id)}">Map</button><button class="pill clickable danger" data-p3-action="delete-standard" data-standard-id="${esc(item.id)}">Delete</button></div></article>`;
      }).join('') : '<div class="empty-state"><strong>No standards yet</strong>Add one standard or paste a whole set at once.</div>'}
    </div>
  `, 'STANDARDS');
}
function questionsForSelected() { return state.questions.filter((item) => item.courseId === state.selectedCourseId); }

function showMapAssignment(preselectedStandardId = '') {
  const assignments = state.assignments.filter((item) => item.courseId === state.selectedCourseId);
  const standards = standardsForSelected();
  if (!assignments.length || !standards.length) return toast('Add at least one assignment and standard first.', 'error');
  openModal('Map assignment evidence', `<form id="p3-map-form">
    <div class="field"><label>Assignment</label><select name="assignmentId">${assignments.map((item) => `<option value="${esc(item.id)}">${esc(item.title)}</option>`).join('')}</select></div>
    <div class="field"><label>Standards</label><div class="p3-check-list standard-map-list">${standards.map((item) => `<label><input type="checkbox" name="standardId" value="${esc(item.id)}" ${preselectedStandardId === item.id ? 'checked' : ''}><span><strong>${esc(item.code)} — ${esc(item.title)}</strong><small>${esc(item.description || 'No description')}</small></span></label>`).join('')}</div></div>
    <div class="modal-actions"><button type="button" class="btn btn-secondary" data-p3-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Save mappings</button></div>
  </form>`, 'STANDARDS');
}

function showQuestionForm(questionId = '') {
  const standards = standardsForSelected();
  const existing = questionId ? state.questions.find((item) => item.id === questionId) : null;
  const selected = course(state.selectedCourseId);
  if (existing && (!selected || existing.courseId !== selected.id || !canManageCourse(selected.id))) return toast('You cannot edit that question.', 'error');
  const inAssessments = existing ? state.assessments.filter((item) => (item.questionIds || []).includes(existing.id)).length : 0;
  const selectedStandard = existing?.standardIds?.[0] || '';
  openModal(existing ? 'Edit question' : 'Add question', `<form id="p3-question-form">
    <input type="hidden" name="questionId" value="${esc(existing?.id || '')}">
    ${existing && inAssessments ? `<div class="callout info" style="margin-bottom:14px"><strong>Used in ${inAssessments} assessment${inAssessments === 1 ? '' : 's'}.</strong><br>Editing this bank question changes future assessment snapshots. Existing assessments keep their current copy until you edit and save that assessment. Assessments with attempts keep their locked snapshot.</div>` : ''}
    <div class="form-grid">
      <div class="field"><label>Type</label><select name="type"><option value="multiple_choice" ${existing?.type === 'multiple_choice' ? 'selected' : ''}>Multiple choice</option><option value="true_false" ${existing?.type === 'true_false' ? 'selected' : ''}>True / False</option><option value="short_answer" ${existing?.type === 'short_answer' ? 'selected' : ''}>Short answer</option></select></div>
      <div class="field"><label>Points</label><input name="points" type="number" min="1" step="0.5" value="${esc(existing?.points ?? 1)}" required></div>
      <div class="field span-2"><label>Prompt</label><textarea name="prompt" rows="4" required>${esc(existing?.prompt || '')}</textarea></div>
      <div class="field span-2"><label>Options</label><textarea name="options" rows="5" placeholder="For multiple choice, put one option per line. For true/false, leave blank.">${esc((existing?.options || []).join('\n'))}</textarea></div>
      <div class="field"><label>Correct answer</label><input name="correctAnswer" value="${esc(existing?.correctAnswer || '')}" placeholder="Exact option text or true/false"></div>
      <div class="field"><label>Standard</label><select name="standardId"><option value="">No standard</option>${standards.map((item) => `<option value="${esc(item.id)}" ${selectedStandard === item.id ? 'selected' : ''}>${esc(item.code)} — ${esc(item.title)}</option>`).join('')}</select></div>
    </div>
    <div class="callout info"><strong>Answer-key protection:</strong> the correct answer stays in the teacher-only question bank. Published student assessments receive a safe question snapshot without the answer.</div>
    <div class="modal-actions"><button type="button" class="btn btn-secondary" data-p3-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${existing ? 'Save question' : 'Add question'}</button></div>
  </form>`, 'QUESTION BANK');
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function presentedAssessmentItems(item) {
  let items = [...(item.items || [])];
  const count = Number(item.randomQuestionCount || 0);
  if (count > 0 && count < items.length) items = shuffled(items).slice(0, count);
  else if (item.shuffleQuestions) items = shuffled(items);
  if (item.shuffleAnswers) {
    items = items.map((q) => q.type === 'multiple_choice' ? { ...q, options: shuffled(q.options || []) } : q);
  }
  return items;
}

function showAssessmentForm(assessmentId = '') {
  const questions = questionsForSelected();
  const existing = assessmentId ? assessment(assessmentId) : null;
  const selected = course(state.selectedCourseId);
  if (existing && (!selected || existing.courseId !== selected.id || !canManageCourse(selected.id))) return toast('You cannot edit that assessment.', 'error');
  if (!questions.length && !existing) return toast('Add at least one question first.', 'error');

  const attempts = existing ? state.attempts.filter((item) => item.assessmentId === existing.id) : [];
  const poolLocked = attempts.length > 0;
  const selectedIds = new Set(existing?.questionIds || []);
  const title = existing ? 'Edit assessment' : 'Create assessment';

  openModal(title, `<form id="p3-assessment-form">
    <input type="hidden" name="assessmentId" value="${esc(existing?.id || '')}">
    ${poolLocked ? `<div class="callout warning" style="margin-bottom:14px"><strong>Question pool locked.</strong><br>${attempts.length} attempt${attempts.length === 1 ? '' : 's'} already exist. You can edit assessment details and delivery settings, but the question pool is preserved so submitted work remains reviewable.</div>` : ''}
    <div class="assignment-builder">
      <div class="assignment-builder-section"><div class="assignment-builder-heading"><span>1</span><div><strong>Assessment details</strong><small>Name, description, and availability</small></div></div><div class="form-grid">
        <div class="field span-2"><label>Title</label><input name="title" value="${esc(existing?.title || '')}" required></div>
        <div class="field span-2"><label>Description</label><textarea name="description" rows="3">${esc(existing?.description || '')}</textarea></div>
        <div class="field"><label>Available from</label><input name="availableFrom" type="datetime-local" value="${esc(dateTimeInput(existing?.availableFrom))}"></div>
        <div class="field"><label>Due date</label><input name="dueAt" type="datetime-local" value="${esc(dateTimeInput(existing?.dueAt))}"></div>
        <div class="field"><label>Status</label><select name="status"><option value="draft" ${existing?.status !== 'published' ? 'selected' : ''}>Draft</option><option value="published" ${existing?.status === 'published' ? 'selected' : ''}>Published</option></select></div>
      </div></div>
      <div class="assignment-builder-section"><div class="assignment-builder-heading"><span>2</span><div><strong>Question pool</strong><small>${poolLocked ? 'Locked because attempts already exist' : 'Select reusable questions from the course bank'}</small></div></div>
        <div class="p3-check-list">${questions.map((item) => {
          const checked = selectedIds.has(item.id);
          return `<label class="${poolLocked ? 'is-locked' : ''}"><input type="checkbox" name="questionId" value="${esc(item.id)}" ${checked ? 'checked' : ''} ${poolLocked ? 'disabled' : ''}><span><strong>${esc(item.prompt)}</strong><small>${esc(item.type.replaceAll('_',' '))} · ${Number(item.points || 0)} pts</small></span></label>${poolLocked && checked ? `<input type="hidden" name="questionId" value="${esc(item.id)}">` : ''}`;
        }).join('')}</div>
      </div>
      <div class="assignment-builder-section"><div class="assignment-builder-heading"><span>3</span><div><strong>Delivery settings</strong><small>Control how each student sees the assessment</small></div></div><div class="form-grid">
        <div class="field"><label>Questions per attempt</label><input name="randomQuestionCount" type="number" min="0" step="1" value="${esc(existing?.randomQuestionCount ?? 0)}"><small>0 uses every selected question.</small></div>
        <div class="field"><label>Question order</label><select name="shuffleQuestions"><option value="no" ${existing?.shuffleQuestions ? '' : 'selected'}>Keep selected order</option><option value="yes" ${existing?.shuffleQuestions ? 'selected' : ''}>Shuffle for each attempt</option></select></div>
        <div class="field"><label>Answer choices</label><select name="shuffleAnswers"><option value="no" ${existing?.shuffleAnswers ? '' : 'selected'}>Keep option order</option><option value="yes" ${existing?.shuffleAnswers ? 'selected' : ''}>Shuffle multiple-choice options</option></select></div>
      </div></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-secondary" data-p3-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${existing ? 'Save assessment' : 'Create assessment'}</button></div>
  </form>`, 'ASSESSMENT ENGINE');
}

function showTakeAssessment(id) {
  const item = assessment(id);
  if (!item || item.status !== 'published') return toast('That assessment is not available.', 'error');
  const available = asDate(item.availableFrom);
  if (available && available > new Date()) return toast(`This assessment opens ${formatDate(item.availableFrom, true)}.`, 'error');
  if (state.attempts.some((attempt) => attempt.assessmentId === id && attempt.studentId === uid())) return toast('You already submitted this assessment.', 'error');
  const presented = presentedAssessmentItems(item);
  openModal(item.title, `<form id="p3-attempt-form" data-assessment-id="${esc(item.id)}"><input type="hidden" name="presentedQuestionIds" value="${esc(presented.map((q) => q.id).join(','))}"><div class="callout" style="margin-bottom:18px"><strong>${presented.reduce((sum,q)=>sum+Number(q.points||0),0)} displayed points</strong> · Due ${formatDate(item.dueAt, true)}<br>Submit once you are finished. Objective answer keys are not delivered to student accounts.</div><div class="p3-question-stack">${presented.map((q, index) => `<article class="p3-question"><div class="p3-question-number">${index + 1}</div><div><h4>${esc(q.prompt)}</h4><span class="pill">${Number(q.points || 0)} pts</span>${q.type === 'multiple_choice' ? `<div class="p3-answer-options">${(q.options || []).map((option) => `<label><input type="radio" name="answer__${esc(q.id)}" value="${esc(option)}" required><span>${esc(option)}</span></label>`).join('')}</div>` : q.type === 'true_false' ? `<div class="p3-answer-options"><label><input type="radio" name="answer__${esc(q.id)}" value="true" required><span>True</span></label><label><input type="radio" name="answer__${esc(q.id)}" value="false" required><span>False</span></label></div>` : `<textarea name="answer__${esc(q.id)}" rows="5" required placeholder="Your response"></textarea>`}</div></article>`).join('')}</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-p3-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Submit assessment</button></div></form>`, 'ASSESSMENT');
}

async function showReviewAttempt(id) {
  const attempt = state.attempts.find((item) => item.id === id);
  const item = attempt ? assessment(attempt.assessmentId) : null;
  if (!attempt || !item || !canManageCourse(item.courseId) && !isSupport()) return toast('You cannot review that attempt.', 'error');
  const keySnap = await getDoc(doc(db, 'assessmentKeys', item.id));
  const keys = keySnap.exists() ? keySnap.data().answers || {} : {};
  const presentedIds = Array.isArray(attempt.presentedQuestionIds) && attempt.presentedQuestionIds.length ? attempt.presentedQuestionIds : (item.items || []).map((q) => q.id);
  const rows = (item.items || []).filter((q) => presentedIds.includes(q.id)).map((q) => {
    const answer = attempt.answers?.[q.id] ?? '';
    let suggested = '';
    if (q.type !== 'short_answer') suggested = String(answer).trim().toLowerCase() === String(keys[q.id] ?? '').trim().toLowerCase() ? Number(q.points || 0) : 0;
    return `<article class="p3-review-item"><div><span class="eyebrow">${esc(q.type.replaceAll('_',' '))}</span><h4>${esc(q.prompt)}</h4><p><strong>Student:</strong> ${esc(answer || '(blank)')}</p>${q.type !== 'short_answer' ? `<p><strong>Key:</strong> ${esc(keys[q.id] ?? '—')}</p>` : ''}</div><div class="field"><label>Points / ${Number(q.points || 0)}</label><input name="score__${esc(q.id)}" type="number" min="0" max="${Number(q.points || 0)}" step="0.5" value="${suggested}" required></div></article>`;
  }).join('');
  openModal(`Review: ${item.title}`, `<form id="p3-review-form" data-attempt-id="${esc(attempt.id)}"><div class="callout info" style="margin-bottom:16px"><strong>Protected auto-scoring:</strong> objective items are pre-scored here because this reviewer is authorized to read the answer key. Short-answer points remain a human decision.</div><div class="p3-review-stack">${rows}</div><div class="field"><label>Feedback</label><textarea name="feedback" rows="4">${esc(attempt.feedback || '')}</textarea></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-p3-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Finalize grade</button></div></form>`, 'ASSESSMENT REVIEW');
}

function showInterventionForm() {
  const students = visibleStudents();
  if (!students.length) return toast('No students are available in your current scope.', 'error');
  const courses = visibleCourses();
  openModal('New intervention', `<form id="p3-intervention-form"><div class="form-grid"><div class="field"><label>Student</label><select name="studentId">${students.map((item) => `<option value="${esc(item.id)}">${esc(item.displayName || item.email)}</option>`).join('')}</select></div><div class="field"><label>Course</label><select name="courseId"><option value="">School-wide / not course-specific</option>${courses.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></div><div class="field"><label>Type</label><select name="type"><option>Academic</option><option>Attendance</option><option>Missing Work</option><option>Mastery</option><option>Workload</option><option>Other</option></select></div><div class="field"><label>Priority</label><select name="priority"><option value="normal">Normal</option><option value="medium">Medium</option><option value="high">High</option></select></div><div class="field span-2"><label>Title</label><input name="title" required placeholder="Weekly missing-work check-in"></div><div class="field span-2"><label>Internal notes</label><textarea name="notes" rows="5" required></textarea></div><div class="field"><label>Next review</label><input name="nextReviewAt" type="date"></div></div><div class="callout"><strong>Internal record:</strong> intervention notes are available only to authorized educators and are not shown in student or guardian views.</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-p3-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Create plan</button></div></form>`, 'STUDENT SUPPORT');
}

async function handleForm(form) {
  const data = new FormData(form);
  if (form.id === 'p3-standard-form') {
    const selected = course(state.selectedCourseId); if (!selected || !canManageCourse(selected.id)) throw new Error('Choose a course you manage.');
    const standardId = String(data.get('standardId') || '');
    const payload = { code: String(data.get('code')).trim(), title: String(data.get('title')).trim(), description: String(data.get('description') || '').trim(), updatedAt: serverTimestamp() };
    if (!payload.code || !payload.title) throw new Error('Code and title are required.');
    if (standardId) {
      const existing = state.standards.find((item) => item.id === standardId && item.courseId === selected.id);
      if (!existing) throw new Error('Standard unavailable.');
      await updateDoc(doc(db, 'standards', standardId), payload);
      closeModal(); toast('Standard updated.', 'success'); return render('learning');
    }
    await addDoc(collection(db, 'standards'), { courseId: selected.id, schoolId: selected.schoolId, ...payload, createdBy: uid(), createdAt: serverTimestamp() });
    closeModal(); toast('Standard added.', 'success'); return render('learning');
  }
  if (form.id === 'p3-standard-bulk-form') {
    const selected = course(state.selectedCourseId); if (!selected || !canManageCourse(selected.id)) throw new Error('Choose a course you manage.');
    const lines = String(data.get('standards') || '').split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Add at least one standard.');
    const parsed = lines.map((line, index) => {
      const [code, title, ...rest] = line.split('|').map((part) => part.trim());
      if (!code || !title) throw new Error(`Line ${index + 1} needs CODE | Title.`);
      return { code, title, description: rest.join(' | ') };
    });
    const existingCodes = new Set(standardsForSelected().map((item) => String(item.code || '').toLowerCase()));
    const toCreate = parsed.filter((item) => !existingCodes.has(item.code.toLowerCase()));
    if (!toCreate.length) throw new Error('Every code in that list already exists in this course.');
    await Promise.all(toCreate.map((item) => addDoc(collection(db, 'standards'), { courseId: selected.id, schoolId: selected.schoolId, ...item, createdBy: uid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })));
    closeModal(); toast(`${toCreate.length} standard${toCreate.length === 1 ? '' : 's'} added.`, 'success'); return render('learning');
  }
  if (form.id === 'p3-map-form') {
    const assignmentId = String(data.get('assignmentId'));
    const standardIds = data.getAll('standardId').map(String);
    const assignmentItem = state.assignments.find((item) => item.id === assignmentId); if (!assignmentItem || !canManageCourse(assignmentItem.courseId)) throw new Error('Invalid assignment.');
    if (!standardIds.length) throw new Error('Select at least one standard.');
    await updateDoc(doc(db, 'assignments', assignmentId), { standardIds: [...new Set(standardIds)], updatedAt: serverTimestamp() });
    closeModal(); toast('Assignment mappings updated.', 'success'); return render('learning');
  }
  if (form.id === 'p3-question-form') {
    const selected = course(state.selectedCourseId); if (!selected || !canManageCourse(selected.id)) throw new Error('Choose a course you manage.');
    const questionId = String(data.get('questionId') || '');
    const type = String(data.get('type')); const rawOptions = String(data.get('options') || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const options = type === 'true_false' ? ['true', 'false'] : type === 'multiple_choice' ? rawOptions : [];
    if (type === 'multiple_choice' && options.length < 2) throw new Error('Multiple-choice questions need at least two options.');
    const correctAnswer = String(data.get('correctAnswer') || '').trim();
    if (type !== 'short_answer' && !correctAnswer) throw new Error('Objective questions need a correct answer.');
    if (type === 'multiple_choice' && !options.includes(correctAnswer)) throw new Error('The correct answer must exactly match one of the multiple-choice options.');
    if (type === 'true_false' && !['true','false'].includes(correctAnswer.toLowerCase())) throw new Error('True / False questions must use true or false as the correct answer.');
    const payload = { type, prompt: String(data.get('prompt')).trim(), options, correctAnswer, points: Number(data.get('points')) || 1, standardIds: data.get('standardId') ? [String(data.get('standardId'))] : [], updatedAt: serverTimestamp() };
    if (questionId) {
      const existing = state.questions.find((item) => item.id === questionId && item.courseId === selected.id);
      if (!existing) throw new Error('Question unavailable.');
      await updateDoc(doc(db, 'questionBank', questionId), payload);
      closeModal(); toast('Question updated.', 'success'); return render('assessments');
    }
    await addDoc(collection(db, 'questionBank'), { courseId: selected.id, schoolId: selected.schoolId, ...payload, createdBy: uid(), createdAt: serverTimestamp() });
    closeModal(); toast('Question added to the bank.', 'success'); return render('assessments');
  }
  if (form.id === 'p3-assessment-form') {
    const selected = course(state.selectedCourseId); if (!selected || !canManageCourse(selected.id)) throw new Error('Choose a course you manage.');
    const assessmentId = String(data.get('assessmentId') || '');
    const existing = assessmentId ? assessment(assessmentId) : null;
    if (assessmentId && (!existing || existing.courseId !== selected.id)) throw new Error('Assessment unavailable.');
    const ids = [...new Set(data.getAll('questionId').map(String))]; if (!ids.length) throw new Error('Select at least one question.');
    const questions = ids.map((id) => state.questions.find((item) => item.id === id)).filter(Boolean);
    if (questions.length !== ids.length) throw new Error('One or more selected questions are unavailable.');
    const hasAttempts = existing ? state.attempts.some((item) => item.assessmentId === existing.id) : false;
    const items = hasAttempts
      ? [...(existing.items || [])]
      : questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options || [], points: Number(q.points) || 0, standardIds: q.standardIds || [] }));
    const pointsPossible = items.reduce((sum, item) => sum + Number(item.points || 0), 0);
    const randomQuestionCount = Math.max(0, Math.min(items.length, Number(data.get('randomQuestionCount')) || 0));
    const availableFrom = data.get('availableFrom') ? new Date(String(data.get('availableFrom'))) : null;
    const dueAt = data.get('dueAt') ? new Date(String(data.get('dueAt'))) : null;
    if (availableFrom && Number.isNaN(availableFrom.getTime())) throw new Error('Choose a valid availability date.');
    if (dueAt && Number.isNaN(dueAt.getTime())) throw new Error('Choose a valid due date.');
    if (availableFrom && dueAt && availableFrom > dueAt) throw new Error('Available from must be before the due date.');
    const payload = { title: String(data.get('title')).trim(), description: String(data.get('description') || '').trim(), items, questionIds: ids, pointsPossible, availableFrom, dueAt, randomQuestionCount, shuffleQuestions: String(data.get('shuffleQuestions')) === 'yes', shuffleAnswers: String(data.get('shuffleAnswers')) === 'yes', status: String(data.get('status')), updatedAt: serverTimestamp() };
    const answers = {}; questions.forEach((q) => { answers[q.id] = q.correctAnswer || ''; });

    if (existing) {
      if (hasAttempts) {
        const originalIds = [...(existing.questionIds || [])].sort();
        const submittedIds = [...ids].sort();
        if (JSON.stringify(originalIds) !== JSON.stringify(submittedIds)) throw new Error('The question pool is locked because attempts already exist.');
      }
      await updateDoc(doc(db, 'assessments', existing.id), payload);
      if (!hasAttempts) {
        await setDoc(doc(db, 'assessmentKeys', existing.id), { assessmentId: existing.id, courseId: selected.id, schoolId: selected.schoolId, answers, updatedAt: serverTimestamp() }, { merge: true });
      }
      closeModal(); toast(hasAttempts ? 'Assessment details updated. Existing question snapshot preserved.' : 'Assessment updated.', 'success'); return render('assessments');
    }

    const ref = await addDoc(collection(db, 'assessments'), { courseId: selected.id, schoolId: selected.schoolId, ...payload, createdBy: uid(), createdAt: serverTimestamp() });
    await setDoc(doc(db, 'assessmentKeys', ref.id), { assessmentId: ref.id, courseId: selected.id, schoolId: selected.schoolId, answers, createdBy: uid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    closeModal(); toast('Assessment created.', 'success'); return render('assessments');
  }
  if (form.id === 'p3-attempt-form') {
    if (!isStudent()) throw new Error('Only students can submit an assessment attempt.');
    const id = form.dataset.assessmentId; const item = assessment(id); if (!item || item.status !== 'published') throw new Error('Assessment unavailable.');
    const presentedQuestionIds = String(data.get('presentedQuestionIds') || '').split(',').filter(Boolean);
    const presentedItems = (item.items || []).filter((q) => presentedQuestionIds.includes(q.id));
    const answers = {}; presentedItems.forEach((q) => { answers[q.id] = String(data.get(`answer__${q.id}`) ?? '').trim(); });
    const attemptId = `${id}_${uid()}`;
    await setDoc(doc(db, 'assessmentAttempts', attemptId), { assessmentId: id, courseId: item.courseId, schoolId: item.schoolId, studentId: uid(), answers, presentedQuestionIds, score: null, pointsPossible: presentedItems.reduce((sum,q)=>sum+Number(q.points||0),0), itemResults: [], feedback: '', status: 'submitted', submittedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    closeModal(); toast('Assessment submitted.', 'success'); return render('assessments');
  }
  if (form.id === 'p3-review-form') {
    const attemptId = form.dataset.attemptId; const attempt = state.attempts.find((item) => item.id === attemptId); const item = attempt ? assessment(attempt.assessmentId) : null;
    if (!attempt || !item || (!canManageCourse(item.courseId) && !isSupport())) throw new Error('Attempt unavailable.');
    const presentedIds = Array.isArray(attempt.presentedQuestionIds) && attempt.presentedQuestionIds.length ? attempt.presentedQuestionIds : (item.items || []).map((q) => q.id);
    const results = (item.items || []).filter((q) => presentedIds.includes(q.id)).map((q) => ({ questionId: q.id, standardIds: q.standardIds || [], earned: Math.max(0, Math.min(Number(q.points || 0), Number(data.get(`score__${q.id}`)) || 0)), possible: Number(q.points || 0), type: q.type }));
    const score = results.reduce((sum, result) => sum + result.earned, 0);
    await updateDoc(doc(db, 'assessmentAttempts', attemptId), { itemResults: results, score, pointsPossible: results.reduce((sum, result) => sum + result.possible, 0), feedback: String(data.get('feedback') || '').trim(), status: 'graded', gradedBy: uid(), gradedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    closeModal(); toast('Assessment grade finalized.', 'success'); return render(state.route || 'assessments');
  }
  if (form.id === 'p3-intervention-form') {
    if (!isSupport() && !isTeacher()) throw new Error('You do not have intervention access.');
    const studentId = String(data.get('studentId')); const courseId = String(data.get('courseId') || ''); const student = person(studentId); if (!student) throw new Error('Choose a valid student.');
    let schoolId = student.schoolIds?.[0] || state.profile.schoolIds?.[0] || '';
    if (courseId) { const c = course(courseId); if (!c || !canManageCourse(courseId) && !isSupport()) throw new Error('Choose a course in your scope.'); schoolId = c.schoolId; }
    if (isTeacher() && !courseId) throw new Error('Teachers must connect an intervention to one of their courses.');
    await addDoc(collection(db, 'interventions'), { studentId, schoolId, courseId, type: String(data.get('type')), priority: String(data.get('priority')), title: String(data.get('title')).trim(), notes: String(data.get('notes')).trim(), nextReviewAt: data.get('nextReviewAt') ? new Date(`${data.get('nextReviewAt')}T12:00:00`) : null, status: 'open', ownerId: uid(), createdBy: uid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    closeModal(); toast('Intervention created.', 'success'); return render('support');
  }
  return false;
}

async function handleAction(event) {
  const nav = event.target.closest('[data-p3-nav]'); if (nav) { await render(nav.dataset.p3Nav); return true; }
  const target = event.target.closest('[data-p3-action]'); if (!target) return false;
  const action = target.dataset.p3Action;
  if (action === 'close-modal') closeModal();
  if (action === 'select-course') { state.selectedCourseId = target.dataset.courseId; await render(target.dataset.route || state.route); }
  if (action === 'select-student' && target.tagName === 'SELECT') { state.selectedStudentId = target.value; await render(target.dataset.route || state.route); }
  if (action === 'new-standard') showStandardForm();
  if (action === 'bulk-standard') showBulkStandardForm();
  if (action === 'manage-standards') showStandardManager();
  if (action === 'edit-standard') showStandardForm(target.dataset.standardId);
  if (action === 'map-standard') showMapAssignment(target.dataset.standardId);
  if (action === 'map-assignment') showMapAssignment();
  if (action === 'delete-standard') {
    const item = state.standards.find((standard) => standard.id === target.dataset.standardId);
    if (!item || !canManageCourse(item.courseId)) return true;
    const usage = standardUsage(item.id);
    openModal('Delete standard?', `<div class="callout warning"><strong>${esc(item.code)} — ${esc(item.title)}</strong><br>This standard is connected to ${usage.assignmentCount} assignment${usage.assignmentCount === 1 ? '' : 's'} and ${usage.questionCount} question${usage.questionCount === 1 ? '' : 's'}. Deleting it removes those mappings but does not delete the assignments or questions.</div><div class="modal-actions"><button class="btn btn-secondary" data-p3-action="manage-standards">Cancel</button><button class="btn btn-danger" data-p3-action="confirm-delete-standard" data-standard-id="${esc(item.id)}">Delete standard</button></div>`, 'STANDARDS');
  }
  if (action === 'confirm-delete-standard') {
    const standardId = target.dataset.standardId;
    const item = state.standards.find((standard) => standard.id === standardId);
    if (!item || !canManageCourse(item.courseId)) return true;
    const affectedAssignments = state.assignments.filter((assignment) => (assignment.standardIds || []).includes(standardId));
    const affectedQuestions = state.questions.filter((question) => (question.standardIds || []).includes(standardId));
    await Promise.all([
      ...affectedAssignments.map((assignment) => updateDoc(doc(db, 'assignments', assignment.id), { standardIds: (assignment.standardIds || []).filter((id) => id !== standardId), updatedAt: serverTimestamp() })),
      ...affectedQuestions.map((question) => updateDoc(doc(db, 'questionBank', question.id), { standardIds: (question.standardIds || []).filter((id) => id !== standardId), updatedAt: serverTimestamp() }))
    ]);
    await deleteDoc(doc(db, 'standards', standardId));
    closeModal(); toast('Standard deleted and mappings cleaned up.', 'success'); await render('learning');
  }
  if (action === 'new-question') showQuestionForm();
  if (action === 'edit-question') showQuestionForm(target.dataset.questionId);
  if (action === 'new-assessment') showAssessmentForm();
  if (action === 'edit-assessment') showAssessmentForm(target.dataset.assessmentId);
  if (action === 'take-assessment') showTakeAssessment(target.dataset.assessmentId);
  if (action === 'review-attempt') await showReviewAttempt(target.dataset.attemptId);
  if (action === 'new-intervention') showInterventionForm();
  if (action === 'intervention-status') {
    const item = state.interventions.find((x) => x.id === target.dataset.interventionId); if (!item) return true;
    const next = item.status === 'open' ? 'monitoring' : item.status === 'monitoring' ? 'resolved' : 'open';
    await updateDoc(doc(db, 'interventions', item.id), { status: next, updatedAt: serverTimestamp(), resolvedAt: next === 'resolved' ? serverTimestamp() : null });
    toast(`Intervention moved to ${next}.`, 'success'); await render('support');
  }
  return true;
}

function navItemsForRole() {
  const items = [];
  if (routeAllowed('command')) items.push(['command', '◈', 'Command Center']);
  if (routeAllowed('assessments')) items.push(['assessments', '✓', 'Assessments']);
  if (routeAllowed('learning')) items.push(['learning', '⌁', 'Standards & Mastery']);
  if (routeAllowed('support')) items.push(['support', '+', 'Student Support']);
  if (routeAllowed('district')) items.push(['district', '▦', 'District Pulse']);
  return items;
}

function syncNavigation() {
  const nav = $('primary-nav'); if (!nav) return;
  nav.querySelectorAll('.p3-nav').forEach((node) => node.remove());
  navItemsForRole().forEach(([routeName, icon, label], index) => {
    const button = document.createElement('button');
    button.className = `nav-item p3-nav${index === 0 ? ' p3-nav-first' : ''}`;
    button.dataset.p3Route = routeName;
    button.innerHTML = `<span>${icon}</span>${esc(label)}`;
    nav.appendChild(button);
  });
}

function decorateCorePages() {
  const title = $('page-title')?.textContent || '';
  if (title === 'Platform') {
    document.querySelectorAll('#page-content .pill.success').forEach((pill) => { if (pill.textContent.trim() === 'Phase 2') pill.textContent = 'Phase 3'; });
  }
  if (title === 'Home' && !document.querySelector('.p3-home-strip') && state.profile?.status === 'active') {
    const content = $('page-content'); if (!content) return;
    const primaryRoute = routeAllowed('command') ? 'command' : routeAllowed('learning') ? 'learning' : routeAllowed('assessments') ? 'assessments' : null;
    if (!primaryRoute) return;
    const strip = document.createElement('section'); strip.className = 'card p3-home-strip';
    strip.innerHTML = `<div><span class="eyebrow">PHASE 3 INTELLIGENCE</span><strong>${primaryRoute === 'command' ? 'Command Center is ready.' : primaryRoute === 'learning' ? 'Your Learning Graph is ready.' : 'Assessments are ready.'}</strong><span>Mastery, explainable Pulse signals, workload intelligence, and assessment evidence now connect to the LMS.</span></div><button class="btn btn-secondary" data-p3-nav="${primaryRoute}">Open</button>`;
    content.prepend(strip);
  }
}

function wire() {
  ensureModal();
  document.addEventListener('click', async (event) => {
    const routeButton = event.target.closest('.p3-nav[data-p3-route]');
    if (routeButton) { event.preventDefault(); await render(routeButton.dataset.p3Route); $('sidebar')?.classList.remove('open'); return; }
    await handleAction(event);
  });
  document.addEventListener('change', async (event) => {
    const target = event.target.closest('select[data-p3-action="select-student"]');
    if (target) { state.selectedStudentId = target.value; await render(target.dataset.route || state.route); }
  });
  document.addEventListener('submit', async (event) => {
    if (!event.target.id?.startsWith('p3-')) return;
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]'); if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = 'Saving…'; }
    try { await handleForm(event.target); } catch (error) { console.error(error); toast(error.message || 'Could not save.', 'error'); if (button) { button.disabled = false; button.textContent = button.dataset.label || 'Save'; } }
  });
  $('primary-nav')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-route]')) { state.route = null; document.querySelectorAll('.p3-nav').forEach((node) => node.classList.remove('active')); }
  });
  const observer = new MutationObserver(() => { if (!state.route) decorateCorePages(); });
  if ($('page-content')) observer.observe($('page-content'), { childList: true });
}

wire();

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  if (!user || (user.providerData.some((p) => p.providerId === 'password') && !user.emailVerified)) {
    state.profile = null; state.ready = false; document.querySelectorAll('.p3-nav').forEach((node) => node.remove()); return;
  }
  try {
    state.profile = await loadProfile(user);
    if (!state.profile || state.profile.status !== 'active') return;
    await ensurePhase3();
    await load();
    state.ready = true;
    syncNavigation();
    decorateCorePages();
  } catch (error) {
    console.warn('ClassOS Phase 3 startup did not finish', error);
  }
});
