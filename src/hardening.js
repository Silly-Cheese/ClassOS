import { auth, db } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

let currentRole = 'pending';

function toast(message, type = 'error') {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function enforceTeacherRosterUi() {
  if (currentRole !== 'teacher') return;
  document.querySelectorAll('[data-lms-action="manage-roster"]').forEach((button) => {
    button.remove();
  });
}

function hardenExternalAnchors(root = document) {
  root.querySelectorAll?.('a[target="_blank"]').forEach((anchor) => {
    const existing = new Set(String(anchor.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
    existing.add('noopener');
    existing.add('noreferrer');
    anchor.setAttribute('rel', [...existing].join(' '));
  });
}

const observer = new MutationObserver(() => {
  enforceTeacherRosterUi();
  hardenExternalAnchors(document);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

// The production security model makes course membership administrator-controlled.
// Stop the older Phase 2 roster handler before it can issue a write that the rules reject.
document.addEventListener('click', (event) => {
  if (currentRole !== 'teacher') return;
  const target = event.target.closest('[data-lms-action="manage-roster"],[data-lms-action="roster-change"]');
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toast('Course roster changes are administrator-controlled in ClassOS 1.0.');
}, true);

onAuthStateChanged(auth, async (user) => {
  currentRole = 'pending';
  if (!user) return;
  try {
    const snapshot = await getDoc(doc(db, 'users', user.uid));
    currentRole = snapshot.exists() ? snapshot.data().role || 'pending' : 'pending';
    enforceTeacherRosterUi();
    hardenExternalAnchors(document);
  } catch (error) {
    console.warn('ClassOS client hardening could not read the current role', error);
  }
});
