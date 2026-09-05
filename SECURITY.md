# ClassOS Security Model

ClassOS is a static GitHub Pages application backed by Firebase Authentication and Cloud Firestore. Security decisions are enforced in `firestore.rules`; hiding a button in the browser is never treated as authorization.

## Identity and owner bootstrap

- Google and email/password identities are provided by Firebase Authentication.
- Email/password users must verify their email before an invited role is activated.
- The Platform Owner is the verified Firebase identity for `christophershelley257@gmail.com`.
- New non-owner profiles cannot choose their own role, school, organization, guardian links, or student links.
- Invited and pending profiles must begin with empty `linkedStudentIds` and `guardianIds` arrays.
- A user cannot promote a pending account by editing Firestore directly; an active invitation for the same verified email is required.

## Authorization boundaries

### Platform Owner

The Platform Owner can administer the complete ClassOS Firestore data model and platform configuration. Owner authorization is re-checked in Firestore rules from the verified authentication token.

### District and school administrators

Administrators are scoped to their assigned schools. In ClassOS 1.0, administrators control course membership, guardian/student links, academic terms, and other school-level lifecycle operations.

### Teachers

Teachers may manage instructional data only in courses where their UID is already rostered as a teacher. Teachers may create coursework, grade work, take attendance, post announcements, manage grade categories, create assessment content, and create course-connected intervention records. Course roster membership itself is administrator-controlled in ClassOS 1.0.

### Counselors

Counselors can review school-scoped academic and support information needed for intervention workflows. They are not permitted to write assignment grades simply because they can review a student's records.

### Students

Students can submit only their own assignment work and assessment attempts for courses in which they are rostered. Submission identity fields cannot be changed after creation. Assessment attempts cannot contain a self-assigned score, grading metadata, or item results.

### Guardians

Guardian access depends on administrator-created links. A guardian cannot place student IDs into their own initial profile. Guardian academic reads are restricted to linked students.

## Assessments and answer keys

Correct answers are never stored in the published assessment document delivered to students.

- `questionBank` is educator-only.
- `assessmentKeys` is educator/reviewer-only.
- Published `assessments` contain student-safe question snapshots.
- Student assessment queries explicitly request `status == "published"`.
- Student attempts preserve their original student, course, school, assessment, and answer fields during educator grading.

## Record integrity hardening

ClassOS 1.0 treats routing and identity fields as immutable after a record is created. Security rules prevent authorized users from repointing an existing record to a different course, school, student, assignment, or assessment while performing an otherwise-valid update.

This protection applies to the core LMS and intelligence records, including submissions, attendance, announcements, standards, question-bank items, assessments, answer keys, assessment attempts, and interventions.

## Messaging

ClassOS direct messages are one-recipient messages in the current release. Firestore validates the recipient instead of trusting a client-supplied UID.

- Platform Owner: may message active ClassOS identities.
- School staff/educators: same-school messaging is permitted.
- Student/guardian accounts: may message appropriate same-school staff/educators; peer messaging is not enabled by the production rules.
- A recipient can mark a message read but cannot rewrite its sender, recipients, subject, or body.

## External links and HTML

User-controlled strings are escaped before being inserted into generated interface markup. ClassOS 1.0 additionally:

- rejects assignment submission links that are not `http://` or `https://`;
- blocks unsafe link protocols at click time;
- applies `noopener noreferrer` to links opened in a new tab;
- does not use `eval`, `new Function`, or `document.write`.

## Audit logs

Clients may append audit records only for their own authenticated UID/email and only while their ClassOS profile is active. The log timestamp must be the Firestore request timestamp. Clients cannot update or delete existing audit records; the Platform Owner retains administrative read access.

Audit events are useful for operational traceability, but a browser-originated audit trail is not a substitute for a server-side compliance/audit system.

## Validation

The repository validation workflow checks JavaScript syntax and starts the Firestore emulator so that `firestore.rules` must compile before the validation job succeeds.

## Current architecture boundaries

ClassOS 1.0 intentionally remains a client-only Firebase application so it can be hosted on GitHub Pages without Cloud Functions or a custom server. That creates a few deliberate boundaries:

1. **Firestore rules are the real security perimeter.** Any client-side check can be bypassed, so sensitive authorization must remain duplicated in rules.
2. **Course documents are readable to active users assigned to the same school in the current data model.** Course documents contain roster UID arrays. User-profile rules still restrict which of those UIDs can be resolved to profile information, but a stricter district deployment may prefer membership subcollections or server-issued custom claims.
3. **Assignment drafts are course-readable in the current Phase 2 data model.** The normal student UI does not surface drafts, but a technically sophisticated enrolled student could inspect Firestore and discover draft assignment metadata. Eliminating that residual visibility requires changing the Phase 2 assignment query/model so security rules can require published status without breaking legitimate collection queries.
4. **Client-generated exports are controlled by the browser.** Users should protect downloaded JSON/CSV files according to school policy.
5. **No client-only design should be represented as a complete FERPA/COPPA/compliance program.** Production district use also requires administrative policies, retention rules, agreements, access reviews, incident handling, and legal/compliance review appropriate to the deployment.

These boundaries are documented rather than hidden so future ClassOS versions can migrate them deliberately if stricter institutional isolation is required.

## Firebase configuration

The Firebase Web API key in `src/firebase.js` is a public client configuration value, not a server secret. Actual access is controlled by Firebase Authentication and Firestore Security Rules. Private service-account credentials, Admin SDK keys, passwords, or other server secrets must never be committed to this repository.

## Reporting a security issue

Do not post authentication tokens, student data, passwords, or other sensitive records in a public GitHub issue. Reproduce issues with non-sensitive test data and provide only the minimum information necessary to identify the affected path or rule.
