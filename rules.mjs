export const HZ = 20;
export const FIRE = Object.freeze({ cost: 30, windup: 7, recover: 5, cooldown: 50, range: 48, radius: 4, speed: 28 });
export const RINGS = Object.freeze([
  { from: 60, to: 35, starts: 600, ends: 1000, dps: 5 },
  { from: 35, to: 15, starts: 1600, ends: 2000, dps: 10 }
]);
export const END_TICK = 120 * HZ;
export const WALLS = Object.freeze([
  { x0: -11, x1: -8, y0: -18, y1: 6 },
  { x0: 8, x1: 11, y0: -6, y1: 18 },
  { x0: -26, x1: -16, y0: 17, y1: 20 },
  { x0: 16, x1: 26, y0: -20, y1: -17 },
  { x0: -6, x1: 6, y0: 24, y1: 27 },
  { x0: -6, x1: 6, y0: -27, y1: -24 }
]);

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const player = (id, x, y) => ({
  id, x, y, hp4: 400, chakra4: 400, regenAt: 0, nextCast: 0, recoverAt: 0,
  pending: null, lastSeq: 0, angle: id === 'p' ? 0 : Math.PI
});

export function createMatch(mode = 'standard') {
  const final = mode === 'final';
  return {
    tick: final ? 1900 : 0,
    mode,
    players: final ? [player('p', -20, 0), player('bot', 3, -5)] :
      [player('p', -22, -2), player('bot', 22, 2)],
    walls: WALLS, projectiles: [], blasts: [], events: [], nextId: 1, result: null
  };
}

export function ringAt(tick) {
  const index = tick < RINGS[0].ends ? 0 : 1;
  const { from, to, starts, ends, dps } = RINGS[index];
  const ratio = clamp((tick - starts) / (ends - starts), 0, 1);
  return {
    phase: index + 1, radius: from + (to - from) * ratio, next: to, dps,
    state: tick >= ends ? '末圈' : tick < starts ? '等待' : '收缩',
    seconds: Math.max(0, Math.ceil(((tick < starts ? starts : ends) - tick) / HZ))
  };
}

export function outside(p, ring) {
  return p.x * p.x + p.y * p.y > ring.radius * ring.radius;
}

export function boxHit(a, b, w) {
  let enter = 0, leave = 1;
  for (const axis of ['x', 'y']) {
    const start = a[axis], delta = b[axis] - start;
    const lo = w[axis + '0'], hi = w[axis + '1'];
    if (delta === 0) {
      if (start < lo || start > hi) return null;
      continue;
    }
    const t1 = (lo - start) / delta, t2 = (hi - start) / delta;
    enter = Math.max(enter, Math.min(t1, t2));
    leave = Math.min(leave, Math.max(t1, t2));
    if (enter > leave) return null;
  }
  // 碰到表面并背向墙离开，不算被墙挡住。
  return leave > 0 && enter < 1 ? enter : null;
}

export function blastDamage(center, target, walls) {
  const d = Math.hypot(target.x - center.x, target.y - center.y);
  if (d > FIRE.radius || walls.some(w => boxHit(center, target, w) !== null)) return 0;
  return Math.round(40 - 5 * d);
}

const record = (s, text) => {
  s.events.push({ tick: s.tick, text });
  if (s.events.length > 6) s.events.shift();
};
const name = p => p.id === 'p' ? '你' : '对手';

export function startFire(s, p, seq, angle) {
  if (!Number.isSafeInteger(seq) || seq <= p.lastSeq || !Number.isFinite(angle)) return false;
  p.lastSeq = seq;
  if (s.result || p.hp4 <= 0 || p.pending || s.tick < p.recoverAt || s.tick < p.nextCast || p.chakra4 < FIRE.cost * 4) {
    if (p.id === 'p' && !s.result) record(s, p.chakra4 < FIRE.cost * 4 ? '查克拉不足' : '火球尚不能起手');
    return false;
  }
  p.chakra4 -= FIRE.cost * 4;
  p.regenAt = s.tick + 2 * HZ + 1;
  p.nextCast = s.tick + FIRE.cooldown;
  p.pending = { angle, releaseAt: s.tick + FIRE.windup };
  record(s, name(p) + '开始结印');
  return true;
}

function harm(s, p, damage4, interrupt) {
  if (!p.hp4) return;
  p.hp4 = Math.max(0, p.hp4 - damage4);
  if ((interrupt || !p.hp4) && p.pending) {
    p.pending = null;
    p.recoverAt = s.tick + FIRE.recover;
    if (interrupt) record(s, name(p) + '的结印被打断');
  }
}

