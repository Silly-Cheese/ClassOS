import { auth, db } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
let profile = null;
let organizations = [];
let schools = [];

async function direct(name, id) {
  const snap = await getDoc(doc(db, name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function load() {
  if (!profile) return;
  organizations = (await Promise.all((profile.organizationIds || []).map((id) => direct('organizations', id)))).filter(Boolean);
  schools = (await Promise.all((profile.schoolIds || []).map((id) => direct('schools', id)))).filter(Boolean);
}

function render() {
  const content = $('page-content');
  if (!content || !['district_admin', 'school_admin'].includes(profile?.role)) return;
  $('page-title').textContent = 'Workspace';
  $('workspace-kicker').textContent = profile.role === 'district_admin' ? 'DISTRICT' : 'SCHOOL';
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.remove('active'));
  document.querySelector('.workspace-nav')?.classList.add('active');
  const org = organizations[0];
  const school = schools[0];
  const heading = profile.role === 'district_admin' ? (org?.name || 'Your district') : (school?.name || 'Your school');
  content.innerHTML = `<div class="workspace-admin-page">
    <section class="workspace-admin-hero"><span class="eyebrow">${profile.role === 'district_admin' ? 'DISTRICT WORKSPACE' : 'SCHOOL WORKSPACE'}</span><h2>${esc(heading)}</h2><p>Use this page as the starting point for the administrative side of ClassOS.</p></section>
    <section class="grid grid-3 section">
      <article class="card metric"><div class="metric-top"><span>Organization</span></div><div class="metric-value workspace-admin-metric">${esc(org?.code || '—')}</div><div class="metric-note">${esc(org?.name || 'Not set')}</div></article>
      <article class="card metric"><div class="metric-top"><span>School</span></div><div class="metric-value workspace-admin-metric">${esc(school?.code || '—')}</div><div class="metric-note">${esc(school?.name || 'Not set')}</div></article>
      <article class="card metric"><div class="metric-top"><span>Your role</span></div><div class="metric-value workspace-admin-metric">${profile.role === 'district_admin' ? 'District' : 'School'}</div><div class="metric-note">Administrator</div></article>
    </section>
    <section class="workspace-admin-actions section">
      <button class="workspace-action-card" data-workspace-target="courses"><span>▤</span><div><strong>Classes</strong><small>Create courses and set up gradebooks.</small></div></button>
      <button class="workspace-action-card" data-workspace-target="people"><span>◎</span><div><strong>People</strong><small>View people and school access.</small></div></button>
      <button class="workspace-action-card" data-workspace-target="operations"><span>▣</span><div><strong>Operations</strong><small>Terms, archives, exports, and school-year tools.</small></div></button>
      <button class="workspace-action-card" data-workspace-target="manage"><span>⌫</span><div><strong>Manage</strong><small>Clean up classes, terms, assignments, and assessments.</small></div></button>
    </section>
  </div>`;
}

async function openWorkspace() {
  if (!['district_admin', 'school_admin'].includes(profile?.role)) return;
  const content = $('page-content');
  if (content) content.innerHTML = '<div class="skeleton" style="height:160px"></div>';
  try { await load(); render(); }
  catch (error) { console.error(error); if (content) content.innerHTML = `<div class="empty-state"><strong>Workspace could not load.</strong>${esc(error.message || '')}</div>`; }
}

document.addEventListener('click', async (event) => {
  const route = event.target.closest('[data-workspace-route="workspace"]');
  if (route) {
    event.preventDefault();
    event.stopImmediatePropagation();
    await openWorkspace();
    $('sidebar')?.classList.remove('open');
    return;
  }
  const target = event.target.closest('[data-workspace-target]');
  if (!target) return;
  const name = target.dataset.workspaceTarget;
  if (name === 'operations') document.querySelector('[data-p4-route="operations"]')?.click();
  else if (name === 'manage') document.querySelector('[data-manage-route="manage"]')?.click();
  else document.querySelector(`[data-route="${name}"]`)?.click();
}, true);

onAuthStateChanged(auth, async (user) => {
  if (!user) { profile = null; return; }
  try { profile = await direct('users', user.uid); }
  catch (error) { console.warn('Workspace overview could not initialize', error); }
});
