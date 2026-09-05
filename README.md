# ClassOS

**School shouldn’t be this complicated.**

ClassOS is a web-first school operating system built as a static GitHub Pages application backed by Firebase Authentication and Cloud Firestore. Phases 1–4 now form the ClassOS 1.0 foundation: identity and school structure, a usable LMS, mastery/intelligence workflows, and production operations/hardening.

## ClassOS 1.0 includes

### Identity and platform structure

- Google sign-in
- Email/password signup and login
- Email verification before invited role activation
- Automatic Platform Owner bootstrap for `christophershelley257@gmail.com`
- Platform Owner, District Admin, School Admin, Counselor, Teacher, Staff, Guardian, and Student roles
- Organizations / districts
- Schools
- Course shells and administrator-controlled rosters
- Secure exact-email access pre-registration
- Platform feature flags
- Append-only client audit events

### Core LMS

- Role-aware dashboards
- Assignments, categories, due dates, points, drafts/publishing, instructions, and submission types
- Student text/link submissions
- Late and missing-work handling
- Teacher grading queue
- Scores and written feedback
- Weighted gradebook
- Student Grade Sandbox
- Attendance: present, absent, tardy, excused
- Absent Mode
- Course announcements
- Planner / calendar
- Contextual ClassOS inbox
- Guardian Family View
- Guardian/student linking

### Assessment and mastery

- Secure question banks
- Multiple choice, true/false, and short answer
- Draft/published assessments
- Protected assessment answer keys
- Student-safe published assessment snapshots
- Secure student assessment delivery
- Objective-item score suggestions for authorized reviewers
- Human scoring for short answer
- Course standards
- Assignment-to-standard mapping
- Assessment evidence connected to standards
- Learning Graph / mastery view

### Explainable intelligence

- Student Pulse
- Grade, completion, attendance, and mastery factor breakdowns
- Workload collision detection
- Teacher Command Center
- Student Support / intervention records
- Counselor and administrator workflows
- District Pulse
- School-level comparisons
- Human-review guardrails around academic signals

The base Student Pulse weights are:

- Grade: 35%
- Completion: 30%
- Attendance: 20%
- Mastery: 15%

Only factors with actual evidence are included, and remaining factors are reweighted. Workload warnings do not lower the Pulse score. Pulse is a review/prioritization aid, not an automated disciplinary, placement, admissions, or eligibility decision.

### Phase 4 production operations

- Global role-aware search (`Ctrl/⌘ K`)
- Derived notification center
- Academic term / school-year lifecycle
- Course archiving and restoration
- Safe course-shell duplication with an empty roster
- JSON data exports
- CSV course-roster exports
- Owner-only CSV access pre-registration
- Platform branding controls
- Light, dark, and system appearance modes
- Comfortable / compact density
- Reduced-motion support
- Keyboard focus visibility and skip-to-content navigation
- PWA cache/version refresh for ClassOS 1.0
- GitHub Actions JavaScript validation
- Firestore emulator rule-compilation validation

## Production hardening

Phase 4 included a full pass through the Phase 1–3 authorization model rather than only adding new features.

The hardened rules now include, among other protections:

- invited/pending accounts cannot choose their own school, role, guardian links, or student links;
- guardian link arrays must begin empty and are administrator-managed;
- teachers cannot appoint/remove course teachers or alter rosters in ClassOS 1.0;
- counselors cannot write assignment grades simply because they can review academic/support data;
- record identity fields cannot be repointed to a different course/student/school during an update;
- students cannot write grading metadata into their own submissions or assessment attempts;
- assessment answer keys remain educator-only;
- student assessment queries request published assessments explicitly;
- direct messages are restricted to authorized, in-scope recipients;
- intervention subject/course/school identity is preserved after creation;
- unsafe submission-link protocols are rejected;
- audit entries must match the authenticated actor and Firestore request timestamp.

See [`SECURITY.md`](SECURITY.md) for the security model and documented client-only architecture boundaries.

## Firebase project

This repository is configured for Firebase project `classos-958d3`.

### 1. Enable Authentication

In **Firebase Console → Authentication → Sign-in method**, enable:

1. **Google**
2. **Email/Password**

The recommended first owner sign-in is the Google account `christophershelley257@gmail.com`. Google provides Firebase with a verified email identity immediately.

Email/password users receive a verification email and must verify the address before ClassOS can activate a pre-registered role or owner access.

### 2. Configure authorized domains

In **Firebase Console → Authentication → Settings → Authorized domains**, add every host that serves ClassOS. For the default GitHub Pages deployment this normally includes:

- `silly-cheese.github.io`
- any later custom ClassOS domain

Keep Firebase's default project domains present.

### 3. Create Cloud Firestore

Create the Firestore database in Firebase Console.

ClassOS 1.0 does **not** require Firebase Storage or Cloud Functions. Student file work can use external links; downloadable exports are generated locally in the browser.

### 4. Deploy Firestore rules

The production rules live in `firestore.rules`.

With the Firebase CLI installed and authenticated:

```bash
firebase deploy --only firestore:rules
```

This deployment step is required after pulling/merging the ClassOS 1.0 rule changes.

### 5. Enable GitHub Pages

In **GitHub → Settings → Pages**, publish from the `main` branch and repository root.

The service worker caches the ClassOS 1.0 application shell, including the LMS, intelligence, production, hardening, and secure student-assessment modules.

## Recommended first setup

1. Sign in as the Platform Owner.
2. Create an organization.
3. Add a school.
4. Pre-register administrator, teacher, student, guardian, counselor, and staff emails as appropriate.
5. Have users sign in and verify/activate their accounts.
6. Create a term in **Operations**.
7. Create a course and have an administrator build its roster.
8. Configure grade categories.
9. Create assignments and announcements.
10. Add standards in **Learning Graph**.
11. Build question-bank items and publish an assessment.
12. Test with a student account: submission, attendance, gradebook, Absent Mode, and assessment attempt.
13. Test with a teacher account: grading, assessment review, Command Center, and course-linked support.
14. Test with a guardian account after administrator linking.
15. Review District Pulse / Operations with an administrator account.

## Firestore model

Platform and identity collections:

- `users`
- `invitations`
- `organizations`
- `schools`
- `terms`
- `courses`
- `platformConfig`
- `featureFlags`
- `auditLogs`
- `system`

LMS collections:

- `assignments`
- `submissions`
- `attendanceRecords`
- `announcements`
- `messages`

Assessment/intelligence collections:

- `standards`
- `questionBank`
- `assessments`
- `assessmentKeys`
- `assessmentAttempts`
- `interventions`

Grade categories are stored on course documents. Course membership uses `teacherIds` and `studentIds`. Assignment-to-standard links use `standardIds`. Correct assessment answers are stored separately from student-readable assessment documents.

## Architecture

ClassOS remains intentionally simple to host:

- HTML
- CSS
- JavaScript ES modules
- Firebase Web SDK CDN modules
- Firebase Authentication
- Cloud Firestore
- GitHub Pages

There is no frontend compilation/build step required to serve the application.

## Validation

`.github/workflows/validate.yml` validates all JavaScript modules with Node and starts the Firestore emulator so the security rules must compile successfully.

## Security and institutional deployment

Read [`SECURITY.md`](SECURITY.md) before deploying ClassOS with real student information. The current application is a client-only Firebase architecture; security rules are the real authorization perimeter, and technical controls are only one part of a school's privacy/compliance responsibilities.
