import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const emailKey = (value = '') => String(value).trim().toLowerCase();
let profile = null;
let renderQueued = false;
let rebuilding = false;

const role = () => profile?.role || '';
const isOwner = () => emailKey(auth.currentUser?.email) === OWNER_EMAIL;
const educator = () => role() === 'teacher';
const admin = () => isOwner() || ['district_admin', 'school_admin'].includes(role());

async function loadProfile() {
  if (!auth.currentUser) return null;
  const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function standard(route, icon, label) {
  return `<button class="nav-item" data-route="${route}"><span>${icon}</span>${label}</button>`;
}
function p3(route, icon, label) {
  return `<button class="nav-item p3-nav" data-p3-route="${route}"><span>${icon}</span>${label}</button>`;
}
function p4(icon, label) {
  return `<button class="nav-item p4-nav" data-p4-route="operations"><span>${icon}</span>${label}</button>`;
}
function manage(icon, label) {
  return `<button class="nav-item manage-nav" data-manage-route="manage"><span>${icon}</span>${label}</button>`;
}
function group(label, items) {
  if (!items.length) return '';
  return `<details class="nav-group"><summary>${label}<span>⌄</span></summary><div class="nav-group-items">${items.join('')}</div></details>`;
}

function desiredMarkup() {
  if (!profile || profile.status !== 'active') return standard('dashboard', '⌂', 'Home');
  const r = role();
  const core = [standard('dashboard', '⌂', 'Home')];
  const tools = [];
  const administration = [];

  if (r === 'student') {
    core.push(standard('courses', '▤', 'Courses'), standard('assignments', '✓', 'Assignments'), standard('gradebook', '▦', 'Grades'));
    tools.push(standard('calendar', '□', 'Calendar'), standard('inbox', '✉', 'Inbox'), standard('absent', '↻', 'Absent Mode'));
  } else if (r === 'guardian') {
    core.push(standard('family', '⌂', 'Family'), standard('courses', '▤', 'Courses'));
    tools.push(standard('inbox', '✉', 'Inbox'));
  } else if (educator() || admin() || ['counselor', 'staff'].includes(r)) {
    core.push(standard('courses', '▤', 'Courses'));
    if (educator() || admin()) {
      core.push(standard('gradebook', '▦', 'Gradebook'), standard('assignments', '✓', 'Assignments'));
      tools.push(p3('assessments', '◫', 'Assessments'));
    }
    tools.push(standard('calendar', '□', 'Calendar'), standard('attendance', '◉', 'Attendance'), standard('inbox', '✉', 'Inbox'));
    if (educator() || admin()) tools.push(p3('command', '◈', 'Insights'));
    if (r === 'counselor' || educator() || admin()) tools.push(p3('support', '+', 'Student Support'));
    if (r === 'district_admin' || isOwner()) tools.push(p3('district', '▥', 'District Overview'));

    if (['district_admin', 'school_admin', 'counselor'].includes(r) || isOwner()) administration.push(standard('people', '◎', 'People'));
    if (educator() || admin()) administration.push(manage('⌫', 'Manage'));
    if (admin()) administration.push(p4('▣', 'Operations'));
    if (r === 'district_admin' || r === 'school_admin') administration.push('<button class="nav-item workspace-nav" data-workspace-route="workspace"><span>◇</span>Workspace</button>');
    if (isOwner()) {
      administration.push(standard('organizations', '◇', 'Structure'));
      administration.push(standard('platform', '⚙', 'Platform'));
    }
  }

  return `${core.join('')}${group('Tools', tools)}${group('Administration', administration)}`;
}

const titleByKey = {
  dashboard: 'Home', courses: 'Courses', assignments: 'Assignments', gradebook: 'Gradebook',
  calendar: 'Calendar', attendance: 'Attendance', inbox: 'Inbox', absent: 'Absent Mode', family: 'Family',
  people: 'People', organizations: 'Organizations', platform: 'Platform',
  assessments: 'Assessments', command: 'Command Center', support: 'Student Support', district: 'District Pulse',
  operations: 'Operations', manage: 'Manage', workspace: 'Workspace'
};

function activeTitleFor(button) {
  const key = button.dataset.route || button.dataset.p3Route || button.dataset.p4Route || button.dataset.manageRoute || button.dataset.workspaceRoute;
  return titleByKey[key] || '';
}

function updateActive() {
  const title = $('page-title')?.textContent?.trim() || '';
  document.querySelectorAll('#primary-nav .nav-item').forEach((button) => {
    const active = activeTitleFor(button) === title;
    button.classList.toggle('active', active);
    if (active) button.closest('details')?.setAttribute('open', '');
  });
}

function rebuild() {
  if (rebuilding) return;
  const nav = $('primary-nav');
  if (!nav) return;
  const html = desiredMarkup();
  const signature = `${profile?.role || 'none'}|${profile?.status || 'none'}|${isOwner() ? 'owner' : 'user'}`;
  if (nav.dataset.navSignature === signature && nav.innerHTML === html) {
    updateActive();
    return;
  }
  rebuilding = true;
  nav.innerHTML = html;
  nav.dataset.navSignature = signature;
  rebuilding = false;
  updateActive();
}

function scheduleRebuild() {
  if (renderQueued) return;
  renderQueued = true;
  window.setTimeout(() => {
    renderQueued = false;
    rebuild();
  }, 90);
}

const nav = $('primary-nav');
if (nav) new MutationObserver(() => { if (!rebuilding) scheduleRebuild(); }).observe(nav, { childList: true });
if ($('page-title')) new MutationObserver(updateActive).observe($('page-title'), { childList: true, characterData: true, subtree: true });

document.addEventListener('click', (event) => {
  const item = event.target.closest('#primary-nav .nav-item');
  if (!item) return;
  window.setTimeout(updateActive, 120);
  $('sidebar')?.classList.remove('open');
}, true);

onAuthStateChanged(auth, async (user) => {
  if (!user) { profile = null; scheduleRebuild(); return; }
  try {
    profile = await loadProfile();
    scheduleRebuild();
  } catch (error) {
    console.warn('Navigation could not load the current role', error);
  }
});
