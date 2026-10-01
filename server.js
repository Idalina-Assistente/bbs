import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as store from './store.js';
import { handleLive, liveEnabled } from './live.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const BBS_NAME = process.env.BBS_NAME || 'Porto Seguro BBS';
const SYSOP = (process.env.SYSOP_HANDLE || 'sysop').toLowerCase();
const TOKEN_DAYS = 30;

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET não definido: as sessões perdem-se a cada reinício.');
}

// ---------- auth ----------
const b64u = (b) => Buffer.from(b).toString('base64url');
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

function makeToken(handle) {
  const payload = b64u(JSON.stringify({ h: handle, exp: Date.now() + TOKEN_DAYS * 864e5 }));
  return `${payload}.${sign(payload)}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const good = sign(payload);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const { h, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (exp < Date.now()) return null;
    const u = store.findUser(h);
    return u ? { handle: u.handle, role: u.role } : null;
  } catch { return null; }
}
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');

function auth(req, _res, next) {
  const h = req.headers.authorization || '';
  req.user = h.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
  next();
}
const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Precisas de entrar na BBS.' });

// ---------- rate limit ----------
const hits = new Map();
const limit = (max, windowMs) => (req, res, next) => {
  const k = req.ip + req.path;
  const now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return res.status(429).json({ error: 'Demasiados pedidos. Tenta daqui a pouco.' });
  arr.push(now);
  hits.set(k, arr);
  next();
};
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(auth);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/healthz', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const events = new WebSocketServer({ noServer: true });
const live = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const c of events.clients) if (c.readyState === 1) c.send(s);
}
const broadcastOnline = () => broadcast({ type: 'online', count: events.clients.size });

app.get('/api/info', (_req, res) =>
  res.json({ name: BBS_NAME, voice: liveEnabled(), online: events.clients.size, users: store.userCount() }));

app.post('/api/register', limit(6, 60_000), (req, res) => {
  const { handle, password } = req.body || {};
  if (!/^[A-Za-z0-9_-]{3,16}$/.test(handle || '')) return res.status(400).json({ error: 'Nome: 3-16 caracteres (letras, números, _ ou -).' });
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) return res.status(400).json({ error: 'A palavra-passe precisa de pelo menos 6 caracteres.' });
  if (store.findUser(handle)) return res.status(409).json({ error: 'Esse nome já existe.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const role = store.userCount() === 0 || handle.toLowerCase() === SYSOP ? 'sysop' : 'user';
  store.addUser({ handle, salt, hash: hashPw(password, salt), role, created: Date.now() });
  res.json({ token: makeToken(handle), user: { handle, role } });
});

app.post('/api/login', limit(10, 60_000), (req, res) => {
  const { handle, password } = req.body || {};
  const u = store.findUser(handle || '');
  const ok = u && typeof password === 'string' &&
    crypto.timingSafeEqual(Buffer.from(hashPw(password, u.salt)), Buffer.from(u.hash));
  if (!ok) return res.status(401).json({ error: 'Nome ou palavra-passe incorretos.' });
  res.json({ token: makeToken(u.handle), user: { handle: u.handle, role: u.role } });
});

app.get('/api/me', (req, res) => res.json({ user: req.user }));
app.get('/api/boards', (_req, res) => res.json({ boards: store.listBoards() }));

app.get('/api/boards/:slug/messages', (req, res) => {
  const board = store.getBoard(req.params.slug);
  if (!board) return res.status(404).json({ error: 'Área não encontrada.' });
  const before = req.query.before ? Number(req.query.before) : Infinity;
  res.json({ board, messages: store.listMessages(board.slug, { limit: Number(req.query.limit) || 30, before }) });
});

app.get('/api/messages/:id', (req, res) => {
  const m = store.getMessage(req.params.id);
  if (!m) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  res.json({ message: m });
});

app.post('/api/boards/:slug/messages', limit(20, 60_000), requireUser, (req, res) => {
  if (!store.getBoard(req.params.slug)) return res.status(404).json({ error: 'Área não encontrada.' });
  const subject = String(req.body?.subject || '').trim().slice(0, 80);
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!subject || !body) return res.status(400).json({ error: 'Assunto e texto são obrigatórios.' });
  const replyTo = req.body?.replyTo && store.getMessage(req.body.replyTo) ? Number(req.body.replyTo) : null;
  const m = store.addMessage({ board: req.params.slug, subject, body, author: req.user.handle, via: 'web', replyTo });
  broadcast({ type: 'message', message: { ...m, body: undefined, preview: body.slice(0, 140) } });
  res.json({ message: m });
});

app.delete('/api/messages/:id', requireUser, (req, res) => {
  if (req.user.role !== 'sysop') return res.status(403).json({ error: 'Só o Sysop pode apagar mensagens.' });
  if (!store.deleteMessage(req.params.id)) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  broadcast({ type: 'deleted', id: Number(req.params.id) });
  res.json({ ok: true });
});

app.get('/api/search', limit(30, 60_000), (req, res) =>
  res.json({ messages: store.search(String(req.query.q || '')) }));

app.use(express.static(path.join(__dirname, 'public')));

// ---------- websockets ----------
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/events') {
    events.handleUpgrade(req, socket, head, (ws) => events.emit('connection', ws, req));
  } else if (url.pathname === '/live') {
    const user = verifyToken(url.searchParams.get('token'));
    if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    live.handleUpgrade(req, socket, head, (ws) => live.emit('connection', ws, req, user));
  } else {
    socket.destroy();
  }
});

events.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('close', broadcastOnline);
  broadcastOnline();
});
live.on('connection', (ws, _req, user) => handleLive(ws, user, broadcast));

// mantém ligações vivas atrás do proxy do Render
setInterval(() => {
  for (const ws of events.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

server.listen(PORT, () => console.log(`${BBS_NAME} a ouvir na porta ${PORT} (voz: ${liveEnabled() ? 'ativa' : 'desativada'})`));
