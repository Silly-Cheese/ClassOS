import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  collection, doc, getDoc, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const emailKey = (value = '') => String(value).trim().toLowerCase();

let profile = null;
let choice = 'teacher';

function toast(message, type = '') {
  const region = $('toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4600);
}

async function currentProfile() {
  if (!auth.currentUser) return null;
  const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function hasInvite() {
  const email = emailKey(auth.currentUser?.email);
  if (!email) return false;
  try {
    const snap = await getDoc(doc(db, 'invitations', email));
    return snap.exists() && snap.data().status === 'active';
  } catch {
    return false;
  }
}

function codeFrom(value, fallback) {
  const code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return code || fallback;
}

function ensureOverlay() {
  if ($('self-onboarding')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="self-onboarding" class="onboarding-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <section class="onboarding-panel">
        <div class="onboarding-brand"><div class="brand-mark">C</div><span>ClassOS</span></div>
        <div class="onboarding-copy">
          <span class="eyebrow">GET STARTED</span>
          <h1 id="onboarding-title">How will you use ClassOS?</h1>
          <p>You were not pre-assigned to a school, so you can start your own workspace. This only gives you control over the workspace you create.</p>
        </div>
        <div class="onboarding-choices" role="radiogroup" aria-label="Account type">
          <button type="button" class="onboarding-choice selected" data-onboarding-choice="teacher">
            <span class="onboarding-choice-icon">▦</span><strong>Educator</strong><small>Start classes and gradebooks right away.</small>
          </button>
          <button type="button" class="onboarding-choice" data-onboarding-choice="school_admin">
            <span class="onboarding-choice-icon">⌂</span><strong>School Admin</strong><small>Create and manage an independent school.</small>
          </button>
          <button type="button" class="onboarding-choice" data-onboarding-choice="district_admin">
            <span class="onboarding-choice-icon">◇</span><strong>District Admin</strong><small>Create a district and its first school.</small>
          </button>
          <button type="button" class="onboarding-choice" data-onboarding-choice="join">
            <span class="onboarding-choice-icon">→</span><strong>Student or Family</strong><small>Join through an invitation from your school.</small>
          </button>
        </div>
        <form id="onboarding-form" onsubmit="return false;">
          <div id="onboarding-fields"></div>
          <div class="onboarding-actions">
            <button type="button" class="btn btn-secondary" data-onboarding-action="signout">Sign out</button>
            <button id="onboarding-submit" type="button" class="btn btn-primary" data-onboarding-action="finish">Create my workspace</button>
          </div>
        </form>
      </section>
    </div>`);
}

function fieldsForChoice() {
  const host = $('onboarding-fields');
  const submit = $('onboarding-submit');
  if (!host || !submit) return;
  if (choice === 'teacher') {
    host.innerHTML = `<div class="onboarding-note"><strong>Your personal teaching workspace</strong><span>ClassOS will create “My Classes” for you. From there, create a course and its Gradebook is ready automatically.</span></div>`;
    submit.textContent = 'Start teaching';
    submit.disabled = false;
    return;
  }
  if (choice === 'school_admin') {
    host.innerHTML = `<div class="form-grid"><div class="field span-2"><label>School name</label><input name="schoolName" maxlength="100" required placeholder="Lincoln Academy"></div><div class="field span-2"><label>School code</label><input name="schoolCode" maxlength="12" placeholder="LINCOLN"></div></div>`;
    submit.textContent = 'Create school';
    submit.disabled = false;
    return;
  }
  if (choice === 'district_admin') {
    host.innerHTML = `<div class="form-grid"><div class="field"><label>District name</label><input name="districtName" maxlength="100" required placeholder="Example Public Schools"></div><div class="field"><label>District code</label><input name="districtCode" maxlength="12" placeholder="EPS"></div><div class="field"><label>First school</label><input name="schoolName" maxlength="100" required placeholder="Central High School"></div><div class="field"><label>School code</label><input name="schoolCode" maxlength="12" placeholder="CHS"></div></div>`;
    submit.textContent = 'Create district';
    submit.disabled = false;
    return;
  }
  host.innerHTML = `<div class="onboarding-note"><strong>Your school needs to invite you first.</strong><span>Ask the school to pre-register the same email address you used for this ClassOS account. When you sign in again, the assigned student or family access will be applied automatically.</span></div>`;
  submit.textContent = 'Invitation required';
  submit.disabled = true;
}

function show() {
  ensureOverlay();
  fieldsForChoice();
  $('self-onboarding')?.classList.remove('hidden');
  document.body.classList.add('onboarding-open');
}

function hide() {
  $('self-onboarding')?.classList.add('hidden');
  document.body.classList.remove('onboarding-open');
}

async function finish(button) {
  if (!auth.currentUser || !profile || profile.status !== 'pending' || profile.role !== 'pending') return;
  if (!['teacher', 'school_admin', 'district_admin'].includes(choice)) return;
  const form = $('onboarding-form');
  if (typeof form?.reportValidity === 'function' && !form.reportValidity()) return;

  const data = Object.fromEntries(new FormData(form));
  const displayName = profile.displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Educator';
  let orgName = `${displayName}'s Classes`;
  let orgCode = 'MYCLASS';
  let schoolName = 'My Classes';
  let schoolCode = 'MYCLASS';
  let orgType = 'personal_workspace';

  if (choice === 'school_admin') {
    schoolName = String(data.schoolName || '').trim();
    if (!schoolName) return toast('Enter your school name.', 'error');
    schoolCode = codeFrom(data.schoolCode, 'SCHOOL');
    orgName = schoolName;
    orgCode = schoolCode;
    orgType = 'independent_school';
  }
  if (choice === 'district_admin') {
    orgName = String(data.districtName || '').trim();
    schoolName = String(data.schoolName || '').trim();
    if (!orgName || !schoolName) return toast('Enter the district and first school names.', 'error');
    orgCode = codeFrom(data.districtCode, 'DISTRICT');
    schoolCode = codeFrom(data.schoolCode, 'SCHOOL');
    orgType = 'district';
  }

  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Setting up…';
  try {
    const userRef = doc(db, 'users', auth.currentUser.uid);
    const orgRef = doc(collection(db, 'organizations'));
    const schoolRef = doc(collection(db, 'schools'));
    const batch = writeBatch(db);
    batch.set(orgRef, {
      name: orgName,
      code: orgCode,
      type: orgType,
      status: 'active',
      ownerUid: auth.currentUser.uid,
      selfService: true,
      createdBy: auth.currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(schoolRef, {
      organizationId: orgRef.id,
      organizationName: orgName,
      name: schoolName,
      code: schoolCode,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago',
      status: 'active',
      ownerUid: auth.currentUser.uid,
      selfService: true,
      createdBy: auth.currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.update(userRef, {
      role: choice,
      status: 'active',
      platformAccess: false,
      organizationIds: [orgRef.id],
      schoolIds: [schoolRef.id],
      selfService: true,
      setupComplete: true,
      setupRole: choice,
      setupAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    });
    await batch.commit();
    toast(choice === 'teacher' ? 'Your teaching workspace is ready.' : choice === 'district_admin' ? 'Your district is ready.' : 'Your school is ready.', 'success');
    hide();
    window.setTimeout(() => window.location.reload(), 250);
  } catch (error) {
    console.error(error);
    const message = error?.code === 'permission-denied'
      ? 'Self-service setup needs the latest ClassOS Firestore rules to be deployed.'
      : error?.message || 'ClassOS could not finish setup.';
    toast(message, 'error');
    button.disabled = false;
    button.textContent = original;
  }
}

ensureOverlay();
fieldsForChoice();

document.addEventListener('click', async (event) => {
  const pick = event.target.closest('[data-onboarding-choice]');
  if (pick) {
    choice = pick.dataset.onboardingChoice;
    document.querySelectorAll('[data-onboarding-choice]').forEach((node) => node.classList.toggle('selected', node === pick));
    fieldsForChoice();
    return;
  }
  const action = event.target.closest('[data-onboarding-action]');
  if (!action) return;
  if (action.dataset.onboardingAction === 'finish') await finish(action);
  if (action.dataset.onboardingAction === 'signout') {
    const { signOut } = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js');
    await signOut(auth);
  }
}, true);

onAuthStateChanged(auth, async (user) => {
  if (!user || emailKey(user.email) === OWNER_EMAIL) { profile = null; hide(); return; }
  try {
    profile = await currentProfile();
    if (!profile || profile.status !== 'pending' || profile.role !== 'pending') { hide(); return; }
    if (await hasInvite()) { hide(); return; }
    show();
  } catch (error) {
    console.warn('ClassOS onboarding could not initialize', error);
  }
});
