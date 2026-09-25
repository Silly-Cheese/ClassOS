/* ClassOS Next shell enhancements.
   This file intentionally works with the existing ClassOS routes instead of replacing them. */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-7h5v7"/></svg>',
  courses: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16"/><path d="M8 7h8"/></svg>',
  assignments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 4h10l2 2v14H5V6z"/><path d="m8 12 2 2 5-5"/><path d="M8 17h8"/></svg>',
  gradebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h16v16H4z"/><path d="M4 9h16M9 4v16"/><path d="m12 14 2 2 4-5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 6h16v14H4z"/><path d="M8 3v6M16 3v6M4 10h16"/></svg>',
  attendance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="m16 14 2 2 3-4"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 5h18v14H3z"/><path d="m4 6 8 7 8-7"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M15.5 14.5a5 5 0 0 1 5 5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  assessments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h3"/><path d="m14 16 1.5 1.5L19 14"/></svg>',
  insights: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
  support: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  district: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 21h18M5 21V8l7-4 7 4v13"/><path d="M9 10h2v2H9zM13 10h2v2h-2zM9 15h2v2H9zM13 15h2v2h-2z"/></svg>',
  manage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 6h16M7 6V4h10v2M6 6l1 14h10l1-14"/><path d="M10 10v6M14 10v6"/></svg>',
  operations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>',
  workspace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3M4 11h16"/></svg>',
  family: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M14.5 15a5 5 0 0 1 6 5"/></svg>',
  absent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 12a8 8 0 1 0 2-5.3"/><path d="M4 4v5h5"/></svg>',
  structure: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 4v5M5 20v-5h14v5M5 15v-3h14v3"/><circle cx="12" cy="3" r="2"/><circle cx="5" cy="21" r="2"/><circle cx="19" cy="21" r="2"/></svg>',
  course: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 7 9-4 9 4-9 4z"/><path d="M7 9v5c0 2 2.2 4 5 4s5-2 5-4V9"/><path d="M21 7v7"/></svg>',
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 6h16v14H4z"/><path d="M8 3v6M16 3v6M4 10h16"/></svg>'
};

function iconFor(key) {
  return ICONS[key] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="8"/></svg>';
}

function routeKey(button) {
  if (!button) return '';
  const standard = button.dataset.route;
  const special = button.dataset.p3Route || button.dataset.p4Route || button.dataset.manageRoute || button.dataset.workspaceRoute;
  if (standard) return standard === 'dashboard' ? 'home' : standard;
  if (special === 'command') return 'insights';
  if (special === 'district') return 'district';
  return special || 'course';
}

function decorateNavigation() {
  const nav = $('#primary-nav');
  if (!nav) return;

  $('.nav-item', nav).forEach((button) => {
    const span = $('span:first-child', button);
    if (!span) return;
    const key = routeKey(button);
    if (span.dataset.classosIcon === key) return;
    span.innerHTML = iconFor(key);
    span.dataset.classosIcon = key;
  });

  const settings = $('.sidebar-bottom .nav-item[data-route="settings"]');
  if (settings) {
    const span = $('span:first-child', settings);
    if (span && span.dataset.classosIcon !== 'settings') {
      span.innerHTML = iconFor('settings');
      span.dataset.classosIcon = 'settings';
    }
  }
}

function currentPage() {
  return ($('#page-title') && $('#page-title').textContent || 'Home').trim();
}

function currentKicker() {
  return ($('#workspace-kicker') && $('#workspace-kicker').textContent || 'CLASSOS').trim();
}

function clickRoute(route) {
  let button = $('#primary-nav [data-route="' + route + '"]');
  if (button) {
    button.click();
    return true;
  }

  const nav = $('#primary-nav');
  if (!nav) return false;
  button = document.createElement('button');
  button.className = 'nav-item hidden classos-route-proxy';
  button.dataset.route = route;
  nav.appendChild(button);
  button.click();
  window.setTimeout(() => button.remove(), 200);
  return true;
}

