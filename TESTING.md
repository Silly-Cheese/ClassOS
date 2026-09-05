# ClassOS Production Validation

ClassOS 1.0 uses GitHub Actions to validate both application syntax and Firestore authorization behavior.

## JavaScript validation

Every push to `main` or `phase-4-production` runs `node --check` against the core application modules, Firebase configuration, service worker, production/hardening modules, secure student-assessment module, and the Firestore rules test harness.

## Firestore validation

CI starts the Firebase Firestore emulator with the repository's current `firestore.rules` and executes `tests/firestore.rules.test.mjs`.

The regression suite currently verifies that:

- an invited guardian cannot self-link a student during profile creation;
- the same guardian can create the correctly constrained empty-link profile;
- a student cannot submit a self-assigned grade;
- a student cannot later alter grading metadata on their submission;
- a counselor cannot create an assignment grade;
- a teacher cannot mutate course roster membership;
- a teacher can still update course grade categories;
- a student can read a published assessment;
- a student cannot read a draft assessment;
- a student cannot read a protected assessment answer key;
- a student can message an appropriate same-school teacher;
- a student cannot message an arbitrary cross-school UID;
- an intervention reviewer cannot repoint an existing intervention to a different student;
- an authorized intervention status update remains permitted.

A green JavaScript syntax check alone is not sufficient for the production branch; the Firestore emulator authorization regression tests must also pass.
