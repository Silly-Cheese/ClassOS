import { auth, db, googleProvider, OWNER_EMAIL } from './firebase.js';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup,
  sendPasswordResetEmail, sendEmailVerification, signOut, onAuthStateChanged,
  updateProfile, reload
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const OWNER_ROLE = 'platform_owner';
const ROLES = ['student','teacher','guardian','staff','counselor','school_admin','district_admin'];
const labels = {
  platform_owner:'Platform Owner', district_admin:'District Admin', school_admin:'School Admin',
  counselor:'Counselor', teacher:'Teacher', staff:'Staff', guardian:'Parent / Guardian',
  student:'Student', pending:'Pending Access'
};
const state = { mode:'signin', user:null, profile:null, route:'dashboard', organizations:[], schools:[], courses:[], users:[], invitations:[], flags:[] };

const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const emailKey = (v='') => String(v).trim().toLowerCase();
const roleName = (v) => labels[v] || String(v || 'Member').replaceAll('_',' ');
const isOwner = () => state.profile?.role === OWNER_ROLE && emailKey(state.user?.email) === OWNER_EMAIL;
const formatDate = (v) => {
  if (!v) return '—';
  const d = v instanceof Timestamp ? v.toDate() : v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(d);
};
const initials = (v='User') => v.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'U';

function toast(message,type='') {
  const n=document.createElement('div'); n.className=`toast ${type}`.trim(); n.textContent=message;
  $('toast-region').appendChild(n); setTimeout(()=>n.remove(),4200);
}
function busy(btn,on,text='Working…') {
  if(!btn) return; if(on){btn.dataset.label=btn.textContent;btn.textContent=text;btn.disabled=true;}
  else{btn.textContent=btn.dataset.label||btn.textContent;btn.disabled=false;}
}
function authMessage(e) {
  return ({
    'auth/invalid-credential':'That email/password combination was not recognized.',
    'auth/email-already-in-use':'An account already exists with that email address.',
    'auth/weak-password':'Use a stronger password with at least 6 characters.',
    'auth/invalid-email':'Enter a valid email address.',
    'auth/popup-closed-by-user':'Google sign-in was closed before it finished.',
    'auth/popup-blocked':'Your browser blocked the Google sign-in window.',
    'auth/too-many-requests':'Too many attempts were made. Try again shortly.'
  })[e?.code] || e?.message || 'Something went wrong.';
}
function openModal(title,body,kicker='CLASSOS'){$('modal-title').textContent=title;$('modal-kicker').textContent=kicker;$('modal-body').innerHTML=body;$('modal').classList.remove('hidden');}
function closeModal(){$('modal').classList.add('hidden');$('modal-body').innerHTML='';}

async function logAction(action,targetType='system',targetId=null,details={}) {
  if(!state.user) return;
  try { await addDoc(collection(db,'auditLogs'),{actorUid:state.user.uid,actorEmail:emailKey(state.user.email),action,targetType,targetId,details,createdAt:serverTimestamp()}); } catch(e){ console.warn(e); }
}

async function invitationFor(user) {
  if(!user?.email || !user.emailVerified) return null;
  const ref=await getDoc(doc(db,'invitations',emailKey(user.email)));
  return ref.exists() && ref.data().status==='active' ? ref.data() : null;
}

async function ensureProfile(user) {
  const ref=doc(db,'users',user.uid), existing=await getDoc(ref), mail=emailKey(user.email);
  const base={email:mail,displayName:user.displayName||mail.split('@')[0],photoURL:user.photoURL||'',lastLoginAt:serverTimestamp()};
  if(mail===OWNER_EMAIL && user.emailVerified){
    await setDoc(ref,{...base,role:OWNER_ROLE,status:'active',platformAccess:true,organizationIds:[],schoolIds:[],bootstrapOwner:true,...(!existing.exists()?{createdAt:serverTimestamp()}:{})},{merge:true});
    await bootstrap(user.uid);
  } else if(!existing.exists()) {
    const inv=await invitationFor(user);
    await setDoc(ref,{...base,role:inv?.role||'pending',status:inv?'active':'pending',platformAccess:false,
      organizationIds:inv?.organizationId?[inv.organizationId]:[],schoolIds:inv?.schoolId?[inv.schoolId]:[],
      invitationEmail:inv?mail:null,createdAt:serverTimestamp()});
  } else if(existing.data().status==='pending' && user.emailVerified) {
    const inv=await invitationFor(user);
    if(inv){
      await setDoc(ref,{...base,role:inv.role,status:'active',organizationIds:inv.organizationId?[inv.organizationId]:[],schoolIds:inv.schoolId?[inv.schoolId]:[],invitationEmail:mail},{merge:true});
    } else await setDoc(ref,base,{merge:true});
  } else await setDoc(ref,base,{merge:true});
  const fresh=await getDoc(ref); return {id:fresh.id,...fresh.data()};
}

