/* ClassOS 2.0 experience layer
   Enhances the existing app without changing Firestore schema or authorization. */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

function roleText() {
  return ($('#mini-role')?.textContent || '').trim();
}

function isTeacherLike() {
  return ['Teacher', 'School Admin', 'District Admin', 'Platform Owner'].includes(roleText());
}

function groupNavigation() {
  const nav = $('#primary-nav');
  if (!nav || nav.dataset.classos2Grouped === 'true') return;

  const buttons = $$('.nav-item', nav);
  if (!buttons.length) return;

  const academic = new Set(['dashboard', 'courses', 'assignments', 'gradebook', 'attendance', 'calendar', 'people']);
  const communication = new Set(['inbox', 'family', 'absent']);
  const administration = new Set(['organizations', 'platform']);

  const classify = (button) => {
    const route = button.dataset.route || button.dataset.p3Route || button.dataset.p4Route || button.dataset.manageRoute || button.dataset.workspaceRoute || '';
    if (academic.has(route) || ['assessments', 'command', 'support'].includes(route)) return 'TEACHING';
    if (communication.has(route)) return 'COMMUNICATION';
    if (administration.has(route) || ['district', 'operations', 'manage', 'workspace'].includes(route)) return 'ADMINISTRATION';
    return 'MORE';
  };

  let previous = '';
  buttons.forEach((button) => {
    const group = classify(button);
    if (group !== previous) {
      const label = document.createElement('div');
      label.className = 'classos2-nav-label';
      label.textContent = group;
      nav.insertBefore(label, button);
      previous = group;
    }
  });
  nav.dataset.classos2Grouped = 'true';
}

function addTeacherCommandCenter() {
  const content = $('#page-content');
  if (!content || $('#page-title')?.textContent !== 'Home' || !isTeacherLike()) return;
  if ($('.classos2-command-center', content)) return;

  const hero = $('.hero', content);
  const section = document.createElement('section');
  section.className = 'classos2-command-center';
  section.innerHTML = `
    <div class="classos2-command-head">
      <div>
        <span class="eyebrow">QUICK ACTIONS</span>
        <h3>Run your classroom</h3>
        <p>Get to the work teachers do most without digging through menus.</p>
      </div>
      <span class="classos2-kbd-hint">⌘/Ctrl + K to search</span>
    </div>
    <div class="classos2-action-grid">
      <button data-classos2-route="gradebook"><strong>Enter grades</strong><span>Open the spreadsheet gradebook</span></button>
      <button data-classos2-route="assignments"><strong>Create or review work</strong><span>Assignments and grading queue</span></button>
      <button data-classos2-route="attendance"><strong>Take attendance</strong><span>Record today’s class attendance</span></button>
      <button data-classos2-route="courses"><strong>Open a course</strong><span>Modules, people, assessments, and more</span></button>
      <button data-classos2-route="calendar"><strong>Plan the week</strong><span>See deadlines and workload collisions</span></button>
      <button data-classos2-route="inbox"><strong>Message students</strong><span>Open ClassOS communication</span></button>
    </div>`;

  if (hero) hero.insertAdjacentElement('afterend', section);
  else content.prepend(section);
}

function installQuickActionRouting() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-classos2-route]');
    if (!button) return;
    const route = button.dataset.classos2Route;
    const target = document.querySelector(`#primary-nav [data-route="${route}"]`);
    if (target) target.click();
  });
}

function enhanceGradebook() {
  if ($('#page-title')?.textContent !== 'Gradebook') return;
  const root = $('.gradebook-plus');
  if (!root || $('.classos2-grade-tools', root)) return;

  const tableWrap = $('.gb-table-wrap', root);
  if (!tableWrap) return;

  const tools = document.createElement('div');
  tools.className = 'classos2-grade-tools';
  tools.innerHTML = `
    <div class="classos2-grade-search">
      <span aria-hidden="true">⌕</span>
      <input type="search" id="classos2-grade-filter" placeholder="Find a student…" autocomplete="off" aria-label="Find a student in the gradebook">
    </div>
    <div class="classos2-grade-shortcuts">
      <span><kbd>M</kbd> Missing</span>
      <span><kbd>EX</kbd> Excused</span>
      <span><kbd>Enter</kbd> Next student</span>
    </div>`;
  tableWrap.insertAdjacentElement('beforebegin', tools);

  $('#classos2-grade-filter')?.addEventListener('input', (event) => {
    const q = event.target.value.trim().toLowerCase();
    $$('.gb-table tbody tr').forEach((row) => {
      const name = $('.gb-student', row)?.textContent.toLowerCase() || '';
      row.hidden = q && !name.includes(q);
    });
  });

  $$('.gb-grade-input').forEach((input) => {
    input.addEventListener('focus', () => input.closest('tr')?.classList.add('classos2-row-focus'));
    input.addEventListener('blur', () => input.closest('tr')?.classList.remove('classos2-row-focus'));
  });
}

function protectUnsavedGrades() {
  window.addEventListener('beforeunload', (event) => {
    if (document.querySelector('.gb-grade-input.is-dirty')) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!event.target.matches?.('.gb-grade-input')) return;
    const input = event.target;
    if (event.key.toLowerCase() === 'm' && !input.value) {
      input.value = 'M';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);
}

function makeCourseCardsActionable() {
  if ($('#page-title')?.textContent !== 'Courses') return;
  $$('.course-card').forEach((card) => {
    if (card.dataset.classos2Enhanced) return;
    card.dataset.classos2Enhanced = 'true';
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'group');
    card.classList.add('classos2-course-card');
  });
}

function addPageDescriptor() {
  const topbar = $('.topbar-left > div');
  if (!topbar || $('.classos2-page-desc', topbar)) return;
  const page = ($('#page-title')?.textContent || '').trim();
  const descriptions = {
    Home: 'What needs your attention right now',
    Courses: 'Your classes and course spaces',
    Course: 'Teach, organize, and communicate',
    Assignments: 'Create, collect, and grade work',
    Gradebook: 'Fast, spreadsheet-style grading',
    Attendance: 'Record and review attendance',
    Calendar: 'Plan coursework and deadlines',
    Inbox: 'Classroom communication',
    People: 'Students and course members'
  };
  if (!descriptions[page]) return;
  const p = document.createElement('p');
  p.className = 'classos2-page-desc';
  p.textContent = descriptions[page];
  topbar.appendChild(p);
}

function decorate() {
  groupNavigation();
  addTeacherCommandCenter();
  enhanceGradebook();
  makeCourseCardsActionable();
  addPageDescriptor();
  document.documentElement.classList.add('classos2');
}

installQuickActionRouting();
protectUnsavedGrades();

const content = $('#page-content');
if (content) new MutationObserver(() => requestAnimationFrame(decorate)).observe(content, { childList: true, subtree: false });

const title = $('#page-title');
if (title) new MutationObserver(() => requestAnimationFrame(decorate)).observe(title, { childList: true, subtree: true });

const nav = $('#primary-nav');
if (nav) new MutationObserver(() => requestAnimationFrame(groupNavigation)).observe(nav, { childList: true, subtree: true });

decorate();
window.setTimeout(decorate, 300);
window.setTimeout(decorate, 1200);
