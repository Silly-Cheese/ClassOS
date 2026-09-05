import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'demo-classos-teacher-students';
const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});

await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, 'organizations', 'org1'), { name: 'District', status: 'active' });
  await setDoc(doc(db, 'schools', 'school1'), { name: 'School One', organizationId: 'org1', status: 'active' });
  await setDoc(doc(db, 'users', 'teacher1'), {
    email: 'teacher@example.com', role: 'teacher', status: 'active', platformAccess: false,
    organizationIds: ['org1'], schoolIds: ['school1'], linkedStudentIds: [], guardianIds: []
  });
  await setDoc(doc(db, 'users', 'teacher2'), {
    email: 'other@example.com', role: 'teacher', status: 'active', platformAccess: false,
    organizationIds: ['org1'], schoolIds: ['school1'], linkedStudentIds: [], guardianIds: []
  });
  await setDoc(doc(db, 'courses', 'course1'), {
    organizationId: 'org1', schoolId: 'school1', name: 'Biology', status: 'active',
    teacherIds: ['teacher1'], studentIds: [], gradeCategories: [{ id: 'coursework', name: 'Coursework', weight: 100 }], createdBy: 'teacher1'
  });
  await setDoc(doc(db, 'courses', 'course2'), {
    organizationId: 'org1', schoolId: 'school1', name: 'English', status: 'active',
    teacherIds: ['teacher2'], studentIds: [], gradeCategories: [{ id: 'coursework', name: 'Coursework', weight: 100 }], createdBy: 'teacher2'
  });
});

const teacher = testEnv.authenticatedContext('teacher1', { email: 'teacher@example.com' }).firestore();
const studentInvite = {
  email: 'student@example.com', role: 'student', schoolId: 'school1', organizationId: 'org1',
  courseId: 'course1', studentName: 'Student One', status: 'active',
  invitedBy: 'teacher1', invitedByRole: 'teacher', createdAt: 1, updatedAt: 1
};
await assertSucceeds(setDoc(doc(teacher, 'invitations', 'student@example.com'), studentInvite));

await assertFails(setDoc(doc(teacher, 'invitations', 'fake-admin@example.com'), {
  ...studentInvite, email: 'fake-admin@example.com', role: 'school_admin'
}));

await assertFails(setDoc(doc(teacher, 'invitations', 'other-course@example.com'), {
  ...studentInvite, email: 'other-course@example.com', courseId: 'course2'
}));

await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, 'users', 'student1'), {
    email: 'student@example.com', role: 'student', status: 'active', platformAccess: false,
    organizationIds: ['org1'], schoolIds: ['school1'], linkedStudentIds: [], guardianIds: []
  });
});

const student = testEnv.authenticatedContext('student1', { email: 'student@example.com' }).firestore();
await assertSucceeds(updateDoc(doc(student, 'courses', 'course1'), {
  studentIds: ['student1'], updatedAt: 2
}));

await assertFails(updateDoc(doc(student, 'courses', 'course2'), {
  studentIds: ['student1'], updatedAt: 2
}));

await assertFails(updateDoc(doc(student, 'courses', 'course1'), {
  studentIds: ['student1', 'someone-else'], updatedAt: 3
}));

console.log('ClassOS teacher-created student authorization tests passed.');
await testEnv.cleanup();