function clickSpecial(route) {
  const selectors = [
    '#primary-nav [data-p3-route="' + route + '"]',
    '#primary-nav [data-p4-route="' + route + '"]',
    '#primary-nav [data-manage-route="' + route + '"]',
    '#primary-nav [data-workspace-route="' + route + '"]'
  ];
  for (const selector of selectors) {
    const button = $(selector);
    if (button) {
      button.click();
      return true;
    }
  }
  return false;
}

function navigateTarget(target) {
  if (!target) return;
  if (target.indexOf('special:') === 0) {
    clickSpecial(target.slice(8));
    return;
  }
  clickRoute(target);
}

function targetAvailable(target) {
  if (target === 'course') return true;
  if (target.indexOf('special:') === 0) {
    const route = target.slice(8);
    return Boolean(
      $('#primary-nav [data-p3-route="' + route + '"]') ||
      $('#primary-nav [data-p4-route="' + route + '"]') ||
      $('#primary-nav [data-manage-route="' + route + '"]') ||
      $('#primary-nav [data-workspace-route="' + route + '"]')
    );
  }
  return Boolean($('#primary-nav [data-route="' + target + '"]'));
}

function contextTabs(page) {
  if (page === 'Course') {
    return [
      ['course', 'Course Home', 'course'],
      ['assignments', 'Assignments', 'assignments'],
      ['special:assessments', 'Assessments', 'assessments'],
      ['gradebook', 'Grades', 'gradebook'],
      ['attendance', 'Attendance', 'attendance'],
      ['people', 'People', 'people']
    ];
  }

  if (page === 'Gradebook') {
    return [
      ['gradebook', 'Gradebook', 'gradebook'],
      ['assignments', 'Assignments', 'assignments'],
      ['special:assessments', 'Assessments', 'assessments'],
      ['attendance', 'Attendance', 'attendance']
    ];
  }

  if (page === 'Courses') {
    return [
      ['courses', 'All Courses', 'courses'],
      ['assignments', 'Assignments', 'assignments'],
      ['calendar', 'Calendar', 'calendar']
    ];
  }

  return [];
}

function renderContextBar() {
  const workspace = $('.workspace');
  const topbar = $('.topbar');
  if (!workspace || !topbar) return;

  let bar = $('.classos-contextbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'classos-contextbar';
    topbar.insertAdjacentElement('afterend', bar);
    bar.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-classos-target]');
      if (!tab) return;
      event.preventDefault();
      navigateTarget(tab.dataset.classosTarget);
    });
  }

  const page = currentPage();
  const kicker = currentKicker();
  const tabs = contextTabs(page).filter((item) => targetAvailable(item[0]));
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());

  const breadcrumb = '<div class="classos-breadcrumb"><span>ClassOS</span><span>/</span><strong>' +
    escapeHtml(kicker === 'CLASSOS' ? page : kicker) + '</strong></div>';

  const tabsMarkup = tabs.length
    ? '<div class="classos-context-tabs">' + tabs.map((item) => {
        const active = item[1] === page || (page === 'Course' && item[1] === 'Course Home');
        return '<button class="classos-context-tab' + (active ? ' active' : '') + '" data-classos-target="' +
          escapeHtml(item[0]) + '">' + iconFor(item[2]) + '<span>' + escapeHtml(item[1]) + '</span></button>';
      }).join('') + '</div>'
    : '';

  bar.innerHTML = breadcrumb + tabsMarkup + '<div class="classos-context-meta">' + escapeHtml(date) + '</div>';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function decorateHero() {
  const content = $('#page-content');
  if (!content) return;
  const hero = $('.hero', content);
  if (!hero) return;

  const page = currentPage();
  hero.dataset.classosHero = page.toLowerCase();

  if ((page === 'Home' || page === 'Course') && !$('.classos-today', hero)) {
    const h1 = $('h1', hero);
    if (!h1) return;
    const line = document.createElement('div');
    line.className = 'classos-today';
    line.innerHTML = iconFor('today') + '<span>' +
      escapeHtml(new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())) +
      '</span>';
    h1.insertAdjacentElement('beforebegin', line);
  }
}

function decorateCourseCards() {
  $$('.course-card').forEach((card) => {
    card.setAttribute('data-classos-course-card', 'true');
  });
}

