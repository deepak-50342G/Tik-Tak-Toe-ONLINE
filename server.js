const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const users = new Map();   // id -> { socket, room }
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const MODES = ['classic', 'misere', 'speed', 'fading'];
const THEMES = ['pond','mint','eye','panda','night','berry','citrus','stars','froggy'];
const SPEED_MS = 5000;

const newId = () => {
  let id;
  do { id = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (users.has(id));
  return id;
};

/* ---------- game logic ---------- */
function newGame(room) {
  const first = room.round % 2 === 0 ? 'X' : 'O';
  room.game = { board: Array(9).fill(null), turn: first, over: false, winner: null,
                winLine: null, moves: { X: [], O: [] }, deadline: null };
  armTimer(room);
}

function armTimer(room) {
  clearTimeout(room.timer);
  const g = room.game;
  if (room.mode !== 'speed' || !g || g.over) { if (g) g.deadline = null; return; }
  g.deadline = Date.now() + SPEED_MS;
  room.timer = setTimeout(() => {
    if (room.game !== g || g.over) return;
    const empty = g.board.map((v, i) => v ? null : i).filter(i => i !== null);
    applyMove(room, g.turn, empty[Math.floor(Math.random() * empty.length)]);
    broadcast(room);
  }, SPEED_MS + 50);
}

function applyMove(room, sym, i) {
  const g = room.game;
  if (room.mode === 'fading' && g.moves[sym].length === 3) {
    g.board[g.moves[sym].shift()] = null;       // oldest mark vanishes
  }
  g.board[i] = sym;
  g.moves[sym].push(i);

  const line = LINES.find(l => l.every(k => g.board[k] === sym));
  if (line) {
    g.over = true; g.winLine = line;
    g.winner = room.mode === 'misere' ? (sym === 'X' ? 'O' : 'X') : sym;
  } else if (g.board.every(Boolean)) {
    g.over = true; g.winner = 'draw';
  }

  if (g.over) {
    clearTimeout(room.timer); g.deadline = null;
    if (g.winner === 'draw') room.scores.draw++;
    else room.scores[g.winner === 'X' ? room.players[0] : room.players[1]]++;
  } else {
    g.turn = sym === 'X' ? 'O' : 'X';
    armTimer(room);
  }
}

/* ---------- state sync ---------- */
function snapshot(uid) {
  const u = users.get(uid), r = u.room;
  if (!r) return { me: uid, opponent: null, room: null };
  const opp = r.players.find(p => p !== uid);
  const g = r.game;
  return {
    me: uid, opponent: opp,
    room: {
      host: r.players[0], mode: r.mode, theme: r.theme,
      scores: { me: r.scores[uid], opp: r.scores[opp], draw: r.scores.draw },
      game: g && {
        board: g.board, turn: g.turn, over: g.over, winner: g.winner, winLine: g.winLine,
        moves: g.moves, mySym: uid === r.players[0] ? 'X' : 'O',
        remaining: g.deadline ? Math.max(0, g.deadline - Date.now()) : null
      }
    }
  };
}
function sendState(uid) { const u = users.get(uid); if (u) u.socket.emit('state', snapshot(uid)); }
function broadcast(room) { room.players.forEach(sendState); }

function destroyRoom(room, leaverId, reason) {
  clearTimeout(room.timer);
  room.players.forEach(p => {
    const u = users.get(p);
    if (!u) return;
    u.room = null;
    sendState(p);
    if (p !== leaverId) u.socket.emit('notice', reason);
  });
}

/* ---------- sockets ---------- */
io.on('connection', socket => {
  let uid = null;

  socket.on('register', (wanted, cb) => {
    uid = (typeof wanted === 'string' && /^[A-Z0-9]{6}$/.test(wanted) && !users.has(wanted)) ? wanted : newId();
    users.set(uid, { socket, room: null });
    cb(uid);
    sendState(uid);
  });

  socket.on('check', (id, cb) => {
    id = String(id || '').trim().toUpperCase();
    const u = users.get(id);
    cb({ id, self: id === uid, online: !!u, busy: !!(u && u.room) });
  });

  socket.on('add', (id, cb) => {
    id = String(id || '').trim().toUpperCase();
    const me = users.get(uid), other = users.get(id);
    if (!me || me.room) return cb({ ok: false, error: 'You already have an opponent.' });
    if (!other || id === uid) return cb({ ok: false, error: 'That user is not online.' });
    if (other.room) return cb({ ok: false, error: 'That user already has an opponent.' });
    const room = { players: [uid, id], mode: 'classic', theme: 'chalk', game: null, round: 0,
                   scores: { [uid]: 0, [id]: 0, draw: 0 }, timer: null };
    me.room = other.room = room;
    broadcast(room);
    cb({ ok: true });
    other.socket.emit('notice', `${uid} added you as an opponent.`);
  });

  socket.on('leave', () => {
    const u = users.get(uid);
    if (u && u.room) destroyRoom(u.room, uid, `${uid} left the room.`);
  });

  socket.on('config', ({ mode, theme } = {}) => {
    const r = users.get(uid)?.room;
    if (!r || r.players[0] !== uid) return;
    if (MODES.includes(mode) && !r.game) r.mode = mode;
    if (THEMES.includes(theme) && !r.game) r.theme = theme;
    broadcast(r);
  });

  socket.on('start', () => {
    const r = users.get(uid)?.room;
    if (!r || r.players[0] !== uid || r.game) return;
    r.round = 0;
    r.scores = { [r.players[0]]: 0, [r.players[1]]: 0, draw: 0 };
    newGame(r);
    broadcast(r);
  });

  socket.on('move', i => {
    const r = users.get(uid)?.room, g = r?.game;
    if (!g || g.over || !Number.isInteger(i) || i < 0 || i > 8 || g.board[i]) return;
    const sym = uid === r.players[0] ? 'X' : 'O';
    if (g.turn !== sym) return;
    applyMove(r, sym, i);
    broadcast(r);
  });

  socket.on('next', () => {
    const r = users.get(uid)?.room;
    if (!r || !r.game || !r.game.over) return;
    r.round++;
    newGame(r);
    broadcast(r);
  });

  socket.on('lobby', () => {          // back to mode/theme selection, keep opponent
    const r = users.get(uid)?.room;
    if (!r) return;
    clearTimeout(r.timer);
    r.game = null;
    broadcast(r);
  });

  socket.on('chat', text => {
    const r = users.get(uid)?.room;
    text = String(text || '').slice(0, 500).trim();
    if (!r || !text) return;
    r.players.forEach(p => users.get(p)?.socket.emit('chat', { from: uid, text }));
  });

  socket.on('disconnect', () => {
    const u = users.get(uid);
    if (!u || u.socket !== socket) return;
    if (u.room) destroyRoom(u.room, uid, `${uid} disconnected.`);
    users.delete(uid);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Tic Tac Toe running on http://localhost:${PORT}`));
