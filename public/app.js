const socket = io();
const $ = s => document.querySelector(s);

const MODES = {
  classic: ['Classic', 'Three in a row wins.'],
  misere:  ['Misère', 'Three in a row loses. Avoid it.'],
  speed:   ['Speed', '5 seconds per move, or a random one is played.'],
  fading:  ['Fading', 'Only 3 marks each. Your oldest mark vanishes.']
};
const THEMES = {   // name, preview image, X piece, O piece
  pond:   ['Lily Pond',   'themes/theme1.jpg', '🐸', '🪷'],
  mint:   ['Mint Dots',   'themes/theme2.jpg', '💚', '🟢'],
  eye:    ['Evil Eye',    'themes/theme3.jpg', '🧿', '⚪'],
  panda:  ['Panda Love',  'themes/theme4.jpg', '🐼', '💗'],
  night:  ['Sleepy Sky',  'themes/theme5.jpg', '🌙', '⭐'],
  berry:  ['Strawberry',  'themes/theme6.jpg', '🍓', '🌼'],
  citrus: ['Orange Bloom','themes/theme7.jpg', '💚', '🌸'],
  stars:  ['Star Candy',  'themes/theme8.jpg', '🌟', '⚫'],
  froggy: ['Froggy Hearts','themes/theme9.jpg','🐸', '❤️']
};

let state = { me: null, opponent: null, room: null };
let localMode = 'classic', localTheme = 'pond';
let unread = 0, chatOpen = false, timerEnd = 0, timerId = null, prevOpp = null;

/* ---------- connection ---------- */
socket.on('connect', () => {
  socket.emit('register', sessionStorage.getItem('ttt-id'), id => {
    sessionStorage.setItem('ttt-id', id);
    $('#myId').textContent = id;
  });
});
socket.on('state', s => { state = s; render(); });
socket.on('notice', toast);
socket.on('chat', m => {
  addMsg(m.from === state.me ? 'me' : 'other', m.from === state.me ? 'Me' : m.from, m.text);
  if (m.from !== state.me && !chatOpen) { unread++; updateBadge(); }
});

