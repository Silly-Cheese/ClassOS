# ClassOS

**School shouldn’t be this complicated.**

ClassOS is a web-first school operating system built as a static GitHub Pages application backed by Firebase Authentication and Cloud Firestore. Phase 1 established identity and school structure. Phase 2 added the usable LMS. Phase 3 adds the assessment, mastery, support, and intelligence layer.

## Phase 3 status

Phase 3 includes everything from Phases 1 and 2, plus:

- Secure course question banks
- Multiple-choice, true/false, and short-answer questions
- Draft/published assessments
- Student assessment attempts
- Protected assessment answer keys that student accounts cannot read
- Objective-item auto-scoring for authorized teacher/admin review
- Human scoring for short-answer items
- Standards creation and assignment mapping
- Learning Graph / standards mastery
- Assessment evidence connected to standards
- Explainable Student Pulse
- Grade, completion, attendance, and mastery factor breakdowns
- Workload collision detection for major items due in the next 7 days
- Teacher Command Center
- Student Support / intervention records
- Counselor and administrator support workflows
- Internal intervention notes hidden from student/guardian accounts
- School and District Pulse dashboards
- School-level comparisons
- Academic signal guardrails that require human review
- Role-aware Phase 3 navigation
- Phase 3 PWA caching

The Student Pulse is intentionally explainable. Its base weighting is:

- Grade: 35%
- Completion: 30%
- Attendance: 20%
- Mastery: 15%

Only factors that have actual data are included, and the remaining factors are reweighted. Workload warnings do **not** lower the academic Pulse score. Pulse is designed to focus educator attention; it is not an automated disciplinary, placement, admissions, or eligibility decision.

## Firebase project

This repository is configured for Firebase project `classos-958d3`.

### 1. Enable Authentication providers

In **Firebase Console → Authentication → Sign-in method**, enable:

1. **Google**
2. **Email/Password**

The recommended first owner sign-in is the Google account `christophershelley257@gmail.com`. Google provides Firebase with a verified email identity immediately.

Email/password users receive a verification email and must verify the address before ClassOS can activate a pre-registered role or owner access.

### 2. Add authorized domains

In **Firebase Console → Authentication → Settings → Authorized domains**, add every host that serves ClassOS. For the default GitHub Pages deployment, this normally includes:

- `silly-cheese.github.io`
- Any custom ClassOS domain added later

Firebase's default project domains should remain present.

### 3. Create Cloud Firestore

Create the Firestore database in Firebase Console.

ClassOS Phase 3 still does **not** require Firebase Storage or Cloud Functions. Student file work can continue through external links, and secure assessment keys remain in Firestore collections that only authorized educators can read.

### 4. Deploy Firestore rules

The production rules live in `firestore.rules`.

With the Firebase CLI installed and authenticated:

```bash
firebase deploy --only firestore:rules
```

Phase 3 intentionally uses single-field Firestore queries for its core workflows and does not require a composite-index file.

### 5. Enable GitHub Pages

In **GitHub → Settings → Pages**, publish from the `main` branch and repository root.

The PWA service worker caches the Phase 3 application shell, including `src/lms.js`, `src/intelligence.js`, `assets/lms.css`, and `assets/intelligence.css`.

## Owner bootstrap

The Platform Owner is not selected from a signup dropdown. Both the application and Firestore rules recognize the verified Firebase Authentication identity with this exact email:

`christophershelley257@gmail.com`

On verified owner sign-in, ClassOS maintains the platform configuration and enables the Phase 3 feature flags.

## User provisioning

The Platform Owner can pre-register an exact email address, role, and optional school. The user then signs in independently with Google or email/password.

Firestore rules allow the role claim only when Firebase reports that the matching address is verified. Users who sign up without pre-registered access remain pending and cannot self-promote.

## Recommended setup workflow

1. Create an organization.
2. Add a school.
3. Pre-register teacher, student, guardian, counselor, and administrator accounts.
4. Have those users sign in and activate their accounts.
5. Create a course and assign its roster.
6. Configure grade categories.
7. Create assignments and mark attendance.
8. Add course standards in **Learning Graph**.
9. Map assignments to standards.
10. Build reusable questions in **Assessments**.
11. Create and publish an assessment.
12. Students submit attempts.
13. Teachers review attempts; objective items are automatically pre-scored from the protected key while short answers receive human scoring.
14. Review the **Teacher Command Center**, **Student Support**, and **District Pulse** views as data accumulates.

## Firestore model

Platform collections:

- `users`
- `invitations`
- `organizations`
- `schools`
- `courses`
- `featureFlags`
- `auditLogs`
- `system`

Phase 2 LMS collections:

- `assignments`
- `submissions`
- `attendanceRecords`
- `announcements`
- `messages`

Phase 3 collections:

- `standards`
- `questionBank`
- `assessments`
- `assessmentKeys`
- `assessmentAttempts`
- `interventions`

Grade categories are stored on the related course document. Course membership is stored through `teacherIds` and `studentIds` on the course. Assignment-to-standard links are stored in `standardIds` on assignments. Assessment documents contain student-safe question snapshots; answer keys are stored separately in `assessmentKeys`.

## Assessment security model

ClassOS does not place correct answers inside assessment documents that students can read.

The reusable `questionBank` and `assessmentKeys` collections are restricted to authorized educators. Published `assessments` contain only question prompts, options, points, and standard mappings. Students submit answers into `assessmentAttempts`. When an authorized reviewer opens an attempt, ClassOS reads the protected key and pre-scores objective items in the reviewer session. Short-answer scoring remains manual.

This design keeps answer keys out of student browser access without adding Cloud Functions.

## Student Pulse model

Pulse uses existing academic evidence and always exposes its contributing factors. The status bands are:

- **On track:** 80–100
- **Watch:** 65–79
- **Attention:** below 65
- **Not enough data:** no usable evidence yet

ClassOS also lists specific reasons such as multiple missing assignments, low course averages, recent unexcused absences, weak standards mastery, or workload collisions. Workload is an alert only and is not included in the Pulse score.

## Security model

Firestore rules enforce access rather than relying only on hidden browser controls.

Students can read published assessments for their own courses and create only their own attempts. Students cannot read the question bank or answer-key collection. Teachers manage Phase 3 course records only for courses where they are rostered. Counselors and administrators receive school-scoped review/support access. Guardians can read linked-student academic evidence but cannot read internal intervention records. The Platform Owner remains protected by the verified bootstrap email at the rules layer.

## Development architecture

ClassOS remains framework-free for rapid generation and deployment:

- HTML
- CSS
- JavaScript ES modules
- Firebase Web SDK CDN modules
- Firebase Authentication
- Cloud Firestore
- GitHub Pages

There is no frontend build pipeline required to deploy the current application. GitHub Actions performs JavaScript syntax validation on the core shell, LMS module, intelligence module, Firebase config, and service worker.

## Next phase

Phase 4 is the production-readiness pass: global search, notification polish, accessibility, UI consistency, imports/exports, school-year and term management, archival workflows, additional validation, support tools, performance cleanup, onboarding, and final deployment polish.
