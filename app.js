const root = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');

const state = {
  user: null,
  workspace: null,
  view: 'overview',
  modal: null,
  selectedNoteId: null,
  quiz: [],
  quizIndex: 0,
  quizResult: null,
  focusSeconds: 25 * 60,
  focusLength: 25,
  timerId: null,
  timerRunning: false
};

const icons = { overview: '01', planner: '02', courses: '03', exams: '04', notes: '05', revision: '06', settings: '07' };
const titles = { overview: 'Your orbit', planner: 'Weekly planner', courses: 'Courses', exams: 'Exam board', notes: 'Study notes', revision: 'Revision room', settings: 'Workspace settings' };

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function today() { return new Date().toISOString().slice(0, 10); }
function friendlyDate(value) {
  if (!value) return 'Unscheduled';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Unscheduled' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}
function dayName(value) { return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(`${value}T12:00:00`)); }
function timeLabel(value) { return value || 'Any time'; }
function getCourse(id) { return state.workspace?.courses?.find((course) => course.id === id); }
function courseName(id) { return getCourse(id)?.name || 'Independent study'; }
function initials(name) { return String(name || 'O').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function focusTime() { const seconds = Math.max(0, state.focusSeconds); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function currentWeekMinutes() { return (state.workspace?.focusSessions || []).reduce((total, session) => total + Number(session.minutes || 0), 0); }
function completedCount() { return (state.workspace?.tasks || []).filter((task) => task.done).length; }

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type === 'error' ? 'error' : ''}`;
  item.textContent = message;
  toastRegion.append(item);
  setTimeout(() => item.remove(), 3400);
}

function applyTheme() {
  document.body.classList.toggle('light', state.workspace?.settings?.theme === 'light');
}

async function hydrate() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    if (state.user) {
      const data = await api('/api/workspace');
      state.workspace = data.workspace;
      applyTheme();
    }
  } catch (error) {
    toast(error.message, 'error');
  }
  render();
}

function landing() {
  return `
    <main class="landing">
      <nav class="landing-nav">
        <span class="orbit-mark">Orbit</span>
        <div class="nav-actions">
          <button class="button button-secondary" data-action="auth" data-mode="login">Sign in</button>
          <button class="button button-primary" data-action="auth" data-mode="register">Create your space</button>
        </div>
      </nav>
      <section class="landing-hero">
        <div>
          <div class="eyebrow">A calmer way to learn</div>
          <h1>Make room to <span>focus.</span></h1>
          <p class="landing-copy">Orbit brings your study blocks, deadlines, notes, focus sessions, and revision practice into one private workspace you can return to from any device.</p>
          <div class="hero-actions">
            <button class="button button-primary" data-action="auth" data-mode="register">Build my weekly plan <span aria-hidden="true">→</span></button>
            <button class="button button-secondary" data-action="auth" data-mode="login">I already have an account</button>
          </div>
          <div class="hero-proof">
            <div><strong class="proof-number">01</strong><span class="proof-copy">personal workspace</span></div>
            <div><strong class="proof-number">06</strong><span class="proof-copy">study tools in one flow</span></div>
            <div><strong class="proof-number">∞</strong><span class="proof-copy">room to improve</span></div>
          </div>
        </div>
        <div class="showcase" aria-label="Preview of the Orbit workspace">
          <div class="rings"></div>
          <div class="showcase-card">
            <div class="showcase-top"><span class="orbit-mark">Orbit</span><span class="showcase-user"><b class="avatar">AL</b> Today</span></div>
            <div class="progress-hero"><span class="eyebrow">This week</span><h3>Make room to focus.</h3><div class="bar"><i style="width:62%"></i></div></div>
            <div class="mini-plan">
              <div class="mini-task"><i class="dot"></i><span>Review database chapter</span><time>10:00</time></div>
              <div class="mini-task"><i class="dot"></i><span>Write OS notes</span><time>14:30</time></div>
              <div class="mini-task"><i class="dot"></i><span>Revision checkpoint</span><time>18:00</time></div>
            </div>
          </div>
          <div class="showcase-tip"><b class="eyebrow">Momentum</b><br/>2 focus sessions done</div>
        </div>
      </section>
      <footer class="landing-footer">Orbit is an educational study-planning project. Your account data is private to your workspace.</footer>
      <div id="modal-root"></div>
    </main>`;
}

function nav() {
  const items = Object.keys(icons).map((key) => `<button class="nav-item ${state.view === key ? 'active' : ''}" data-action="view" data-view="${key}"><span class="nav-icon">${icons[key]}</span><span>${key === 'overview' ? 'Overview' : key[0].toUpperCase() + key.slice(1)}</span></button>`).join('');
  return `<aside class="sidebar">
    <span class="orbit-mark">Orbit</span>
    <nav class="sidebar-nav" aria-label="Study workspace navigation">${items}</nav>
    <div class="sidebar-bottom"><div class="signed-user"><b class="avatar">${esc(initials(state.user.name))}</b><div><strong>${esc(state.user.name)}</strong><span>Private workspace</span></div></div><button class="sidebar-logout" data-action="logout">Sign out</button></div>
  </aside>`;
}

function overview() {
  const tasks = [...state.workspace.tasks].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 5);
  const upcomingExams = [...state.workspace.exams].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const goal = Number(state.workspace.settings?.weeklyGoal || 8) * 60;
  const minutes = currentWeekMinutes();
  const percent = Math.min(100, Math.round((minutes / goal) * 100));
  return `<div class="dashboard-grid">
    <section class="stats">
      <article class="stat-card"><span class="stat-label">Focus this week</span><strong class="stat-value">${minutes}<small>m</small></strong><span class="stat-note">of ${goal} minute goal</span></article>
      <article class="stat-card violet"><span class="stat-label">Tasks completed</span><strong class="stat-value">${completedCount()}</strong><span class="stat-note">from ${state.workspace.tasks.length} study blocks</span></article>
      <article class="stat-card"><span class="stat-label">Courses in motion</span><strong class="stat-value">${state.workspace.courses.length}</strong><span class="stat-note">build a steady rhythm</span></article>
    </section>
    <section class="panel">
      <header class="panel-head"><div><div class="panel-kicker">TODAY'S PLAN</div><h3 class="panel-title">Small steps, real progress</h3></div><button class="button button-ghost" data-action="add-task">+ Add</button></header>
      <div class="task-list">${tasks.length ? tasks.map(taskLine).join('') : empty('Your plan is clear.', 'Add one small study block to give today direction.', 'add-task', 'Add a block')}</div>
    </section>
    <section class="panel focus-card">
      <div class="panel-kicker">FOCUS ROOM</div><div class="timer" data-timer>${focusTime()}</div><p>${state.timerRunning ? 'One task. One interval. Keep going.' : 'Choose an interval and give it your full attention.'}</p>
      <div class="timer-actions"><button class="button button-primary" data-action="timer">${state.timerRunning ? 'Pause' : 'Start focus'}</button><button class="button button-secondary" data-action="timer-reset">Reset</button></div>
    </section>
    <section class="panel progress-panel">
      <header class="panel-head"><div><div class="panel-kicker">WEEKLY PACE</div><h3 class="panel-title">Keep your promise to yourself</h3></div></header>
      <div class="goal-row"><span>${minutes} focused minutes</span><strong>${percent}%</strong></div><div class="bar"><i style="width:${percent}%"></i></div>
      <div class="form-grid"><div class="field"><label for="focus-length">Next focus interval</label><select id="focus-length" data-action="focus-length"><option value="15" ${state.focusLength === 15 ? 'selected' : ''}>15 minutes</option><option value="25" ${state.focusLength === 25 ? 'selected' : ''}>25 minutes</option><option value="50" ${state.focusLength === 50 ? 'selected' : ''}>50 minutes</option></select></div><div class="field"><label>Weekly goal</label><button class="button button-secondary" data-action="view" data-view="settings">${state.workspace.settings?.weeklyGoal || 8} hours · Edit</button></div></div>
    </section>
    <section class="panel">
      <header class="panel-head"><div><div class="panel-kicker">UPCOMING</div><h3 class="panel-title">Exam checkpoints</h3></div><button class="button button-ghost" data-action="view" data-view="exams">Board</button></header>
      <div class="exam-list">${upcomingExams.length ? upcomingExams.map((exam) => `<div class="exam-row"><div class="date-chip">${esc(dayName(exam.date))}<br>${esc(friendlyDate(exam.date))}</div><div><strong>${esc(exam.title)}</strong><span>${esc(courseName(exam.courseId))}${exam.place ? ` · ${esc(exam.place)}` : ''}</span></div></div>`).join('') : empty('Nothing scheduled yet.', 'Add an exam or deadline so Orbit can keep it visible.', 'add-exam', 'Add an exam')}</div>
    </section>
  </div>`;
}

function taskLine(task) {
  return `<div class="task-line"><button class="check ${task.done ? 'done' : ''}" aria-label="${task.done ? 'Mark incomplete' : 'Mark complete'}" data-action="toggle-task" data-id="${task.id}">${task.done ? '✓' : ''}</button><div class="task-copy"><strong class="${task.done ? 'done' : ''}">${esc(task.title)}</strong><span>${esc(courseName(task.courseId))} · ${esc(friendlyDate(task.date))} ${task.time ? `· ${esc(task.time)}` : ''}</span></div><span class="priority ${task.priority}">${esc(task.priority)}</span></div>`;
}

function planner() {
  const tasks = [...state.workspace.tasks].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() + index); return date.toISOString().slice(0, 10); });
  return `<div class="planner-layout"><section class="panel"><header class="panel-head"><div><div class="panel-kicker">YOUR RHYTHM</div><h3 class="panel-title">Plan the next meaningful block</h3></div><button class="button button-primary" data-action="add-task">+ Study block</button></header><div class="week-tabs">${days.map((date, index) => `<button class="day-tab ${index === 0 ? 'active' : ''}" data-action="planner-day" data-date="${date}"><strong>${index === 0 ? 'Today' : dayName(date)}</strong><span>${friendlyDate(date)}</span></button>`).join('')}</div><div class="schedule">${tasks.length ? tasks.map((task) => `<article class="schedule-item"><time>${esc(timeLabel(task.time))}<br/><span>${task.duration}m</span></time><div><strong class="${task.done ? 'muted' : ''}">${esc(task.title)}</strong><span>${esc(courseName(task.courseId))} · ${esc(friendlyDate(task.date))} · ${esc(task.priority)} priority</span></div><div class="row-actions"><button class="small-action" data-action="toggle-task" data-id="${task.id}">${task.done ? 'Reopen' : 'Done'}</button><button class="small-action" data-action="edit-task" data-id="${task.id}">Edit</button><button class="small-action danger" data-action="delete-task" data-id="${task.id}">Remove</button></div></article>`).join('') : empty('Your planner is empty.', 'Start with your next 30-minute study block.', 'add-task', 'Add a study block')}</div></section><aside class="panel quick-form"><div><div class="panel-kicker">PLANNING TIP</div><h3 class="panel-title">Keep blocks small enough to start.</h3></div><p class="muted" style="font-size:.82rem;line-height:1.6;margin:0">Name the outcome, choose a date, and let your week become visible.</p><div class="bar"><i style="width:74%"></i></div><button class="button button-secondary" data-action="add-task">Create the next block</button></aside></div>`;
}

function courses() {
  const cards = state.workspace.courses.map((course) => {
    const percent = Math.min(100, Math.round((Number(course.completedHours || 0) / Number(course.targetHours || 1)) * 100));
    return `<article class="course-card" style="--course-color:${esc(course.color || '#baf91a')}"><div class="row-actions"><button class="small-action" data-action="edit-course" data-id="${course.id}">Edit</button><button class="small-action danger" data-action="delete-course" data-id="${course.id}">Remove</button></div><span class="course-code">${esc(course.code || 'STUDY')}</span><h3>${esc(course.name)}</h3><div class="course-meta"><span>Progress</span><strong>${course.completedHours || 0} / ${course.targetHours || 0} hrs</strong></div><div class="bar"><i style="width:${percent}%;background:${esc(course.color || '#baf91a')}"></i></div><div class="course-meta"><span>${percent}% complete</span><span>${(state.workspace.tasks || []).filter((task) => task.courseId === course.id && !task.done).length} open blocks</span></div></article>`;
  }).join('');
  return `<div class="view-header"><div><div class="eyebrow">LEARNING MAP</div><h2>Give every subject a place.</h2><p>Track target hours and connect study blocks to each course.</p></div><button class="button button-primary" data-action="add-course">+ Add course</button></div><div class="course-grid">${cards || empty('No courses yet.', 'Add a course to organise your planner around your actual subjects.', 'add-course', 'Add first course')}</div>`;
}

function exams() {
  const cards = [...state.workspace.exams].sort((a, b) => a.date.localeCompare(b.date)).map((exam) => `<article class="exam-card"><button class="small-action danger" data-action="delete-exam" data-id="${exam.id}">Remove</button><span class="calendar-date">${esc(dayName(exam.date).toUpperCase())} · ${esc(friendlyDate(exam.date).toUpperCase())}${exam.time ? ` · ${esc(exam.time)}` : ''}</span><h3>${esc(exam.title)}</h3><p>${esc(courseName(exam.courseId))}${exam.place ? `<br/>${esc(exam.place)}` : ''}</p></article>`).join('');
  return `<div class="view-header"><div><div class="eyebrow">DEADLINE BOARD</div><h2>See what needs your attention.</h2><p>Keep assessments and important checkpoints in one calm view.</p></div><button class="button button-primary" data-action="add-exam">+ Add exam</button></div><div class="exam-board">${cards || empty('No deadlines planned.', 'Add an exam, assignment, or review checkpoint.', 'add-exam', 'Add a deadline')}</div>`;
}

function notes() {
  const selected = state.workspace.notes.find((note) => note.id === state.selectedNoteId) || state.workspace.notes[0] || null;
  if (selected && !state.selectedNoteId) state.selectedNoteId = selected.id;
  return `<div class="view-header"><div><div class="eyebrow">KNOWLEDGE GARDEN</div><h2>Notes that stay close to the work.</h2><p>Save compact explanations, revision prompts, and useful reminders.</p></div><button class="button button-primary" data-action="new-note">+ New note</button></div><div class="notes-layout"><section class="panel"><header class="panel-head"><h3 class="panel-title">Your notes</h3><span class="panel-kicker">${state.workspace.notes.length} saved</span></header><div class="note-list">${state.workspace.notes.length ? state.workspace.notes.map((note) => `<button class="note-item ${selected?.id === note.id ? 'active' : ''}" data-action="select-note" data-id="${note.id}"><strong>${note.favourite ? '★ ' : ''}${esc(note.title)}</strong><span>${esc(note.tag || 'GENERAL')} · ${new Date(note.updatedAt).toLocaleDateString()}</span></button>`).join('') : empty('No notes yet.', 'Create the first note for this workspace.', 'new-note', 'New note')}</div></section><section class="panel note-editor">${noteEditor(selected)}</section></div>`;
}

function noteEditor(note) {
  return `<form data-form="note"><input type="hidden" name="id" value="${esc(note?.id || '')}"><div class="notes-form-top"><div class="field"><label for="note-title">Title</label><input id="note-title" required maxlength="100" name="title" value="${esc(note?.title || '')}" placeholder="A useful idea" /></div><div class="field"><label for="note-tag">Label</label><input id="note-tag" maxlength="30" name="tag" value="${esc(note?.tag || '')}" placeholder="REVISION" /></div></div><div class="field" style="flex:1"><label for="note-content">Your note</label><textarea id="note-content" name="content" placeholder="Write in plain text - summaries, formulas, questions, or next steps.">${esc(note?.content || '')}</textarea></div><div class="note-editor-actions"><label class="muted" style="font-size:.74rem"><input type="checkbox" name="favourite" ${note?.favourite ? 'checked' : ''}> Keep near the top</label><div class="row-actions">${note ? `<button type="button" class="button button-danger" data-action="delete-note" data-id="${note.id}">Delete</button>` : ''}<button class="button button-primary" type="submit">${note ? 'Save changes' : 'Save note'}</button></div></div></form>`;
}

function revision() {
  const question = state.quiz[state.quizIndex];
  const attempts = state.workspace.revisionResults.slice(0, 4);
  if (!question) return `<div class="quiz-layout"><div class="empty-state"><h3>Revision room is ready.</h3><p>Load a short server-scored practice round to test what you remember.</p><button class="button button-primary" data-action="load-quiz">Load practice round</button></div></div>`;
  return `<div class="quiz-layout"><div class="view-header"><div><div class="eyebrow">RECALL PRACTICE</div><h2>Learn by bringing it back.</h2><p>Short questions, immediate score, saved history.</p></div></div><form class="quiz-card" data-form="quiz"><div class="quiz-count">QUESTION ${state.quizIndex + 1} / ${state.quiz.length}</div><h3>${esc(question.question)}</h3><div class="answer-options">${question.choices.map((choice, index) => `<label class="answer-option"><input type="radio" required name="${question.id}" value="${index}"><span>${esc(choice)}</span></label>`).join('')}</div><div class="quiz-actions">${state.quizIndex > 0 ? `<button type="button" class="button button-secondary" data-action="quiz-prev">Previous</button>` : '<span></span>'}${state.quizIndex < state.quiz.length - 1 ? `<button type="button" class="button button-primary" data-action="quiz-next">Next</button>` : `<button class="button button-primary" type="submit">Score my round</button>`}</div>${state.quizResult ? `<div class="quiz-result">You scored ${state.quizResult.score} / ${state.quizResult.total}. ${state.quizResult.score >= 4 ? 'Strong recall - keep that rhythm.' : 'Review the weaker areas, then try again.'}</div>` : ''}</form>${attempts.length ? `<div class="attempt-list">${attempts.map((attempt) => `<div class="attempt-row"><span>${new Date(attempt.createdAt).toLocaleDateString()}</span><strong>${attempt.score} / ${attempt.total}</strong></div>`).join('')}</div>` : ''}</div>`;
}

function settings() {
  const settings = state.workspace.settings || {};
  return `<div class="settings-layout"><div class="view-header"><div><div class="eyebrow">MAKE IT YOURS</div><h2>A workspace that fits your rhythm.</h2><p>Your preferences are saved with your personal study space.</p></div></div><section class="panel"><header class="panel-head"><h3 class="panel-title">Focus and appearance</h3></header><div class="setting-row"><div><strong>Weekly focus goal</strong><p>Set the number of hours you want to protect for study.</p></div><form data-form="goal" style="display:flex;gap:7px;align-items:center"><input aria-label="Weekly focus goal in hours" type="number" min="1" max="80" name="weeklyGoal" value="${Number(settings.weeklyGoal || 8)}" style="width:75px"><span class="muted" style="font-size:.75rem">hrs</span><button class="button button-primary" type="submit">Save</button></form></div><div class="setting-row"><div><strong>Colour mode</strong><p>Choose a calm canvas for your sessions.</p></div><div class="theme-choices"><button class="theme-choice ${settings.theme !== 'light' ? 'selected' : ''}" data-action="theme" data-theme="dark">Dark</button><button class="theme-choice ${settings.theme === 'light' ? 'selected' : ''}" data-action="theme" data-theme="light">Light</button></div></div></section><section class="panel"><header class="panel-head"><h3 class="panel-title">About this project</h3></header><p class="muted" style="font-size:.82rem;line-height:1.65;margin:0">Orbit is a full-stack educational study planner. Your account, study blocks, courses, exam reminders, notes, focus history, and revision attempts are isolated to your own cloud workspace.</p></section></div>`;
}

function content() {
  if (state.view === 'planner') return planner();
  if (state.view === 'courses') return courses();
  if (state.view === 'exams') return exams();
  if (state.view === 'notes') return notes();
  if (state.view === 'revision') return revision();
  if (state.view === 'settings') return settings();
  return overview();
}

function appShell() {
  return `<div class="shell">${nav()}<main class="main"><header class="topbar"><div><div class="eyebrow">${state.view === 'overview' ? 'YOUR PRIVATE STUDY SPACE' : titles[state.view].toUpperCase()}</div><h1>${titles[state.view]}</h1></div><div class="topbar-right"><span class="status-pill">Cloud workspace active</span><button class="icon-button" title="Open settings" data-action="view" data-view="settings">⚙</button></div></header><div class="view">${content()}</div></main><div id="modal-root"></div></div>`;
}

function empty(title, description, action, label) { return `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(description)}</p><button class="button button-secondary" data-action="${action}">${esc(label)}</button></div>`; }

function render() {
  root.innerHTML = state.user ? appShell() : landing();
  renderModal();
}

function renderModal() {
  const host = document.querySelector('#modal-root');
  if (!host || !state.modal) return;
  const modal = state.modal;
  if (modal.type === 'auth') {
    const registering = modal.mode === 'register';
    host.innerHTML = `<div class="modal-backdrop"><section class="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><header class="modal-head"><div><div class="eyebrow">WELCOME TO ORBIT</div><h2 id="auth-title">${registering ? 'Create your workspace' : 'Welcome back'}</h2></div><button class="icon-button" aria-label="Close" data-action="close-modal">×</button></header><div class="auth-strap">${registering ? 'Your study plan is saved to a private cloud workspace after you create an account.' : 'Sign in to return to your personal courses, tasks, notes, and progress.'}</div><form data-form="auth"><input type="hidden" name="mode" value="${modal.mode}">${registering ? `<div class="field" style="margin-bottom:12px"><label for="auth-name">Your name</label><input required id="auth-name" name="name" maxlength="60" autocomplete="name" placeholder="How should Orbit greet you?" /></div>` : ''}<div class="field" style="margin-bottom:12px"><label for="auth-email">Email</label><input required id="auth-email" type="email" name="email" autocomplete="email" placeholder="you@example.com" /></div><div class="field"><label for="auth-password">Password</label><input required id="auth-password" type="password" minlength="8" name="password" autocomplete="${registering ? 'new-password' : 'current-password'}" placeholder="At least 8 characters" /></div><div class="form-error" data-form-error></div><button class="button button-primary" style="width:100%;margin-top:13px" type="submit">${registering ? 'Create my workspace' : 'Sign in to Orbit'}</button></form><p class="auth-switch">${registering ? 'Already have a workspace?' : 'New to Orbit?'}<button data-action="switch-auth" data-mode="${registering ? 'login' : 'register'}">${registering ? 'Sign in' : 'Create one'}</button></p></section></div>`;
    return;
  }
  const item = modal.id ? (modal.type === 'task' ? state.workspace.tasks.find((task) => task.id === modal.id) : modal.type === 'course' ? state.workspace.courses.find((course) => course.id === modal.id) : null) : null;
  const title = modal.type === 'task' ? (item ? 'Edit study block' : 'Add a study block') : modal.type === 'course' ? (item ? 'Edit course' : 'Add a course') : 'Add an exam';
  host.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><div><div class="eyebrow">ORBIT PLANNER</div><h2>${title}</h2></div><button class="icon-button" aria-label="Close" data-action="close-modal">×</button></header>${modalForm(modal.type, item)}</section></div>`;
}

function courseOptions(selected = '') { return `<option value="">Independent study</option>${state.workspace.courses.map((course) => `<option value="${course.id}" ${course.id === selected ? 'selected' : ''}>${esc(course.name)}</option>`).join('')}`; }
function modalForm(type, item) {
  if (type === 'task') return `<form data-form="task"><input type="hidden" name="id" value="${esc(item?.id || '')}"><div class="form-grid"><div class="field full"><label>What is the outcome?</label><input required name="title" maxlength="100" value="${esc(item?.title || '')}" placeholder="e.g. Review linked-list questions" /></div><div class="field"><label>Course</label><select name="courseId">${courseOptions(item?.courseId)}</select></div><div class="field"><label>Priority</label><select name="priority">${['low','medium','high'].map((priority) => `<option value="${priority}" ${item?.priority === priority ? 'selected' : ''}>${priority[0].toUpperCase() + priority.slice(1)}</option>`).join('')}</select></div><div class="field"><label>Date</label><input type="date" name="date" value="${esc(item?.date || today())}" /></div><div class="field"><label>Start time</label><input type="time" name="time" value="${esc(item?.time || '')}" /></div><div class="field"><label>Duration (minutes)</label><input type="number" name="duration" min="15" max="480" step="15" value="${Number(item?.duration || 60)}" /></div></div><footer class="modal-footer"><button class="button button-secondary" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">${item ? 'Save changes' : 'Add to plan'}</button></footer></form>`;
  if (type === 'course') return `<form data-form="course"><input type="hidden" name="id" value="${esc(item?.id || '')}"><div class="form-grid"><div class="field full"><label>Course name</label><input required name="name" maxlength="70" value="${esc(item?.name || '')}" placeholder="e.g. Data Structures" /></div><div class="field"><label>Course code</label><input name="code" maxlength="20" value="${esc(item?.code || '')}" placeholder="CS204" /></div><div class="field"><label>Accent colour</label><input type="color" name="color" value="${esc(item?.color || '#baf91a')}" /></div><div class="field"><label>Target hours</label><input type="number" name="targetHours" min="1" max="250" value="${Number(item?.targetHours || 20)}" /></div>${item ? `<div class="field"><label>Completed hours</label><input type="number" name="completedHours" min="0" max="250" value="${Number(item?.completedHours || 0)}" /></div>` : ''}</div><footer class="modal-footer"><button class="button button-secondary" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">${item ? 'Save course' : 'Add course'}</button></footer></form>`;
  return `<form data-form="exam"><div class="form-grid"><div class="field full"><label>Exam or checkpoint</label><input required name="title" maxlength="90" placeholder="e.g. Database systems midterm" /></div><div class="field"><label>Course</label><select name="courseId">${courseOptions()}</select></div><div class="field"><label>Date</label><input required type="date" name="date" value="${today()}" /></div><div class="field"><label>Time</label><input type="time" name="time" /></div><div class="field"><label>Room / delivery note</label><input name="place" maxlength="80" placeholder="Room B-204" /></div></div><footer class="modal-footer"><button class="button button-secondary" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">Add checkpoint</button></footer></form>`;
}

