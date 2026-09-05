# ClassOS

**School shouldn’t be this complicated.**

ClassOS is a web-first school operating system. Phase 1 establishes the secure platform foundation that the LMS features will build on.

## Phase 1 includes

- Google sign-in with Firebase Authentication
- Email/password signup and login
- Email verification before privileged role activation
- Password reset
- Automatic Platform Owner bootstrap for `christophershelley257@gmail.com`
- Role model for Platform Owner, District Admin, School Admin, Counselor, Teacher, Staff, Parent/Guardian, and Student
- Safe email-based role pre-registration without Cloud Functions or the Admin SDK
- Organizations / districts
- Schools
- Course shells
- Platform Owner console
- Feature flags
- Client audit events
- Responsive web interface
- PWA manifest and service worker
- Firestore Security Rules
- GitHub Pages-compatible static architecture

## Firebase project

This repository is configured for Firebase project `classos-958d3`.

### 1. Enable Authentication providers

In **Firebase Console → Authentication → Sign-in method**, enable:

1. **Google**
2. **Email/Password**

For the owner bootstrap, the safest first sign-in is the Google account `christophershelley257@gmail.com`. Google supplies a verified email identity immediately.

Email/password users receive a verification email and must verify the address before ClassOS can activate a pre-registered role or owner access.

### 2. Add authorized domains

In **Firebase Console → Authentication → Settings → Authorized domains**, add every host that will serve ClassOS. For the default GitHub Pages deployment, this normally includes:

- `silly-cheese.github.io`
- Any custom domain later connected to ClassOS

Firebase's own default project domains should remain present.

### 3. Create Cloud Firestore

Create the Firestore database in the Firebase Console. ClassOS uses Firestore only; Phase 1 does not require Firebase Storage or Cloud Functions.

### 4. Deploy Firestore rules

The production rules live in `firestore.rules`.

With the Firebase CLI installed and authenticated:

```bash
firebase deploy --only firestore:rules
```

No composite index file is required for the Phase 1 queries.

### 5. Enable GitHub Pages

In **GitHub → Settings → Pages**, publish from the `main` branch and repository root.

The site will then be available from the repository's GitHub Pages URL unless a custom domain is configured.

## Owner bootstrap

The owner is not selected from a client-side dropdown and cannot be assigned by another user. Both the application and Firestore rules recognize the verified Firebase Authentication identity with this exact email:

`christophershelley257@gmail.com`

On the owner's first verified sign-in, ClassOS creates the owner profile, platform configuration, and initial feature flags.

## User provisioning without paid backend services

ClassOS Phase 1 avoids Cloud Functions and the Firebase Admin SDK.

The Platform Owner can pre-register an exact email address, role, and optional school. The user then signs in independently with Google or email/password. Firestore rules allow the role claim only when Firebase reports that the same email is verified.

This prevents a user from editing the browser code or their own Firestore profile to grant themselves an administrative role.

## Firestore model

Primary collections:

- `users`
- `invitations`
- `organizations`
- `schools`
- `courses`
- `featureFlags`
- `auditLogs`
- `system`

Phase 2 can add assignments, submissions, gradebook data, attendance, calendars, and instructional workflows to this structure without replacing Phase 1 identity or school records.

## Development notes

The frontend is intentionally framework-free in Phase 1: plain HTML, CSS, JavaScript modules, Firebase Web SDK CDN imports, and Firestore. That keeps GitHub Pages hosting simple and avoids a build pipeline while the product is still being generated rapidly.
