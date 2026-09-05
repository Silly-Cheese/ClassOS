import { auth, db } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, setDoc, query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const state = { user: null, profile: null, courses: [], assessments: [], attempts: [], active: false };
const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

function toast(message, type = '') {
  const region = $('toast-region'); if (!region) return;
  const node = document.createElement('div'); node.className = `toast ${type}`.trim(); node.textContent = message;
  region.appendChild(node); window.setTimeout(() => node.remove(), 4200);
}

function asDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date;
}
function fmt(value) {
  const date = asDate(value); if (!date) return 'No due date';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
function courseName(id) { return state.courses.find((item) => item.id === id)?.name || 'Course'; }

async function load() {
  if (!state.user || state.profile?.role !== 'student' || state.profile.status !== 'active') return;
  const courseSnap = await getDocs(query(collection(db, 'courses'), where('studentIds', 'array-contains', state.user.uid)));
  state.courses = courseSnap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.status !== 'archived');
  const assessmentBatches = await Promise.all(state.courses.map(async (course) => {
    try {
      const snap = await getDocs(query(
        collection(db, 'assessments'),
        where('courseId', '==', course.id),
        where('status', '==', 'published')
      ));
      return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
    } catch (error) {
      console.warn(`Could not load published assessments for ${course.id}`, error);
      return [];
    }
  }));
  state.assessments = assessmentBatches.flat();
  const attempts = await getDocs(query(collection(db, 'assessmentAttempts'), where('studentId', '==', state.user.uid)));
  state.attempts = attempts.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function ensureModal() {
  if ($('sa-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="sa-modal" class="modal-backdrop hidden" role="presentation"><section class="modal p3-modal" role="dialog" aria-modal="true" aria-labelledby="sa-title"><div class="modal-head"><div><span class="eyebrow">ASSESSMENT</span><h3 id="sa-title">Assessment</h3></div><button id="sa-close" class="icon-btn" aria-label="Close">×</button></div><div id="sa-body" class="modal-body"></div></section></div>`);
  $('sa-close').onclick = closeModal;
  $('sa-modal').onclick = (event) => { if (event.target.id === 'sa-modal') closeModal(); };
}
function openModal(title, body) { ensureModal(); $('sa-title').textContent = title; $('sa-body').innerHTML = body; $('sa-modal').classList.remove('hidden'); }
function closeModal() { $('sa-modal')?.classList.add('hidden'); if ($('sa-body')) $('sa-body').innerHTML = ''; }

function render() {
  state.active = true;
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.remove('active'));
  document.querySelector('.p3-nav[data-p3-route="assessments"]')?.classList.add('active');
  if ($('page-title')) $('page-title').textContent = 'Assessments';
  if ($('workspace-kicker')) $('workspace-kicker').textContent = 'ASSESSMENT ENGINE';
  const content = $('page-content'); if (!content) return;
  const now = new Date();
  const cards = state.assessments.sort((a, b) => (asDate(a.dueAt)?.getTime() || Infinity) - (asDate(b.dueAt)?.getTime() || Infinity)).map((assessment) => {
    const attempt = state.attempts.find((item) => item.assessmentId === assessment.id);
    const overdue = asDate(assessment.dueAt) && asDate(assessment.dueAt) < now && !attempt;
    const status = attempt?.status === 'graded' ? `${Number(attempt.score || 0)}/${Number(attempt.pointsPossible || assessment.pointsPossible || 0)}` : attempt ? 'Submitted' : overdue ? 'Overdue' : 'Open';
    const cls = attempt?.status === 'graded' ? 'success' : attempt ? 'info' : overdue ? 'danger' : 'warning';
    return `<article class="card"><div class="section-head"><div><span class="eyebrow">${esc(courseName(assessment.courseId))}</span><h3>${esc(assessment.title)}</h3></div><span class="pill ${cls}">${esc(status)}</span></div><p class="metric-note" style="line-height:1.6">${esc(assessment.description || 'No description provided.')}</p><div class="assignment-meta"><span>${Number(assessment.pointsPossible || 0)} points</span><span>Due ${esc(fmt(assessment.dueAt))}</span></div><button class="btn btn-secondary btn-block" data-sa-action="${attempt ? 'result' : 'take'}" data-id="${esc(assessment.id)}">${attempt ? 'View submission' : 'Take assessment'}</button></article>`;
  }).join('');
  content.innerHTML = `<section class="hero"><span class="eyebrow">SECURE ASSESSMENTS</span><h1>Assessments</h1><p>Only published assessments from your enrolled courses appear here. Correct answers are stored separately and are never delivered to your account.</p></section><section class="section grid grid-3">${cards || '<div class="empty-state"><strong>No published assessments</strong>Your teachers have not published an assessment for your courses.</div>'}</section>`;
}

function showTake(id) {
  const assessment = state.assessments.find((item) => item.id === id);
  if (!assessment || state.attempts.some((item) => item.assessmentId === id)) return toast('That assessment is no longer available.', 'error');
  const questions = (assessment.items || []).map((question, index) => `<article class="p3-question"><div class="p3-question-number">${index + 1}</div><div><h4>${esc(question.prompt)}</h4><span class="pill">${Number(question.points || 0)} pts</span>${question.type === 'multiple_choice' ? `<div class="p3-answer-options">${(question.options || []).map((option) => `<label><input type="radio" name="answer__${esc(question.id)}" value="${esc(option)}" required><span>${esc(option)}</span></label>`).join('')}</div>` : question.type === 'true_false' ? `<div class="p3-answer-options"><label><input type="radio" name="answer__${esc(question.id)}" value="true" required><span>True</span></label><label><input type="radio" name="answer__${esc(question.id)}" value="false" required><span>False</span></label></div>` : `<textarea name="answer__${esc(question.id)}" rows="5" required placeholder="Your response"></textarea>`}</div></article>`).join('');
  openModal(assessment.title, `<form id="sa-attempt-form" data-id="${esc(assessment.id)}"><div class="callout info" style="margin-bottom:18px"><strong>${Number(assessment.pointsPossible || 0)} points</strong> · Due ${esc(fmt(assessment.dueAt))}<br>This assessment can be submitted once.</div><div class="p3-question-stack">${questions}</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-sa-action="close">Cancel</button><button type="submit" class="btn btn-primary">Submit assessment</button></div></form>`);
}

function showResult(id) {
  const assessment = state.assessments.find((item) => item.id === id);
  const attempt = state.attempts.find((item) => item.assessmentId === id);
  if (!assessment || !attempt) return;
  const result = attempt.status === 'graded'
    ? `<div class="grade-detail-hero"><strong>${Number(attempt.score || 0)}/${Number(attempt.pointsPossible || assessment.pointsPossible || 0)}</strong><span>Final assessment score</span></div>${attempt.feedback ? `<div class="callout info"><strong>Teacher feedback</strong><br>${esc(attempt.feedback)}</div>` : ''}`
    : '<div class="callout info"><strong>Submitted.</strong><br>Your teacher has not finalized this assessment grade yet.</div>';
  openModal(assessment.title, `${result}<div class="modal-actions"><button type="button" class="btn btn-secondary" data-sa-action="close">Close</button></div>`);
}

document.addEventListener('click', async (event) => {
  if (state.profile?.role !== 'student') return;
  const route = event.target.closest('.p3-nav[data-p3-route="assessments"],[data-p3-nav="assessments"]');
  if (route) {
    event.preventDefault(); event.stopImmediatePropagation();
    $('sidebar')?.classList.remove('open');
    try { await load(); render(); } catch (error) { console.error(error); toast('Assessments could not load.', 'error'); }
    return;
  }
  const action = event.target.closest('[data-sa-action]');
  if (!action) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (action.dataset.saAction === 'close') closeModal();
  if (action.dataset.saAction === 'take') showTake(action.dataset.id);
  if (action.dataset.saAction === 'result') showResult(action.dataset.id);
}, true);

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'sa-attempt-form') return;
  event.preventDefault(); event.stopImmediatePropagation();
  const assessment = state.assessments.find((item) => item.id === event.target.dataset.id);
  if (!assessment) return toast('Assessment unavailable.', 'error');
  const button = event.target.querySelector('button[type="submit"]'); if (button) { button.disabled = true; button.textContent = 'Submitting…'; }
  try {
    const data = new FormData(event.target), answers = {};
    (assessment.items || []).forEach((question) => { answers[question.id] = String(data.get(`answer__${question.id}`) ?? '').trim(); });
    const attemptId = `${assessment.id}_${state.user.uid}`;
    await setDoc(doc(db, 'assessmentAttempts', attemptId), {
      assessmentId: assessment.id, courseId: assessment.courseId, schoolId: assessment.schoolId,
      studentId: state.user.uid, answers, score: null, pointsPossible: Number(assessment.pointsPossible) || 0,
      itemResults: [], feedback: '', status: 'submitted', submittedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    closeModal(); toast('Assessment submitted.', 'success'); await load(); render();
  } catch (error) {
    console.error(error); toast(error.message || 'Assessment could not be submitted.', 'error'); if (button) { button.disabled = false; button.textContent = 'Submit assessment'; }
  }
}, true);

onAuthStateChanged(auth, async (user) => {
  state.user = user; state.profile = null; state.active = false;
  if (!user) return;
  try {
    const profile = await getDoc(doc(db, 'users', user.uid));
    if (profile.exists()) state.profile = { id: profile.id, ...profile.data() };
  } catch (error) { console.warn('Secure student assessment bootstrap failed', error); }
});
