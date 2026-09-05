import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, writeBatch } from 'firebase/firestore';

const projectId = 'demo-classos-self-service';
const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});

await testEnv.clearFirestore();

async function seedPending(uid, email) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid), {
      email,
      displayName: uid,
      photoURL: '',
      role: 'pending',
      status: 'pending',
      platformAccess: false,
      organizationIds: [],
      schoolIds: [],
      linkedStudentIds: [],
      guardianIds: [],
      invitationEmail: null,
      lastLoginAt: 1,
      createdAt: 1
    });
  });
}

await seedPending('teacher-self', 'teacher-self@example.com');
const teacher = testEnv.authenticatedContext('teacher-self', { email: 'teacher-self@example.com' }).firestore();
const teacherOrg = doc(collection(teacher, 'organizations'));
const teacherSchool = doc(collection(teacher, 'schools'));
const teacherBatch = writeBatch(teacher);
teacherBatch.set(teacherOrg, {
  name: 'Teacher Classes', code: 'MYCLASS', type: 'personal_workspace', status: 'active',
  ownerUid: 'teacher-self', selfService: true, createdBy: 'teacher-self', createdAt: 2, updatedAt: 2
});
teacherBatch.set(teacherSchool, {
  organizationId: teacherOrg.id, organizationName: 'Teacher Classes', name: 'My Classes', code: 'MYCLASS',
  timezone: 'America/Chicago', status: 'active', ownerUid: 'teacher-self', selfService: true,
  createdBy: 'teacher-self', createdAt: 2, updatedAt: 2
});
teacherBatch.update(doc(teacher, 'users', 'teacher-self'), {
  role: 'teacher', status: 'active', platformAccess: false,
  organizationIds: [teacherOrg.id], schoolIds: [teacherSchool.id],
  selfService: true, setupComplete: true, setupRole: 'teacher', setupAt: 2, lastLoginAt: 2
});
await assertSucceeds(teacherBatch.commit());

await seedPending('district-self', 'district-self@example.com');
const district = testEnv.authenticatedContext('district-self', { email: 'district-self@example.com' }).firestore();
const districtOrg = doc(collection(district, 'organizations'));
const districtSchool = doc(collection(district, 'schools'));
const districtBatch = writeBatch(district);
districtBatch.set(districtOrg, {
  name: 'New District', code: 'ND', type: 'district', status: 'active',
  ownerUid: 'district-self', selfService: true, createdBy: 'district-self', createdAt: 2, updatedAt: 2
});
districtBatch.set(districtSchool, {
  organizationId: districtOrg.id, organizationName: 'New District', name: 'Central High', code: 'CHS',
  timezone: 'America/Chicago', status: 'active', ownerUid: 'district-self', selfService: true,
  createdBy: 'district-self', createdAt: 2, updatedAt: 2
});
districtBatch.update(doc(district, 'users', 'district-self'), {
  role: 'district_admin', status: 'active', platformAccess: false,
  organizationIds: [districtOrg.id], schoolIds: [districtSchool.id],
  selfService: true, setupComplete: true, setupRole: 'district_admin', setupAt: 2, lastLoginAt: 2
});
await assertSucceeds(districtBatch.commit());

await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, 'organizations', 'existing-org'), {
    name: 'Existing District', type: 'district', ownerUid: 'someone-else', selfService: true, status: 'active'
  });
  await setDoc(doc(db, 'schools', 'existing-school'), {
    name: 'Existing School', organizationId: 'existing-org', ownerUid: 'someone-else', selfService: true, status: 'active'
  });
});

await seedPending('attacker', 'attacker@example.com');
const attacker = testEnv.authenticatedContext('attacker', { email: 'attacker@example.com' }).firestore();
await assertFails(setDoc(doc(attacker, 'organizations', 'bad-org'), {
  name: 'Bad', code: 'BAD', type: 'district', status: 'active',
  ownerUid: 'someone-else', selfService: true, createdBy: 'attacker'
}));

const claimBatch = writeBatch(attacker);
claimBatch.update(doc(attacker, 'users', 'attacker'), {
  role: 'district_admin', status: 'active', platformAccess: false,
  organizationIds: ['existing-org'], schoolIds: ['existing-school'],
  selfService: true, setupComplete: true, setupRole: 'district_admin', setupAt: 2, lastLoginAt: 2
});
await assertFails(claimBatch.commit());

await seedPending('invited-user', 'invited@example.com');
await testEnv.withSecurityRulesDisabled(async (context) => {
  await setDoc(doc(context.firestore(), 'invitations', 'invited@example.com'), {
    email: 'invited@example.com', role: 'teacher', status: 'active', schoolId: 'existing-school', organizationId: 'existing-org'
  });
});
const invited = testEnv.authenticatedContext('invited-user', { email: 'invited@example.com' }).firestore();
await assertFails(setDoc(doc(invited, 'organizations', 'invite-bypass'), {
  name: 'Bypass', code: 'NO', type: 'personal_workspace', status: 'active',
  ownerUid: 'invited-user', selfService: true, createdBy: 'invited-user'
}));

console.log('ClassOS self-service onboarding authorization tests passed.');
await testEnv.cleanup();
