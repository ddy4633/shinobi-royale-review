import { HZ, END_TICK, createMatch, ringAt, outside, step } from './rules.mjs';

const $ = id => document.getElementById(id);
const canvas = $('arena'), ctx = canvas.getContext('2d');
const scale = 5.35;
const keys = new Set();
const moving = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
let state = createMatch(), playing = false, started = false;
let aimWorld = null, fire = false, bank = 0, previous = null, seq = 0, lastEvents = '';

function reset(mode) {
  state = createMatch(mode);
  started = playing = true;
  aimWorld = null;
  fire = false;
  bank = 0;
  seq = 0;
  keys.clear();
  canvas.focus();
}

function togglePause() {
  if (!started || state.result) return;
  playing = !playing;
  keys.clear();
  fire = false;
  bank = 0;
  if (playing) canvas.focus();
}

$('normal').addEventListener('click', () => reset('standard'));
$('final').addEventListener('click', () => reset('final'));
$('pause').addEventListener('click', togglePause);

const keyInput = event => {
  if ((event.type === 'keydown' && (!started || document.activeElement !== canvas)) ||
      (!moving.has(event.code) && !['Space', 'Escape'].includes(event.code))) return;
  if (event.type === 'keyup') { keys.delete(event.code); return; }
  event.preventDefault();
  if (event.code === 'Escape' && !event.repeat) togglePause();
  else if (event.code === 'Space' && !event.repeat && playing) fire = true;
  else if (moving.has(event.code)) keys.add(event.code);
};
window.addEventListener('keydown', keyInput);
window.addEventListener('keyup', keyInput);
canvas.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing) togglePause();
});

const aim = event => {
  const rect = canvas.getBoundingClientRect();
  aimWorld = {
    x: ((event.clientX - rect.left) / rect.width - 0.5) * canvas.width / scale,
    y: ((event.clientY - rect.top) / rect.height - 0.5) * canvas.height / scale
  };
};
canvas.addEventListener('pointermove', aim);
canvas.addEventListener('pointerdown', event => {
  if (!playing || state.result || event.button !== 0) return;
  event.preventDefault();
  canvas.focus();
  aim(event);
  fire = true;
});
canvas.addEventListener('pointerleave', () => { aimWorld = null; });

function input() {
  const down = (...codes) => Number(codes.some(code => keys.has(code)));
  const x = down('KeyD','ArrowRight') - down('KeyA','ArrowLeft');
  const y = down('KeyS','ArrowDown') - down('KeyW','ArrowUp');
  const p = state.players[0];
  const angle = aimWorld ? Math.atan2(aimWorld.y - p.y, aimWorld.x - p.x)
    : x || y ? Math.atan2(y, x) : p.angle;
  const intent = { x, y, angle, seq: fire ? ++seq : undefined };
  fire = false;
  return intent;
}

function circle(x, y, radius, fill, stroke, width = 0.35) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

function draw(ring) {
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = '#18271e';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(scale,0,0,scale,canvas.width / 2,canvas.height / 2);
  ctx.strokeStyle = '#304137'; ctx.lineWidth = 0.18;
  ctx.beginPath();
  for (let i = -60; i <= 60; i += 5) {
    ctx.moveTo(-64,i); ctx.lineTo(64,i); ctx.moveTo(i,-64); ctx.lineTo(i,64);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(-70,-70,140,140);
  ctx.moveTo(ring.radius,0);
  ctx.arc(0,0,ring.radius,0,Math.PI * 2);
  ctx.fillStyle = 'rgba(192,68,37,.22)'; ctx.fill('evenodd');
  circle(0,0,ring.radius,null,'#eabd84',0.44);
  if (ring.next < ring.radius) {
    ctx.setLineDash([1.2,0.8]);
    circle(0,0,ring.next,null,'#aacc8b',0.34);
    ctx.setLineDash([]);
  }
  for (const w of state.walls) {
    ctx.fillStyle = '#5d6a5e'; ctx.strokeStyle = '#899581'; ctx.lineWidth = .28;
    ctx.fillRect(w.x0,w.y0,w.x1-w.x0,w.y1-w.y0);
    ctx.strokeRect(w.x0,w.y0,w.x1-w.x0,w.y1-w.y0);
  }
  for (const b of state.blasts)
    circle(b.x,b.y,4,'rgba(249,155,83,.29)','#ffe2ad',0.36);
  for (const f of state.projectiles) circle(f.x,f.y,.75,'#ffd78f');
  for (const p of state.players) {
    if (!p.hp4) continue;
    const color = p.id === 'p' ? '#cce795' : '#ff937d';
    if (p.pending) circle(p.x,p.y,2.55,null,'#ffd78f',0.42);
    circle(p.x,p.y,1.55,color,'#101814');
    if (outside(p, ring)) circle(p.x,p.y,2.15,null,'#ff937d');
    ctx.beginPath(); ctx.moveTo(p.x,p.y);
    ctx.lineTo(p.x+Math.cos(p.angle)*4,p.y+Math.sin(p.angle)*4);
    ctx.strokeStyle=color; ctx.lineWidth=.32; ctx.stroke();
  }
  if (!playing || state.result) {
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = 'rgba(15,22,17,.75)';
    ctx.fillRect(0,316,720,88);
    ctx.font = 'bold 29px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#e9e8d8';
    ctx.fillText(state.result || (started ? '已暂停' : '选择开局，或直接练末圈'),360,370);
  }
}

function write(id, content) {
  if ($(id).textContent !== String(content)) $(id).textContent = content;
}

function render() {
  const ring = ringAt(state.tick), [you, bot] = state.players;
  draw(ring);
  write('hp', you.hp4 / 4); write('chakra', you.chakra4 / 4);
  write('bot-hp', bot.hp4 / 4); write('radius', ring.radius.toFixed(1));
  write('dps', ring.dps + ' / 秒');
  write('fire-state', you.pending ? '结印中' : state.tick < you.recoverAt ? '收招中' :
    state.tick < you.nextCast ? '冷却中' : you.chakra4 < 120 ? '查克拉不足' : '可施放');
  write('result', state.result || (!started ? '待开始' : !playing ? '已暂停' : outside(you, ring) ? '在圈外 · 正在扣血' : '在安全圈内'));
  write('ring-line', '第 ' + ring.phase + ' 圈 · ' + ring.state + (ring.seconds ? ' ' + ring.seconds + ' 秒' : '') +
    ' / 距结算 ' + Math.max(0, Math.ceil((END_TICK - state.tick) / HZ)) + ' 秒');
  write('pause', playing ? '暂停' : '继续');
  $('pause').disabled = !started || Boolean(state.result);
  const lines = state.events.slice(-4).reverse().map(e => Math.floor(e.tick / HZ) + ' 秒 · ' + e.text);
  if (lines.join('\n') !== lastEvents) {
    lastEvents = lines.join('\n');
    $('events').replaceChildren(...(lines.length ? lines : ['暂无']).map(line => {
      const row = document.createElement('li'); row.textContent = line; return row;
    }));
  }
}

function frame(now) {
  const elapsed = previous === null ? 0 : Math.min(250, now - previous);
  previous = now;
  if (playing && !state.result) {
    bank += elapsed;
    while (bank >= 1000 / HZ && !state.result) {
      step(state, input());
      bank -= 1000 / HZ;
    }
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
