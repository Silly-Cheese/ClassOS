# ClassOS

**School shouldn’t be this complicated.**

ClassOS is a web-first school operating system built as a static GitHub Pages application backed by Firebase Authentication and Cloud Firestore. Phase 1 established identity, permissions, organizations, schools, and courses. Phase 2 adds the usable LMS layer.

## Phase 2 status

Phase 2 includes:

- Google sign-in
- Email/password signup and login
- Verified-email role activation
- Automatic Platform Owner bootstrap for `christophershelley257@gmail.com`
- Organizations, schools, users, roles, and course shells
- Course roster management for teachers and students
- Assignments with categories, due dates, points, instructions, draft/published status, and submission type
- Student text/link submissions without Firebase Storage
- Late and missing-work handling
- Teacher grading queue
- Scores and written feedback
- Weighted grade categories
- Student gradebook
- Student grade sandbox for hypothetical scores
- Teacher/admin gradebook views
- Attendance with present, absent, tardy, and excused statuses
- Student attendance history
- Absent Mode recovery view
- Course announcements
- Unified assignment calendar / planner
- Contextual ClassOS inbox and direct messaging
- Parent/guardian Family View
- Guardian-to-student account linking
- Role-aware dashboards and navigation
- Platform feature flags
- Audit-log foundation
- Responsive desktop/mobile interface
- PWA manifest and service worker
- Firestore Security Rules for all Phase 2 collections
- GitHub Pages-compatible architecture
- GitHub Actions JavaScript syntax validation

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

ClassOS Phase 2 still does **not** require Firebase Storage or Cloud Functions. Student submissions currently use typed responses and/or external links so the system remains compatible with the no-paid-backend architecture.

### 4. Deploy Firestore rules

The production rules live in `firestore.rules`.

With Firebase CLI installed and authenticated:

```bash
firebase deploy --only firestore:rules
```

Phase 2 intentionally uses simple Firestore queries and does not require a composite-index file for its core flows.

### 5. Enable GitHub Pages

In **GitHub → Settings → Pages**, publish from the `main` branch and repository root.

The PWA service worker caches the Phase 2 application shell, including `src/lms.js` and `assets/lms.css`.

## Owner bootstrap

The Platform Owner is not selected from a signup dropdown. Both the application and Firestore rules recognize the verified Firebase Authentication identity with this exact email:

`christophershelley257@gmail.com`

On verified owner sign-in, ClassOS maintains the platform configuration and creates Phase 2 feature flags where needed.

## User provisioning

The Platform Owner can pre-register an exact email address, role, and optional school. The user then signs in independently with Google or email/password.

Firestore rules allow the role claim only when Firebase reports that the matching address is verified. Users who sign up without pre-registered access remain in a pending state and cannot self-promote.

## Course workflow

A normal first setup is:

1. Create an organization.
2. Add a school.
3. Pre-register teacher, student, guardian, and/or administrator accounts.
4. Have those users sign in and complete account activation.
5. Create a course.
6. Open the course and use **Roster** to assign teachers and students.
7. Configure grade categories if weighted grading is desired.
8. Create assignments and announcements.
9. Teachers mark attendance and grade submissions.
10. Link guardian accounts to student accounts from **People & Access** when Family View is needed.

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

Grade categories are stored on the related course document. Course membership is stored through `teacherIds` and `studentIds` on the course.

## Security model

Firestore rules enforce the LMS permissions rather than relying only on hidden buttons in the browser.

Students can read course content for courses available to them and can create/update only their own submissions. Teachers can manage instructional data only for courses where they are rostered as teachers. School/district administrators receive school-scoped management access. Guardians can read academic data only for students linked to their guardian profile. The Platform Owner is protected by the verified bootstrap email at the security-rule layer.

## Development architecture

ClassOS remains framework-free for rapid generation and deployment:

- HTML
- CSS
- JavaScript ES modules
- Firebase Web SDK CDN modules
- Firebase Authentication
- Cloud Firestore
- GitHub Pages

There is no frontend build pipeline required to deploy the current application.

## Next phase

Phase 3 is intended to add the features that make ClassOS meaningfully different from a conventional LMS: assessments, question banks, standards, Learning Graph/mastery, Student Pulse, workload intelligence, interventions, counselor tools, advanced analytics, Teacher Command Center, and District Pulse.