function move(s, p, x, y) {
  const norm = Math.max(1, Math.hypot(x, y));
  const stride = (p.pending ? 4 : 9) / HZ / norm;
  const open = (x, y) => !s.walls.some(w =>
    x >= w.x0 - 0.8 && x <= w.x1 + 0.8 && y >= w.y0 - 0.8 && y <= w.y1 + 0.8);
  const nx = clamp(p.x + x * stride, -64, 64), ny = clamp(p.y + y * stride, -64, 64);
  if (open(nx, p.y)) p.x = nx;
  if (open(p.x, ny)) p.y = ny;
}

function roundHit(a, b, p) {
  const ux = b.x - a.x, uy = b.y - a.y, dx = a.x - p.x, dy = a.y - p.y;
  const c = dx * dx + dy * dy - 1;
  if (c <= 0) return 0;
  const k = ux * ux + uy * uy, m = dx * ux + dy * uy;
  const discriminant = m * m - k * c;
  if (discriminant < 0) return null;
  const t = (-m - Math.sqrt(discriminant)) / k;
  return t >= 0 && t <= 1 ? t : null;
}

function advanceProjectiles(s) {
  s.projectiles = s.projectiles.filter(f => {
    const d = Math.min(f.left, FIRE.speed / HZ);
    const end = { x: f.x + f.dx * d, y: f.y + f.dy * d };
    let t = Infinity;
    for (const w of s.walls) t = Math.min(t, boxHit(f, end, w) ?? Infinity);
    for (const p of s.players) {
      if (p.id !== f.owner && p.hp4) t = Math.min(t, roundHit(f, end, p) ?? Infinity);
    }
    if (!Number.isFinite(t) && f.left > d) {
      Object.assign(f, end);
      f.left -= d;
      return true;
    }
    const fraction = Number.isFinite(t) ? t : 1;
    const center = { x: f.x + f.dx * d * fraction, y: f.y + f.dy * d * fraction };
    s.blasts.push({ ...center, until: s.tick + 9 });
    for (const p of s.players) {
      const damage = p.id === f.owner || !p.hp4 ? 0 : blastDamage(center, p, s.walls);
      if (damage) {
        harm(s, p, damage * 4, true);
        record(s, name(p) + '受到 ' + damage + ' 点火球伤害');
      }
    }
    return false;
  });
}

function decide(s) {
  const [a, b] = s.players;
  if (a.hp4 && b.hp4 && s.tick < END_TICK) return;
  if (a.hp4 !== b.hp4) s.result = a.hp4 > b.hp4 ? '胜利' : '落败';
  else if (a.hp4 && a.chakra4 !== b.chakra4) s.result = a.chakra4 > b.chakra4 ? '胜利' : '落败';
  else s.result = '平局';
  record(s, '对局结束：' + s.result);
}

export function botIntent(s) {
  const [you, bot] = s.players;
  const dx = you.x - bot.x, dy = you.y - bot.y, dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  if (Math.hypot(bot.x, bot.y) > ringAt(s.tick).radius - 3)
    return { x: -bot.x, y: -bot.y, angle };
  const sight = !s.walls.some(w => boxHit(bot, you, w) !== null);
  const orbit = Math.floor(s.tick / 55) % 2 ? 1 : -1;
  const towards = dist > 22 ? 0.8 : dist < 7 ? -0.7 : 0;
  return {
    x: sight ? towards * dx - orbit * dy * 0.65 : -orbit * dy + 0.32 * dx,
    y: sight ? towards * dy + orbit * dx * 0.65 : orbit * dx + 0.32 * dy,
    angle,
    seq: sight && dist < 37 && !bot.pending && s.tick >= bot.nextCast && s.tick % 11 === 0 && bot.chakra4 >= 120
      ? bot.lastSeq + 1 : undefined
  };
}

export function step(s, intent = {}, rival = botIntent(s)) {
  if (s.result) return s;
  s.tick++;
  const ring = ringAt(s.tick);
  for (const [i, p] of s.players.entries()) {
    if (!p.hp4) continue;
    if (s.tick >= p.regenAt) p.chakra4 = Math.min(400, p.chakra4 + 1);
    const command = i === 0 ? intent : rival;
    if (Number.isFinite(command.angle)) p.angle = command.angle;
    if (command.seq !== undefined) startFire(s, p, command.seq, p.angle);
    move(s, p, command.x ?? 0, command.y ?? 0);
    if (p.pending && s.tick >= p.pending.releaseAt) {
      const { angle } = p.pending;
      s.projectiles.push({
        id: s.nextId++, owner: p.id, x: p.x, y: p.y,
        dx: Math.cos(angle), dy: Math.sin(angle), left: FIRE.range
      });
      p.pending = null;
      p.recoverAt = s.tick + FIRE.recover;
      record(s, name(p) + '释放火球');
    }
  }
  advanceProjectiles(s);
  for (const p of s.players) {
    if (outside(p, ring)) harm(s, p, ring.dps * 4 / HZ, false);
  }
  s.blasts = s.blasts.filter(b => b.until > s.tick);
  decide(s);
  return s;
}
