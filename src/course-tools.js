import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const emailKey = (value = '') => String(value).trim().toLowerCase();

let profile = null;
let schools = [];
let teacherCourses = [];
let injectQueued = false;

const role = () => profile?.role || '';
const uid = () => auth.currentUser?.uid || '';
const isOwner = () => emailKey(auth.currentUser?.email) === OWNER_EMAIL;
const canCreateCourse = () => isOwner() || ['district_admin', 'school_admin', 'teacher'].includes(role());
const canAddStudent = () => role() === 'teacher';

function toast(message, type = '') {
  const region = $('toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4600);
}

async function loadProfile() {
  if (!auth.currentUser) return null;
  const snapshot = await getDoc(doc(db, 'users', auth.currentUser.uid));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function loadSchools() {
  if (!auth.currentUser) return [];
  if (isOwner()) {
    const snapshot = await getDocs(collection(db, 'schools'));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  }
  const ids = Array.isArray(profile?.schoolIds) ? profile.schoolIds : [];
  const results = await Promise.all(ids.map(async (id) => {
    try {
      const snapshot = await getDoc(doc(db, 'schools', id));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    } catch {
      return null;
    }
  }));
  return results.filter(Boolean);
}

async function loadTeacherCourses() {
  if (!auth.currentUser || role() !== 'teacher') return [];
  const snapshot = await getDocs(query(collection(db, 'courses'), where('teacherIds', 'array-contains', uid())));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((course) => course.status !== 'archived' && (profile?.schoolIds || []).includes(course.schoolId));
}

function ensureModal() {
  let modal = $('course-create-modal');
  if (modal) return modal;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="course-create-modal" class="modal-backdrop hidden" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="course-create-title">
        <div class="modal-head">
          <div><span class="eyebrow" id="course-tools-kicker">ACADEMICS</span><h3 id="course-create-title">Create course</h3></div>
          <button id="course-create-close" class="icon-btn" type="button" aria-label="Close">×</button>
        </div>
        <div id="course-create-body" class="modal-body"></div>
      </section>
    </div>`);
  modal = $('course-create-modal');
  $('course-create-close').onclick = closeModal;
  modal.onclick = (event) => { if (event.target === modal) closeModal(); };
  return modal;
}

function setModalHeading(title, kicker = 'ACADEMICS') {
  if ($('course-create-title')) $('course-create-title').textContent = title;
  if ($('course-tools-kicker')) $('course-tools-kicker').textContent = kicker;
}

function closeModal() {
  $('course-create-modal')?.classList.add('hidden');
  if ($('course-create-body')) $('course-create-body').innerHTML = '';
}

async function showCreateCourse() {
  if (!canCreateCourse()) return;
  schools = await loadSchools();
  if (!schools.length) {
    toast(isOwner() ? 'Create a school before adding a course.' : 'You need to belong to a school before creating a course.', 'error');
    return;
  }

  const modal = ensureModal();
  setModalHeading('Create course');
  $('course-create-body').innerHTML = `
    <form id="course-create-form" onsubmit="return false;">
      <div class="form-grid">
        <div class="field span-2">
          <label>School</label>
          <select name="schoolId" required>
            ${schools.map((school) => `<option value="${esc(school.id)}">${esc(school.name || 'School')}</option>`).join('')}
          </select>
        </div>
        <div class="field span-2">
          <label>Course name</label>
          <input name="name" maxlength="120" required placeholder="AP English Language">
        </div>
        <div class="field">
          <label>Course code</label>
          <input name="courseCode" maxlength="30" placeholder="APLANG">
        </div>
        <div class="field">
          <label>Term</label>
          <input name="term" maxlength="80" placeholder="Fall 2026">
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-course-tools-action="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-course-tools-action="save">Create course</button>
      </div>
    </form>`;
  modal.classList.remove('hidden');
  window.setTimeout(() => $('course-create-body')?.querySelector('input[name="name"]')?.focus(), 0);
}

async function showAddStudent() {
  if (!canAddStudent()) return;
  teacherCourses = await loadTeacherCourses();
  if (!teacherCourses.length) {
    toast('Create a course before adding students.', 'error');
    return;
  }

  const modal = ensureModal();
  setModalHeading('Add student', 'ROSTER');
  $('course-create-body').innerHTML = `
    <form id="student-create-form" onsubmit="return false;">
      <div class="callout info" style="margin-bottom:18px">
        <strong>Student account setup</strong>
        <span>The student will use this email to create or sign into ClassOS. Their student role, school, and class enrollment will be applied automatically.</span>
      </div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Student name</label>
          <input name="studentName" maxlength="100" required placeholder="Student name">
        </div>
        <div class="field span-2">
          <label>Student email</label>
          <input name="email" type="email" maxlength="254" required placeholder="student@example.com">
        </div>
        <div class="field span-2">
          <label>Class</label>
          <select name="courseId" required>
            ${teacherCourses.map((course) => `<option value="${esc(course.id)}">${esc(course.name || 'Course')}${course.courseCode ? ` · ${esc(course.courseCode)}` : ''}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-course-tools-action="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-course-tools-action="save-student">Add student</button>
      </div>
    </form>`;
  modal.classList.remove('hidden');
  window.setTimeout(() => $('course-create-body')?.querySelector('input[name="studentName"]')?.focus(), 0);
}

async function logAction(action, targetType, targetId, details = {}) {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      actorUid: uid(),
      actorEmail: emailKey(auth.currentUser?.email),
      action,
      targetType,
      targetId,
      details,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn('ClassOS audit log could not be written', error);
  }
}

async function saveCourse(form, button) {
  if (!form || !canCreateCourse()) return;
  if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  const school = schools.find((item) => item.id === data.schoolId);
  if (!school) {
    toast('That school is not available to your account.', 'error');
    return;
  }

  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Creating…';
  try {
    const teacherIds = role() === 'teacher' ? [uid()] : [];
    const ref = await addDoc(collection(db, 'courses'), {
      organizationId: school.organizationId || '',
      schoolId: school.id,
      name: String(data.name || '').trim(),
      courseCode: String(data.courseCode || '').trim(),
      term: String(data.term || '').trim(),
      teacherIds,
      studentIds: [],
      gradeCategories: [{ id: 'coursework', name: 'Coursework', weight: 100 }],
      status: 'active',
      createdBy: uid(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await logAction('course.create', 'course', ref.id, { name: String(data.name || '').trim() });
    closeModal();
    toast('Course created.', 'success');
    document.querySelector('.nav-item[data-route="courses"]')?.click();
  } catch (error) {
    console.error(error);
    const message = error?.code === 'permission-denied'
      ? 'Course creation is not enabled for this role in the deployed Firebase rules yet.'
      : error?.message || 'Could not create the course.';
    toast(message, 'error');
  } finally {
    if (document.body.contains(button)) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

async function saveStudent(form, button) {
  if (!form || !canAddStudent()) return;
  if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  const course = teacherCourses.find((item) => item.id === data.courseId);
  if (!course || !(course.teacherIds || []).includes(uid())) {
    toast('Choose one of your own classes.', 'error');
    return;
  }
  const mail = emailKey(data.email);
  if (!mail || mail === OWNER_EMAIL) {
    toast('Enter a valid student email address.', 'error');
    return;
  }

  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Adding…';
  try {
    await setDoc(doc(db, 'invitations', mail), {
      email: mail,
      role: 'student',
      schoolId: course.schoolId || '',
      organizationId: course.organizationId || '',
      courseId: course.id,
      studentName: String(data.studentName || '').trim(),
      status: 'active',
      invitedBy: uid(),
      invitedByRole: 'teacher',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    await logAction('student.create', 'invitation', mail, { courseId: course.id, schoolId: course.schoolId, studentName: String(data.studentName || '').trim() });
    closeModal();
    toast('Student added. Their ClassOS access will be ready when they sign in with that email.', 'success');
  } catch (error) {
    console.error(error);
    const message = error?.code === 'permission-denied'
      ? 'Teacher student creation needs the latest ClassOS Firestore rules to be deployed.'
      : error?.message || 'Could not add the student.';
    toast(message, 'error');
  } finally {
    if (document.body.contains(button)) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function injectButtons() {
  if ($('page-title')?.textContent !== 'Courses') return;
  const toolbar = document.querySelector('#page-content .toolbar');
  if (!toolbar) return;

  let actions = toolbar.querySelector('.course-tools-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'toolbar-group course-tools-actions';
    toolbar.appendChild(actions);
  }

  if (canAddStudent() && !actions.querySelector('[data-course-tools-action="new-student"]')) {
    const studentButton = document.createElement('button');
    studentButton.type = 'button';
    studentButton.className = 'btn btn-secondary';
    studentButton.dataset.courseToolsAction = 'new-student';
    studentButton.textContent = 'Add Student';
    actions.appendChild(studentButton);
  }

  if (canCreateCourse() && !actions.querySelector('[data-course-tools-action="new"]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-primary';
    button.dataset.courseToolsAction = 'new';
    button.textContent = 'Create Course';
    actions.appendChild(button);
  }
}

function scheduleInject() {
  if (injectQueued) return;
  injectQueued = true;
  window.setTimeout(() => {
    injectQueued = false;
    injectButtons();
  }, 80);
}

document.addEventListener('submit', (event) => {
  if (['course-create-form', 'student-create-form'].includes(event.target?.id)) event.preventDefault();
}, true);

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-course-tools-action]');
  if (action) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (action.dataset.courseToolsAction === 'new') await showCreateCourse();
    if (action.dataset.courseToolsAction === 'new-student') await showAddStudent();
    if (action.dataset.courseToolsAction === 'cancel') closeModal();
    if (action.dataset.courseToolsAction === 'save') await saveCourse(action.closest('form'), action);
    if (action.dataset.courseToolsAction === 'save-student') await saveStudent(action.closest('form'), action);
    return;
  }

  const route = event.target.closest('.nav-item[data-route="courses"]');
  if (route) {
    window.setTimeout(scheduleInject, 100);
    window.setTimeout(scheduleInject, 350);
  }
}, true);

const content = $('page-content');
if (content) {
  const observer = new MutationObserver(() => scheduleInject());
  observer.observe(content, { childList: true, subtree: false });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    profile = null;
    schools = [];
    teacherCourses = [];
    return;
  }
  try {
    profile = await loadProfile();
    scheduleInject();
  } catch (error) {
    console.warn('Course tools could not initialize', error);
  }
});
