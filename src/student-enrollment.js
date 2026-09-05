import { auth, db, OWNER_EMAIL } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { arrayUnion, doc, getDoc, serverTimestamp, updateDoc } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const emailKey = (value = '') => String(value).trim().toLowerCase();

async function applyTeacherEnrollment(user) {
  if (!user?.email || emailKey(user.email) === OWNER_EMAIL) return;
  const mail = emailKey(user.email);
  const [profileSnap, inviteSnap] = await Promise.all([
    getDoc(doc(db, 'users', user.uid)),
    getDoc(doc(db, 'invitations', mail))
  ]);
  if (!profileSnap.exists() || !inviteSnap.exists()) return;
  const profile = profileSnap.data();
  const invite = inviteSnap.data();
  if (profile.status !== 'active' || profile.role !== 'student') return;
  if (invite.status !== 'active' || invite.role !== 'student' || !invite.courseId) return;
  if (!(profile.schoolIds || []).includes(invite.schoolId)) return;

  const courseRef = doc(db, 'courses', invite.courseId);
  const courseSnap = await getDoc(courseRef);
  if (!courseSnap.exists()) return;
  const course = courseSnap.data();
  if (course.schoolId !== invite.schoolId || course.organizationId !== invite.organizationId) return;
  if ((course.studentIds || []).includes(user.uid)) return;

  await updateDoc(courseRef, {
    studentIds: arrayUnion(user.uid),
    updatedAt: serverTimestamp()
  });
}

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  window.setTimeout(() => applyTeacherEnrollment(user).catch((error) => {
    if (error?.code !== 'permission-denied') console.warn('Student course enrollment could not finish', error);
  }), 650);
});