function toast(text) {
  const t = $('#toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ---------- build static pieces ---------- */
Object.entries(MODES).forEach(([key, [name, desc]]) => {
  const b = document.createElement('button');
  b.className = 'card'; b.dataset.key = key;
  b.innerHTML = `<b>${name}</b><span>${desc}</span>`;
  b.onclick = () => chooseConfig({ mode: key });
  $('#modes').append(b);
});
Object.entries(THEMES).forEach(([key, [name, img]]) => {
  const b = document.createElement('button');
  b.className = 'swatch'; b.dataset.key = key;
  b.innerHTML = `<img src="${img}" alt="" loading="lazy"><span>${name}</span>`;
  b.onclick = () => chooseConfig({ theme: key });
  $('#themes').append(b);
});
for (let i = 0; i < 9; i++) {
  const c = document.createElement('button');
  c.className = 'cell'; c.onclick = () => socket.emit('move', i);
  $('#board').append(c);
}

function chooseConfig(part) {
  if (state.room) { if (state.room.host === state.me) socket.emit('config', part); return; }
  if (part.mode) localMode = part.mode;
  if (part.theme) localTheme = part.theme;
  render();
}

/* ---------- render ---------- */
function render() {
  const r = state.room, g = r && r.game, isHost = r && r.host === state.me;
  const theme = r ? r.theme : localTheme, mode = r ? r.mode : localMode;
  document.body.dataset.theme = theme;

  $('#lobby').hidden = !!g;
  $('#game').hidden = !g;

  // opponent box
  const box = $('#oppBox');
  if (state.opponent) {
    box.innerHTML = `<div class="oppRow"><span><span class="dot"></span><b>${state.opponent}</b> is in your room</span>
      <button id="removeBtn" class="ghost danger">${isHost ? 'Remove opponent' : 'Exit room'}</button></div>`;
    $('#removeBtn').onclick = () => socket.emit('leave');
  } else {
    box.innerHTML = `<button id="addBtn" class="addBtn ghost"><span class="plus">+</span>Add opponent</button>`;
    $('#addBtn').onclick = openModal;
  }

  // chat availability
  $('#chatToggle').disabled = !state.opponent;
  $('#chatTitle').textContent = state.opponent ? `Chat with ${state.opponent}` : 'Chat';
  if (state.opponent !== prevOpp) {
    $('#msgs').innerHTML = '';
    if (state.opponent) addMsg('sys', '', `You are now connected with ${state.opponent}.`);
    else if (prevOpp) { $('#chat').hidden = true; chatOpen = false; }
    unread = 0; updateBadge(); prevOpp = state.opponent;
  }

  // selections
  document.querySelectorAll('.card').forEach(b => { b.classList.toggle('sel', b.dataset.key === mode); b.disabled = !!r && !isHost; });
  document.querySelectorAll('.swatch').forEach(b => { b.classList.toggle('sel', b.dataset.key === theme); b.disabled = !!r && !isHost; });

  // start button
  $('#startBtn').disabled = !(r && isHost);
  $('#startBtn').onclick = () => socket.emit('start');
  $('#startHint').textContent = !r ? 'Add an opponent to start playing.' : isHost ? '' : 'Waiting for the host to start. The host picks mode and theme.';

  if (g) renderGame(r, g, mode);
}

function renderGame(r, g, mode) {
  const myTurn = g.turn === g.mySym && !g.over;
  let text;
  if (g.over) text = g.winner === 'draw' ? "It's a draw" : g.winner === g.mySym ? 'You win!' : 'Opponent wins';
  else text = myTurn ? `Your move (${g.mySym})` : `Opponent's move (${g.turn})`;
  $('#statusText').textContent = text;

  document.querySelectorAll('.cell').forEach((c, i) => {
    const v = g.board[i];
    c.innerHTML = v ? `<span class="piece">${THEMES[r.theme][v === 'X' ? 2 : 3]}</span>` : '';
    c.className = 'cell' + (v ? ' ' + v.toLowerCase() : '');
    c.disabled = !myTurn || !!v;
    if (g.winLine && g.winLine.includes(i)) c.classList.add('win');
    if (mode === 'fading' && !g.over && v && g.moves[v].length === 3 && g.moves[v][0] === i) c.classList.add('vanish');
  });

  $('#sMe').textContent = r.scores.me; $('#sOpp').textContent = r.scores.opp; $('#sDraw').textContent = r.scores.draw;
  $('#nextBtn').hidden = !g.over;
  $('#nextBtn').onclick = () => socket.emit('next');
  $('#lobbyBtn').onclick = () => socket.emit('lobby');
  $('#exitBtn').onclick = () => socket.emit('leave');

  clearInterval(timerId); $('#timer').textContent = '';
  if (g.remaining != null) {
    timerEnd = Date.now() + g.remaining;
    const tick = () => { $('#timer').textContent = (Math.max(0, timerEnd - Date.now()) / 1000).toFixed(1) + 's'; };
    tick(); timerId = setInterval(tick, 100);
  }
}

/* ---------- add opponent modal ---------- */
let checkTimer, canAdd = false;
function openModal() {
  $('#modal').hidden = false; $('#oppInput').value = ''; setResult('', ''); $('#confirmAdd').disabled = true; $('#oppInput').focus();
}
function setResult(text, cls) { const p = $('#checkResult'); p.textContent = text; p.className = 'hint ' + cls; }
$('#cancelAdd').onclick = () => $('#modal').hidden = true;
$('#oppInput').oninput = e => {
  const id = e.target.value.trim().toUpperCase();
  canAdd = false; $('#confirmAdd').disabled = true; clearTimeout(checkTimer);
  if (id.length < 6) return setResult('', '');
  checkTimer = setTimeout(() => socket.emit('check', id, res => {
    if (res.self) setResult("That's your own ID.", 'bad');
    else if (!res.online) setResult(`${res.id} is offline.`, 'bad');
    else if (res.busy) setResult(`${res.id} is online but already has an opponent.`, 'bad');
    else { setResult(`${res.id} is online.`, 'ok'); canAdd = true; $('#confirmAdd').disabled = false; }
  }), 250);
};
$('#confirmAdd').onclick = () => {
  if (!canAdd) return;
  socket.emit('add', $('#oppInput').value.trim().toUpperCase(), res => {
    if (res.ok) $('#modal').hidden = true; else setResult(res.error, 'bad');
  });
};
$('#copyBtn').onclick = () => { navigator.clipboard?.writeText($('#myId').textContent); toast('ID copied'); };

/* ---------- chat ---------- */
function addMsg(kind, who, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + kind;
  if (who) { const s = document.createElement('small'); s.textContent = who; d.append(s); }
  d.append(document.createTextNode(text));
  const box = $('#msgs'); box.append(d); box.scrollTop = box.scrollHeight;
}
function updateBadge() { $('#badge').hidden = unread === 0; $('#badge').textContent = unread; }
$('#chatToggle').onclick = () => {
  chatOpen = !chatOpen; $('#chat').hidden = !chatOpen;
  if (chatOpen) { unread = 0; updateBadge(); $('#msgInput').focus(); }
};
$('#chatClose').onclick = () => { chatOpen = false; $('#chat').hidden = true; };
function sendMsg() {
  const t = $('#msgInput').value.trim();
  if (t) socket.emit('chat', t);
  $('#msgInput').value = '';
}
$('#sendBtn').onclick = sendMsg;
$('#msgInput').onkeydown = e => { if (e.key === 'Enter') sendMsg(); };

render();


/* ---------- light / night mode + moving stars ---------- */
const root = document.documentElement;
const SUN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function setMode(m) {
  root.dataset.mode = m;
  try { localStorage.setItem('ttt-mode', m); } catch (e) {}
  $('#modeBtn').innerHTML = m === 'night' ? SUN + 'Light' : MOON + 'Night';
  m === 'night' ? startStars() : stopStars();
}
$('#modeBtn').onclick = () => setMode(root.dataset.mode === 'night' ? 'light' : 'night');

const cv = $('#stars'), ctx = cv.getContext('2d');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let stars = [], raf = 0;
function sizeStars() {
  const d = window.devicePixelRatio || 1;
  cv.width = innerWidth * d; cv.height = innerHeight * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  const n = Math.min(140, Math.floor(innerWidth * innerHeight / 9000));
  stars = Array.from({ length: n }, () => ({
    x: Math.random() * innerWidth, y: Math.random() * innerHeight,
    r: Math.random() * 1.4 + 0.3, vy: Math.random() * 0.12 + 0.02, vx: (Math.random() - 0.5) * 0.06,
    p: Math.random() * Math.PI * 2, tw: Math.random() * 0.03 + 0.01
  }));
}
function drawStars() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const s of stars) {
    s.p += s.tw; s.y -= s.vy; s.x += s.vx;
    if (s.y < -2) { s.y = innerHeight + 2; s.x = Math.random() * innerWidth; }
    if (s.x < -2) s.x = innerWidth + 2; if (s.x > innerWidth + 2) s.x = -2;
    ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(s.p));
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
  }
  if (!reduceMotion) raf = requestAnimationFrame(drawStars);
}
function startStars() { cancelAnimationFrame(raf); sizeStars(); drawStars(); }
function stopStars() { cancelAnimationFrame(raf); ctx.clearRect(0, 0, cv.width, cv.height); }
addEventListener('resize', () => { if (root.dataset.mode === 'night') startStars(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelAnimationFrame(raf); else if (root.dataset.mode === 'night') startStars();
});
setMode(root.dataset.mode || 'light');