async function saveMutation(operation, payload, close = true) {
  const response = await api('/api/workspace/mutate', { method: 'POST', body: JSON.stringify({ operation, payload }) });
  state.workspace = response.workspace;
  if (close) state.modal = null;
  applyTheme();
  render();
  toast(response.message);
}

function openModal(type, id = '') { state.modal = { type, id }; renderModal(); }
function stopTimer() { state.timerRunning = false; clearInterval(state.timerId); state.timerId = null; }
async function finishFocus() { stopTimer(); try { await saveMutation('addFocus', { minutes: state.focusLength, label: 'Orbit focus session' }, false); state.focusSeconds = state.focusLength * 60; render(); toast('Focus session completed and saved.'); } catch (error) { toast(error.message, 'error'); } }

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action } = target.dataset;
  try {
    if (action === 'auth') { state.modal = { type: 'auth', mode: target.dataset.mode }; renderModal(); }
    else if (action === 'switch-auth') { state.modal = { type: 'auth', mode: target.dataset.mode }; renderModal(); }
    else if (action === 'close-modal') { state.modal = null; renderModal(); }
    else if (action === 'view') { state.view = target.dataset.view; state.quizResult = null; render(); if (state.view === 'revision' && !state.quiz.length) await loadQuiz(); }
    else if (action === 'logout') { stopTimer(); await api('/api/auth/logout', { method: 'POST' }); state.user = null; state.workspace = null; state.modal = null; state.view = 'overview'; state.quiz = []; document.body.classList.remove('light'); render(); toast('You have signed out.'); }
    else if (action === 'add-task') openModal('task')
    else if (action === 'edit-task') openModal('task', target.dataset.id)
    else if (action === 'toggle-task') await saveMutation('toggleTask', { id: target.dataset.id }, false)
    else if (action === 'delete-task') await saveMutation('deleteTask', { id: target.dataset.id }, false)
    else if (action === 'add-course') openModal('course')
    else if (action === 'edit-course') openModal('course', target.dataset.id)
    else if (action === 'delete-course') await saveMutation('deleteCourse', { id: target.dataset.id }, false)
    else if (action === 'add-exam') openModal('exam')
    else if (action === 'delete-exam') await saveMutation('deleteExam', { id: target.dataset.id }, false)
    else if (action === 'new-note') { state.selectedNoteId = null; render(); }
    else if (action === 'select-note') { state.selectedNoteId = target.dataset.id; render(); }
    else if (action === 'delete-note') { await saveMutation('deleteNote', { id: target.dataset.id }, false); state.selectedNoteId = state.workspace.notes[0]?.id || null; render(); }
    else if (action === 'theme') await saveMutation('updateSettings', { weeklyGoal: state.workspace.settings.weeklyGoal, theme: target.dataset.theme }, false)
    else if (action === 'timer') {
      if (state.timerRunning) { stopTimer(); render(); }
      else { state.timerRunning = true; state.timerId = setInterval(() => { state.focusSeconds -= 1; const timer = document.querySelector('[data-timer]'); if (timer) timer.textContent = focusTime(); if (state.focusSeconds <= 0) finishFocus(); }, 1000); render(); }
    }
    else if (action === 'timer-reset') { stopTimer(); state.focusSeconds = state.focusLength * 60; render(); }
    else if (action === 'load-quiz') await loadQuiz()
    else if (action === 'quiz-next') { state.quizIndex = Math.min(state.quiz.length - 1, state.quizIndex + 1); render(); }
    else if (action === 'quiz-prev') { state.quizIndex = Math.max(0, state.quizIndex - 1); render(); }
  } catch (error) { toast(error.message, 'error'); }
});

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-action="focus-length"]')) { state.focusLength = Number(event.target.value); if (!state.timerRunning) state.focusSeconds = state.focusLength * 60; render(); }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.matches('[data-form]')) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const errorArea = form.querySelector('[data-form-error]');
  if (errorArea) errorArea.textContent = '';
  try {
    if (form.dataset.form === 'auth') {
      const response = await api(`/api/auth/${data.mode}`, { method: 'POST', body: JSON.stringify(data) });
      state.user = response.user; state.workspace = response.workspace; state.modal = null; applyTheme(); render(); toast(data.mode === 'register' ? 'Your Orbit workspace is ready.' : `Welcome back, ${response.user.name}.`);
    } else if (form.dataset.form === 'task') await saveMutation(data.id ? 'updateTask' : 'addTask', data)
    else if (form.dataset.form === 'course') await saveMutation(data.id ? 'updateCourse' : 'addCourse', data)
    else if (form.dataset.form === 'exam') await saveMutation('addExam', data)
    else if (form.dataset.form === 'note') { data.favourite = form.querySelector('[name="favourite"]').checked; await saveMutation(data.id ? 'updateNote' : 'addNote', data, false); if (!data.id) state.selectedNoteId = state.workspace.notes[0]?.id || null; render(); }
    else if (form.dataset.form === 'goal') await saveMutation('updateSettings', { weeklyGoal: data.weeklyGoal, theme: state.workspace.settings.theme }, false)
    else if (form.dataset.form === 'quiz') {
      const answers = Object.fromEntries(new FormData(form).entries());
      const response = await api('/api/revision/submit', { method: 'POST', body: JSON.stringify({ answers }) });
      state.workspace = response.workspace; state.quizResult = response; render(); toast(`Revision score saved: ${response.score}/${response.total}.`);
    }
  } catch (error) { if (errorArea) errorArea.textContent = error.message; else toast(error.message, 'error'); }
});

async function loadQuiz() {
  try { const response = await api('/api/revision/questions'); state.quiz = response.questions; state.quizIndex = 0; state.quizResult = null; render(); } catch (error) { toast(error.message, 'error'); }
}

hydrate();
