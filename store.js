import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'bbs.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

function seed() {
  return {
    nextId: 2,
    users: [],
    boards: [
      { slug: 'geral', name: 'Geral', description: 'Conversa livre, apresentações e novidades.' },
      { slug: 'tech', name: 'Tecnologia', description: 'Código, hardware, redes e IA.' },
      { slug: 'retro', name: 'Retro & Sysops', description: 'Memórias de modems, BBSs e disquetes.' },
      { slug: 'offtopic', name: 'Off-topic', description: 'Tudo o resto.' },
    ],
    messages: [
      {
        id: 1, board: 'geral', subject: 'Bem-vindo à BBS!',
        body: 'Esta é uma BBS moderna com alma antiga. Regista um nome de utilizador, escreve mensagens ou carrega em V para falar por voz com o Sysop (Gemini Live), que lê e escreve mensagens por ti.',
        author: 'SYSOP', via: 'web', ts: Date.now(), replyTo: null,
      },
    ],
  };
}

let db;
let timer = null;
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = seed(); flush(); }

function save() { clearTimeout(timer); timer = setTimeout(flush, 250); }
function flush() {
  clearTimeout(timer);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { flush(); process.exit(0); });

const preview = (m) => {
  const { body, ...rest } = m;
  return { ...rest, preview: body.replace(/\s+/g, ' ').slice(0, 140) };
};

export const getBoard = (slug) => db.boards.find((b) => b.slug === slug) || null;
export const listBoards = () =>
  db.boards.map((b) => ({ ...b, count: db.messages.filter((m) => m.board === b.slug).length }));

export function listMessages(slug, { limit = 30, before = Infinity } = {}) {
  return db.messages
    .filter((m) => m.board === slug && m.id < before)
    .sort((a, b) => b.id - a.id)
    .slice(0, Math.min(limit, 100))
    .map(preview);
}
export const getMessage = (id) => db.messages.find((m) => m.id === Number(id)) || null;

export function addMessage({ board, subject, body, author, via = 'web', replyTo = null }) {
  const m = { id: db.nextId++, board, subject, body, author, via, ts: Date.now(), replyTo };
  db.messages.push(m);
  save();
  return m;
}
export function deleteMessage(id) {
  const i = db.messages.findIndex((m) => m.id === Number(id));
  if (i < 0) return false;
  db.messages.splice(i, 1);
  save();
  return true;
}
export function search(q, limit = 20) {
  const t = String(q).toLowerCase().trim();
  if (!t) return [];
  return db.messages
    .filter((m) => (m.subject + ' ' + m.body + ' ' + m.author).toLowerCase().includes(t))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)
    .map(preview);
}

export const findUser = (handle) =>
  db.users.find((u) => u.handle.toLowerCase() === String(handle).toLowerCase()) || null;
export function addUser(user) {
  db.users.push(user);
  save();
}
export const userCount = () => db.users.length;
