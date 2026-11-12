import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 10000);
const jwtSecret = process.env.JWT_SECRET || 'orbit-local-development-secret-change-me';
const isProduction = process.env.NODE_ENV === 'production';

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '160kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, max: 180, standardHeaders: true, legacyHeaders: false }));

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 120 },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const workspaceSchema = new mongoose.Schema({
  ownerId: { type: String, required: true, unique: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Workspace = mongoose.models.Workspace || mongoose.model('Workspace', workspaceSchema);

let databaseConnected = false;
const memoryUsers = new Map();
const memoryWorkspaces = new Map();

const quizBank = [
  { id: 'q1', question: 'Which study method spaces review sessions over time?', choices: ['Cramming', 'Spaced repetition', 'Passive reading', 'Multitasking'], correct: 1 },
  { id: 'q2', question: 'A good focus block should begin with:', choices: ['A clear, small outcome', 'Every possible task', 'A social media break', 'No time limit'], correct: 0 },
  { id: 'q3', question: 'Which is the best way to prepare for an exam deadline?', choices: ['Wait for the last evening', 'Break it into dated blocks', 'Ignore the course plan', 'Study only one topic'], correct: 1 },
  { id: 'q4', question: 'After a quiz, the most useful next step is to:', choices: ['Hide the result', 'Review weak answers', 'Delete all notes', 'Repeat without feedback'], correct: 1 },
  { id: 'q5', question: 'A realistic weekly goal should be:', choices: ['Specific and reviewable', 'Impossible to measure', 'Copied from another student', 'Changed every hour'], correct: 0 }
];

function defaultWorkspace() {
  return {
    courses: [],
    tasks: [],
    exams: [],
    notes: [],
    focusSessions: [],
    revisionResults: [],
    settings: { weeklyGoal: 8, theme: 'dark' }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function getCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id || String(user._id), name: user.name }, jwtSecret, { expiresIn: '14d' });
  res.cookie('orbit_session', token, { httpOnly: true, secure: isProduction, sameSite: 'lax', maxAge: 14 * 24 * 60 * 60 * 1000, path: '/' });
}

function publicUser(user) {
  return { id: user.id || String(user._id), name: user.name, email: user.email, createdAt: user.createdAt };
}

async function findUserById(id) {
  if (!databaseConnected) return memoryUsers.get(id) || null;
  return User.findById(id).lean();
}

async function findUserByEmail(email) {
  if (!databaseConnected) return [...memoryUsers.values()].find((user) => user.email === email) || null;
  return User.findOne({ email }).lean();
}

async function createUser({ name, email, passwordHash }) {
  if (!databaseConnected) {
    const user = { id: randomUUID(), name, email, passwordHash, createdAt: new Date().toISOString() };
    memoryUsers.set(user.id, user);
    return user;
  }
  const user = await User.create({ name, email, passwordHash });
  return user.toObject();
}

async function getWorkspace(ownerId) {
  if (!databaseConnected) {
    if (!memoryWorkspaces.has(ownerId)) memoryWorkspaces.set(ownerId, defaultWorkspace());
    return clone(memoryWorkspaces.get(ownerId));
  }
  let workspace = await Workspace.findOne({ ownerId }).lean();
  if (!workspace) {
    workspace = (await Workspace.create({ ownerId, data: defaultWorkspace() })).toObject();
  }
  return clone(workspace.data);
}

async function saveWorkspace(ownerId, data) {
  if (!databaseConnected) {
    memoryWorkspaces.set(ownerId, clone(data));
    return;
  }
  await Workspace.findOneAndUpdate({ ownerId }, { data, updatedAt: new Date() }, { upsert: true, new: true });
}

function getUserId(user) {
  return user.id || String(user._id);
}

async function requireUser(req, res, next) {
  try {
    const token = getCookies(req).orbit_session;
    if (!token) return res.status(401).json({ error: 'Please sign in to access your workspace.' });
    const payload = jwt.verify(token, jwtSecret);
    const user = await findUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    req.user = user;
    next();
  } catch {
    res.clearCookie('orbit_session', { path: '/' });
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
}

function idFrom(payload) {
  return cleanText(payload?.id, 80);
}

function findItem(items, id) {
  return items.find((item) => item.id === id);
}

async function connectDatabase() {
  if (!process.env.MONGODB_URI) {
    console.log('Orbit is running in temporary demo-memory mode. Add MONGODB_URI for persistence.');
    return;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    databaseConnected = true;
    console.log('MongoDB connected. Orbit workspaces are persistent.');
  } catch (error) {
    console.error(`MongoDB connection failed; temporary demo-memory mode enabled: ${error.message}`);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'Orbit', database: databaseConnected ? 'connected' : 'demo-memory', persistent: databaseConnected, demoData: !databaseConnected });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const name = cleanText(req.body?.name, 60);
    const email = cleanText(req.body?.email, 120).toLowerCase();
    const password = String(req.body?.password || '');
    if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters for your password.' });
    if (await findUserByEmail(email)) return res.status(409).json({ error: 'An account already exists with this email.' });
    const user = await createUser({ name, email, passwordHash: await bcrypt.hash(password, 12) });
    await saveWorkspace(getUserId(user), defaultWorkspace());
    setSession(res, user);
    res.status(201).json({ user: publicUser(user), workspace: await getWorkspace(getUserId(user)) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'An account already exists with this email.' });
    console.error(error);
    res.status(500).json({ error: 'We could not create your account. Please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = cleanText(req.body?.email, 120).toLowerCase();
    const password = String(req.body?.password || '');
    const user = await findUserByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is not correct.' });
    setSession(res, user);
    const ownerId = getUserId(user);
    res.json({ user: publicUser(user), workspace: await getWorkspace(ownerId) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'We could not sign you in. Please try again.' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('orbit_session', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const token = getCookies(req).orbit_session;
  if (!token) return res.json({ user: null });
  try {
    const payload = jwt.verify(token, jwtSecret);
    const user = await findUserById(payload.sub);
    if (!user) return res.json({ user: null });
    res.json({ user: publicUser(user) });
  } catch {
    res.json({ user: null });
  }
});

app.get('/api/workspace', requireUser, async (req, res) => {
  const workspace = await getWorkspace(getUserId(req.user));
  res.json({ workspace });
});

app.post('/api/workspace/mutate', requireUser, async (req, res) => {
  try {
    const operation = cleanText(req.body?.operation, 40);
    const payload = req.body?.payload || {};
    const ownerId = getUserId(req.user);
    const workspace = await getWorkspace(ownerId);
    let message = 'Workspace updated.';

    if (operation === 'addTask') {
      const title = cleanText(payload.title, 100);
      if (title.length < 2) return res.status(400).json({ error: 'Add a clear study task title.' });
      workspace.tasks.unshift({ id: randomUUID(), title, courseId: cleanText(payload.courseId, 80), date: validDate(payload.date), time: cleanText(payload.time, 8), duration: Math.min(480, Math.max(15, Number(payload.duration) || 60)), priority: ['low', 'medium', 'high'].includes(payload.priority) ? payload.priority : 'medium', done: false, createdAt: new Date().toISOString() });
      message = 'Study block added to your plan.';
    } else if (operation === 'updateTask') {
      const task = findItem(workspace.tasks, idFrom(payload));
      if (!task) return res.status(404).json({ error: 'That study block no longer exists.' });
      const title = cleanText(payload.title, 100);
      if (title.length < 2) return res.status(400).json({ error: 'Add a clear study task title.' });
      Object.assign(task, { title, courseId: cleanText(payload.courseId, 80), date: validDate(payload.date), time: cleanText(payload.time, 8), duration: Math.min(480, Math.max(15, Number(payload.duration) || 60)), priority: ['low', 'medium', 'high'].includes(payload.priority) ? payload.priority : 'medium' });
      message = 'Study block updated.';
    } else if (operation === 'toggleTask') {
      const task = findItem(workspace.tasks, idFrom(payload));
      if (!task) return res.status(404).json({ error: 'That study block no longer exists.' });
      task.done = !task.done;
      task.completedAt = task.done ? new Date().toISOString() : null;
      message = task.done ? 'Nice work - task completed.' : 'Task reopened.';
    } else if (operation === 'deleteTask') {
      workspace.tasks = workspace.tasks.filter((task) => task.id !== idFrom(payload));
      message = 'Study block removed.';
    } else if (operation === 'addCourse') {
      const name = cleanText(payload.name, 70);
      if (name.length < 2) return res.status(400).json({ error: 'Enter a course name.' });
      workspace.courses.push({ id: randomUUID(), name, code: cleanText(payload.code, 20), color: /^#[0-9a-f]{6}$/i.test(payload.color) ? payload.color : '#baf91a', targetHours: Math.min(250, Math.max(1, Number(payload.targetHours) || 20)), completedHours: 0, createdAt: new Date().toISOString() });
      message = 'Course added.';
    } else if (operation === 'updateCourse') {
      const course = findItem(workspace.courses, idFrom(payload));
      if (!course) return res.status(404).json({ error: 'That course no longer exists.' });
      const name = cleanText(payload.name, 70);
      if (name.length < 2) return res.status(400).json({ error: 'Enter a course name.' });
      Object.assign(course, { name, code: cleanText(payload.code, 20), color: /^#[0-9a-f]{6}$/i.test(payload.color) ? payload.color : course.color, targetHours: Math.min(250, Math.max(1, Number(payload.targetHours) || 20)), completedHours: Math.min(250, Math.max(0, Number(payload.completedHours) || 0)) });
      message = 'Course progress updated.';
    } else if (operation === 'deleteCourse') {
      const courseId = idFrom(payload);
      workspace.courses = workspace.courses.filter((course) => course.id !== courseId);
      workspace.tasks.forEach((task) => { if (task.courseId === courseId) task.courseId = ''; });
      message = 'Course removed; your study blocks are still available.';
    } else if (operation === 'addExam') {
      const title = cleanText(payload.title, 90);
      const date = validDate(payload.date);
      if (title.length < 2 || !date) return res.status(400).json({ error: 'Enter an exam title and date.' });
      workspace.exams.push({ id: randomUUID(), title, courseId: cleanText(payload.courseId, 80), date, time: cleanText(payload.time, 8), place: cleanText(payload.place, 80), createdAt: new Date().toISOString() });
      message = 'Exam added to your deadline board.';
    } else if (operation === 'deleteExam') {
      workspace.exams = workspace.exams.filter((exam) => exam.id !== idFrom(payload));
      message = 'Exam removed.';
    } else if (operation === 'addNote') {
      const title = cleanText(payload.title, 100) || 'Untitled note';
      const content = cleanText(payload.content, 6000);
      workspace.notes.unshift({ id: randomUUID(), title, content, tag: cleanText(payload.tag, 30), favourite: false, updatedAt: new Date().toISOString() });
      message = 'Note saved.';
    } else if (operation === 'updateNote') {
      const note = findItem(workspace.notes, idFrom(payload));
      if (!note) return res.status(404).json({ error: 'That note no longer exists.' });
      note.title = cleanText(payload.title, 100) || 'Untitled note';
      note.content = cleanText(payload.content, 6000);
      note.tag = cleanText(payload.tag, 30);
      note.favourite = Boolean(payload.favourite);
      note.updatedAt = new Date().toISOString();
      message = 'Note updated.';
    } else if (operation === 'deleteNote') {
      workspace.notes = workspace.notes.filter((note) => note.id !== idFrom(payload));
      message = 'Note removed.';
    } else if (operation === 'addFocus') {
      const minutes = Math.min(300, Math.max(1, Math.round(Number(payload.minutes) || 0)));
      if (!minutes) return res.status(400).json({ error: 'Focus time must be at least one minute.' });
      workspace.focusSessions.unshift({ id: randomUUID(), minutes, label: cleanText(payload.label, 80) || 'Focused study', createdAt: new Date().toISOString() });
      message = `${minutes} focused minutes recorded.`;
    } else if (operation === 'updateSettings') {
      workspace.settings = { ...workspace.settings, weeklyGoal: Math.min(80, Math.max(1, Number(payload.weeklyGoal) || 8)), theme: payload.theme === 'light' ? 'light' : 'dark' };
      message = 'Workspace settings saved.';
    } else {
      return res.status(400).json({ error: 'That workspace action is not supported.' });
    }

    await saveWorkspace(ownerId, workspace);
    res.json({ workspace, message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'We could not save that change. Please try again.' });
  }
});

app.get('/api/revision/questions', requireUser, (_req, res) => {
  res.json({ questions: quizBank.map(({ id, question, choices }) => ({ id, question, choices })) });
});

app.post('/api/revision/submit', requireUser, async (req, res) => {
  try {
    const answers = req.body?.answers || {};
    const score = quizBank.reduce((total, question) => total + (Number(answers[question.id]) === question.correct ? 1 : 0), 0);
    const workspace = await getWorkspace(getUserId(req.user));
    const attempt = { id: randomUUID(), score, total: quizBank.length, createdAt: new Date().toISOString() };
    workspace.revisionResults.unshift(attempt);
    await saveWorkspace(getUserId(req.user), workspace);
    res.json({ score, total: quizBank.length, attempt, workspace });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'We could not score your revision round. Please retry.' });
  }
});

app.use(express.static(path.join(__dirname)));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

connectDatabase().finally(() => {
  app.listen(port, () => console.log(`Orbit is listening on port ${port}.`));
});
