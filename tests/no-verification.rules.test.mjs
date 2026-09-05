import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const projectId = 'demo-classos-no-verification';
const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});

await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, 'organizations', 'org1'), { name: 'District One' });
  await setDoc(doc(db, 'schools', 'school1'), { name: 'School One', organizationId: 'org1' });
  await setDoc(doc(db, 'invitations', 'guardian@example.com'), {
    email: 'guardian@example.com', role: 'guardian', status: 'active', schoolId: 'school1', organizationId: 'org1'
  });
});

const invited = testEnv.authenticatedContext('guardian-no-verify', {
  email: 'guardian@example.com', email_verified: false
}).firestore();

await assertSucceeds(setDoc(doc(invited, 'users', 'guardian-no-verify'), {
  email: 'guardian@example.com',
  displayName: 'Guardian',
  role: 'guardian',
  status: 'active',
  platformAccess: false,
  organizationIds: ['org1'],
  schoolIds: ['school1'],
  linkedStudentIds: [],
  guardianIds: []
}));

const owner = testEnv.authenticatedContext('owner-no-verify', {
  email: 'christophershelley257@gmail.com', email_verified: false
}).firestore();

await assertSucceeds(setDoc(doc(owner, 'users', 'owner-no-verify'), {
  email: 'christophershelley257@gmail.com',
  displayName: 'Owner',
  role: 'platform_owner',
  status: 'active',
  platformAccess: true,
  organizationIds: [],
  schoolIds: [],
  linkedStudentIds: [],
  guardianIds: []
}));
await assertSucceeds(setDoc(doc(owner, 'system', 'config'), { noVerification: true }, { merge: true }));

console.log('ClassOS no-verification authorization tests passed.');
await testEnv.cleanup();
