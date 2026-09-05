import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const emailKey = (value = '') => String(value).trim().toLowerCase();
let profile = null;

const role = () => profile?.role || '';
const isOwner = () => emailKey(auth.currentUser?.email) === OWNER_EMAIL;
const educator = () => role() === 'teacher';
const admin = () => isOwner() || ['district_admin', 'school_admin'].includes(role());

async function loadProfile() {
  if (!auth.currentUser) return null;
  const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function standard(route, icon, label, section = '') {
  return `<button class="nav-item" data-route="${route}"${section ? ` data-nav-section="${section}"` : ''}><span>${icon}</span>${label}</button>`;
}
function p3(route, icon, label, section = '') {
  return `<button class="nav-item p3-nav" data-p3-route="${route}"${section ? ` data-nav-section="${section}"` : ''}><span>${icon}</span>${label}</button>`;
}
function p4(icon, label, section = '') {
  return `<button class="nav-item p4-nav" data-p4-route="operations"${section ? ` data-nav-section="${section}"` : ''}><span>${icon}</span>${label}</button>`;
}
function manage(icon, label, section = '') {
  return `<button class="nav-item manage-nav" data-manage-route="manage"${section ? ` data-nav-section="${section}"` : ''}><span>${icon}</span>${label}</button>`;
}
function workspace(icon, label, section = '') {
  return `<button class="nav-item workspace-nav" data-workspace-route="workspace"${section ? ` data-nav-section="${section}"` : ''}><span>${icon}</span>${label}</button>`;
}
function sectionToggle(name, label) {
  return `<button type="button" class="nav-section-toggle" data-nav-section-toggle="${name}" aria-expanded="true"><span>${label}</span><b>⌄</b></button>`;
}

function desiredMarkup() {
  if (!profile || profile.status !== 'active') return standard('dashboard', '⌂', 'Home');
  const r = role();
  const core = [standard('dashboard', '⌂', 'Home')];
  const tools = [];
  const administration = [];

  if (r === 'student') {
    core.push(standard('courses', '▤', 'Courses'), standard('assignments', '✓', 'Assignments'), standard('gradebook', '▦', 'Grades'));
    tools.push(standard('calendar', '□', 'Calendar', 'tools'), standard('inbox', '✉', 'Inbox', 'tools'), standard('absent', '↻', 'Absent Mode', 'tools'));
  } else if (r === 'guardian') {
    core.push(standard('family', '⌂', 'Family'), standard('courses', '▤', 'Courses'));
    tools.push(standard('inbox', '✉', 'Inbox', 'tools'));
  } else if (educator() || admin() || ['counselor', 'staff'].includes(r)) {
    core.push(standard('courses', '▤', 'Courses'));
    if (educator() || admin()) {
      core.push(standard('gradebook', '▦', 'Gradebook'), standard('assignments', '✓', 'Assignments'));
      tools.push(p3('assessments', '◫', 'Assessments', 'tools'));
    }
    tools.push(standard('calendar', '□', 'Calendar', 'tools'));
    if (r !== 'staff') tools.push(standard('attendance', '◉', 'Attendance', 'tools'));
    tools.push(standard('inbox', '✉', 'Inbox', 'tools'));
    if (educator() || admin()) tools.push(p3('command', '◈', 'Insights', 'tools'));
    if (r === 'counselor' || educator() || admin()) tools.push(p3('support', '+', 'Student Support', 'tools'));
    if (r === 'district_admin' || isOwner()) tools.push(p3('district', '▥', 'District Overview', 'tools'));

    if (['district_admin', 'school_admin', 'counselor'].includes(r) || isOwner()) administration.push(standard('people', '◎', 'People', 'administration'));
    if (educator() || admin()) administration.push(manage('⌫', 'Manage', 'administration'));
    if (admin()) administration.push(p4('▣', 'Operations', 'administration'));
    if (r === 'district_admin' || r === 'school_admin') administration.push(workspace('◇', 'Workspace', 'administration'));
    if (isOwner()) {
      administration.push(standard('organizations', '◇', 'Structure', 'administration'));
      administration.push(standard('platform', '⚙', 'Platform', 'administration'));
    }
  }

  return `${core.join('')}${tools.length ? sectionToggle('tools', 'Tools') + tools.join('') : ''}${administration.length ? sectionToggle('administration', 'Administration') + administration.join('') : ''}`;
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

function collapsedKey(name) {
  return `classos-nav-${name}-collapsed`;
}

function applySectionState(name) {
  const nav = $('primary-nav');
  if (!nav) return;
  const collapsed = localStorage.getItem(collapsedKey(name)) === '1';
  nav.querySelector(`[data-nav-section-toggle="${name}"]`)?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  nav.querySelectorAll(`[data-nav-section="${name}"]`).forEach((node) => node.classList.toggle('nav-collapsed', collapsed));
}

function updateActive() {
  const title = $('page-title')?.textContent?.trim() || '';
  document.querySelectorAll('#primary-nav .nav-item').forEach((button) => {
    button.classList.toggle('active', activeTitleFor(button) === title);
  });
}

function renderNavigation() {
  const nav = $('primary-nav');
  if (!nav) return;
  nav.innerHTML = desiredMarkup();
  applySectionState('tools');
  applySectionState('administration');
  if ($('mini-role') && educator()) $('mini-role').textContent = 'Educator';
  updateActive();
}

function normalizeDynamicItems() {
  const nav = $('primary-nav');
  if (!nav) return;
  const assignments = [
    ['.p3-nav[data-p3-route="assessments"]', 'tools'],
    ['.p3-nav[data-p3-route="command"]', 'tools'],
    ['.p3-nav[data-p3-route="support"]', 'tools'],
    ['.p3-nav[data-p3-route="district"]', 'tools'],
    ['.manage-nav', 'administration'],
    ['.p4-nav', 'administration'],
    ['.workspace-nav', 'administration'],
    ['[data-route="people"]', 'administration'],
    ['[data-route="organizations"]', 'administration'],
    ['[data-route="platform"]', 'administration']
  ];
  assignments.forEach(([selector, section]) => {
    nav.querySelectorAll(selector).forEach((node) => {
      if (node.parentElement === nav) node.dataset.navSection = section;
    });
  });
  applySectionState('tools');
  applySectionState('administration');
  updateActive();
}

document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-nav-section-toggle]');
  if (toggle) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const name = toggle.dataset.navSectionToggle;
    const collapsed = localStorage.getItem(collapsedKey(name)) === '1';
    localStorage.setItem(collapsedKey(name), collapsed ? '0' : '1');
    applySectionState(name);
    return;
  }
  const item = event.target.closest('#primary-nav .nav-item');
  if (!item) return;
  window.setTimeout(updateActive, 120);
  $('sidebar')?.classList.remove('open');
}, true);

if ($('page-title')) new MutationObserver(updateActive).observe($('page-title'), { childList: true, characterData: true, subtree: true });

onAuthStateChanged(auth, async (user) => {
  if (!user) { profile = null; renderNavigation(); return; }
  try {
    profile = await loadProfile();
    renderNavigation();
    window.setTimeout(normalizeDynamicItems, 250);
    window.setTimeout(normalizeDynamicItems, 900);
  } catch (error) {
    console.warn('Navigation could not load the current role', error);
  }
});