async function bootstrap(uid) {
  const ref=doc(db,'system','config'), snap=await getDoc(ref); if(snap.exists()) return;
  await setDoc(ref,{productName:'ClassOS',environment:'production',ownerUid:uid,ownerEmail:OWNER_EMAIL,version:'0.1.0-phase1',setupComplete:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  const defaults=[
    ['core_lms',true,'Core LMS foundation'],['assessments',false,'Assessment engine'],
    ['mastery',false,'Learning Graph and mastery'],['student_pulse',false,'Explainable student pulse'],
    ['district_pulse',false,'District-level intelligence'],['family_portal',false,'Parent and guardian experience']
  ];
  for(const [key,enabled,description] of defaults) await setDoc(doc(db,'featureFlags',key),{key,enabled,description,updatedBy:uid,updatedAt:serverTimestamp()});
}

async function all(name){const s=await getDocs(collection(db,name));return s.docs.map(x=>({id:x.id,...x.data()}));}
async function refreshData(){
  if(isOwner()) [state.organizations,state.schools,state.courses,state.users,state.invitations,state.flags]=await Promise.all(['organizations','schools','courses','users','invitations','featureFlags'].map(all));
  else {
    state.organizations=[];state.schools=[];state.courses=[];
    for(const id of (state.profile.organizationIds||[])){const s=await getDoc(doc(db,'organizations',id));if(s.exists())state.organizations.push({id:s.id,...s.data()});}
    for(const id of (state.profile.schoolIds||[])){const s=await getDoc(doc(db,'schools',id));if(s.exists())state.schools.push({id:s.id,...s.data()});}
    if(state.profile.schoolIds?.length){const q=await getDocs(query(collection(db,'courses'),where('schoolId','in',state.profile.schoolIds.slice(0,10))));state.courses=q.docs.map(x=>({id:x.id,...x.data()}));}
  }
}

function setMode(mode){
  state.mode=mode;const signup=mode==='signup';$('name-field').classList.toggle('hidden',!signup);
  $('auth-title').textContent=signup?'Create your ClassOS account':'Sign in to ClassOS';
  $('auth-subtitle').textContent=signup?'Create an account with email or continue with Google.':'Use your ClassOS account or continue with Google.';
  $('auth-submit').textContent=signup?'Create account':'Sign in';$('auth-switch-copy').textContent=signup?'Already have an account?':'New to ClassOS?';
  $('auth-switch').textContent=signup?'Sign in':'Create account';$('forgot-password').classList.toggle('hidden',signup);
}

async function emailAuth(e){
  e.preventDefault();const btn=$('auth-submit'),mail=emailKey($('email').value),pass=$('password').value,name=$('display-name').value.trim();
  if(!mail||!pass||(state.mode==='signup'&&!name)){toast('Complete all required fields.','error');return;}
  busy(btn,true,state.mode==='signup'?'Creating account…':'Signing in…');
  try{
    if(state.mode==='signup'){
      const result=await createUserWithEmailAndPassword(auth,mail,pass);await updateProfile(result.user,{displayName:name});await sendEmailVerification(result.user);
      showVerification(result.user);toast('Account created. Check your email to verify it.','success');
    } else await signInWithEmailAndPassword(auth,mail,pass);
  }catch(err){toast(authMessage(err),'error');}finally{busy(btn,false);}
}
async function googleAuth(){const b=$('google-auth');busy(b,true,'Opening Google…');try{await signInWithPopup(auth,googleProvider);}catch(e){toast(authMessage(e),'error');}finally{busy(b,false);}}
async function resetPassword(){const mail=emailKey($('email').value);if(!mail){toast('Enter your email address first.','error');return;}try{await sendPasswordResetEmail(auth,mail);toast('Password reset email sent.','success');}catch(e){toast(authMessage(e),'error');}}

function showVerification(user){
  $('app-view').classList.add('hidden');$('auth-view').classList.remove('hidden');
  const wrap=document.querySelector('.auth-card');
  wrap.innerHTML=`<div class="mobile-brand brand-lockup"><div class="brand-mark">C</div><span>ClassOS</span></div><div class="auth-heading"><span class="eyebrow">VERIFY YOUR EMAIL</span><h2>Check your inbox.</h2><p>We sent a verification link to <strong>${esc(user.email)}</strong>. ClassOS will not activate invited roles or owner access until the address is verified.</p></div><button id="verified-check" class="btn btn-primary btn-block">I’ve verified my email</button><button id="verification-resend" class="btn btn-secondary btn-block">Resend verification email</button><button id="verification-signout" class="link-button" style="display:block;margin:22px auto 0">Use a different account</button>`;
  $('verified-check').onclick=async()=>{const b=$('verified-check');busy(b,true,'Checking…');await reload(auth.currentUser);if(auth.currentUser.emailVerified)location.reload();else{toast('That email is not verified yet.','error');busy(b,false);}};
  $('verification-resend').onclick=async()=>{try{await sendEmailVerification(auth.currentUser);toast('Verification email sent again.','success');}catch(e){toast(authMessage(e),'error');}};
  $('verification-signout').onclick=()=>{signOut(auth);location.reload();};
}

function shellProfile(){
  const n=state.profile.displayName||state.user.displayName||state.user.email;$('mini-name').textContent=n;$('mini-role').textContent=roleName(state.profile.role);
  $('mini-avatar').innerHTML=state.profile.photoURL?`<img src="${esc(state.profile.photoURL)}" alt="" referrerpolicy="no-referrer">`:esc(initials(n));
  document.querySelectorAll('.owner-only').forEach(x=>x.classList.toggle('hidden',!isOwner()));
}
const metric=(label,value,note)=>`<article class="card metric"><div class="metric-top"><span>${esc(label)}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></article>`;

function dashboard(){
  if(state.profile.status==='pending') return `<section class="hero"><span class="eyebrow">ACCOUNT READY</span><h1>Welcome to ClassOS.</h1><p>Your identity is verified. This email has not yet been assigned a ClassOS role. The Platform Owner can pre-register your email from People & Access.</p></section><section class="section grid grid-2"><div class="card"><span class="eyebrow">ACCOUNT</span><h3>${esc(state.profile.displayName)}</h3><p class="metric-note">${esc(state.profile.email)}</p><div style="margin-top:16px"><span class="pill warning">Pending access</span></div></div><div class="card"><span class="eyebrow">NEXT STEP</span><h3>Role assignment</h3><p class="metric-note" style="line-height:1.6">After the owner pre-registers this exact email, sign out and back in. ClassOS will claim only the role that was approved for you.</p></div></section>`;
  const first=(state.profile.displayName||'there').split(' ')[0];
  if(isOwner()) return `<section class="hero"><span class="eyebrow">PLATFORM OWNER</span><h1>Good to see you, ${esc(first)}.</h1><p>Phase 1 is live: authentication, verified identity, role security, organizations, schools, course shells, invitations, feature flags, and the owner console.</p><div class="hero-actions"><button class="btn btn-primary" data-action="new-org">Create organization</button><button class="btn btn-secondary" data-jump="people">Pre-register user</button></div></section><section class="section grid grid-4">${metric('Organizations',state.organizations.length,'Districts and institutions')}${metric('Schools',state.schools.length,'Connected campuses')}${metric('Courses',state.courses.length,'Course shells')}${metric('Users',state.users.length,'Authenticated identities')}</section><section class="section grid grid-2"><div class="card"><div class="section-head"><div><span class="eyebrow">FOUNDATION</span><h3>Phase 1 systems</h3></div><span class="pill success">Operational</span></div><div class="list">${[['Authentication','Google + verified email/password'],['Owner bootstrap',OWNER_EMAIL],['Permissions','Firestore-enforced roles'],['Structure','Organization → school → course']].map(x=>`<div class="list-row"><div class="list-main"><strong>${x[0]}</strong><span>${esc(x[1])}</span></div><span class="pill success">Ready</span></div>`).join('')}</div></div><div class="card"><div class="section-head"><div><span class="eyebrow">PHASE 2 READY</span><h3>Instructional layer</h3></div></div><div class="callout info"><strong>The durable foundation is in place.</strong><br>Assignments, submissions, attendance, gradebooks, calendars, and student workflows can now attach to these identities and course shells.</div></div></section>`;
  return `<section class="hero"><span class="eyebrow">${esc(roleName(state.profile.role))}</span><h1>Welcome back, ${esc(first)}.</h1><p>Your ClassOS identity and school access are connected.</p></section><section class="section grid grid-3">${metric('Courses',state.courses.length,'Available course shells')}${metric('Schools',state.schools.length,'Connected campuses')}${metric('Status','Active',roleName(state.profile.role))}</section>`;
}

function organizations(){
  if(!isOwner())return '<div class="empty-state"><strong>Restricted</strong>This area is available to the Platform Owner.</div>';
  const orgRows=state.organizations.map(o=>`<tr><td><span class="row-title">${esc(o.name)}</span><span class="row-subtitle">${esc(o.type||'Organization')}</span></td><td>${esc(o.code||'—')}</td><td>${state.schools.filter(s=>s.organizationId===o.id).length}</td><td><span class="pill success">${esc(o.status||'active')}</span></td></tr>`).join('');
  const schoolRows=state.schools.map(s=>`<tr><td><span class="row-title">${esc(s.name)}</span><span class="row-subtitle">${esc(state.organizations.find(o=>o.id===s.organizationId)?.name||'—')}</span></td><td>${esc(s.code||'—')}</td><td>${esc(s.timezone||'America/Chicago')}</td><td><span class="pill success">${esc(s.status||'active')}</span></td></tr>`).join('');
  return `<div class="toolbar"><div><span class="eyebrow">STRUCTURE</span><h2 style="margin:4px 0 0">Organizations & schools</h2></div><div class="toolbar-group"><button class="btn btn-secondary" data-action="new-school">Add school</button><button class="btn btn-primary" data-action="new-org">Create organization</button></div></div><section class="card"><div class="section-head"><div><h3>Organizations</h3><p>Districts, networks, and independent institutions.</p></div></div>${orgRows?`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Code</th><th>Schools</th><th>Status</th></tr></thead><tbody>${orgRows}</tbody></table></div>`:'<div class="empty-state"><strong>No organizations yet</strong>Create your first organization.</div>'}</section><section class="section card"><div class="section-head"><div><h3>Schools</h3><p>Campuses attached to an organization.</p></div></div>${schoolRows?`<div class="table-wrap"><table><thead><tr><th>School</th><th>Code</th><th>Timezone</th><th>Status</th></tr></thead><tbody>${schoolRows}</tbody></table></div>`:'<div class="empty-state"><strong>No schools yet</strong>Add a school after creating an organization.</div>'}</section>`;
}
function courses(){
  const canCreate=isOwner()||['district_admin','school_admin'].includes(state.profile.role);
  const rows=state.courses.map(c=>`<tr><td><span class="row-title">${esc(c.name)}</span><span class="row-subtitle">${esc(c.courseCode||'No course code')}</span></td><td>${esc(state.schools.find(s=>s.id===c.schoolId)?.name||'—')}</td><td>${esc(c.term||'—')}</td><td>${(c.teacherIds||[]).length}</td><td><span class="pill success">${esc(c.status||'active')}</span></td></tr>`).join('');
  return `<div class="toolbar"><div><span class="eyebrow">ACADEMICS</span><h2 style="margin:4px 0 0">Courses</h2></div>${canCreate?'<button class="btn btn-primary" data-action="new-course">Create course</button>':''}</div><div class="callout"><strong>Phase 1 course shells</strong> establish the link between school, teachers, students, and the Phase 2 LMS.</div><section class="section">${rows?`<div class="table-wrap"><table><thead><tr><th>Course</th><th>School</th><th>Term</th><th>Teachers</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="empty-state"><strong>No courses yet</strong>Create your first course shell.</div>'}</section>`;
}
function people(){
  if(!isOwner())return `<div class="toolbar"><div><span class="eyebrow">DIRECTORY</span><h2 style="margin:4px 0 0">People</h2></div></div><div class="card"><p class="metric-note">Your current role does not include platform-wide directory access.</p></div>`;
  const users=state.users.map(u=>`<tr><td><span class="row-title">${esc(u.displayName||'Unnamed')}</span><span class="row-subtitle">${esc(u.email||'')}</span></td><td>${esc(roleName(u.role))}</td><td><span class="pill ${u.status==='active'?'success':'warning'}">${esc(u.status||'pending')}</span></td><td>${formatDate(u.lastLoginAt)}</td></tr>`).join('');
  const inv=state.invitations.map(i=>`<tr><td><span class="row-title">${esc(i.email)}</span><span class="row-subtitle">Verified email required</span></td><td>${esc(roleName(i.role))}</td><td>${esc(state.schools.find(s=>s.id===i.schoolId)?.name||'Platform / org')}</td><td><span class="pill info">${esc(i.status||'active')}</span></td></tr>`).join('');
  return `<div class="toolbar"><div><span class="eyebrow">IDENTITY</span><h2 style="margin:4px 0 0">People & access</h2></div><button class="btn btn-primary" data-action="invite">Pre-register user</button></div><div class="callout info"><strong>Secure self-service provisioning:</strong> approve an exact email and role. The user signs in with Google or verifies an email/password account before ClassOS can claim that role.</div><section class="section card"><div class="section-head"><div><h3>Authenticated users</h3><p>People who have completed identity setup.</p></div></div>${users?`<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead><tbody>${users}</tbody></table></div>`:'<div class="empty-state">No users yet.</div>'}</section><section class="section card"><div class="section-head"><div><h3>Pre-registered access</h3><p>Approved roles waiting for the matching verified email.</p></div></div>${inv?`<div class="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>School</th><th>Status</th></tr></thead><tbody>${inv}</tbody></table></div>`:'<div class="empty-state"><strong>No invitations yet</strong>Pre-register an email to approve access.</div>'}</section>`;
}
function platform(){
  if(!isOwner())return '<div class="empty-state"><strong>Restricted</strong>This area is available to the Platform Owner.</div>';
  const flags=state.flags.sort((a,b)=>a.key.localeCompare(b.key)).map(f=>`<div class="list-row"><div class="list-main"><strong>${esc(f.key.replaceAll('_',' '))}</strong><span>${esc(f.description||'Feature control')}</span></div><button class="pill clickable ${f.enabled?'success':''}" data-action="flag" data-id="${esc(f.id)}" data-enabled="${f.enabled?'1':'0'}">${f.enabled?'Enabled':'Disabled'}</button></div>`).join('');
  return `<div class="toolbar"><div><span class="eyebrow">OWNER CONSOLE</span><h2 style="margin:4px 0 0">Platform controls</h2></div><span class="pill success">Owner verified</span></div><section class="grid grid-2"><div class="card"><div class="section-head"><div><h3>Feature flags</h3><p>Stage future ClassOS modules safely.</p></div></div><div class="list">${flags}</div></div><div class="card"><div class="section-head"><div><h3>Platform identity</h3></div></div><div class="list"><div class="list-row"><div class="list-main"><strong>Bootstrap owner</strong><span>${OWNER_EMAIL}</span></div><span class="pill success">Protected</span></div><div class="list-row"><div class="list-main"><strong>Firebase project</strong><span>classos-958d3</span></div><span class="pill info">Connected</span></div><div class="list-row"><div class="list-main"><strong>Hosting</strong><span>GitHub Pages compatible</span></div><span class="pill">Static</span></div></div></div></section>`;
}
function settings(){return `<div class="toolbar"><div><span class="eyebrow">ACCOUNT</span><h2 style="margin:4px 0 0">Settings</h2></div></div><section class="grid grid-2"><div class="card"><div class="list"><div class="list-row"><div class="list-main"><strong>Name</strong><span>${esc(state.profile.displayName)}</span></div></div><div class="list-row"><div class="list-main"><strong>Email</strong><span>${esc(state.profile.email)}</span></div><span class="pill success">Verified</span></div><div class="list-row"><div class="list-main"><strong>Role</strong><span>${esc(roleName(state.profile.role))}</span></div></div></div></div><div class="card"><h3>Session</h3><p class="metric-note">Authentication is managed by Firebase and persists in this browser.</p><button class="btn btn-secondary" data-action="logout">Sign out</button></div></section>`;}

const routeViews={dashboard,organizations,courses,people,platform,settings};
const meta={dashboard:['Home','CLASSOS'],courses:['Courses','ACADEMICS'],people:['People','DIRECTORY'],organizations:['Organizations','STRUCTURE'],platform:['Platform','OWNER CONSOLE'],settings:['Settings','ACCOUNT']};
async function render(route=state.route){
  if(['organizations','platform'].includes(route)&&!isOwner())route='dashboard';state.route=route;
  [$('page-title').textContent,$('workspace-kicker').textContent]=meta[route]||meta.dashboard;
  document.querySelectorAll('.nav-item[data-route]').forEach(x=>x.classList.toggle('active',x.dataset.route===route));
  $('page-content').innerHTML='<div class="skeleton" style="height:150px"></div>';try{await refreshData();$('page-content').innerHTML=(routeViews[route]||dashboard)();}catch(e){console.error(e);$('page-content').innerHTML=`<div class="empty-state"><strong>ClassOS could not load this page.</strong>${esc(e.message)}</div>`;}
}

const orgOptions=()=>state.organizations.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
const schoolOptions=()=>state.schools.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
function showOrg(){openModal('Create organization',`<form id="org-form"><div class="form-grid"><div class="field span-2"><label>Name</label><input name="name" required placeholder="Example Public Schools"></div><div class="field"><label>Type</label><select name="type"><option value="district">School district</option><option value="independent_school">Independent school</option><option value="network">School network</option></select></div><div class="field"><label>Code</label><input name="code" required maxlength="12" placeholder="EPS"></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Create</button></div></form>`,'STRUCTURE');}
function showSchool(){if(!state.organizations.length){toast('Create an organization first.','error');return;}openModal('Add school',`<form id="school-form"><div class="form-grid"><div class="field span-2"><label>Organization</label><select name="organizationId">${orgOptions()}</select></div><div class="field span-2"><label>School name</label><input name="name" required></div><div class="field"><label>Code</label><input name="code" required maxlength="12"></div><div class="field"><label>Timezone</label><select name="timezone"><option>America/Chicago</option><option>America/New_York</option><option>America/Denver</option><option>America/Los_Angeles</option></select></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Add school</button></div></form>`,'STRUCTURE');}
function showCourse(){if(!state.schools.length){toast('Add a school first.','error');return;}openModal('Create course',`<form id="course-form"><div class="form-grid"><div class="field span-2"><label>School</label><select name="schoolId">${schoolOptions()}</select></div><div class="field span-2"><label>Course name</label><input name="name" required placeholder="AP English Language"></div><div class="field"><label>Course code</label><input name="courseCode"></div><div class="field"><label>Term</label><input name="term" placeholder="2026–2027"></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Create course</button></div></form>`,'ACADEMICS');}
function showInvite(){openModal('Pre-register user',`<form id="invite-form"><div class="callout info" style="margin-bottom:18px"><strong>Verified identity required:</strong> this role can only be claimed by a Firebase-authenticated user after this exact email is verified.</div><div class="form-grid"><div class="field span-2"><label>Email</label><input name="email" type="email" required></div><div class="field"><label>Role</label><select name="role">${ROLES.map(r=>`<option value="${r}">${roleName(r)}</option>`).join('')}</select></div><div class="field"><label>School (optional)</label><select name="schoolId"><option value="">No school yet</option>${schoolOptions()}</select></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary">Pre-register</button></div></form>`,'IDENTITY');}

async function saveForm(form){
  const d=Object.fromEntries(new FormData(form));
  if(form.id==='org-form'){const r=await addDoc(collection(db,'organizations'),{name:d.name.trim(),type:d.type,code:d.code.trim().toUpperCase(),status:'active',createdBy:state.user.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await logAction('organization.create','organization',r.id,{name:d.name.trim()});closeModal();toast('Organization created.','success');return render('organizations');}
  if(form.id==='school-form'){const org=state.organizations.find(x=>x.id===d.organizationId),r=await addDoc(collection(db,'schools'),{organizationId:d.organizationId,organizationName:org?.name||'',name:d.name.trim(),code:d.code.trim().toUpperCase(),timezone:d.timezone,status:'active',createdBy:state.user.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await logAction('school.create','school',r.id,{name:d.name.trim()});closeModal();toast('School added.','success');return render('organizations');}
  if(form.id==='course-form'){const s=state.schools.find(x=>x.id===d.schoolId),r=await addDoc(collection(db,'courses'),{organizationId:s?.organizationId||'',schoolId:d.schoolId,name:d.name.trim(),courseCode:d.courseCode.trim(),term:d.term.trim(),teacherIds:[],studentIds:[],status:'active',createdBy:state.user.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await logAction('course.create','course',r.id,{name:d.name.trim()});closeModal();toast('Course shell created.','success');return render('courses');}
  if(form.id==='invite-form'){const mail=emailKey(d.email);if(mail===OWNER_EMAIL){toast('The bootstrap owner already has owner access.','error');return;}const s=state.schools.find(x=>x.id===d.schoolId);await setDoc(doc(db,'invitations',mail),{email:mail,role:d.role,schoolId:d.schoolId||'',organizationId:s?.organizationId||'',status:'active',invitedBy:state.user.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});await logAction('invitation.create','invitation',mail,{role:d.role});closeModal();toast('Access pre-registered.','success');return render('people');}
}

async function pageAction(e){
  const jump=e.target.closest('[data-jump]');if(jump)return render(jump.dataset.jump);
  const n=e.target.closest('[data-action]');if(!n)return;const a=n.dataset.action;
  if(a==='new-org')showOrg(); if(a==='new-school')showSchool(); if(a==='new-course')showCourse(); if(a==='invite')showInvite(); if(a==='close')closeModal(); if(a==='logout')signOut(auth);
  if(a==='flag'&&isOwner()){const enabled=n.dataset.enabled==='1';await updateDoc(doc(db,'featureFlags',n.dataset.id),{enabled:!enabled,updatedBy:state.user.uid,updatedAt:serverTimestamp()});await logAction('feature_flag.toggle','featureFlag',n.dataset.id,{enabled:!enabled});toast('Feature flag updated.','success');render('platform');}
}

function wire(){
  $('auth-form').addEventListener('submit',emailAuth);$('google-auth').onclick=googleAuth;$('forgot-password').onclick=resetPassword;$('auth-switch').onclick=()=>setMode(state.mode==='signin'?'signup':'signin');$('sign-out').onclick=()=>signOut(auth);
  $('page-content').addEventListener('click',pageAction);$('modal-body').addEventListener('click',pageAction);$('modal-body').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button[type="submit"],button:not([type])');busy(b,true,'Saving…');try{await saveForm(e.target);}catch(err){console.error(err);toast(err.message||'Could not save.','error');busy(b,false);}});
  $('modal-close').onclick=closeModal;$('modal').onclick=e=>{if(e.target.id==='modal')closeModal();};
  document.querySelectorAll('.nav-item[data-route]').forEach(b=>b.onclick=()=>{render(b.dataset.route);$('sidebar').classList.remove('open');});$('sidebar-open').onclick=()=>$('sidebar').classList.add('open');$('sidebar-close').onclick=()=>$('sidebar').classList.remove('open');
  $('global-search').onclick=()=>openModal('Search ClassOS','<div class="callout">Global entity search is wired into the Phase 1 shell and will expand with assignments, submissions, and gradebook data in Phase 2.</div>','SEARCH');
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
}
wire();setMode('signin');

onAuthStateChanged(auth,async user=>{
  if(!user){state.user=null;state.profile=null;$('app-view').classList.add('hidden');$('auth-view').classList.remove('hidden');return;}
  const usesPassword=user.providerData.some(p=>p.providerId==='password');
  if(usesPassword&&!user.emailVerified){showVerification(user);return;}
  $('auth-view').classList.add('hidden');$('app-view').classList.remove('hidden');$('page-content').innerHTML='<div class="skeleton" style="height:180px"></div>';
  try{state.user=user;state.profile=await ensureProfile(user);shellProfile();await logAction('session.sign_in','user',user.uid,{provider:user.providerData?.[0]?.providerId||'unknown'});await render('dashboard');}
  catch(e){console.error(e);$('page-content').innerHTML=`<div class="empty-state"><strong>ClassOS sign-in succeeded, but setup could not finish.</strong>${esc(e.message)}</div>`;toast('Signed in, but ClassOS could not finish loading.','error');}
});
