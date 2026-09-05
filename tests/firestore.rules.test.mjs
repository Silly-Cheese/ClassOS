import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc
} from 'firebase/firestore';

const projectId = 'demo-classos';
const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});

const profile = (role, schoolId = 'school1', organizationId = 'org1') => ({
  email: `${role}@example.com`,
  displayName: role,
  role,
  status: 'active',
  platformAccess: false,
  organizationIds: [organizationId],
  schoolIds: [schoolId],
  linkedStudentIds: [],
  guardianIds: []
});

await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await Promise.all([
    setDoc(doc(db, 'organizations', 'org1'), { name: 'District One' }),
    setDoc(doc(db, 'organizations', 'org2'), { name: 'District Two' }),
    setDoc(doc(db, 'schools', 'school1'), { name: 'School One', organizationId: 'org1' }),
    setDoc(doc(db, 'schools', 'school2'), { name: 'School Two', organizationId: 'org2' }),
    setDoc(doc(db, 'users', 'student1'), { ...profile('student'), email: 'student1@example.com' }),
    setDoc(doc(db, 'users', 'student2'), { ...profile('student'), email: 'student2@example.com' }),
    setDoc(doc(db, 'users', 'teacher1'), { ...profile('teacher'), email: 'teacher1@example.com' }),
    setDoc(doc(db, 'users', 'teacher2'), { ...profile('teacher', 'school2', 'org2'), email: 'teacher2@example.com' }),
    setDoc(doc(db, 'users', 'counselor1'), { ...profile('counselor'), email: 'counselor1@example.com' }),
    setDoc(doc(db, 'courses', 'course1'), {
      organizationId: 'org1', schoolId: 'school1', name: 'Algebra I',
      teacherIds: ['teacher1'], studentIds: ['student1', 'student2'],
      gradeCategories: [{ id: 'coursework', name: 'Coursework', weight: 100 }], status: 'active'
    }),
    setDoc(doc(db, 'assignments', 'assignment1'), {
      organizationId: 'org1', schoolId: 'school1', courseId: 'course1',
      title: 'Practice', status: 'published', pointsPossible: 10
    }),
    setDoc(doc(db, 'assessments', 'assessment-published'), {
      schoolId: 'school1', courseId: 'course1', title: 'Published Test', status: 'published', pointsPossible: 10, items: []
    }),
    setDoc(doc(db, 'assessments', 'assessment-draft'), {
      schoolId: 'school1', courseId: 'course1', title: 'Draft Test', status: 'draft', pointsPossible: 10, items: []
    }),
    setDoc(doc(db, 'assessmentKeys', 'assessment-published'), {
      assessmentId: 'assessment-published', schoolId: 'school1', courseId: 'course1', answers: { q1: 'secret' }
    }),
    setDoc(doc(db, 'interventions', 'intervention1'), {
      studentId: 'student1', schoolId: 'school1', courseId: 'course1',
      title: 'Support plan', status: 'open', createdBy: 'teacher1', ownerId: 'teacher1'
    }),
    setDoc(doc(db, 'invitations', 'guardian@example.com'), {
      email: 'guardian@example.com', role: 'guardian', status: 'active', schoolId: 'school1', organizationId: 'org1'
    })
  ]);
});

const student = testEnv.authenticatedContext('student1', {
  email: 'student1@example.com', email_verified: true
}).firestore();
const teacher = testEnv.authenticatedContext('teacher1', {
  email: 'teacher1@example.com', email_verified: true
}).firestore();
const counselor = testEnv.authenticatedContext('counselor1', {
  email: 'counselor1@example.com', email_verified: true
}).firestore();
const guardian = testEnv.authenticatedContext('guardian-new', {
  email: 'guardian@example.com', email_verified: true
}).firestore();

// Invited guardians must not be able to forge their own linked-student access.
await assertFails(setDoc(doc(guardian, 'users', 'guardian-new'), {
  email: 'guardian@example.com', displayName: 'Guardian', role: 'guardian', status: 'active', platformAccess: false,
  organizationIds: ['org1'], schoolIds: ['school1'], linkedStudentIds: ['student1'], guardianIds: []
}));
await assertSucceeds(setDoc(doc(guardian, 'users', 'guardian-new'), {
  email: 'guardian@example.com', displayName: 'Guardian', role: 'guardian', status: 'active', platformAccess: false,
  organizationIds: ['org1'], schoolIds: ['school1'], linkedStudentIds: [], guardianIds: []
}));

// Students cannot submit a self-assigned score or later modify grading metadata.
await assertFails(setDoc(doc(student, 'submissions', 'bad-submission'), {
  assignmentId: 'assignment1', courseId: 'course1', schoolId: 'school1', studentId: 'student1',
  responseText: 'My answer', linkUrl: '', status: 'submitted', score: 10, gradedBy: null, gradedAt: null
}));
await assertSucceeds(setDoc(doc(student, 'submissions', 'good-submission'), {
  assignmentId: 'assignment1', courseId: 'course1', schoolId: 'school1', studentId: 'student1',
  responseText: 'My answer', linkUrl: '', status: 'submitted', score: null, gradedBy: null, gradedAt: null
}));
await assertFails(updateDoc(doc(student, 'submissions', 'good-submission'), { score: 10 }));

// Counselors can review records but cannot create assignment grades.
await assertFails(setDoc(doc(counselor, 'submissions', 'counselor-grade'), {
  assignmentId: 'assignment1', courseId: 'course1', schoolId: 'school1', studentId: 'student2',
  responseText: '', linkUrl: '', status: 'graded', score: 10, gradedBy: 'counselor1', gradedAt: null
}));

// Teachers manage instruction, but course membership is administrator-controlled in ClassOS 1.0.
await assertFails(updateDoc(doc(teacher, 'courses', 'course1'), { studentIds: ['student1'] }));
await assertSucceeds(updateDoc(doc(teacher, 'courses', 'course1'), {
  gradeCategories: [{ id: 'tests', name: 'Tests', weight: 100 }]
}));

// Students can read a published assessment but not a draft or its protected key.
await assertSucceeds(getDoc(doc(student, 'assessments', 'assessment-published')));
await assertFails(getDoc(doc(student, 'assessments', 'assessment-draft')));
await assertFails(getDoc(doc(student, 'assessmentKeys', 'assessment-published')));

// Same-school student-to-teacher messaging is allowed; arbitrary cross-school UID messaging is not.
await assertSucceeds(setDoc(doc(student, 'messages', 'allowed-message'), {
  senderId: 'student1', senderName: 'Student', recipientIds: ['teacher1'],
  subject: 'Question', body: 'Can you help?', readBy: ['student1']
}));
await assertFails(setDoc(doc(student, 'messages', 'cross-school-message'), {
  senderId: 'student1', senderName: 'Student', recipientIds: ['teacher2'],
  subject: 'Question', body: 'Cross school', readBy: ['student1']
}));

// An authorized support user cannot repoint an existing intervention to another student.
await assertFails(updateDoc(doc(counselor, 'interventions', 'intervention1'), { studentId: 'student2' }));
await assertSucceeds(updateDoc(doc(counselor, 'interventions', 'intervention1'), { status: 'monitoring' }));

console.log('ClassOS authorization regression tests passed.');
await testEnv.cleanup();
