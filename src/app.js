import { auth, db, googleProvider, OWNER_EMAIL } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const authView = $("auth-view");
const appView = $("app-view");
const pageContent = $("page-content");
const pageTitle = $("page-title");
const workspaceKicker = $("workspace-kicker");
const OWNER_ROLE = "platform_owner";
const VALID_ROLES = ["student", "teacher", "guardian", "staff", "counselor", "school_admin", "district_admin"];

const state = {
  authMode: "signin",
  user: null,
  profile: null,
  route: "dashboard",
  organizations: [],
  schools: [],
  courses: [],
  users: [],
  invitations: [],
  flags: []
};

const roleLabels = {
  platform_owner: "Platform Owner",
  district_admin: "District Admin",
  school_admin: "School Admin",
  counselor: "Counselor",
  teacher: "Teacher",
  staff: "Staff",
  guardian: "Parent / Guardian",
  student: "Student",
  pending: "Pending Access"
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function safeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function formatRole(role) {
  return roleLabels[role] || String(role || "Member").replaceAll("_", " ");
}

function formatDate(value) {
  if (!value) return "—";
  const date = value instanceof Timestamp ? value.toDate() : value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function initials(name = "User") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

function toast(message, type = "") {
  const node = document.createElement("div");
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  $("toast-region").appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function setBusy(button, busy, label = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
  }
}

function authErrorMessage(error) {
  const code = error?.code || "";
  const map = {
    "auth/invalid-credential": "That email/password combination was not recognized.",
    "auth/email-already-in-use": "An account already exists with that email address.",
    "auth/weak-password": "Use a stronger password with at least 6 characters.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
    "auth/popup-blocked": "Your browser blocked the Google sign-in window.",
    "auth/too-many-requests": "Too many attempts were made. Try again shortly.",
    "auth/network-request-failed": "ClassOS could not reach Firebase. Check your connection."
  };
  return map[code] || error?.message || "Something went wrong. Please try again.";
}

function openModal(title, body, kicker = "CLASSOS") {
  $("modal-title").textContent = title;
  $("modal-kicker").textContent = kicker;
  $("modal-body").innerHTML = body;
  $("modal").classList.remove("hidden");
}

function closeModal() {
  $("modal").classList.add("hidden");
  $("modal-body").innerHTML = "";
}

function isOwner() {
  return state.profile?.role === OWNER_ROLE && safeEmail(state.user?.email) === OWNER_EMAIL;
}

async function audit(action, targetType = "system", targetId = null, details = {}) {
  if (!state.user) return;
  try {
    await addDoc(collection(db, "auditLogs"), {
      actorUid: state.user.uid,
      actorEmail: state.user.email || "",
      action,
      targetType,
      targetId,
      details,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Audit log write failed", error);
  }
}

async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snapshot = await getDoc(ref);
  const email = safeEmail(user.email);
  const base = {
    email,
    displayName: user.displayName || email.split("@")[0],
    photoURL: user.photoURL || "",
    lastLoginAt: serverTimestamp()
  };

  if (email === OWNER_EMAIL) {
    await setDoc(ref, {
      ...base,
      role: OWNER_ROLE,
      status: "active",
      platformAccess: true,
      organizationIds: [],
      schoolIds: [],
      bootstrapOwner: true,
      ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() })
    }, { merge: true });
    await bootstrapPlatform(user.uid);
  } else if (!snapshot.exists()) {
    const inviteRef = doc(db, "invitations", email);
    const invite = await getDoc(inviteRef);
    const invited = invite.exists() && invite.data()?.status === "active" ? invite.data() : null;
    await setDoc(ref, {
      ...base,
      role: invited?.role || "pending",
      status: invited ? "active" : "pending",
      platformAccess: false,
      organizationIds: invited?.organizationId ? [invited.organizationId] : [],
      schoolIds: invited?.schoolId ? [invited.schoolId] : [],
      invitationEmail: invited ? email : null,
      createdAt: serverTimestamp()
    });
  } else {
    await setDoc(ref, base, { merge: true });
  }

  const fresh = await getDoc(ref);
  return { id: fresh.id, ...fresh.data() };
}

async function bootstrapPlatform(uid) {
  const configRef = doc(db, "system", "config");
  const config = await getDoc(configRef);
  if (!config.exists()) {
    await setDoc(configRef, {
      productName: "ClassOS",
      environment: "production",
      ownerUid: uid,
      ownerEmail: OWNER_EMAIL,
      version: "0.1.0-phase1",
      setupComplete: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    const defaultFlags = [
      ["core_lms", true, "Core LMS foundation"],
      ["assessments", false, "Assessment engine"],
      ["mastery", false, "Learning Graph and mastery"],
      ["student_pulse", false, "Explainable student pulse"],
      ["district_pulse", false, "District-level intelligence"],
      ["family_portal", false, "Parent and guardian experience"]
    ];
    for (const [key, enabled, description] of defaultFlags) {
      await setDoc(doc(db, "featureFlags", key), {
        key, enabled, description, updatedBy: uid, updatedAt: serverTimestamp()
      });
    }
  }
}

async function loadCollection(name, constraints = []) {
  const ref = constraints.length ? query(collection(db, name), ...constraints) : collection(db, name);
  const snapshot = await getDocs(ref);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function refreshOwnerData() {
  if (!isOwner()) return;
  const results = await Promise.all([
    loadCollection("organizations"),
    loadCollection("schools"),
    loadCollection("courses"),
    loadCollection("users"),
    loadCollection("invitations"),
    loadCollection("featureFlags")
  ]);
  [state.organizations, state.schools, state.courses, state.users, state.invitations, state.flags] = results;
}

async function refreshMemberData() {
  if (!state.profile || isOwner()) return;
  const schoolIds = state.profile.schoolIds || [];
  const organizationIds = state.profile.organizationIds || [];
  state.schools = [];
  state.organizations = [];
  state.courses = [];
  for (const id of schoolIds.slice(0, 10)) {
    const snap = await getDoc(doc(db, "schools", id));
    if (snap.exists()) state.schools.push({ id: snap.id, ...snap.data() });
  }
  for (const id of organizationIds.slice(0, 10)) {
    const snap = await getDoc(doc(db, "organizations", id));
    if (snap.exists()) state.organizations.push({ id: snap.id, ...snap.data() });
  }
  if (schoolIds.length) {
    const snaps = await getDocs(query(collection(db, "courses"), where("schoolId", "in", schoolIds.slice(0, 10))));
    state.courses = snaps.docs.map((item) => ({ id: item.id, ...item.data() }));
  }
}

function updateAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === "signup";
  $("name-field").classList.toggle("hidden", !signup);
  $("auth-title").textContent = signup ? "Create your ClassOS account" : "Sign in to ClassOS";
  $("auth-subtitle").textContent = signup ? "Create an account with email or continue with Google." : "Use your ClassOS account or continue with Google.";
  $("auth-submit").textContent = signup ? "Create account" : "Sign in";
  $("auth-switch-copy").textContent = signup ? "Already have an account?" : "New to ClassOS?";
  $("auth-switch").textContent = signup ? "Sign in" : "Create account";
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("forgot-password").classList.toggle("hidden", signup);
}

async function handleEmailAuth(event) {
  event.preventDefault();
  const submit = $("auth-submit");
  const email = safeEmail($("email").value);
  const password = $("password").value;
  const displayName = $("display-name").value.trim();
  if (!email || !password || (state.authMode === "signup" && !displayName)) {
    toast("Complete all required fields.", "error");
    return;
  }
  setBusy(submit, true, state.authMode === "signup" ? "Creating account…" : "Signing in…");
  try {
    if (state.authMode === "signup") {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(result.user, { displayName });
      toast("Your ClassOS account was created.", "success");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    toast(authErrorMessage(error), "error");
  } finally {
    setBusy(submit, false);
  }
}

async function handleGoogleAuth() {
  const button = $("google-auth");
  setBusy(button, true, "Opening Google…");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    toast(authErrorMessage(error), "error");
  } finally {
    setBusy(button, false);
  }
}

async function handlePasswordReset() {
  const email = safeEmail($("email").value);
  if (!email) {
    toast("Enter your email address first.", "error");
    $("email").focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    toast("Password reset email sent.", "success");
  } catch (error) {
    toast(authErrorMessage(error), "error");
  }
}

function applyProfileToShell() {
  const name = state.profile?.displayName || state.user?.displayName || state.user?.email || "User";
  $("mini-name").textContent = name;
  $("mini-role").textContent = formatRole(state.profile?.role);
  $("mini-avatar").innerHTML = state.profile?.photoURL
    ? `<img src="${escapeHtml(state.profile.photoURL)}" alt="" referrerpolicy="no-referrer">`
    : escapeHtml(initials(name));
  document.querySelectorAll(".owner-only").forEach((node) => node.classList.toggle("hidden", !isOwner()));
}

function metric(label, value, note, pill = "") {
  return `<article class="card metric"><div class="metric-top"><span>${escapeHtml(label)}</span>${pill}</div><div class="metric-value">${escapeHtml(value)}</div><div class="metric-note">${escapeHtml(note)}</div></article>`;
}

function pendingAccessView() {
  return `<section class="hero"><span class="eyebrow">ACCOUNT CREATED</span><h1>You’re in ClassOS.</h1><p>Your sign-in works, but this email has not yet been assigned to a school or ClassOS role. An administrator can pre-register your email from the People area.</p></section>
  <section class="section grid grid-2"><div class="card"><span class="eyebrow">YOUR ACCOUNT</span><h3>${escapeHtml(state.profile.displayName)}</h3><p class="metric-note">${escapeHtml(state.profile.email)}</p><div style="margin-top:16px"><span class="pill warning">Pending access</span></div></div><div class="card"><span class="eyebrow">WHAT HAPPENS NEXT</span><h3>Nothing else to set up</h3><p class="metric-note" style="line-height:1.65">Once your email is assigned a role, sign out and back in. ClassOS will load the workspace and permissions connected to your account.</p></div></section>`;
}

function dashboardView() {
  if (state.profile?.status === "pending") return pendingAccessView();
  const firstName = (state.profile?.displayName || "there").split(" ")[0];
  if (isOwner()) {
    const activeUsers = state.users.filter((u) => u.status === "active").length;
    return `<section class="hero"><span class="eyebrow">PLATFORM OWNER</span><h1>Good to see you, ${escapeHtml(firstName)}.</h1><p>ClassOS Phase 1 is live. The identity, organization, school, course, permissions, invitation, and platform-control foundations are ready for the LMS layer.</p><div class="hero-actions"><button class="btn btn-primary" data-action="new-organization">Create organization</button><button class="btn btn-secondary" data-route-jump="people">Invite a user</button></div></section>
    <section class="section grid grid-4">${metric("Organizations", state.organizations.length, "Districts and independent schools")}${metric("Schools", state.schools.length, "Active ClassOS campuses")}${metric("Courses", state.courses.length, "Course shells created")}${metric("Active users", activeUsers, `${state.invitations.length} invitations pre-registered`)}</section>
    <section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">FOUNDATION STATUS</span><h3>Phase 1 systems</h3></div><span class="pill success">Operational</span></div><div class="list">${[
      ["Authentication", "Google + email/password", "success"],
      ["Owner bootstrap", OWNER_EMAIL, "success"],
      ["Role security", "Firestore rules + invitation claims", "success"],
      ["School structure", "Organizations → schools → courses", "success"]
    ].map(([a,b,c]) => `<div class="list-row"><div class="list-main"><strong>${a}</strong><span>${escapeHtml(b)}</span></div><span class="pill ${c}">Ready</span></div>`).join("")}</div></div>
    <div class="card"><div class="section-head"><div><span class="eyebrow">NEXT LAYER</span><h3>Phase 2 readiness</h3></div></div><div class="callout info"><strong>The foundation is intentionally separate from instructional data.</strong><br>Assignments, submissions, gradebooks, attendance, calendars, and student workflows can now attach cleanly to the course and identity model built here.</div><div style="margin-top:18px" class="list"><div class="list-row"><div class="list-main"><strong>Core LMS feature flag</strong><span>Controls rollout of instructional modules.</span></div><span class="pill ${state.flags.find(f=>f.key==='core_lms')?.enabled ? 'success' : 'warning'}">${state.flags.find(f=>f.key==='core_lms')?.enabled ? 'Enabled' : 'Disabled'}</span></div></div></div></section>`;
  }
  return `<section class="hero"><span class="eyebrow">${escapeHtml(formatRole(state.profile?.role))}</span><h1>Welcome back, ${escapeHtml(firstName)}.</h1><p>Your ClassOS workspace is connected. Phase 2 will add the day-to-day instructional tools to this foundation.</p></section><section class="section grid grid-3">${metric("Courses", state.courses.length, "Courses available to your school")}${metric("Schools", state.schools.length, "Connected campuses")}${metric("Account", "Active", formatRole(state.profile?.role), '<span class="pill success">Verified</span>')}</section>`;
}

function organizationsView() {
  if (!isOwner()) return `<div class="empty-state"><strong>Restricted</strong>This area is available to the Platform Owner.</div>`;
  const rows = state.organizations.map((org) => {
    const schoolCount = state.schools.filter((s) => s.organizationId === org.id).length;
    return `<tr><td><span class="row-title">${escapeHtml(org.name)}</span><span class="row-subtitle">${escapeHtml(org.type || "Organization")}</span></td><td>${escapeHtml(org.code || "—")}</td><td>${schoolCount}</td><td><span class="pill ${org.status === 'active' ? 'success' : ''}">${escapeHtml(org.status || "active")}</span></td><td>${formatDate(org.createdAt)}</td></tr>`;
  }).join("");
  const schoolRows = state.schools.map((school) => `<tr><td><span class="row-title">${escapeHtml(school.name)}</span><span class="row-subtitle">${escapeHtml(state.organizations.find(o=>o.id===school.organizationId)?.name || "Unassigned")}</span></td><td>${escapeHtml(school.code || "—")}</td><td>${escapeHtml(school.timezone || "America/Chicago")}</td><td><span class="pill success">${escapeHtml(school.status || "active")}</span></td></tr>`).join("");
  return `<div class="toolbar"><div><span class="eyebrow">STRUCTURE</span><h2 style="margin:4px 0 0">Organizations & schools</h2></div><div class="toolbar-group"><button class="btn btn-secondary" data-action="new-school">Add school</button><button class="btn btn-primary" data-action="new-organization">Create organization</button></div></div>
  <section class="card"><div class="section-head"><div><h3>Organizations</h3><p>Districts, networks, and independent institutions.</p></div></div>${rows ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Code</th><th>Schools</th><th>Status</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state"><strong>No organizations yet</strong>Create the first ClassOS organization to begin building your school structure.</div>'}</section>
  <section class="section card"><div class="section-head"><div><h3>Schools</h3><p>Campuses attached to a ClassOS organization.</p></div></div>${schoolRows ? `<div class="table-wrap"><table><thead><tr><th>School</th><th>Code</th><th>Timezone</th><th>Status</th></tr></thead><tbody>${schoolRows}</tbody></table></div>` : '<div class="empty-state"><strong>No schools yet</strong>Add a school after creating an organization.</div>'}</section>`;
}

function coursesView() {
  const canCreate = isOwner() || ["district_admin", "school_admin"].includes(state.profile?.role);
  const rows = state.courses.map((course) => {
    const school = state.schools.find((s) => s.id === course.schoolId);
    return `<tr><td><span class="row-title">${escapeHtml(course.name)}</span><span class="row-subtitle">${escapeHtml(course.courseCode || "No course code")}</span></td><td>${escapeHtml(school?.name || "—")}</td><td>${escapeHtml(course.term || "—")}</td><td>${(course.teacherIds || []).length}</td><td><span class="pill ${course.status === 'active' ? 'success' : ''}">${escapeHtml(course.status || "active")}</span></td></tr>`;
  }).join("");
  return `<div class="toolbar"><div><span class="eyebrow">ACADEMICS</span><h2 style="margin:4px 0 0">Courses</h2></div>${canCreate ? '<button class="btn btn-primary" data-action="new-course">Create course</button>' : ''}</div>
  <div class="callout"><strong>Phase 1 course shells:</strong> courses establish the durable link between schools, teachers, students, and the Phase 2 LMS features. Assignments and gradebooks are intentionally not stored yet.</div>
  <section class="section">${rows ? `<div class="table-wrap"><table><thead><tr><th>Course</th><th>School</th><th>Term</th><th>Teachers</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state"><strong>No courses yet</strong>Create your first course shell when a school is ready.</div>'}</section>`;
}

function peopleView() {
  if (!isOwner()) {
    return `<div class="toolbar"><div><span class="eyebrow">DIRECTORY</span><h2 style="margin:4px 0 0">People</h2></div></div><div class="card"><p class="metric-note">Your current role does not include platform-wide directory access.</p></div>`;
  }
  const userRows = state.users.map((user) => `<tr><td><span class="row-title">${escapeHtml(user.displayName || "Unnamed user")}</span><span class="row-subtitle">${escapeHtml(user.email || "")}</span></td><td>${escapeHtml(formatRole(user.role))}</td><td><span class="pill ${user.status === 'active' ? 'success' : 'warning'}">${escapeHtml(user.status || "pending")}</span></td><td>${formatDate(user.lastLoginAt)}</td></tr>`).join("");
  const inviteRows = state.invitations.map((invite) => `<tr><td><span class="row-title">${escapeHtml(invite.email)}</span><span class="row-subtitle">Pre-registered account</span></td><td>${escapeHtml(formatRole(invite.role))}</td><td>${escapeHtml(state.schools.find(s=>s.id===invite.schoolId)?.name || "Platform / org")}</td><td><span class="pill info">${escapeHtml(invite.status || "active")}</span></td></tr>`).join("");
  return `<div class="toolbar"><div><span class="eyebrow">IDENTITY</span><h2 style="margin:4px 0 0">People & access</h2></div><button class="btn btn-primary" data-action="invite-user">Pre-register user</button></div>
  <div class="callout info"><strong>No admin server is required for Phase 1.</strong> Pre-register a person’s exact email and role here. They create/sign into their own Firebase Authentication account; ClassOS then safely claims the pre-approved role for that authenticated email.</div>
  <section class="section card"><div class="section-head"><div><h3>Authenticated users</h3><p>People who have signed into ClassOS at least once.</p></div></div>${userRows ? `<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead><tbody>${userRows}</tbody></table></div>` : '<div class="empty-state"><strong>No users yet</strong>Your owner account will appear after the initial bootstrap finishes.</div>'}</section>
  <section class="section card"><div class="section-head"><div><h3>Pre-registered access</h3><p>Roles waiting for the matching email to sign in.</p></div></div>${inviteRows ? `<div class="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>School</th><th>Status</th></tr></thead><tbody>${inviteRows}</tbody></table></div>` : '<div class="empty-state"><strong>No invitations yet</strong>Pre-register an email to give a new user approved access.</div>'}</section>`;
}

function platformView() {
  if (!isOwner()) return `<div class="empty-state"><strong>Restricted</strong>This area is available to the Platform Owner.</div>`;
  const flags = state.flags.sort((a,b)=>a.key.localeCompare(b.key)).map((flag) => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(flag.key.replaceAll('_',' '))}</strong><span>${escapeHtml(flag.description || "Feature control")}</span></div><button class="pill clickable ${flag.enabled ? 'success' : ''}" data-action="toggle-flag" data-id="${escapeHtml(flag.id)}" data-enabled="${flag.enabled ? 'true':'false'}">${flag.enabled ? 'Enabled' : 'Disabled'}</button></div>`).join("");
  return `<div class="toolbar"><div><span class="eyebrow">OWNER CONSOLE</span><h2 style="margin:4px 0 0">Platform controls</h2></div><span class="pill success">Owner verified</span></div>
  <section class="grid grid-2"><div class="card"><div class="section-head"><div><h3>Feature flags</h3><p>Control staged ClassOS modules without changing the navigation model.</p></div></div><div class="list">${flags || '<div class="empty-state">No feature flags found.</div>'}</div></div>
  <div class="card"><div class="section-head"><div><h3>Platform identity</h3><p>The bootstrap owner is enforced in both application logic and Firestore rules.</p></div></div><div class="list"><div class="list-row"><div class="list-main"><strong>Bootstrap owner</strong><span>${OWNER_EMAIL}</span></div><span class="pill success">Protected</span></div><div class="list-row"><div class="list-main"><strong>Firebase project</strong><span>classos-958d3</span></div><span class="pill info">Connected</span></div><div class="list-row"><div class="list-main"><strong>Hosting target</strong><span>GitHub Pages / static web</span></div><span class="pill">Phase 1</span></div></div></div></section>
  <section class="section card"><div class="section-head"><div><h3>Permission model</h3><p>Platform Owner → District Admin → School Admin → Counselor / Teacher / Staff → Guardian / Student.</p></div></div><div class="callout"><strong>Important:</strong> client-side controls are only the interface. The included Firestore rules separately enforce privileged writes, owner access, invitation claims, and user-profile role protection.</div></section>`;
}

function settingsView() {
  return `<div class="toolbar"><div><span class="eyebrow">ACCOUNT</span><h2 style="margin:4px 0 0">Settings</h2></div></div><section class="grid grid-2"><div class="card"><div class="section-head"><div><h3>Your profile</h3><p>Identity supplied by Firebase Authentication.</p></div></div><div class="list"><div class="list-row"><div class="list-main"><strong>Name</strong><span>${escapeHtml(state.profile?.displayName || "—")}</span></div></div><div class="list-row"><div class="list-main"><strong>Email</strong><span>${escapeHtml(state.profile?.email || "—")}</span></div><span class="pill success">Authenticated</span></div><div class="list-row"><div class="list-main"><strong>ClassOS role</strong><span>${escapeHtml(formatRole(state.profile?.role))}</span></div></div></div></div><div class="card"><div class="section-head"><div><h3>Session</h3><p>Your session persists securely through Firebase Authentication.</p></div></div><button class="btn btn-secondary" data-action="sign-out-secondary">Sign out of ClassOS</button></div></section>`;
}

const routeMeta = {
  dashboard: ["Home", "CLASSOS"], courses: ["Courses", "ACADEMICS"], people: ["People", "DIRECTORY"], organizations: ["Organizations", "STRUCTURE"], platform: ["Platform", "OWNER CONSOLE"], settings: ["Settings", "ACCOUNT"]
};

async function renderRoute(route = state.route) {
  if (!state.profile) return;
  if (["organizations", "platform"].includes(route) && !isOwner()) route = "dashboard";
  state.route = route;
  const [title, kicker] = routeMeta[route] || routeMeta.dashboard;
  pageTitle.textContent = title;
  workspaceKicker.textContent = kicker;
  document.querySelectorAll(".nav-item[data-route]").forEach((button) => button.classList.toggle("active", button.dataset.route === route));
  pageContent.innerHTML = '<div class="skeleton" style="height:130px"></div><div class="section grid grid-4"><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div></div>';
  try {
    if (isOwner()) await refreshOwnerData(); else await refreshMemberData();
    const views = { dashboard: dashboardView, organizations: organizationsView, courses: coursesView, people: peopleView, platform: platformView, settings: settingsView };
    pageContent.innerHTML = (views[route] || dashboardView)();
  } catch (error) {
    console.error(error);
    pageContent.innerHTML = `<div class="empty-state"><strong>ClassOS could not load this page.</strong>${escapeHtml(error.message || "Check your Firestore configuration and rules.")}</div>`;
  }
}

function organizationOptions(selected = "") {
  return state.organizations.map((org) => `<option value="${escapeHtml(org.id)}" ${selected===org.id?'selected':''}>${escapeHtml(org.name)}</option>`).join("");
}
function schoolOptions(selected = "") {
  return state.schools.map((school) => `<option value="${escapeHtml(school.id)}" ${selected===school.id?'selected':''}>${escapeHtml(school.name)}</option>`).join("");
}

function showNewOrganization() {
  openModal("Create organization", `<form id="organization-form"><div class="form-grid"><div class="field span-2"><label>Name</label><input name="name" required placeholder="Example Public Schools"></div><div class="field"><label>Type</label><select name="type"><option value="district">School district</option><option value="independent_school">Independent school</option><option value="network">School network</option><option value="other">Other</option></select></div><div class="field"><label>Code</label><input name="code" required maxlength="12" placeholder="EPS"></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">Create organization</button></div></form>`, "STRUCTURE");
}

function showNewSchool() {
  if (!state.organizations.length) { toast("Create an organization before adding a school.", "error"); return; }
  openModal("Add school", `<form id="school-form"><div class="form-grid"><div class="field span-2"><label>Organization</label><select name="organizationId" required>${organizationOptions()}</select></div><div class="field span-2"><label>School name</label><input name="name" required placeholder="ClassOS Academy"></div><div class="field"><label>School code</label><input name="code" required maxlength="12" placeholder="COA"></div><div class="field"><label>Timezone</label><select name="timezone"><option>America/Chicago</option><option>America/New_York</option><option>America/Denver</option><option>America/Los_Angeles</option></select></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">Add school</button></div></form>`, "STRUCTURE");
}

function showNewCourse() {
  if (!state.schools.length) { toast("Add a school before creating a course.", "error"); return; }
  openModal("Create course", `<form id="course-form"><div class="form-grid"><div class="field span-2"><label>School</label><select name="schoolId" required>${schoolOptions()}</select></div><div class="field span-2"><label>Course name</label><input name="name" required placeholder="AP English Language"></div><div class="field"><label>Course code</label><input name="courseCode" maxlength="24" placeholder="APLANG-01"></div><div class="field"><label>Term</label><input name="term" placeholder="2026–2027"></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">Create course</button></div></form>`, "ACADEMICS");
}

function showInviteUser() {
  openModal("Pre-register user", `<form id="invite-form"><div class="callout info" style="margin-bottom:18px"><strong>How this works:</strong> enter the exact email the person will use for Google or email/password sign-in. ClassOS will only grant this role when Firebase authenticates that same email.</div><div class="form-grid"><div class="field span-2"><label>Email</label><input name="email" type="email" required placeholder="person@school.org"></div><div class="field"><label>Role</label><select name="role" required>${VALID_ROLES.map((r)=>`<option value="${r}">${formatRole(r)}</option>`).join("")}</select></div><div class="field"><label>School (optional)</label><select name="schoolId"><option value="">No school yet</option>${schoolOptions()}</select></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">Pre-register access</button></div></form>`, "IDENTITY");
}

async function saveOrganization(form) {
  const data = Object.fromEntries(new FormData(form));
  const ref = await addDoc(collection(db, "organizations"), { name: data.name.trim(), type: data.type, code: data.code.trim().toUpperCase(), status: "active", createdBy: state.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await audit("organization.create", "organization", ref.id, { name: data.name.trim() });
  toast("Organization created.", "success"); closeModal(); await renderRoute("organizations");
}

async function saveSchool(form) {
  const data = Object.fromEntries(new FormData(form));
  const org = state.organizations.find((item) => item.id === data.organizationId);
  const ref = await addDoc(collection(db, "schools"), { organizationId: data.organizationId, organizationName: org?.name || "", name: data.name.trim(), code: data.code.trim().toUpperCase(), timezone: data.timezone, status: "active", createdBy: state.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await audit("school.create", "school", ref.id, { name: data.name.trim(), organizationId: data.organizationId });
  toast("School added.", "success"); closeModal(); await renderRoute("organizations");
}

async function saveCourse(form) {
  const data = Object.fromEntries(new FormData(form));
  const school = state.schools.find((item) => item.id === data.schoolId);
  const ref = await addDoc(collection(db, "courses"), { organizationId: school?.organizationId || "", schoolId: data.schoolId, name: data.name.trim(), courseCode: data.courseCode.trim(), term: data.term.trim(), teacherIds: [], studentIds: [], status: "active", createdBy: state.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await audit("course.create", "course", ref.id, { name: data.name.trim(), schoolId: data.schoolId });
  toast("Course shell created.", "success"); closeModal(); await renderRoute("courses");
}

async function saveInvitation(form) {
  const data = Object.fromEntries(new FormData(form));
  const email = safeEmail(data.email);
  if (email === OWNER_EMAIL) { toast("The bootstrap owner already has permanent owner access.", "error"); return; }
  if (!VALID_ROLES.includes(data.role)) { toast("Choose a valid ClassOS role.", "error"); return; }
  const school = state.schools.find((item) => item.id === data.schoolId);
  await setDoc(doc(db, "invitations", email), {
    email,
    role: data.role,
    schoolId: data.schoolId || "",
    organizationId: school?.organizationId || "",
    status: "active",
    invitedBy: state.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  await audit("invitation.create", "invitation", email, { role: data.role, schoolId: data.schoolId || null });
  toast("Access pre-registered for that email.", "success"); closeModal(); await renderRoute("people");
}

async function toggleFlag(id, enabled) {
  if (!isOwner()) return;
  await updateDoc(doc(db, "featureFlags", id), { enabled: !enabled, updatedBy: state.user.uid, updatedAt: serverTimestamp() });
  await audit("feature_flag.toggle", "featureFlag", id, { enabled: !enabled });
  toast(`${id.replaceAll('_',' ')} ${!enabled ? 'enabled' : 'disabled'}.`, "success");
  await renderRoute("platform");
}

async function showGlobalSearch() {
  if (!state.user) return;
  if (isOwner()) await refreshOwnerData();
  openModal("Search ClassOS", `<div class="field"><label for="global-search-input">Search people, schools, courses, and organizations</label><input id="global-search-input" placeholder="Start typing…" autofocus></div><div id="search-results" class="list"><div class="empty-state"><strong>Search the platform</strong>Results will appear here as you type.</div></div>`, "SEARCH");
  const input = $("global-search-input");
  input.focus();
  input.addEventListener("input", () => {
    const needle = input.value.trim().toLowerCase();
    if (!needle) { $("search-results").innerHTML = '<div class="empty-state"><strong>Search the platform</strong>Results will appear here as you type.</div>'; return; }
    const source = [
      ...state.courses.map(x=>({type:"Course", title:x.name, subtitle:x.courseCode || ""})),
      ...state.schools.map(x=>({type:"School", title:x.name, subtitle:x.code || ""})),
      ...state.organizations.map(x=>({type:"Organization", title:x.name, subtitle:x.code || ""})),
      ...(isOwner() ? state.users.map(x=>({type:"Person", title:x.displayName || x.email, subtitle:x.email || ""})) : [])
    ].filter(x=>`${x.title} ${x.subtitle}`.toLowerCase().includes(needle)).slice(0, 12);
    $("search-results").innerHTML = source.length ? source.map(x=>`<div class="list-row"><div class="list-main"><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.subtitle)}</span></div><span class="pill">${x.type}</span></div>`).join("") : '<div class="empty-state"><strong>No results</strong>Try a different search.</div>';
  });
}

async function handlePageClick(event) {
  const routeJump = event.target.closest("[data-route-jump]");
  if (routeJump) { await renderRoute(routeJump.dataset.routeJump); return; }
  const actionNode = event.target.closest("[data-action]");
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  if (action === "new-organization") showNewOrganization();
  if (action === "new-school") showNewSchool();
  if (action === "new-course") showNewCourse();
  if (action === "invite-user") showInviteUser();
  if (action === "close-modal") closeModal();
  if (action === "sign-out-secondary") await signOut(auth);
  if (action === "toggle-flag") await toggleFlag(actionNode.dataset.id, actionNode.dataset.enabled === "true");
}

async function handleModalSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('button[type="submit"]');
  setBusy(submit, true, "Saving…");
  try {
    if (form.id === "organization-form") await saveOrganization(form);
    if (form.id === "school-form") await saveSchool(form);
    if (form.id === "course-form") await saveCourse(form);
    if (form.id === "invite-form") await saveInvitation(form);
  } catch (error) {
    console.error(error);
    toast(error.message || "ClassOS could not save that change.", "error");
    setBusy(submit, false);
  }
}

function wireUi() {
  $("auth-form").addEventListener("submit", handleEmailAuth);
  $("google-auth").addEventListener("click", handleGoogleAuth);
  $("forgot-password").addEventListener("click", handlePasswordReset);
  $("auth-switch").addEventListener("click", () => updateAuthMode(state.authMode === "signin" ? "signup" : "signin"));
  $("sign-out").addEventListener("click", () => signOut(auth));
  $("modal-close").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (event) => { if (event.target.id === "modal") closeModal(); });
  $("modal-body").addEventListener("submit", handleModalSubmit);
  $("modal-body").addEventListener("click", handlePageClick);
  pageContent.addEventListener("click", handlePageClick);
  document.querySelectorAll(".nav-item[data-route]").forEach((button) => button.addEventListener("click", async () => { await renderRoute(button.dataset.route); $("sidebar").classList.remove("open"); }));
  $("sidebar-open").addEventListener("click", () => $("sidebar").classList.add("open"));
  $("sidebar-close").addEventListener("click", () => $("sidebar").classList.remove("open"));
  $("global-search").addEventListener("click", showGlobalSearch);
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); showGlobalSearch(); }
    if (event.key === "Escape") closeModal();
  });
}

wireUi();
updateAuthMode("signin");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.user = null;
    state.profile = null;
    appView.classList.add("hidden");
    authView.classList.remove("hidden");
    return;
  }
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  pageContent.innerHTML = '<div class="skeleton" style="height:180px"></div>';
  try {
    state.user = user;
    state.profile = await ensureUserProfile(user);
    applyProfileToShell();
    await audit("session.sign_in", "user", user.uid, { provider: user.providerData?.[0]?.providerId || "unknown" });
    await renderRoute("dashboard");
  } catch (error) {
    console.error(error);
    pageContent.innerHTML = `<div class="empty-state"><strong>ClassOS sign-in succeeded, but setup could not finish.</strong>${escapeHtml(error.message || "Check Firestore and Authentication configuration.")}</div>`;
    toast("Signed in, but ClassOS could not finish loading your profile.", "error");
  }
});