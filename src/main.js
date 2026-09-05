import { auth, db, googleProvider, OWNER_EMAIL } from './firebase.js';
import { createLms } from './lms.js';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup,
  sendPasswordResetEmail, sendEmailVerification, signOut, onAuthStateChanged,
  updateProfile, reload
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const OWNER_ROLE = 'platform_owner';
const ROLES = ['student', 'teacher', 'guardian', 'staff', 'counselor', 'school_admin', 'district_admin'];
const labels = {
  platform_owner: 'Platform Owner', district_admin: 'District Admin', school_admin: 'School Admin',
  counselor: 'Counselor', teacher: 'Teacher', staff: 'Staff', guardian: 'Parent / Guardian',
  student: 'Student', pending: 'Pending Access'
};

const state = {
  mode: 'signin', user: null, profile: null, route: 'dashboard',
  organizations: [], schools: [], courses: [], users: [], invitations: [], flags: []
};
let lms = null;

const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[char]);
const emailKey = (value = '') => String(value).trim().toLowerCase();
const roleName = (value) => labels[value] || String(value || 'Member').replaceAll('_', ' ');
const isOwner = () => state.profile?.role === OWNER_ROLE && emailKey(state.user?.email) === OWNER_EMAIL;

function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Timestamp ? value.toDate() : typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function initials(value = 'User') {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  $('toast-region').appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function busy(button, on, text = 'Working…') {
  if (!button) return;
  if (on) {
    button.dataset.label = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function authMessage(error) {
  return ({
    'auth/invalid-credential': 'That email/password combination was not recognized.',
    'auth/email-already-in-use': 'An account already exists with that email address.',
    'auth/weak-password': 'Use a stronger password with at least 6 characters.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in window.',
    'auth/too-many-requests': 'Too many attempts were made. Try again shortly.',
    'auth/network-request-failed': 'ClassOS could not reach Firebase. Check your connection.'
  })[error?.code] || error?.message || 'Something went wrong.';
}

function openModal(title, body, kicker = 'CLASSOS') {
  $('modal-title').textContent = title;
  $('modal-kicker').textContent = kicker;
  $('modal-body').innerHTML = body;
  $('modal').classList.remove('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
  $('modal-body').innerHTML = '';
}

async function logAction(action, targetType = 'system', targetId = null, details = {}) {
  if (!state.user) return;
  try {
    await addDoc(collection(db, 'auditLogs'), {
      actorUid: state.user.uid,
      actorEmail: emailKey(state.user.email),
      action, targetType, targetId, details,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn('Audit log write failed', error);
  }
}

async function invitationFor(user) {
  if (!user?.email || !user.emailVerified) return null;
  const snapshot = await getDoc(doc(db, 'invitations', emailKey(user.email)));
  return snapshot.exists() && snapshot.data().status === 'active' ? snapshot.data() : null;
}

async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const existing = await getDoc(ref);
  const mail = emailKey(user.email);
  const base = {
    email: mail,
    displayName: user.displayName || mail.split('@')[0],
    photoURL: user.photoURL || '',
    lastLoginAt: serverTimestamp()
  };

  if (mail === OWNER_EMAIL && user.emailVerified) {
    await setDoc(ref, {
      ...base,
      role: OWNER_ROLE,
      status: 'active',
      platformAccess: true,
      organizationIds: [],
      schoolIds: [],
      bootstrapOwner: true,
      ...(!existing.exists() ? { createdAt: serverTimestamp() } : {})
    }, { merge: true });
    await bootstrap(user.uid);
  } else if (!existing.exists()) {
    const invite = await invitationFor(user);
    await setDoc(ref, {
      ...base,
      role: invite?.role || 'pending',
      status: invite ? 'active' : 'pending',
      platformAccess: false,
      organizationIds: invite?.organizationId ? [invite.organizationId] : [],
      schoolIds: invite?.schoolId ? [invite.schoolId] : [],
      invitationEmail: invite ? mail : null,
      linkedStudentIds: [],
      guardianIds: [],
      createdAt: serverTimestamp()
    });
  } else if (existing.data().status === 'pending' && user.emailVerified) {
    const invite = await invitationFor(user);
    if (invite) {
      await setDoc(ref, {
        ...base,
        role: invite.role,
        status: 'active',
        organizationIds: invite.organizationId ? [invite.organizationId] : [],
        schoolIds: invite.schoolId ? [invite.schoolId] : [],
        invitationEmail: mail
      }, { merge: true });
    } else {
      await setDoc(ref, base, { merge: true });
    }
  } else {
    await setDoc(ref, base, { merge: true });
  }

  const fresh = await getDoc(ref);
  return { id: fresh.id, ...fresh.data() };
}

async function bootstrap(ownerUid) {
  const ref = doc(db, 'system', 'config');
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    await setDoc(ref, {
      productName: 'ClassOS', environment: 'production', ownerUid,
      ownerEmail: OWNER_EMAIL, version: '0.2.0-phase2', phase: 2,
      setupComplete: true, lmsReady: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    const defaults = [
      ['core_lms', true, 'Core LMS foundation'],
      ['assignments', true, 'Assignments and due-date workflows'],
      ['gradebook', true, 'Weighted gradebook and grading queue'],
      ['attendance', true, 'Course attendance tracking'],
      ['calendar', true, 'Assignment calendar and planner'],
      ['messaging', true, 'Contextual ClassOS inbox'],
      ['absent_mode', true, 'Student absence recovery workflow'],
      ['family_portal', true, 'Parent and guardian experience'],
      ['assessments', false, 'Assessment engine'],
      ['mastery', false, 'Learning Graph and mastery'],
      ['student_pulse', false, 'Explainable student pulse'],
      ['district_pulse', false, 'District-level intelligence']
    ];
    for (const [key, enabled, description] of defaults) {
      await setDoc(doc(db, 'featureFlags', key), {
        key, enabled, description, updatedBy: ownerUid, updatedAt: serverTimestamp()
      });
    }
  }
}

async function all(name) {
  const snapshot = await getDocs(collection(db, name));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function refreshData() {
  if (isOwner()) {
    [state.organizations, state.schools, state.courses, state.users, state.invitations, state.flags] = await Promise.all([
      all('organizations'), all('schools'), all('courses'), all('users'), all('invitations'), all('featureFlags')
    ]);
    return;
  }

  state.organizations = [];
  state.schools = [];
  state.courses = [];
  state.users = [];
  state.invitations = [];
  state.flags = [];

  for (const id of (state.profile?.organizationIds || []).slice(0, 10)) {
    const snapshot = await getDoc(doc(db, 'organizations', id));
    if (snapshot.exists()) state.organizations.push({ id: snapshot.id, ...snapshot.data() });
  }
  for (const id of (state.profile?.schoolIds || []).slice(0, 10)) {
    const snapshot = await getDoc(doc(db, 'schools', id));
    if (snapshot.exists()) state.schools.push({ id: snapshot.id, ...snapshot.data() });
  }
  if (state.profile?.schoolIds?.length) {
    const snapshot = await getDocs(query(collection(db, 'courses'), where('schoolId', 'in', state.profile.schoolIds.slice(0, 10))));
    state.courses = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  }
}

function setMode(mode) {
  state.mode = mode;
  const signup = mode === 'signup';
  $('name-field').classList.toggle('hidden', !signup);
  $('auth-title').textContent = signup ? 'Create your ClassOS account' : 'Sign in to ClassOS';
  $('auth-subtitle').textContent = signup ? 'Create an account with email or continue with Google.' : 'Use your ClassOS account or continue with Google.';
  $('auth-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('auth-switch-copy').textContent = signup ? 'Already have an account?' : 'New to ClassOS?';
  $('auth-switch').textContent = signup ? 'Sign in' : 'Create account';
  $('forgot-password').classList.toggle('hidden', signup);
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
}

async function emailAuth(event) {
  event.preventDefault();
  const button = $('auth-submit');
  const mail = emailKey($('email').value);
  const password = $('password').value;
  const name = $('display-name').value.trim();
  if (!mail || !password || (state.mode === 'signup' && !name)) {
    toast('Complete all required fields.', 'error');
    return;
  }
  busy(button, true, state.mode === 'signup' ? 'Creating account…' : 'Signing in…');
  try {
    if (state.mode === 'signup') {
      const result = await createUserWithEmailAndPassword(auth, mail, password);
      await updateProfile(result.user, { displayName: name });
      await sendEmailVerification(result.user);
      showVerification(result.user);
      toast('Account created. Check your email to verify it.', 'success');
    } else {
      await signInWithEmailAndPassword(auth, mail, password);
    }
  } catch (error) {
    toast(authMessage(error), 'error');
  } finally {
    busy(button, false);
  }
}

async function googleAuth() {
  const button = $('google-auth');
  busy(button, true, 'Opening Google…');
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    toast(authMessage(error), 'error');
  } finally {
    busy(button, false);
  }
}

async function resetPassword() {
  const mail = emailKey($('email').value);
  if (!mail) {
    toast('Enter your email address first.', 'error');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, mail);
    toast('Password reset email sent.', 'success');
  } catch (error) {
    toast(authMessage(error), 'error');
  }
}

function showVerification(user) {
  $('app-view').classList.add('hidden');
  $('auth-view').classList.remove('hidden');
  const wrap = document.querySelector('.auth-card');
  wrap.innerHTML = `<div class="mobile-brand brand-lockup"><div class="brand-mark">C</div><span>ClassOS</span></div><div class="auth-heading"><span class="eyebrow">VERIFY YOUR EMAIL</span><h2>Check your inbox.</h2><p>We sent a verification link to <strong>${esc(user.email)}</strong>. ClassOS will not activate invited roles or owner access until the address is verified.</p></div><button id="verified-check" class="btn btn-primary btn-block">I’ve verified my email</button><button id="verification-resend" class="btn btn-secondary btn-block">Resend verification email</button><button id="verification-signout" class="link-button" style="display:block;margin:22px auto 0">Use a different account</button>`;
  $('verified-check').onclick = async () => {
    const button = $('verified-check');
    busy(button, true, 'Checking…');
    await reload(auth.currentUser);
    if (auth.currentUser.emailVerified) location.reload();
    else {
      toast('That email is not verified yet.', 'error');
      busy(button, false);
    }
  };
  $('verification-resend').onclick = async () => {
    try {
      await sendEmailVerification(auth.currentUser);
      toast('Verification email sent again.', 'success');
    } catch (error) {
      toast(authMessage(error), 'error');
    }
  };
  $('verification-signout').onclick = async () => {
    await signOut(auth);
    location.reload();
  };
}

function shellProfile() {
  const name = state.profile?.displayName || state.user?.displayName || state.user?.email || 'User';
  $('mini-name').textContent = name;
  $('mini-role').textContent = roleName(state.profile?.role);
  $('mini-avatar').innerHTML = state.profile?.photoURL
    ? `<img src="${esc(state.profile.photoURL)}" alt="" referrerpolicy="no-referrer">`
    : esc(initials(name));
  document.querySelectorAll('.owner-only').forEach((node) => node.classList.toggle('hidden', !isOwner()));
  lms?.syncNavigation();
}

function organizationsView() {
  if (!isOwner()) return '<div class="empty-state"><strong>Restricted</strong>This area is available to the Platform Owner.</div>';
  const orgRows = state.organizations.map((organization) => `<tr><td><span class="row-title">${esc(organization.name)}</span><span class="row-subtitle">${esc(organization.type || 'Organization')}</span></td><td>${esc(organization.code || '—')}</td><td>${state.schools.filter((school) => school.organizationId === organization.id).length}</td><td><span class="pill success">${esc(organization.status || 'active')}</span></td></tr>`).join('');
  const schoolRows = state.schools.map((school) => `<tr><td><span class="row-title">${esc(school.name)}</span><span class="row-subtitle">${esc(state.organizations.find((organization) => organization.id === school.organizationId)?.name || '—')}</span></td><td>${esc(school.code || '—')}</td><td>${esc(school.timezone || 'America/Chicago')}</td><td><span class="pill success">${esc(school.status || 'active')}</span></td></tr>`).join('');
  return `<div class="toolbar"><div><span class="eyebrow">STRUCTURE</span><h2 style="margin:4px 0 0">Organizations & schools</h2></div><div class="toolbar-group"><button class="btn btn-secondary" data-action="new-school">Add school</button><button class="btn btn-primary" data-action="new-org">Create organization</button></div></div><section class="card"><div class="section-head"><div><h3>Organizations</h3><p>Districts, networks, and independent institutions.</p></div></div>${orgRows ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Code</th><th>Schools</th><th>Status</th></tr></thead><tbody>${orgRows}</tbody></table></div>` : '<div class="empty-state"><strong>No organizations yet</strong>Create your first organization.</div>'}</section><section class="section card"><div class="section-head"><div><h3>Schools</h3><p>Campuses attached to an organization.</p></div></div>${schoolRows ? `<div class="table-wrap"><table><thead><tr><th>School</th><th>Code</th><th>Timezone</th><th>Status</th></tr></thead><tbody>${schoolRows}</tbody></table></div>` : '<div class="empty-state"><strong>No schools yet</strong>Add a school after creating an organization.</div>'}</section>`;
}

function platformView() {
  if (!isOwner()) return '<div class="empty-state"><strong>Restricted</strong>This area is available to the Platform Owner.</div>';
  const flags = [...state.flags].sort((a, b) => a.key.localeCompare(b.key)).map((flag) => `<div class="list-row"><div class="list-main"><strong>${esc(flag.key.replaceAll('_', ' '))}</strong><span>${esc(flag.description || 'Feature control')}</span></div><button class="pill clickable ${flag.enabled ? 'success' : ''}" data-action="flag" data-id="${esc(flag.id)}" data-enabled="${flag.enabled ? '1' : '0'}">${flag.enabled ? 'Enabled' : 'Disabled'}</button></div>`).join('');
  return `<div class="toolbar"><div><span class="eyebrow">OWNER CONSOLE</span><h2 style="margin:4px 0 0">Platform controls</h2></div><span class="pill success">Phase 2</span></div><section class="grid grid-2"><div class="card"><div class="section-head"><div><h3>Feature flags</h3><p>Control staged ClassOS modules.</p></div></div><div class="list">${flags}</div></div><div class="card"><div class="section-head"><div><h3>Platform identity</h3></div></div><div class="list"><div class="list-row"><div class="list-main"><strong>Bootstrap owner</strong><span>${OWNER_EMAIL}</span></div><span class="pill success">Protected</span></div><div class="list-row"><div class="list-main"><strong>Firebase project</strong><span>classos-958d3</span></div><span class="pill info">Connected</span></div><div class="list-row"><div class="list-main"><strong>LMS layer</strong><span>Assignments, grades, attendance, messaging, family view</span></div><span class="pill success">Phase 2</span></div></div></div></section>`;
}

function settingsView() {
  return `<div class="toolbar"><div><span class="eyebrow">ACCOUNT</span><h2 style="margin:4px 0 0">Settings</h2></div></div><section class="grid grid-2"><div class="card"><div class="list"><div class="list-row"><div class="list-main"><strong>Name</strong><span>${esc(state.profile?.displayName)}</span></div></div><div class="list-row"><div class="list-main"><strong>Email</strong><span>${esc(state.profile?.email)}</span></div><span class="pill success">Verified</span></div><div class="list-row"><div class="list-main"><strong>Role</strong><span>${esc(roleName(state.profile?.role))}</span></div></div></div></div><div class="card"><h3>Session</h3><p class="metric-note">Authentication is managed by Firebase and persists securely in this browser.</p><button class="btn btn-secondary" data-action="logout">Sign out</button></div></section>`;
}

const meta = {
  dashboard: ['Home', 'CLASSOS'], courses: ['Courses', 'ACADEMICS'], course: ['Course', 'ACADEMICS'],
  assignments: ['Assignments', 'COURSEWORK'], gradebook: ['Gradebook', 'GRADES'],
  attendance: ['Attendance', 'ATTENDANCE'], calendar: ['Calendar', 'PLANNER'],
  inbox: ['Inbox', 'COMMUNICATION'], absent: ['Absent Mode', 'RECOVERY'], family: ['Family', 'FAMILY VIEW'],
  people: ['People', 'DIRECTORY'], organizations: ['Organizations', 'STRUCTURE'],
  platform: ['Platform', 'OWNER CONSOLE'], settings: ['Settings', 'ACCOUNT']
};

async function render(route = state.route) {
  if (lms && !lms.routeAllowed(route)) route = 'dashboard';
  state.route = route;
  const [title, kicker] = meta[route] || meta.dashboard;
  $('page-title').textContent = title;
  $('workspace-kicker').textContent = kicker;
  document.querySelectorAll('.nav-item[data-route]').forEach((node) => node.classList.toggle('active', node.dataset.route === route));
  $('page-content').innerHTML = '<div class="skeleton" style="height:150px"></div>';
  try {
    await refreshData();
    await lms.load();
    const views = {
      dashboard: lms.dashboard,
      courses: lms.courses,
      course: lms.course,
      assignments: lms.assignments,
      gradebook: lms.gradebook,
      attendance: lms.attendance,
      calendar: lms.calendar,
      inbox: lms.inbox,
      absent: lms.absent,
      family: lms.family,
      people: lms.people,
      organizations: organizationsView,
      platform: platformView,
      settings: settingsView
    };
    $('page-content').innerHTML = (views[route] || lms.dashboard)();
  } catch (error) {
    console.error(error);
    $('page-content').innerHTML = `<div class="empty-state"><strong>ClassOS could not load this page.</strong>${esc(error.message || 'Unknown error')}</div>`;
  }
}

const orgOptions = () => state.organizations.map((organization) => `<option value="${esc(organization.id)}">${esc(organization.name)}</option>`).join('');
const schoolOptions = () => state.schools.map((school) => `<option value="${esc(school.id)}">${esc(school.name)}</option>`).join('');

function showOrg() {
  openModal('Create organization', `<form id="org-form"><div class="form-grid"><div class="field span-2"><label>Name</label><input name="name" required placeholder="Example Public Schools"></div><div class="field"><label>Type</label><select name="type"><option value="district">School district</option><option value="independent_school">Independent school</option><option value="network">School network</option></select></div><div class="field"><label>Code</label><input name="code" required maxlength="12" placeholder="EPS"></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Create</button></div></form>`, 'STRUCTURE');
}

function showSchool() {
  if (!state.organizations.length) return toast('Create an organization first.', 'error');
  openModal('Add school', `<form id="school-form"><div class="form-grid"><div class="field span-2"><label>Organization</label><select name="organizationId">${orgOptions()}</select></div><div class="field span-2"><label>School name</label><input name="name" required></div><div class="field"><label>Code</label><input name="code" required maxlength="12"></div><div class="field"><label>Timezone</label><select name="timezone"><option>America/Chicago</option><option>America/New_York</option><option>America/Denver</option><option>America/Los_Angeles</option></select></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Add school</button></div></form>`, 'STRUCTURE');
}

function showCourse() {
  if (!state.schools.length) return toast('Add a school first.', 'error');
  openModal('Create course', `<form id="course-form"><div class="form-grid"><div class="field span-2"><label>School</label><select name="schoolId">${schoolOptions()}</select></div><div class="field span-2"><label>Course name</label><input name="name" required placeholder="AP English Language"></div><div class="field"><label>Course code</label><input name="courseCode"></div><div class="field"><label>Term</label><input name="term" placeholder="2026–2027"></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Create course</button></div></form>`, 'ACADEMICS');
}

function showInvite() {
  openModal('Pre-register user', `<form id="invite-form"><div class="callout info" style="margin-bottom:18px"><strong>Verified identity required:</strong> this role can only be claimed by a Firebase-authenticated user after this exact email is verified.</div><div class="form-grid"><div class="field span-2"><label>Email</label><input name="email" type="email" required></div><div class="field"><label>Role</label><select name="role">${ROLES.map((item) => `<option value="${item}">${roleName(item)}</option>`).join('')}</select></div><div class="field"><label>School (optional)</label><select name="schoolId"><option value="">No school yet</option>${schoolOptions()}</select></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Pre-register</button></div></form>`, 'IDENTITY');
}

async function savePhaseOneForm(form) {
  const data = Object.fromEntries(new FormData(form));
  if (form.id === 'org-form') {
    const ref = await addDoc(collection(db, 'organizations'), {
      name: data.name.trim(), type: data.type, code: data.code.trim().toUpperCase(), status: 'active',
      createdBy: state.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    await logAction('organization.create', 'organization', ref.id, { name: data.name.trim() });
    closeModal(); toast('Organization created.', 'success'); return render('organizations');
  }
  if (form.id === 'school-form') {
    const organization = state.organizations.find((item) => item.id === data.organizationId);
    const ref = await addDoc(collection(db, 'schools'), {
      organizationId: data.organizationId, organizationName: organization?.name || '',
      name: data.name.trim(), code: data.code.trim().toUpperCase(), timezone: data.timezone,
      status: 'active', createdBy: state.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    await logAction('school.create', 'school', ref.id, { name: data.name.trim() });
    closeModal(); toast('School added.', 'success'); return render('organizations');
  }
  if (form.id === 'course-form') {
    const school = state.schools.find((item) => item.id === data.schoolId);
    const ref = await addDoc(collection(db, 'courses'), {
      organizationId: school?.organizationId || '', schoolId: data.schoolId,
      name: data.name.trim(), courseCode: data.courseCode.trim(), term: data.term.trim(),
      teacherIds: [], studentIds: [], gradeCategories: [{ id: 'coursework', name: 'Coursework', weight: 100 }],
      status: 'active', createdBy: state.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    await logAction('course.create', 'course', ref.id, { name: data.name.trim() });
    closeModal(); toast('Course created.', 'success'); return render('courses');
  }
  if (form.id === 'invite-form') {
    const mail = emailKey(data.email);
    if (mail === OWNER_EMAIL) return toast('The bootstrap owner already has owner access.', 'error');
    const school = state.schools.find((item) => item.id === data.schoolId);
    await setDoc(doc(db, 'invitations', mail), {
      email: mail, role: data.role, schoolId: data.schoolId || '', organizationId: school?.organizationId || '',
      status: 'active', invitedBy: state.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }, { merge: true });
    await logAction('invitation.create', 'invitation', mail, { role: data.role });
    closeModal(); toast('Access pre-registered.', 'success'); return render('people');
  }
}

async function pageAction(event) {
  if (await lms.handleAction(event)) return;
  const jump = event.target.closest('[data-jump]');
  if (jump) return render(jump.dataset.jump);
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'new-org') showOrg();
  if (action === 'new-school') showSchool();
  if (action === 'new-course') showCourse();
  if (action === 'invite') showInvite();
  if (action === 'close') closeModal();
  if (action === 'logout') await signOut(auth);
  if (action === 'flag' && isOwner()) {
    const enabled = target.dataset.enabled === '1';
    await updateDoc(doc(db, 'featureFlags', target.dataset.id), {
      enabled: !enabled, updatedBy: state.user.uid, updatedAt: serverTimestamp()
    });
    await logAction('feature_flag.toggle', 'featureFlag', target.dataset.id, { enabled: !enabled });
    toast('Feature flag updated.', 'success');
    await render('platform');
  }
}

lms = createLms({
  state, db, auth,
  helpers: {
    esc, toast, openModal, closeModal, logAction, isOwner, roleName, formatDate, busy,
    navigate: (route) => render(route)
  }
});

function wire() {
  $('auth-form').addEventListener('submit', emailAuth);
  $('google-auth').onclick = googleAuth;
  $('forgot-password').onclick = resetPassword;
  $('auth-switch').onclick = () => setMode(state.mode === 'signin' ? 'signup' : 'signin');
  $('sign-out').onclick = () => signOut(auth);
  $('page-content').addEventListener('click', pageAction);
  $('modal-body').addEventListener('click', pageAction);
  $('modal-body').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"],button:not([type])');
    busy(button, true, 'Saving…');
    try {
      if (await lms.handleForm(event.target)) return;
      await savePhaseOneForm(event.target);
    } catch (error) {
      console.error(error);
      toast(error.message || 'Could not save.', 'error');
      busy(button, false);
    }
  });
  $('modal-close').onclick = closeModal;
  $('modal').onclick = (event) => {
    if (event.target.id === 'modal') closeModal();
  };
  $('primary-nav').addEventListener('click', (event) => {
    const button = event.target.closest('.nav-item[data-route]');
    if (!button) return;
    render(button.dataset.route);
    $('sidebar').classList.remove('open');
  });
  $('sidebar-open').onclick = () => $('sidebar').classList.add('open');
  $('sidebar-close').onclick = () => $('sidebar').classList.remove('open');
  $('global-search').onclick = () => openModal('Search ClassOS', '<div class="callout info"><strong>Search is ready for the Phase 3 intelligence pass.</strong><br>For now, use Courses, Assignments, Gradebook, Calendar, and Inbox to navigate current LMS data.</div>', 'SEARCH');
  document.querySelector('.notification-btn')?.addEventListener('click', () => render('inbox'));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
}

wire();
setMode('signin');

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.user = null;
    state.profile = null;
    $('app-view').classList.add('hidden');
    $('auth-view').classList.remove('hidden');
    return;
  }
  const usesPassword = user.providerData.some((provider) => provider.providerId === 'password');
  if (usesPassword && !user.emailVerified) {
    showVerification(user);
    return;
  }

  $('auth-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  $('page-content').innerHTML = '<div class="skeleton" style="height:180px"></div>';
  try {
    state.user = user;
    state.profile = await ensureProfile(user);
    await lms.ensurePhase2();
    shellProfile();
    await logAction('session.sign_in', 'user', user.uid, { provider: user.providerData?.[0]?.providerId || 'unknown' });
    await render('dashboard');
  } catch (error) {
    console.error(error);
    $('page-content').innerHTML = `<div class="empty-state"><strong>ClassOS sign-in succeeded, but setup could not finish.</strong>${esc(error.message || 'Check Firebase configuration and Firestore rules.')}</div>`;
    toast('Signed in, but ClassOS could not finish loading.', 'error');
  }
});