function installMobileDock() {
  if ($('.classos-mobile-dock')) return;
  const dock = document.createElement('nav');
  dock.className = 'classos-mobile-dock';
  dock.setAttribute('aria-label', 'Quick navigation');

  const items = [
    ['dashboard', 'Home', 'home'],
    ['courses', 'Courses', 'courses'],
    ['assignments', 'Work', 'assignments'],
    ['calendar', 'Calendar', 'calendar'],
    ['inbox', 'Inbox', 'inbox']
  ];

  dock.innerHTML = items.map((item) =>
    '<button type="button" data-mobile-route="' + item[0] + '">' +
    iconFor(item[2]) + '<span>' + item[1] + '</span></button>'
  ).join('');

  dock.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mobile-route]');
    if (!button) return;
    clickRoute(button.dataset.mobileRoute);
  });

  document.body.appendChild(dock);
}

function updateMobileDock() {
  const title = currentPage();
  const map = {
    Home: 'dashboard',
    Courses: 'courses',
    Course: 'courses',
    Assignments: 'assignments',
    Calendar: 'calendar',
    Inbox: 'inbox'
  };
  const route = map[title] || '';
  $$('.classos-mobile-dock [data-mobile-route]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mobileRoute === route);
  });
}

function installGradebookKeyboard() {
  document.addEventListener('keydown', (event) => {
    const input = event.target.closest && event.target.closest('.gb-grade-input');
    if (!input) return;

    const inputs = $$('.gb-grade-input');
    const currentIndex = inputs.indexOf(input);
    if (currentIndex < 0) return;

    const row = input.closest('tr');
    const cell = input.closest('td');
    const rows = $$('.gb-table tbody tr');
    const rowIndex = rows.indexOf(row);
    const rowInputs = $$('.gb-grade-input', row);
    const columnIndex = rowInputs.indexOf(input);

    function focusInput(target) {
      if (!target) return;
      event.preventDefault();
      target.focus();
      target.select();
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    if (event.key === 'Enter') {
      const nextRow = rows[rowIndex + (event.shiftKey ? -1 : 1)];
      if (nextRow) focusInput($$('.gb-grade-input', nextRow)[columnIndex]);
      return;
    }

    if (event.altKey && event.key === 'ArrowDown') {
      const nextRow = rows[rowIndex + 1];
      if (nextRow) focusInput($$('.gb-grade-input', nextRow)[columnIndex]);
      return;
    }

    if (event.altKey && event.key === 'ArrowUp') {
      const prevRow = rows[rowIndex - 1];
      if (prevRow) focusInput($$('.gb-grade-input', prevRow)[columnIndex]);
      return;
    }

    if (event.altKey && event.key === 'ArrowRight') {
      focusInput(rowInputs[columnIndex + 1]);
      return;
    }

    if (event.altKey && event.key === 'ArrowLeft') {
      focusInput(rowInputs[columnIndex - 1]);
    }
  }, true);
}

function addGradebookHint() {
  const bar = $('.gb-course-bar');
  if (!bar || $('.classos-gradebook-hint', bar)) return;
  const hint = document.createElement('span');
  hint.className = 'classos-gradebook-hint';
  hint.style.cssText = 'font-size:.64rem;color:var(--muted);margin-left:auto;align-self:center;white-space:nowrap';
  hint.textContent = 'Enter moves down • Alt + arrows move between cells';
  bar.appendChild(hint);
}

let decorating = false;
function decorate() {
  if (decorating) return;
  decorating = true;
  window.requestAnimationFrame(() => {
    decorateNavigation();
    renderContextBar();
    decorateHero();
    decorateCourseCards();
    installMobileDock();
    updateMobileDock();
    addGradebookHint();
    decorating = false;
  });
}

const titleNode = $('#page-title');
if (titleNode) {
  new MutationObserver(decorate).observe(titleNode, { childList: true, characterData: true, subtree: true });
}

const navNode = $('#primary-nav');
if (navNode) {
  new MutationObserver(decorateNavigation).observe(navNode, { childList: true, subtree: true });
}

const contentNode = $('#page-content');
if (contentNode) {
  new MutationObserver(decorate).observe(contentNode, { childList: true, subtree: false });
}

installGradebookKeyboard();
decorate();
window.setTimeout(decorate, 250);
window.setTimeout(decorate, 1000);
