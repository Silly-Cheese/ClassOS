import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

export function createLms({ state, db, auth, helpers }) {
  const {
    esc, toast, openModal, closeModal, logAction, isOwner, roleName,
    formatDate, busy, navigate
  } = helpers;

  const ADMIN_ROLES = ['district_admin', 'school_admin'];
  const SUPPORT_ROLES = ['district_admin', 'school_admin', 'counselor'];
  const TEACHING_ROLES = ['district_admin', 'school_admin', 'teacher'];
  const ACTIVE_ROLES = ['platform_owner', 'district_admin', 'school_admin', 'counselor', 'teacher', 'staff', 'guardian', 'student'];

  function initState() {
    const defaults = {
      assignments: [], submissions: [], attendance: [], announcements: [], messages: [],
      selectedCourseId: null, selectedAssignmentId: null, lmsUsers: [], linkedStudents: []
    };
    Object.entries(defaults).forEach(([key, value]) => {
      if (state[key] === undefined) state[key] = value;
    });
  }
  initState();

  const role = () => state.profile?.role || 'pending';
  const uid = () => state.user?.uid || '';
  const isAdmin = () => isOwner() || ADMIN_ROLES.includes(role());
  const isSupport = () => isOwner() || SUPPORT_ROLES.includes(role());
  const isTeacher = () => role() === 'teacher';
  const isStudent = () => role() === 'student';
  const isGuardian = () => role() === 'guardian';

  function asDate(value) {
    if (!value) return null;
    if (value instanceof Timestamp) return value.toDate();
    if (typeof value?.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function dateKey(value) {
    const d = asDate(value);
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function dateTimeInput(value) {
    const d = asDate(value);
    if (!d) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function timeUntil(value) {
    const d = asDate(value);
    if (!d) return 'No due date';
    const diff = d.getTime() - Date.now();
    const absDays = Math.ceil(Math.abs(diff) / 86400000);
    if (diff < 0) return `${absDays} day${absDays === 1 ? '' : 's'} overdue`;
    if (absDays === 0) return 'Due today';
    if (absDays === 1) return 'Due tomorrow';
    return `Due in ${absDays} days`;
  }

  function unique(items) {
    const map = new Map();
    items.forEach((item) => item?.id && map.set(item.id, item));
    return [...map.values()];
  }

  function person(id) {
    return state.users?.find((u) => u.id === id)
      || state.lmsUsers.find((u) => u.id === id)
      || state.linkedStudents.find((u) => u.id === id)
      || null;
  }

  function personName(id, fallback = 'User') {
    const p = person(id);
    return p?.displayName || p?.email || fallback;
  }

  function course(id) {
    return state.courses.find((c) => c.id === id) || null;
  }

  function visibleCourses() {
    const courses = state.courses || [];
    if (isOwner() || ADMIN_ROLES.includes(role()) || ['counselor', 'staff'].includes(role())) return courses;
    if (isTeacher()) return courses.filter((c) => (c.teacherIds || []).includes(uid()));
    if (isStudent()) return courses.filter((c) => (c.studentIds || []).includes(uid()));
    if (isGuardian()) {
      const linked = state.profile?.linkedStudentIds || [];
      return courses.filter((c) => (c.studentIds || []).some((id) => linked.includes(id)));
    }
    return [];
  }

  function canManageCourse(c) {
    if (!c) return false;
    return isOwner()
      || ADMIN_ROLES.includes(role())
      || (isTeacher() && (c.teacherIds || []).includes(uid()));
  }

  function canTeach() {
    return isOwner() || TEACHING_ROLES.includes(role());
  }

  function courseCategories(c) {
    const cats = Array.isArray(c?.gradeCategories) && c.gradeCategories.length
      ? c.gradeCategories
      : [{ id: 'coursework', name: 'Coursework', weight: 100 }];
    return cats.map((cat) => ({
      id: String(cat.id || 'coursework'),
      name: String(cat.name || 'Coursework'),
      weight: Number(cat.weight) || 0
    }));
  }

  async function getDirect(path, id) {
    try {
      const snap = await getDoc(doc(db, path, id));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (error) {
      console.warn(`Could not load ${path}/${id}`, error);
      return null;
    }
  }

  async function byField(name, field, value) {
    try {
      const snap = await getDocs(query(collection(db, name), where(field, '==', value)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
      console.warn(`Could not load ${name} by ${field}`, error);
      return [];
    }
  }

  async function arrayContains(name, field, value) {
    try {
      const snap = await getDocs(query(collection(db, name), where(field, 'array-contains', value)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
      console.warn(`Could not load ${name} by ${field}`, error);
      return [];
    }
  }

  async function allDocs(name) {
    try {
      const snap = await getDocs(collection(db, name));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
      console.warn(`Could not load ${name}`, error);
      return [];
    }
  }

  async function loadDirectory() {
    if (isOwner()) {
      state.lmsUsers = state.users || [];
      return;
    }

    const ids = new Set([uid()]);
    if (isStudent() || isGuardian()) {
      visibleCourses().forEach((c) => (c.teacherIds || []).forEach((id) => ids.add(id)));
      (state.profile?.linkedStudentIds || []).forEach((id) => ids.add(id));
      const people = await Promise.all([...ids].map((id) => getDirect('users', id)));
      state.lmsUsers = people.filter(Boolean);
      state.linkedStudents = state.lmsUsers.filter((u) => (state.profile?.linkedStudentIds || []).includes(u.id));
      return;
    }

    const batches = await Promise.all((state.profile?.schoolIds || []).map((schoolId) => arrayContains('users', 'schoolIds', schoolId)));
    state.lmsUsers = unique(batches.flat().concat(state.profile ? [{ id: uid(), ...state.profile }] : []));
  }

  async function loadCourseCollections() {
    const courses = visibleCourses();
    if (!courses.length) {
      state.assignments = [];
      state.announcements = [];
      state.attendance = [];
      if (!isStudent() && !isGuardian()) state.submissions = [];
      return;
    }

    if (isOwner()) {
      [state.assignments, state.submissions, state.attendance, state.announcements] = await Promise.all([
        allDocs('assignments'), allDocs('submissions'), allDocs('attendanceRecords'), allDocs('announcements')
      ]);
      return;
    }

    const courseIds = courses.map((c) => c.id);
    const assignmentBatches = await Promise.all(courseIds.map((id) => byField('assignments', 'courseId', id)));
    const announcementBatches = await Promise.all(courseIds.map((id) => byField('announcements', 'courseId', id)));
    state.assignments = unique(assignmentBatches.flat());
    state.announcements = unique(announcementBatches.flat());

    if (isStudent()) {
      [state.submissions, state.attendance] = await Promise.all([
        byField('submissions', 'studentId', uid()),
        byField('attendanceRecords', 'studentId', uid())
      ]);
      return;
    }

    if (isGuardian()) {
      const linked = state.profile?.linkedStudentIds || [];
      const subBatches = await Promise.all(linked.map((id) => byField('submissions', 'studentId', id)));
      const attendanceBatches = await Promise.all(linked.map((id) => byField('attendanceRecords', 'studentId', id)));
      state.submissions = unique(subBatches.flat());
      state.attendance = unique(attendanceBatches.flat());
      return;
    }

    const submissionBatches = await Promise.all(courseIds.map((id) => byField('submissions', 'courseId', id)));
    const attendanceBatches = await Promise.all(courseIds.map((id) => byField('attendanceRecords', 'courseId', id)));
    state.submissions = unique(submissionBatches.flat());
    state.attendance = unique(attendanceBatches.flat());
  }

  async function loadMessages() {
    if (isOwner()) {
      state.messages = await allDocs('messages');
      return;
    }
    if (!uid()) return;
    const [received, sent] = await Promise.all([
      arrayContains('messages', 'recipientIds', uid()),
      byField('messages', 'senderId', uid())
    ]);
    state.messages = unique(received.concat(sent));
  }

  async function load() {
    initState();
    if (!state.profile || state.profile.status !== 'active') return;
    await loadDirectory();
    await Promise.all([loadCourseCollections(), loadMessages()]);
    if (!state.selectedCourseId || !visibleCourses().some((c) => c.id === state.selectedCourseId)) {
      state.selectedCourseId = visibleCourses()[0]?.id || null;
    }
  }

  async function ensurePhase2() {
    if (!isOwner()) return;
    try {
      await setDoc(doc(db, 'system', 'config'), {
        version: '0.2.0-phase2',
        phase: 2,
        lmsReady: true,
        updatedAt: serverTimestamp()
      }, { merge: true });
      const flags = [
        ['assignments', true, 'Assignments and due-date workflows'],
        ['gradebook', true, 'Weighted gradebook and grading queue'],
        ['attendance', true, 'Course attendance tracking'],
        ['calendar', true, 'Assignment calendar and planner'],
        ['messaging', true, 'Contextual ClassOS inbox'],
        ['family_portal', true, 'Parent and guardian academic view'],
        ['absent_mode', true, 'Student absence recovery workflow']
      ];
      for (const [key, enabled, description] of flags) {
        const ref = doc(db, 'featureFlags', key);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, { key, enabled, description, updatedBy: uid(), updatedAt: serverTimestamp() });
        } else if (key === 'family_portal') {
          await setDoc(ref, { enabled: true, description, updatedBy: uid(), updatedAt: serverTimestamp() }, { merge: true });
        }
      }
    } catch (error) {
      console.warn('Phase 2 bootstrap could not finish', error);
    }
  }

  function gradeFor(studentId, courseId, overrides = {}) {
    const c = course(courseId);
    const assignments = state.assignments.filter((a) => a.courseId === courseId && a.status !== 'draft' && Number(a.pointsPossible) > 0);
    const categories = courseCategories(c);
    const categoryResults = categories.map((cat) => {
      const items = assignments.filter((a) => (a.categoryId || 'coursework') === cat.id);
      let earned = 0;
      let possible = 0;
      items.forEach((a) => {
        const override = overrides[a.id];
        const submission = state.submissions.find((s) => s.assignmentId === a.id && s.studentId === studentId);
        const score = override !== undefined ? Number(override) : Number(submission?.score);
        if (Number.isFinite(score) && (override !== undefined || submission?.status === 'graded')) {
          earned += score;
          possible += Number(a.pointsPossible) || 0;
        }
      });
      return { ...cat, earned, possible, percent: possible ? (earned / possible) * 100 : null };
    });

    const active = categoryResults.filter((cat) => cat.percent !== null && cat.weight > 0);
    const activeWeight = active.reduce((sum, cat) => sum + cat.weight, 0);
    let percent = null;
    if (active.length && activeWeight > 0) {
      percent = active.reduce((sum, cat) => sum + cat.percent * (cat.weight / activeWeight), 0);
    } else {
      const earned = categoryResults.reduce((sum, cat) => sum + cat.earned, 0);
      const possible = categoryResults.reduce((sum, cat) => sum + cat.possible, 0);
      percent = possible ? (earned / possible) * 100 : null;
    }
    return { percent, categories: categoryResults };
  }

  function gradeLabel(percent) {
    if (percent === null || !Number.isFinite(percent)) return '—';
    return `${percent.toFixed(1)}%`;
  }

  function letterGrade(percent) {
    if (percent === null || !Number.isFinite(percent)) return '—';
    if (percent >= 90) return 'A';
    if (percent >= 80) return 'B';
    if (percent >= 70) return 'C';
    if (percent >= 60) return 'D';
    return 'F';
  }

  function studentSubmission(assignmentId, studentId = uid()) {
    return state.submissions.find((s) => s.assignmentId === assignmentId && s.studentId === studentId) || null;
  }

  function assignmentStatus(a, studentId = uid()) {
    const submission = studentSubmission(a.id, studentId);
    if (submission?.status === 'graded') return { label: `Graded · ${submission.score}/${a.pointsPossible}`, cls: 'success' };
    if (submission?.status === 'excused') return { label: 'Excused', cls: 'info' };
    if (submission?.status === 'missing') return { label: 'Missing', cls: 'danger' };
    if (submission?.status === 'late') return { label: 'Submitted late', cls: 'warning' };
    if (submission?.status === 'submitted') return { label: 'Submitted', cls: 'info' };
    const due = asDate(a.dueAt);
    if (due && due < new Date()) return { label: 'Missing', cls: 'danger' };
    return { label: timeUntil(a.dueAt), cls: '' };
  }

  function coursePicker(routeName) {
    const courses = visibleCourses();
    if (courses.length <= 1) return '';
    return `<div class="course-switcher">${courses.map((c) => `<button class="course-chip ${state.selectedCourseId === c.id ? 'active' : ''}" data-lms-action="select-course" data-course-id="${esc(c.id)}" data-route="${esc(routeName)}">${esc(c.name)}</button>`).join('')}</div>`;
  }

  function hero(title, copy, actions = '') {
    return `<section class="hero"><span class="eyebrow">CLASSOS LMS</span><h1>${title}</h1><p>${copy}</p>${actions ? `<div class="hero-actions">${actions}</div>` : ''}</section>`;
  }

  function dashboard() {
    if (state.profile?.status !== 'active') return `<div class="empty-state"><strong>Access pending</strong>Your account is waiting for a ClassOS role.</div>`;
    const first = esc((state.profile.displayName || 'there').split(' ')[0]);
    const courses = visibleCourses();

    if (isStudent()) {
      const upcoming = state.assignments
        .filter((a) => courses.some((c) => c.id === a.courseId) && a.status !== 'draft')
        .filter((a) => {
          const sub = studentSubmission(a.id);
          return !sub || !['submitted', 'late', 'graded', 'excused'].includes(sub.status);
        })
        .sort((a, b) => (asDate(a.dueAt)?.getTime() || Infinity) - (asDate(b.dueAt)?.getTime() || Infinity));
      const overdue = upcoming.filter((a) => asDate(a.dueAt) && asDate(a.dueAt) < new Date());
      const absences = state.attendance.filter((r) => r.studentId === uid() && ['absent', 'excused'].includes(r.status));
      const grades = courses.map((c) => gradeFor(uid(), c.id).percent).filter((v) => v !== null);
      const avg = grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
      return `${hero(`Welcome back, ${first}.`, 'Here is the work that matters next—without making you hunt through every class.', `<button class="btn btn-primary" data-lms-nav="assignments">View assignments</button><button class="btn btn-secondary" data-lms-nav="absent">Absent Mode</button>`)}
        <section class="section grid grid-4">${metric('Courses', courses.length, 'Active enrollments')}${metric('Due next', upcoming.length, 'Open work')}${metric('Overdue', overdue.length, overdue.length ? 'Needs attention' : 'Nothing overdue')}${metric('Current average', gradeLabel(avg), grades.length ? 'Across graded courses' : 'No grades yet')}</section>
        <section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">WHAT’S NEXT</span><h3>Priority work</h3></div><span class="pill ${overdue.length ? 'danger' : 'success'}">${overdue.length ? `${overdue.length} overdue` : 'On track'}</span></div>${upcoming.length ? `<div class="list">${upcoming.slice(0, 6).map((a) => assignmentRow(a, uid())).join('')}</div>` : '<div class="empty-state"><strong>You’re caught up.</strong>No open assignments are waiting for you.</div>'}</div>
        <div class="card"><div class="section-head"><div><span class="eyebrow">ABSENCE RECOVERY</span><h3>Absent Mode</h3></div><span class="pill ${absences.length ? 'warning' : 'success'}">${absences.length ? `${absences.length} recorded` : 'Clear'}</span></div><p class="metric-note" style="line-height:1.65">If you miss class, ClassOS gathers the assignments and course updates around your absence so you can see what needs attention first.</p><button class="btn btn-secondary" style="margin-top:16px" data-lms-nav="absent">Open Absent Mode</button></div></section>`;
    }

    if (isGuardian()) return family(true);

    const queue = state.submissions.filter((s) => courses.some((c) => c.id === s.courseId) && ['submitted', 'late'].includes(s.status));
    const today = dateKey(new Date());
    const todayAttendance = state.attendance.filter((r) => r.date === today && courses.some((c) => c.id === r.courseId));
    const openAssignments = state.assignments.filter((a) => courses.some((c) => c.id === a.courseId) && a.status !== 'draft');
    const actions = canTeach() ? '<button class="btn btn-primary" data-lms-action="new-assignment">Create assignment</button><button class="btn btn-secondary" data-lms-nav="attendance">Take attendance</button>' : '';
    return `${hero(`Good to see you, ${first}.`, isOwner() ? 'ClassOS now has a working instructional layer connected to your Phase 1 identities and course structure.' : 'Courses, grading, attendance, and communication are together in one workspace.', actions)}
      <section class="section grid grid-4">${metric('Courses', courses.length, 'Visible course spaces')}${metric('Published work', openAssignments.length, 'Assignments in circulation')}${metric('To grade', queue.length, queue.length ? 'Submissions waiting' : 'Queue is clear')}${metric('Attendance today', todayAttendance.length, 'Records entered')}</section>
      <section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">GRADING QUEUE</span><h3>Needs review</h3></div><button class="link-button" data-lms-nav="gradebook">Open gradebook</button></div>${queue.length ? `<div class="list">${queue.slice(0, 6).map((s) => `<div class="list-row"><div class="list-main"><strong>${esc(personName(s.studentId))}</strong><span>${esc(state.assignments.find((a) => a.id === s.assignmentId)?.title || 'Assignment')} · ${esc(course(s.courseId)?.name || '')}</span></div><button class="pill clickable info" data-lms-action="grade-student" data-assignment-id="${esc(s.assignmentId)}" data-student-id="${esc(s.studentId)}">Grade</button></div>`).join('')}</div>` : '<div class="empty-state"><strong>Queue clear</strong>No submitted work is waiting for a grade.</div>'}</div>
      <div class="card"><div class="section-head"><div><span class="eyebrow">COURSE ACTIVITY</span><h3>Recent announcements</h3></div></div>${state.announcements.length ? `<div class="list">${state.announcements.sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0)).slice(0, 5).map((a) => `<div class="list-row"><div class="list-main"><strong>${esc(a.title)}</strong><span>${esc(course(a.courseId)?.name || '')} · ${formatDate(a.createdAt)}</span></div></div>`).join('')}</div>` : '<div class="empty-state"><strong>No announcements yet</strong>Course updates will appear here.</div>'}</div></section>`;
  }

  function metric(label, value, note) {
    return `<article class="card metric"><div class="metric-top"><span>${esc(label)}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></article>`;
  }

  function assignmentRow(a, studentId = null) {
    const c = course(a.courseId);
    const status = studentId ? assignmentStatus(a, studentId) : { label: timeUntil(a.dueAt), cls: '' };
    return `<div class="list-row"><div class="list-main"><strong>${esc(a.title)}</strong><span>${esc(c?.name || 'Course')} · ${formatDate(a.dueAt)} · ${esc(a.pointsPossible || 0)} pts</span></div><span class="pill ${status.cls}">${esc(status.label)}</span></div>`;
  }

  function coursesView() {
    const courses = visibleCourses();
    const cards = courses.map((c) => {
      const assignments = state.assignments.filter((a) => a.courseId === c.id && a.status !== 'draft');
      const teacherNames = (c.teacherIds || []).map((id) => personName(id, 'Teacher')).join(', ') || 'No teacher assigned';
      const grade = isStudent() ? gradeFor(uid(), c.id).percent : null;
      return `<article class="course-card"><div class="course-card-top"><span class="eyebrow">${esc(c.courseCode || c.term || 'COURSE')}</span><span class="pill success">${esc(c.status || 'active')}</span></div><h3>${esc(c.name)}</h3><p>${esc(teacherNames)}</p><div class="course-card-stats"><span><strong>${(c.studentIds || []).length}</strong> students</span><span><strong>${assignments.length}</strong> assignments</span>${isStudent() ? `<span><strong>${esc(gradeLabel(grade))}</strong> grade</span>` : ''}</div><button class="btn btn-secondary btn-block" data-lms-action="open-course" data-course-id="${esc(c.id)}">Open course</button></article>`;
    }).join('');
    return `<div class="toolbar"><div><span class="eyebrow">ACADEMICS</span><h2 style="margin:4px 0 0">Courses</h2></div></div>${courses.length ? `<section class="course-grid">${cards}</section>` : '<div class="empty-state"><strong>No courses yet</strong>Your course enrollments will appear here.</div>'}`;
  }

  function courseView() {
    const c = course(state.selectedCourseId);
    if (!c || !visibleCourses().some((x) => x.id === c.id)) return '<div class="empty-state"><strong>Course unavailable</strong>Select a course from Courses.</div>';
    const assignments = state.assignments.filter((a) => a.courseId === c.id).sort((a, b) => (asDate(a.dueAt)?.getTime() || Infinity) - (asDate(b.dueAt)?.getTime() || Infinity));
    const announcements = state.announcements.filter((a) => a.courseId === c.id).sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));
    const manager = canManageCourse(c);
    const actions = manager ? `<button class="btn btn-primary" data-lms-action="new-assignment" data-course-id="${esc(c.id)}">New assignment</button><button class="btn btn-secondary" data-lms-action="new-announcement" data-course-id="${esc(c.id)}">Announcement</button><button class="btn btn-secondary" data-lms-action="manage-roster" data-course-id="${esc(c.id)}">Roster</button>` : '';
    return `${hero(esc(c.name), `${esc(c.courseCode || '')}${c.courseCode && c.term ? ' · ' : ''}${esc(c.term || '')}`, actions)}
      <section class="section grid grid-4">${metric('Students', (c.studentIds || []).length, 'Rostered learners')}${metric('Teachers', (c.teacherIds || []).length, 'Course staff')}${metric('Assignments', assignments.filter((a) => a.status !== 'draft').length, 'Published work')}${metric('Grade categories', courseCategories(c).length, 'Weighted groups')}</section>
      <section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">ASSIGNMENTS</span><h3>Coursework</h3></div>${manager ? `<button class="link-button" data-lms-action="grade-settings" data-course-id="${esc(c.id)}">Grade settings</button>` : ''}</div>${assignments.length ? `<div class="list">${assignments.slice(0, 10).map((a) => {
        const studentStatus = isStudent() ? assignmentStatus(a, uid()) : null;
        return `<div class="list-row"><div class="list-main"><strong>${esc(a.title)}</strong><span>${esc(a.categoryName || 'Coursework')} · ${formatDate(a.dueAt)} · ${esc(a.pointsPossible)} pts${a.status === 'draft' ? ' · Draft' : ''}</span></div>${isStudent() ? `<button class="pill clickable ${studentStatus.cls}" data-lms-action="submit-assignment" data-assignment-id="${esc(a.id)}">${esc(studentStatus.label)}</button>` : manager ? `<button class="pill clickable info" data-lms-action="grade-assignment" data-assignment-id="${esc(a.id)}">Grade</button>` : ''}</div>`;
      }).join('')}</div>` : '<div class="empty-state"><strong>No assignments yet</strong>This course does not have coursework yet.</div>'}</div>
      <div class="card"><div class="section-head"><div><span class="eyebrow">ANNOUNCEMENTS</span><h3>Course updates</h3></div></div>${announcements.length ? `<div class="list">${announcements.slice(0, 8).map((a) => `<div class="announcement"><div class="announcement-meta">${formatDate(a.createdAt)}</div><strong>${esc(a.title)}</strong><p>${esc(a.body)}</p></div>`).join('')}</div>` : '<div class="empty-state"><strong>No announcements</strong>Course updates will appear here.</div>'}</div></section>`;
  }

  function assignmentsView() {
    const courses = visibleCourses();
    let assignments = state.assignments.filter((a) => courses.some((c) => c.id === a.courseId));
    if (isStudent() || isGuardian()) assignments = assignments.filter((a) => a.status !== 'draft');
    assignments.sort((a, b) => (asDate(a.dueAt)?.getTime() || Infinity) - (asDate(b.dueAt)?.getTime() || Infinity));
    const rows = assignments.map((a) => {
      const c = course(a.courseId);
      if (isStudent()) {
        const status = assignmentStatus(a, uid());
        return `<tr><td><span class="row-title">${esc(a.title)}</span><span class="row-subtitle">${esc(c?.name || '')}</span></td><td>${esc(a.categoryName || 'Coursework')}</td><td>${formatDate(a.dueAt)}</td><td>${esc(a.pointsPossible)} pts</td><td><button class="pill clickable ${status.cls}" data-lms-action="submit-assignment" data-assignment-id="${esc(a.id)}">${esc(status.label)}</button></td></tr>`;
      }
      return `<tr><td><span class="row-title">${esc(a.title)}</span><span class="row-subtitle">${esc(c?.name || '')}</span></td><td>${esc(a.categoryName || 'Coursework')}</td><td>${formatDate(a.dueAt)}</td><td>${esc(a.pointsPossible)} pts</td><td><span class="pill ${a.status === 'draft' ? 'warning' : 'success'}">${esc(a.status || 'published')}</span></td>${canManageCourse(c) ? `<td><button class="pill clickable info" data-lms-action="grade-assignment" data-assignment-id="${esc(a.id)}">Grade</button></td>` : ''}</tr>`;
    }).join('');
    const extraHead = !isStudent() && assignments.some((a) => canManageCourse(course(a.courseId))) ? '<th></th>' : '';
    return `<div class="toolbar"><div><span class="eyebrow">COURSEWORK</span><h2 style="margin:4px 0 0">Assignments</h2></div>${canTeach() ? '<button class="btn btn-primary" data-lms-action="new-assignment">Create assignment</button>' : ''}</div>${rows ? `<div class="table-wrap"><table><thead><tr><th>Assignment</th><th>Category</th><th>Due</th><th>Points</th><th>Status</th>${extraHead}</tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state"><strong>No assignments yet</strong>Coursework will appear here.</div>'}`;
  }

  function gradebook() {
    const courses = visibleCourses();
    if (!courses.length) return '<div class="empty-state"><strong>No courses</strong>The gradebook needs at least one course.</div>';
    const c = course(state.selectedCourseId) || courses[0];
    state.selectedCourseId = c.id;
    const assignments = state.assignments.filter((a) => a.courseId === c.id && a.status !== 'draft' && Number(a.pointsPossible) > 0);

    if (isStudent()) {
      const result = gradeFor(uid(), c.id);
      const detail = assignments.map((a) => {
        const s = studentSubmission(a.id, uid());
        return `<tr><td><span class="row-title">${esc(a.title)}</span><span class="row-subtitle">${esc(a.categoryName || 'Coursework')}</span></td><td>${formatDate(a.dueAt)}</td><td>${s?.status === 'graded' ? `${esc(s.score)}/${esc(a.pointsPossible)}` : '—'}</td><td><span class="pill ${assignmentStatus(a, uid()).cls}">${esc(assignmentStatus(a, uid()).label)}</span></td></tr>`;
      }).join('');
      return `<div class="toolbar"><div><span class="eyebrow">MY GRADES</span><h2 style="margin:4px 0 0">${esc(c.name)}</h2></div><button class="btn btn-secondary" data-lms-action="grade-sandbox" data-course-id="${esc(c.id)}">Grade sandbox</button></div>${coursePicker('gradebook')}<section class="grid grid-3 section">${metric('Current grade', gradeLabel(result.percent), letterGrade(result.percent))}${metric('Graded work', assignments.filter((a) => studentSubmission(a.id)?.status === 'graded').length, `${assignments.length} total assignments`)}${metric('Categories', result.categories.length, 'Weighted grading groups')}</section><section class="section grid grid-2"><div class="card"><div class="section-head"><div><h3>Category breakdown</h3></div></div><div class="list">${result.categories.map((cat) => `<div class="list-row"><div class="list-main"><strong>${esc(cat.name)}</strong><span>${cat.possible ? `${cat.earned.toFixed(1)} / ${cat.possible.toFixed(1)} points` : 'No graded work yet'}</span></div><span class="pill">${cat.percent === null ? '—' : `${cat.percent.toFixed(1)}%`} · ${cat.weight}%</span></div>`).join('')}</div></div><div class="card"><div class="section-head"><div><h3>Assignment grades</h3></div></div>${detail ? `<div class="table-wrap"><table><thead><tr><th>Assignment</th><th>Due</th><th>Score</th><th>Status</th></tr></thead><tbody>${detail}</tbody></table></div>` : '<div class="empty-state">No assignments yet.</div>'}</div></section>`;
    }

    if (isGuardian()) return family(false);

    const students = (c.studentIds || []).map((id) => ({ id, name: personName(id, 'Student') }));
    const rows = students.map((student) => {
      const result = gradeFor(student.id, c.id);
      const missing = assignments.filter((a) => assignmentStatus(a, student.id).label === 'Missing').length;
      const graded = assignments.filter((a) => studentSubmission(a.id, student.id)?.status === 'graded').length;
      return `<tr><td><span class="row-title">${esc(student.name)}</span></td><td><strong>${esc(gradeLabel(result.percent))}</strong><span class="row-subtitle">${esc(letterGrade(result.percent))}</span></td><td>${graded}/${assignments.length}</td><td><span class="pill ${missing ? 'danger' : 'success'}">${missing ? `${missing} missing` : 'Clear'}</span></td><td><button class="pill clickable info" data-lms-action="student-grade-detail" data-course-id="${esc(c.id)}" data-student-id="${esc(student.id)}">Details</button></td></tr>`;
    }).join('');
    return `<div class="toolbar"><div><span class="eyebrow">GRADEBOOK</span><h2 style="margin:4px 0 0">${esc(c.name)}</h2></div><div class="toolbar-group"><button class="btn btn-secondary" data-lms-action="grade-settings" data-course-id="${esc(c.id)}">Categories</button></div></div>${coursePicker('gradebook')}<section class="section">${rows ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Grade</th><th>Graded</th><th>Missing</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state"><strong>No students rostered</strong>Add students to this course to use the gradebook.</div>'}</section>`;
  }

  function attendanceView() {
    const courses = visibleCourses();
    if (!courses.length) return '<div class="empty-state"><strong>No courses</strong>Attendance will appear once you have a course.</div>';
    if (isStudent()) {
      const records = state.attendance.filter((r) => r.studentId === uid()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const absent = records.filter((r) => r.status === 'absent').length;
      const tardy = records.filter((r) => r.status === 'tardy').length;
      return `<div class="toolbar"><div><span class="eyebrow">ATTENDANCE</span><h2 style="margin:4px 0 0">My attendance</h2></div><button class="btn btn-secondary" data-lms-nav="absent">Open Absent Mode</button></div><section class="grid grid-3">${metric('Records', records.length, 'Attendance entries')}${metric('Absences', absent, absent ? 'Review Absent Mode' : 'No absences recorded')}${metric('Tardies', tardy, 'Recorded tardies')}</section><section class="section card"><div class="list">${records.length ? records.slice(0, 30).map((r) => `<div class="list-row"><div class="list-main"><strong>${esc(course(r.courseId)?.name || 'Course')}</strong><span>${esc(r.date)}${r.note ? ` · ${esc(r.note)}` : ''}</span></div><span class="pill ${r.status === 'present' ? 'success' : r.status === 'tardy' ? 'warning' : r.status === 'absent' ? 'danger' : 'info'}">${esc(r.status)}</span></div>`).join('') : '<div class="empty-state">No attendance has been recorded yet.</div>'}</div></section>`;
    }
    if (isGuardian()) return family(false);
    const c = course(state.selectedCourseId) || courses[0];
    state.selectedCourseId = c.id;
    const today = dateKey(new Date());
    const records = state.attendance.filter((r) => r.courseId === c.id && r.date === today);
    const counts = ['present', 'absent', 'tardy', 'excused'].reduce((acc, key) => ({ ...acc, [key]: records.filter((r) => r.status === key).length }), {});
    return `<div class="toolbar"><div><span class="eyebrow">ATTENDANCE</span><h2 style="margin:4px 0 0">${esc(c.name)}</h2></div>${canManageCourse(c) ? `<button class="btn btn-primary" data-lms-action="take-attendance" data-course-id="${esc(c.id)}">Take attendance</button>` : ''}</div>${coursePicker('attendance')}<section class="grid grid-4 section">${metric('Present', counts.present, 'Today')}${metric('Absent', counts.absent, 'Today')}${metric('Tardy', counts.tardy, 'Today')}${metric('Excused', counts.excused, 'Today')}</section><section class="section card"><div class="section-head"><div><h3>Today’s roster</h3><p>${esc(today)}</p></div></div>${(c.studentIds || []).length ? `<div class="list">${c.studentIds.map((studentId) => {
      const r = records.find((x) => x.studentId === studentId);
      return `<div class="list-row"><div class="list-main"><strong>${esc(personName(studentId, 'Student'))}</strong><span>${r?.note ? esc(r.note) : 'No note'}</span></div><span class="pill ${r?.status === 'present' ? 'success' : r?.status === 'absent' ? 'danger' : r?.status === 'tardy' ? 'warning' : 'info'}">${esc(r?.status || 'Not marked')}</span></div>`;
    }).join('')}</div>` : '<div class="empty-state">No students are rostered in this course.</div>'}</section>`;
  }

  function calendarView() {
    const courseIds = visibleCourses().map((c) => c.id);
    const assignments = state.assignments.filter((a) => courseIds.includes(a.courseId) && a.status !== 'draft' && asDate(a.dueAt)).sort((a, b) => asDate(a.dueAt) - asDate(b.dueAt));
    const groups = new Map();
    assignments.forEach((a) => {
      const key = dateKey(a.dueAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    });
    return `<div class="toolbar"><div><span class="eyebrow">PLANNER</span><h2 style="margin:4px 0 0">Calendar</h2></div></div><div class="callout info"><strong>One workload view:</strong> assignment due dates from every visible course are collected here automatically.</div><section class="timeline section">${groups.size ? [...groups.entries()].map(([key, items]) => `<div class="timeline-day"><div class="timeline-date"><strong>${formatDate(new Date(`${key}T12:00:00`))}</strong><span>${items.length} item${items.length === 1 ? '' : 's'}</span></div><div class="timeline-items">${items.map((a) => `<button class="timeline-item" data-lms-action="open-course" data-course-id="${esc(a.courseId)}"><span class="pill">${esc(course(a.courseId)?.courseCode || 'Course')}</span><div><strong>${esc(a.title)}</strong><span>${esc(course(a.courseId)?.name || '')} · ${esc(a.pointsPossible)} pts</span></div></button>`).join('')}</div></div>`).join('') : '<div class="empty-state"><strong>No dated assignments</strong>Due dates will build your ClassOS calendar automatically.</div>'}</section>`;
  }

  function absentMode() {
    if (!isStudent()) return '<div class="empty-state"><strong>Student feature</strong>Absent Mode is designed for the student account experience.</div>';
    const absences = state.attendance.filter((r) => r.studentId === uid() && ['absent', 'excused'].includes(r.status)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const missing = state.assignments.filter((a) => visibleCourses().some((c) => c.id === a.courseId) && a.status !== 'draft').filter((a) => {
      const sub = studentSubmission(a.id);
      return (!sub || sub.status === 'missing') && asDate(a.dueAt) && asDate(a.dueAt) < new Date();
    });
    const recentAbsence = absences[0];
    let catchUp = [];
    if (recentAbsence) {
      const start = new Date(`${recentAbsence.date}T00:00:00`);
      const end = new Date(start.getTime() + 7 * 86400000);
      catchUp = state.assignments.filter((a) => {
        const due = asDate(a.dueAt);
        return due && due >= start && due <= end && a.status !== 'draft' && visibleCourses().some((c) => c.id === a.courseId);
      });
    }
    return `${hero('Absent Mode', 'A recovery view for the days school gets interrupted. ClassOS pulls together what was due, what is missing, and what changed around your absence.')}
      <section class="section grid grid-3">${metric('Recorded absences', absences.length, 'Absent or excused days')}${metric('Currently missing', missing.length, 'Overdue work without a completed submission')}${metric('Recovery window', recentAbsence ? recentAbsence.date : 'Clear', recentAbsence ? 'Most recent absence' : 'No recorded absence')}</section>
      <section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">CATCH-UP PLAN</span><h3>${recentAbsence ? `Around ${esc(recentAbsence.date)}` : 'Nothing to recover'}</h3></div></div>${recentAbsence ? (catchUp.length ? `<div class="list">${catchUp.map((a) => assignmentRow(a, uid())).join('')}</div>` : '<div class="empty-state"><strong>No assignments in the recovery window</strong>Your teachers did not have dated work in the seven days after this absence.</div>') : '<div class="empty-state"><strong>No absences recorded</strong>If attendance records an absence, ClassOS will assemble a catch-up view here.</div>'}</div><div class="card"><div class="section-head"><div><span class="eyebrow">MISSING WORK</span><h3>Needs attention</h3></div></div>${missing.length ? `<div class="list">${missing.slice(0, 10).map((a) => assignmentRow(a, uid())).join('')}</div>` : '<div class="empty-state"><strong>No missing work</strong>You do not have overdue unsubmitted assignments.</div>'}</div></section>`;
  }

  function inbox() {
    const messages = [...state.messages].sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));
    const unread = messages.filter((m) => (m.recipientIds || []).includes(uid()) && !(m.readBy || []).includes(uid())).length;
    return `<div class="toolbar"><div><span class="eyebrow">COMMUNICATION</span><h2 style="margin:4px 0 0">Inbox</h2></div><button class="btn btn-primary" data-lms-action="compose-message">New message</button></div><section class="grid grid-3">${metric('Messages', messages.length, 'Sent and received')}${metric('Unread', unread, unread ? 'Needs your attention' : 'You are caught up')}${metric('Courses', visibleCourses().length, 'Message context')}</section><section class="section card">${messages.length ? `<div class="message-list">${messages.map((m) => {
      const received = (m.recipientIds || []).includes(uid());
      const isUnread = received && !(m.readBy || []).includes(uid());
      return `<button class="message-row ${isUnread ? 'unread' : ''}" data-lms-action="open-message" data-message-id="${esc(m.id)}"><div class="message-dot"></div><div><strong>${esc(m.subject || 'Message')}</strong><span>${received ? `From ${esc(personName(m.senderId, 'ClassOS user'))}` : `To ${(m.recipientIds || []).map((id) => esc(personName(id, 'User'))).join(', ')}`} · ${formatDate(m.createdAt)}</span><p>${esc(String(m.body || '').slice(0, 120))}</p></div></button>`;
    }).join('')}</div>` : '<div class="empty-state"><strong>Your inbox is clear</strong>ClassOS messages will appear here.</div>'}</section>`;
  }

  function family(asDashboard = false) {
    if (!isGuardian()) return '<div class="empty-state"><strong>Guardian feature</strong>This view is available to linked parent/guardian accounts.</div>';
    const students = state.profile?.linkedStudentIds || [];
    const cards = students.map((studentId) => {
      const student = person(studentId);
      const studentCourses = visibleCourses().filter((c) => (c.studentIds || []).includes(studentId));
      const grades = studentCourses.map((c) => gradeFor(studentId, c.id).percent).filter((v) => v !== null);
      const average = grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
      const missing = state.assignments.filter((a) => studentCourses.some((c) => c.id === a.courseId) && assignmentStatus(a, studentId).label === 'Missing').length;
      const absences = state.attendance.filter((r) => r.studentId === studentId && r.status === 'absent').length;
      return `<article class="card family-card"><div class="section-head"><div><span class="eyebrow">STUDENT</span><h3>${esc(student?.displayName || 'Linked student')}</h3></div><span class="pill ${missing ? 'warning' : 'success'}">${missing ? `${missing} missing` : 'On track'}</span></div><div class="grid grid-3 mini-metrics"><div><strong>${esc(gradeLabel(average))}</strong><span>Average</span></div><div><strong>${studentCourses.length}</strong><span>Courses</span></div><div><strong>${absences}</strong><span>Absences</span></div></div><div class="list family-courses">${studentCourses.map((c) => `<div class="list-row"><div class="list-main"><strong>${esc(c.name)}</strong><span>${(c.teacherIds || []).map((id) => esc(personName(id, 'Teacher'))).join(', ')}</span></div><span class="pill">${esc(gradeLabel(gradeFor(studentId, c.id).percent))}</span></div>`).join('')}</div></article>`;
    }).join('');
    const first = esc((state.profile?.displayName || 'there').split(' ')[0]);
    return `${asDashboard ? hero(`Welcome, ${first}.`, 'Family View keeps the focus on what needs attention without exposing the complexity of the teacher gradebook.') : '<div class="toolbar"><div><span class="eyebrow">FAMILY VIEW</span><h2 style="margin:4px 0 0">Student progress</h2></div></div>'}${students.length ? `<section class="section family-grid">${cards}</section>` : '<div class="empty-state"><strong>No students linked yet</strong>A school administrator can connect your guardian account to a student profile.</div>'}`;
  }

  function peopleView() {
    if (!isSupport()) return '<div class="empty-state"><strong>Directory restricted</strong>Your role does not include school-directory access.</div>';
    const people = isOwner() ? (state.users || []) : state.lmsUsers;
    const rows = people.map((u) => `<tr><td><span class="row-title">${esc(u.displayName || 'Unnamed')}</span><span class="row-subtitle">${esc(u.email || '')}</span></td><td>${esc(roleName(u.role))}</td><td><span class="pill ${u.status === 'active' ? 'success' : 'warning'}">${esc(u.status || 'pending')}</span></td><td>${esc((u.schoolIds || []).map((id) => state.schools.find((s) => s.id === id)?.name).filter(Boolean).join(', ') || '—')}</td></tr>`).join('');
    return `<div class="toolbar"><div><span class="eyebrow">DIRECTORY</span><h2 style="margin:4px 0 0">People & access</h2></div><div class="toolbar-group">${isOwner() ? '<button class="btn btn-secondary" data-action="invite">Pre-register user</button>' : ''}${isAdmin() ? '<button class="btn btn-primary" data-lms-action="link-guardian">Link guardian</button>' : ''}</div></div><section class="card">${rows ? `<div class="table-wrap"><table><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>School</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state">No people are available in this directory.</div>'}</section>`;
  }

  function routeAllowed(routeName) {
    if (!state.profile || state.profile.status !== 'active') return ['dashboard', 'settings'].includes(routeName);
    const r = role();
    if (!ACTIVE_ROLES.includes(r)) return ['dashboard', 'settings'].includes(routeName);
    if (['organizations', 'platform'].includes(routeName)) return isOwner();
    if (routeName === 'people') return isSupport();
    if (routeName === 'absent') return isStudent();
    if (routeName === 'family') return isGuardian();
    if (routeName === 'attendance') return ['platform_owner', 'district_admin', 'school_admin', 'counselor', 'teacher', 'guardian', 'student'].includes(r);
    if (routeName === 'course') return visibleCourses().length > 0;
    return true;
  }

  function syncNavigation() {
    const nav = document.querySelector('#primary-nav');
    if (!nav) return;
    const before = nav.querySelector('[data-route="people"]');
    const additions = [
      ['assignments', '✓', 'Assignments'],
      ['gradebook', '▦', 'Gradebook'],
      ['calendar', '□', 'Calendar'],
      ['attendance', '◉', 'Attendance'],
      ['inbox', '✉', 'Inbox'],
      ['absent', '↻', 'Absent Mode'],
      ['family', '⌂', 'Family']
    ];
    additions.forEach(([routeName, icon, label]) => {
      if (nav.querySelector(`[data-route="${routeName}"]`)) return;
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.route = routeName;
      button.innerHTML = `<span>${icon}</span>${label}`;
      nav.insertBefore(button, before);
    });
    nav.querySelectorAll('.nav-item[data-route]').forEach((button) => {
      button.classList.toggle('hidden', !routeAllowed(button.dataset.route));
    });
  }

  function showAssignmentForm(courseId = null) {
    const manageable = visibleCourses().filter(canManageCourse);
    const selected = course(courseId) || course(state.selectedCourseId) || manageable[0];
    if (!selected || !manageable.length) return toast('You do not have a course available for assignment creation.', 'error');
    const categories = courseCategories(selected);
    openModal('Create assignment', `<form id="lms-assignment-form"><div class="form-grid"><div class="field span-2"><label>Course</label><select name="courseId">${manageable.map((c) => `<option value="${esc(c.id)}" ${c.id === selected.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><div class="field span-2"><label>Title</label><input name="title" required maxlength="120" placeholder="Assignment title"></div><div class="field span-2"><label>Instructions</label><textarea name="instructions" rows="5" placeholder="What should students do?"></textarea></div><div class="field"><label>Category</label><select name="categoryId">${categories.map((cat) => `<option value="${esc(cat.id)}">${esc(cat.name)} (${cat.weight}%)</option>`).join('')}</select></div><div class="field"><label>Points possible</label><input name="pointsPossible" type="number" min="0" step="0.01" value="100" required></div><div class="field"><label>Due date & time</label><input name="dueAt" type="datetime-local" required></div><div class="field"><label>Status</label><select name="status"><option value="published">Publish now</option><option value="draft">Save draft</option></select></div><div class="field span-2"><label>Submission format</label><select name="submissionType"><option value="both">Text response or link</option><option value="text">Text response</option><option value="link">External link</option></select></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Create assignment</button></div></form>`, 'COURSEWORK');
  }

  function showSubmissionForm(assignmentId) {
    const a = state.assignments.find((x) => x.id === assignmentId);
    if (!a || !isStudent()) return;
    const existing = studentSubmission(a.id, uid());
    openModal(a.title, `<div class="assignment-brief"><span class="pill">${esc(course(a.courseId)?.name || 'Course')}</span><p>${esc(a.instructions || 'No additional instructions.')}</p><div class="assignment-meta"><span>${formatDate(a.dueAt)}</span><span>${esc(a.pointsPossible)} points</span></div></div>${a.status === 'draft' ? '<div class="callout warning">This assignment is still a draft.</div>' : `<form id="lms-submission-form"><input type="hidden" name="assignmentId" value="${esc(a.id)}"><div class="field"><label>Response</label><textarea name="responseText" rows="7" ${a.submissionType === 'link' ? 'disabled' : ''} placeholder="Type your response here">${esc(existing?.responseText || '')}</textarea></div><div class="field"><label>Link</label><input name="linkUrl" type="url" ${a.submissionType === 'text' ? 'disabled' : ''} value="${esc(existing?.linkUrl || '')}" placeholder="https://..."></div>${existing?.status === 'graded' ? `<div class="callout info"><strong>Current grade: ${esc(existing.score)}/${esc(a.pointsPossible)}</strong><br>${esc(existing.feedback || 'No written feedback.')}</div>` : ''}<div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">${existing ? 'Update submission' : 'Submit assignment'}</button></div></form>`}`, 'ASSIGNMENT');
  }

  function showGradeQueue(assignmentId) {
    const a = state.assignments.find((x) => x.id === assignmentId);
    const c = course(a?.courseId);
    if (!a || !canManageCourse(c)) return;
    const rows = (c.studentIds || []).map((studentId) => {
      const s = studentSubmission(a.id, studentId);
      const status = s?.status || (asDate(a.dueAt) && asDate(a.dueAt) < new Date() ? 'missing' : 'not submitted');
      return `<div class="list-row"><div class="list-main"><strong>${esc(personName(studentId, 'Student'))}</strong><span>${s?.submittedAt ? `Submitted ${formatDate(s.submittedAt)}` : 'No submission'}${s?.linkUrl ? ' · Link attached' : ''}</span></div><div class="row-actions"><span class="pill ${status === 'graded' ? 'success' : status === 'missing' ? 'danger' : status === 'late' ? 'warning' : 'info'}">${esc(status)}</span><button class="pill clickable info" data-lms-action="grade-student" data-assignment-id="${esc(a.id)}" data-student-id="${esc(studentId)}">${s?.status === 'graded' ? 'Edit grade' : 'Grade'}</button>${!s || !['graded', 'excused'].includes(s.status) ? `<button class="pill clickable" data-lms-action="mark-submission" data-assignment-id="${esc(a.id)}" data-student-id="${esc(studentId)}" data-status="excused">Excuse</button>` : ''}</div></div>`;
    }).join('');
    openModal(`Grade · ${a.title}`, `<div class="callout info" style="margin-bottom:16px"><strong>${esc(c.name)}</strong> · ${esc(a.pointsPossible)} points possible</div><div class="list">${rows || '<div class="empty-state">No students are rostered in this course.</div>'}</div>`, 'GRADING QUEUE');
  }

  function showGradeForm(assignmentId, studentId) {
    const a = state.assignments.find((x) => x.id === assignmentId);
    const c = course(a?.courseId);
    if (!a || !canManageCourse(c)) return;
    const s = studentSubmission(a.id, studentId);
    openModal(`Grade ${personName(studentId, 'Student')}`, `<div class="assignment-brief"><span class="pill">${esc(a.title)}</span><p>${esc(s?.responseText || 'No text response submitted.')}</p>${s?.linkUrl ? `<p><a href="${esc(s.linkUrl)}" target="_blank" rel="noopener">Open submitted link ↗</a></p>` : ''}</div><form id="lms-grade-form"><input type="hidden" name="assignmentId" value="${esc(a.id)}"><input type="hidden" name="studentId" value="${esc(studentId)}"><div class="form-grid"><div class="field"><label>Score</label><input name="score" type="number" min="0" max="${esc(a.pointsPossible)}" step="0.01" value="${esc(s?.score ?? '')}" required></div><div class="field"><label>Out of</label><input value="${esc(a.pointsPossible)}" disabled></div><div class="field span-2"><label>Feedback</label><textarea name="feedback" rows="5" placeholder="Feedback for the student">${esc(s?.feedback || '')}</textarea></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Save grade</button></div></form>`, 'GRADE');
  }

  function showAttendanceForm(courseId) {
    const c = course(courseId);
    if (!c || !canManageCourse(c)) return;
    const today = dateKey(new Date());
    const rows = (c.studentIds || []).map((studentId) => {
      const r = state.attendance.find((x) => x.courseId === c.id && x.studentId === studentId && x.date === today);
      return `<div class="attendance-row"><div><strong>${esc(personName(studentId, 'Student'))}</strong></div><select name="status_${esc(studentId)}" class="control"><option value="present" ${!r || r.status === 'present' ? 'selected' : ''}>Present</option><option value="absent" ${r?.status === 'absent' ? 'selected' : ''}>Absent</option><option value="tardy" ${r?.status === 'tardy' ? 'selected' : ''}>Tardy</option><option value="excused" ${r?.status === 'excused' ? 'selected' : ''}>Excused</option></select><input name="note_${esc(studentId)}" class="control" value="${esc(r?.note || '')}" placeholder="Optional note"></div>`;
    }).join('');
    openModal(`Attendance · ${c.name}`, `<form id="lms-attendance-form"><input type="hidden" name="courseId" value="${esc(c.id)}"><div class="field"><label>Date</label><input name="date" type="date" value="${esc(today)}" required></div><div class="attendance-sheet">${rows || '<div class="empty-state">No students are rostered.</div>'}</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Save attendance</button></div></form>`, 'ATTENDANCE');
  }

  function showRoster(c) {
    if (!c || !canManageCourse(c)) return;
    const people = isOwner() ? (state.users || []) : state.lmsUsers;
    const teachers = people.filter((u) => u.role === 'teacher' && (isOwner() || (u.schoolIds || []).includes(c.schoolId)));
    const students = people.filter((u) => u.role === 'student' && (isOwner() || (u.schoolIds || []).includes(c.schoolId)));
    const section = (title, list, field) => `<div class="roster-section"><h4>${title}</h4>${list.length ? list.map((u) => {
      const included = (c[field] || []).includes(u.id);
      return `<div class="list-row"><div class="list-main"><strong>${esc(u.displayName || u.email)}</strong><span>${esc(u.email || '')}</span></div><button class="pill clickable ${included ? 'danger' : 'success'}" data-lms-action="roster-change" data-course-id="${esc(c.id)}" data-user-id="${esc(u.id)}" data-field="${field}" data-mode="${included ? 'remove' : 'add'}">${included ? 'Remove' : 'Add'}</button></div>`;
    }).join('') : '<div class="empty-state">No eligible people found.</div>'}</div>`;
    openModal(`Roster · ${c.name}`, `${section('Teachers', teachers, 'teacherIds')}${section('Students', students, 'studentIds')}`, 'COURSE ROSTER');
  }

  function showAnnouncementForm(courseId) {
    const c = course(courseId);
    if (!c || !canManageCourse(c)) return;
    openModal('New announcement', `<form id="lms-announcement-form"><input type="hidden" name="courseId" value="${esc(c.id)}"><div class="field"><label>Title</label><input name="title" required maxlength="120"></div><div class="field"><label>Message</label><textarea name="body" rows="7" required></textarea></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Post announcement</button></div></form>`, 'COURSE UPDATE');
  }

  function showGradeSettings(c) {
    if (!c || !canManageCourse(c)) return;
    const cats = courseCategories(c);
    const rows = [0, 1, 2, 3].map((i) => `<div class="category-row"><input name="name_${i}" class="control" value="${esc(cats[i]?.name || '')}" placeholder="Category name"><input name="weight_${i}" class="control" type="number" min="0" max="100" step="1" value="${esc(cats[i]?.weight ?? '')}" placeholder="Weight %"></div>`).join('');
    openModal('Grade categories', `<form id="lms-grade-settings-form"><input type="hidden" name="courseId" value="${esc(c.id)}"><div class="callout info" style="margin-bottom:16px"><strong>Weighted gradebook:</strong> category weights should total 100%. Empty rows are ignored.</div><div class="category-editor">${rows}</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Save categories</button></div></form>`, 'GRADEBOOK');
  }

  function showSandbox(c) {
    if (!c || !isStudent()) return;
    const assignments = state.assignments.filter((a) => a.courseId === c.id && a.status !== 'draft' && Number(a.pointsPossible) > 0);
    const current = gradeFor(uid(), c.id).percent;
    openModal('Grade sandbox', `<form id="lms-sandbox-form"><input type="hidden" name="courseId" value="${esc(c.id)}"><div class="callout info" style="margin-bottom:16px">This does <strong>not</strong> change your real grade. Try a hypothetical assignment score to see the projected course grade.</div><div class="form-grid"><div class="field span-2"><label>Assignment</label><select name="assignmentId">${assignments.map((a) => `<option value="${esc(a.id)}">${esc(a.title)} · ${esc(a.pointsPossible)} pts</option>`).join('')}</select></div><div class="field"><label>Hypothetical score</label><input name="score" type="number" min="0" step="0.01" required></div><div class="field"><label>Current grade</label><input value="${esc(gradeLabel(current))}" disabled></div></div><div id="sandbox-result"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Close</button><button class="btn btn-primary">Calculate</button></div></form>`, 'GRADE SANDBOX');
  }

  function messageRecipients() {
    const ids = new Set();
    if (isOwner() || isSupport() || isTeacher()) {
      (isOwner() ? state.users : state.lmsUsers).forEach((u) => {
        if (u.id !== uid() && u.status === 'active') ids.add(u.id);
      });
    } else {
      visibleCourses().forEach((c) => (c.teacherIds || []).forEach((id) => ids.add(id)));
    }
    return [...ids].map((id) => person(id)).filter(Boolean);
  }

  function showCompose() {
    const recipients = messageRecipients();
    if (!recipients.length) return toast('No message recipients are available yet.', 'error');
    openModal('New message', `<form id="lms-message-form"><div class="field"><label>Recipient</label><select name="recipientId">${recipients.map((u) => `<option value="${esc(u.id)}">${esc(u.displayName || u.email)} · ${esc(roleName(u.role))}</option>`).join('')}</select></div><div class="field"><label>Subject</label><input name="subject" required maxlength="140"></div><div class="field"><label>Message</label><textarea name="body" rows="7" required></textarea></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Send message</button></div></form>`, 'CLASSOS INBOX');
  }

  function showMessage(messageId) {
    const m = state.messages.find((x) => x.id === messageId);
    if (!m) return;
    const received = (m.recipientIds || []).includes(uid());
    openModal(m.subject || 'Message', `<div class="message-detail"><div class="message-detail-meta">${received ? `From ${esc(personName(m.senderId, 'ClassOS user'))}` : `To ${(m.recipientIds || []).map((id) => esc(personName(id, 'User'))).join(', ')}`} · ${formatDate(m.createdAt)}</div><p>${esc(m.body || '')}</p></div>`, 'MESSAGE');
    if (received && !(m.readBy || []).includes(uid())) {
      updateDoc(doc(db, 'messages', m.id), { readBy: [...new Set([...(m.readBy || []), uid()])], updatedAt: serverTimestamp() }).catch(console.warn);
      m.readBy = [...new Set([...(m.readBy || []), uid()])];
    }
  }

  function showGuardianLink() {
    const people = isOwner() ? state.users : state.lmsUsers;
    const guardians = people.filter((u) => u.role === 'guardian' && u.status === 'active');
    const students = people.filter((u) => u.role === 'student' && u.status === 'active');
    if (!guardians.length || !students.length) return toast('You need at least one active guardian and student account first.', 'error');
    openModal('Link guardian to student', `<form id="lms-guardian-link-form"><div class="field"><label>Guardian</label><select name="guardianId">${guardians.map((u) => `<option value="${esc(u.id)}">${esc(u.displayName || u.email)}</option>`).join('')}</select></div><div class="field"><label>Student</label><select name="studentId">${students.map((u) => `<option value="${esc(u.id)}">${esc(u.displayName || u.email)}</option>`).join('')}</select></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Link accounts</button></div></form>`, 'FAMILY ACCESS');
  }

  function showStudentGradeDetail(courseId, studentId) {
    const c = course(courseId);
    if (!c || !canManageCourse(c)) return;
    const result = gradeFor(studentId, courseId);
    const assignments = state.assignments.filter((a) => a.courseId === courseId && a.status !== 'draft');
    openModal(`${personName(studentId, 'Student')} · ${c.name}`, `<div class="grade-detail-hero"><strong>${esc(gradeLabel(result.percent))}</strong><span>${esc(letterGrade(result.percent))} current course grade</span></div><div class="list">${assignments.map((a) => {
      const s = studentSubmission(a.id, studentId);
      return `<div class="list-row"><div class="list-main"><strong>${esc(a.title)}</strong><span>${esc(a.categoryName || 'Coursework')} · ${formatDate(a.dueAt)}</span></div><button class="pill clickable ${s?.status === 'graded' ? 'success' : assignmentStatus(a, studentId).cls}" data-lms-action="grade-student" data-assignment-id="${esc(a.id)}" data-student-id="${esc(studentId)}">${s?.status === 'graded' ? `${esc(s.score)}/${esc(a.pointsPossible)}` : esc(assignmentStatus(a, studentId).label)}</button></div>`;
    }).join('')}</div>`, 'GRADE DETAIL');
  }

  async function handleAction(event) {
    const nav = event.target.closest('[data-lms-nav]');
    if (nav) {
      navigate(nav.dataset.lmsNav);
      return true;
    }
    const target = event.target.closest('[data-lms-action]');
    if (!target) return false;
    const action = target.dataset.lmsAction;
    if (action === 'select-course') {
      state.selectedCourseId = target.dataset.courseId;
      navigate(target.dataset.route || state.route);
    }
    if (action === 'open-course') {
      state.selectedCourseId = target.dataset.courseId;
      navigate('course');
    }
    if (action === 'new-assignment') showAssignmentForm(target.dataset.courseId || null);
    if (action === 'submit-assignment') showSubmissionForm(target.dataset.assignmentId);
    if (action === 'grade-assignment') showGradeQueue(target.dataset.assignmentId);
    if (action === 'grade-student') showGradeForm(target.dataset.assignmentId, target.dataset.studentId);
    if (action === 'take-attendance') showAttendanceForm(target.dataset.courseId);
    if (action === 'manage-roster') showRoster(course(target.dataset.courseId));
    if (action === 'new-announcement') showAnnouncementForm(target.dataset.courseId);
    if (action === 'grade-settings') showGradeSettings(course(target.dataset.courseId));
    if (action === 'grade-sandbox') showSandbox(course(target.dataset.courseId));
    if (action === 'compose-message') showCompose();
    if (action === 'open-message') showMessage(target.dataset.messageId);
    if (action === 'link-guardian') showGuardianLink();
    if (action === 'student-grade-detail') showStudentGradeDetail(target.dataset.courseId, target.dataset.studentId);
    if (action === 'roster-change') {
      const c = course(target.dataset.courseId);
      if (!c || !canManageCourse(c)) return true;
      const field = target.dataset.field;
      if (!['teacherIds', 'studentIds'].includes(field)) return true;
      const current = [...(c[field] || [])];
      const next = target.dataset.mode === 'remove' ? current.filter((id) => id !== target.dataset.userId) : [...new Set([...current, target.dataset.userId])];
      await updateDoc(doc(db, 'courses', c.id), { [field]: next, updatedAt: serverTimestamp() });
      await logAction('course.roster_update', 'course', c.id, { field, userId: target.dataset.userId, mode: target.dataset.mode });
      c[field] = next;
      closeModal();
      toast('Course roster updated.', 'success');
      await navigate('course');
    }
    if (action === 'mark-submission') {
      const a = state.assignments.find((x) => x.id === target.dataset.assignmentId);
      const c = course(a?.courseId);
      if (!a || !canManageCourse(c)) return true;
      const id = `${a.id}_${target.dataset.studentId}`;
      await setDoc(doc(db, 'submissions', id), {
        assignmentId: a.id, courseId: a.courseId, schoolId: a.schoolId,
        studentId: target.dataset.studentId, studentName: personName(target.dataset.studentId, 'Student'),
        status: target.dataset.status, responseText: '', linkUrl: '', score: null, feedback: '',
        markedBy: uid(), updatedAt: serverTimestamp(), createdAt: serverTimestamp()
      }, { merge: true });
      await logAction('submission.status', 'submission', id, { status: target.dataset.status });
      closeModal();
      toast('Submission status updated.', 'success');
      await navigate('gradebook');
    }
    return true;
  }

  async function handleForm(form) {
    if (!form?.id?.startsWith('lms-')) return false;
    const data = Object.fromEntries(new FormData(form));

    if (form.id === 'lms-assignment-form') {
      const c = course(data.courseId);
      if (!c || !canManageCourse(c)) throw new Error('You do not have permission to create work in this course.');
      const categories = courseCategories(c);
      const cat = categories.find((x) => x.id === data.categoryId) || categories[0];
      const due = new Date(data.dueAt);
      if (Number.isNaN(due.getTime())) throw new Error('Choose a valid due date.');
      const ref = await addDoc(collection(db, 'assignments'), {
        organizationId: c.organizationId || '', schoolId: c.schoolId, courseId: c.id,
        title: data.title.trim(), instructions: data.instructions.trim(),
        categoryId: cat.id, categoryName: cat.name, pointsPossible: Number(data.pointsPossible) || 0,
        dueAt: Timestamp.fromDate(due), status: data.status, submissionType: data.submissionType,
        createdBy: uid(), teacherIds: c.teacherIds || [], createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      await logAction('assignment.create', 'assignment', ref.id, { courseId: c.id, title: data.title.trim() });
      closeModal(); toast('Assignment created.', 'success'); await navigate('assignments');
    }

    if (form.id === 'lms-submission-form') {
      const a = state.assignments.find((x) => x.id === data.assignmentId);
      const c = course(a?.courseId);
      if (!a || !c || !(c.studentIds || []).includes(uid())) throw new Error('This assignment is not available to your account.');
      const responseText = data.responseText?.trim() || '';
      const linkUrl = data.linkUrl?.trim() || '';
      if (!responseText && !linkUrl) throw new Error('Add a response or a link before submitting.');
      const existing = studentSubmission(a.id, uid());
      const status = asDate(a.dueAt) && asDate(a.dueAt) < new Date() ? 'late' : 'submitted';
      const id = `${a.id}_${uid()}`;
      const payload = {
        assignmentId: a.id, courseId: a.courseId, schoolId: a.schoolId,
        studentId: uid(), studentName: state.profile.displayName || state.profile.email,
        responseText, linkUrl, status, submittedAt: serverTimestamp(), updatedAt: serverTimestamp()
      };
      if (!existing) Object.assign(payload, { score: null, feedback: '', gradedAt: null, gradedBy: null, createdAt: serverTimestamp() });
      await setDoc(doc(db, 'submissions', id), payload, { merge: true });
      await logAction('submission.submit', 'submission', id, { assignmentId: a.id, status });
      closeModal(); toast(status === 'late' ? 'Submitted and marked late.' : 'Assignment submitted.', 'success'); await navigate('assignments');
    }

    if (form.id === 'lms-grade-form') {
      const a = state.assignments.find((x) => x.id === data.assignmentId);
      const c = course(a?.courseId);
      if (!a || !canManageCourse(c)) throw new Error('You cannot grade this assignment.');
      const score = Number(data.score);
      if (!Number.isFinite(score) || score < 0 || score > Number(a.pointsPossible)) throw new Error('Enter a score within the assignment point range.');
      const id = `${a.id}_${data.studentId}`;
      const existing = studentSubmission(a.id, data.studentId);
      await setDoc(doc(db, 'submissions', id), {
        assignmentId: a.id, courseId: a.courseId, schoolId: a.schoolId,
        studentId: data.studentId, studentName: personName(data.studentId, 'Student'),
        responseText: existing?.responseText || '', linkUrl: existing?.linkUrl || '',
        submittedAt: existing?.submittedAt || null, score, feedback: data.feedback.trim(),
        status: 'graded', gradedAt: serverTimestamp(), gradedBy: uid(), updatedAt: serverTimestamp(),
        ...(existing ? {} : { createdAt: serverTimestamp() })
      }, { merge: true });
      await logAction('submission.grade', 'submission', id, { assignmentId: a.id, score });
      closeModal(); toast('Grade saved.', 'success'); await navigate('gradebook');
    }

    if (form.id === 'lms-attendance-form') {
      const c = course(data.courseId);
      if (!c || !canManageCourse(c)) throw new Error('You cannot mark attendance for this course.');
      for (const studentId of (c.studentIds || [])) {
        const status = data[`status_${studentId}`] || 'present';
        const note = data[`note_${studentId}`]?.trim() || '';
        const id = `${c.id}_${data.date}_${studentId}`;
        await setDoc(doc(db, 'attendanceRecords', id), {
          courseId: c.id, schoolId: c.schoolId, studentId, date: data.date, status, note,
          markedBy: uid(), updatedAt: serverTimestamp(), createdAt: serverTimestamp()
        }, { merge: true });
      }
      await logAction('attendance.save', 'course', c.id, { date: data.date, count: (c.studentIds || []).length });
      closeModal(); toast('Attendance saved.', 'success'); await navigate('attendance');
    }

    if (form.id === 'lms-announcement-form') {
      const c = course(data.courseId);
      if (!c || !canManageCourse(c)) throw new Error('You cannot post in this course.');
      const ref = await addDoc(collection(db, 'announcements'), {
        courseId: c.id, schoolId: c.schoolId, title: data.title.trim(), body: data.body.trim(),
        authorId: uid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      await logAction('announcement.create', 'announcement', ref.id, { courseId: c.id });
      closeModal(); toast('Announcement posted.', 'success'); await navigate('course');
    }

    if (form.id === 'lms-grade-settings-form') {
      const c = course(data.courseId);
      if (!c || !canManageCourse(c)) throw new Error('You cannot change this course gradebook.');
      const categories = [0, 1, 2, 3].map((i) => ({ name: data[`name_${i}`]?.trim(), weight: Number(data[`weight_${i}`]) })).filter((x) => x.name && Number.isFinite(x.weight) && x.weight >= 0).map((x, index) => ({ id: x.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `category-${index + 1}`, name: x.name, weight: x.weight }));
      const total = categories.reduce((sum, cat) => sum + cat.weight, 0);
      if (!categories.length) throw new Error('Add at least one grade category.');
      if (Math.abs(total - 100) > 0.01) throw new Error(`Category weights total ${total}%. They must total 100%.`);
      await updateDoc(doc(db, 'courses', c.id), { gradeCategories: categories, updatedAt: serverTimestamp() });
      await logAction('gradebook.categories', 'course', c.id, { categories });
      closeModal(); toast('Grade categories saved.', 'success'); await navigate('gradebook');
    }

    if (form.id === 'lms-sandbox-form') {
      const c = course(data.courseId);
      const a = state.assignments.find((x) => x.id === data.assignmentId && x.courseId === c?.id);
      const score = Number(data.score);
      if (!c || !a || !Number.isFinite(score)) throw new Error('Choose an assignment and enter a score.');
      const projected = gradeFor(uid(), c.id, { [a.id]: score }).percent;
      const result = document.querySelector('#sandbox-result');
      if (result) result.innerHTML = `<div class="sandbox-result"><span>Projected course grade</span><strong>${esc(gradeLabel(projected))}</strong><small>${esc(letterGrade(projected))}</small></div>`;
      busy(form.querySelector('button[type="submit"]'), false);
      return true;
    }

    if (form.id === 'lms-message-form') {
      const recipient = person(data.recipientId);
      if (!recipient) throw new Error('Choose a valid recipient.');
      const ref = await addDoc(collection(db, 'messages'), {
        senderId: uid(), senderName: state.profile.displayName || state.profile.email,
        recipientIds: [data.recipientId], subject: data.subject.trim(), body: data.body.trim(),
        readBy: [uid()], createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      await logAction('message.send', 'message', ref.id, { recipientId: data.recipientId });
      closeModal(); toast('Message sent.', 'success'); await navigate('inbox');
    }

    if (form.id === 'lms-guardian-link-form') {
      if (!isAdmin()) throw new Error('Only an administrator can link guardian accounts.');
      const guardian = person(data.guardianId);
      const student = person(data.studentId);
      if (!guardian || guardian.role !== 'guardian' || !student || student.role !== 'student') throw new Error('Choose a valid guardian and student.');
      const guardianLinks = [...new Set([...(guardian.linkedStudentIds || []), student.id])];
      const studentLinks = [...new Set([...(student.guardianIds || []), guardian.id])];
      await updateDoc(doc(db, 'users', guardian.id), { linkedStudentIds: guardianLinks });
      await updateDoc(doc(db, 'users', student.id), { guardianIds: studentLinks });
      await logAction('guardian.link', 'user', guardian.id, { studentId: student.id });
      closeModal(); toast('Guardian and student linked.', 'success'); await navigate('people');
    }

    return true;
  }

  return {
    load,
    ensurePhase2,
    syncNavigation,
    routeAllowed,
    dashboard,
    courses: coursesView,
    course: courseView,
    assignments: assignmentsView,
    gradebook,
    attendance: attendanceView,
    calendar: calendarView,
    inbox,
    absent: absentMode,
    family: () => family(false),
    people: peopleView,
    handleAction,
    handleForm
  };
}
