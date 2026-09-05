import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const projectId = 'demo-classos-gradebook';
const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});

const profile = (role, email) => ({
  email,
  displayName: role,
  role,
  status: 'active',
  platformAccess: false,
  organizationIds: ['org1'],
  schoolIds: ['school1'],
  linkedStudentIds: [],
  guardianIds: []
});

await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, 'schools', 'school1'), { name: 'School One', organizationId: 'org1' });
  await setDoc(doc(db, 'users', 'teacher1'), profile('teacher', 'teacher1@example.com'));
  await setDoc(doc(db, 'users', 'student1'), profile('student', 'student1@example.com'));
  await setDoc(doc(db, 'users', 'student2'), profile('student', 'student2@example.com'));
  await setDoc(doc(db, 'courses', 'course1'), {
    organizationId: 'org1', schoolId: 'school1', name: 'English I',
    teacherIds: ['teacher1'], studentIds: ['student1'],
    gradeCategories: [{ id: 'coursework', name: 'Coursework', weight: 100 }], status: 'active'
  });
  await setDoc(doc(db, 'assignments', 'assignment1'), {
    organizationId: 'org1', schoolId: 'school1', courseId: 'course1',
    title: 'Essay', status: 'published', pointsPossible: 100
  });
});

const teacher = testEnv.authenticatedContext('teacher1', {
  email: 'teacher1@example.com', email_verified: false
}).firestore();

await assertSucceeds(setDoc(doc(teacher, 'submissions', 'assignment1_student1'), {
  assignmentId: 'assignment1', courseId: 'course1', schoolId: 'school1', studentId: 'student1',
  responseText: '', linkUrl: '', feedback: '', submittedAt: null,
  status: 'graded', score: 92, gradedBy: 'teacher1', gradedAt: null, updatedAt: null
}));

await assertFails(setDoc(doc(teacher, 'submissions', 'assignment1_student2'), {
  assignmentId: 'assignment1', courseId: 'course1', schoolId: 'school1', studentId: 'student2',
  responseText: '', linkUrl: '', feedback: '', submittedAt: null,
  status: 'graded', score: 92, gradedBy: 'teacher1', gradedAt: null, updatedAt: null
}));

console.log('ClassOS gradebook authorization tests passed.');
await testEnv.cleanup();
