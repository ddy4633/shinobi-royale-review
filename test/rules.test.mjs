import test from 'node:test';
import assert from 'node:assert/strict';
import { END_TICK, createMatch, player, ringAt, outside, boxHit, blastDamage, startFire, step } from '../rules.mjs';

const xy = (x, y) => ({ x, y });
function empty() {
  const s = createMatch();
  s.walls = [];
  return s;
}

test('扣费、重复指令、冷却、延迟回复及上限', () => {
  const s = empty(), [p] = s.players;
  assert.equal(startFire(s, p, 1, 0), true);
  assert.equal(startFire(s, p, 1, 0), false);
  assert.equal(startFire(s, p, 2, 0), false);
  assert.equal(p.chakra4 / 4, 70);
  for (let i = 0; i < 40; i++) step(s, {}, {});
  assert.equal(p.chakra4 / 4, 70);
  for (let i = 0; i < 20; i++) step(s, {}, {});
  assert.equal(p.chakra4 / 4, 75);
  for (let i = 0; i < 120; i++) step(s, {}, {});
  assert.equal(p.chakra4 / 4, 100);
});

test('查克拉不足时不扣费也不创建火球', () => {
  const s = empty(), [p] = s.players;
  p.chakra4 = 119;
  assert.equal(startFire(s, p, 1, 0), false);
  assert.equal(p.chakra4, 119);
  assert.equal(p.pending, null);
  assert.equal(s.projectiles.length, 0);
});

test('发射在第七个后续模拟步，受击打断且不退款', () => {
  const s = empty(), [a, b] = s.players;
  a.x = 0; a.y = b.y = 0; b.x = 1.3;
  startFire(s, a, 1, 0);
  for (let i = 0; i < 6; i++) step(s, {}, {});
  assert.equal(s.projectiles.length, 0);
  startFire(s, b, 1, Math.PI);
  step(s, {}, {});
  assert.ok(b.hp4 < 400);
  assert.equal(b.pending, null);
  assert.equal(b.chakra4 / 4, 70);
  assert.equal(s.blasts.length, 1);
  assert.ok(s.events.some(e => e.text.endsWith('结印被打断')));
  const hp = b.hp4;
  step(s, {}, {});
  assert.equal(b.hp4, hp);
});

test('伤害衰减、临界距离、遮挡与爆心贴墙', () => {
  const wall = { x0: 1, y0: 0.5, x1: 1.2, y1: 1.5 };
  assert.equal(blastDamage(xy(0,0), xy(2,0), [wall]), 30);
  assert.equal(blastDamage(xy(0,0), xy(2,2), [wall]), 0);
  assert.equal(blastDamage(xy(0,0), xy(4,0), [wall]), 20);
  assert.equal(blastDamage(xy(0,0), xy(4.1,0), [wall]), 0);
  assert.equal(boxHit(xy(1,1), xy(0,1), wall), null);
  assert.equal(blastDamage(xy(1,1), xy(2,1), [wall]), 0);
});

test('投射物碰到薄墙会停，墙背单位不会掉血', () => {
  const s = empty();
  s.walls = [{x0: 0, x1: 0.1, y0: -9, y1: 9}];
  s.players = [player('p', -4, 0), player('bot', 2, 0)];
  startFire(s, s.players[0], 1, 0);
  for (let i = 0; i < 10; i++) step(s, {}, {});
  assert.equal(s.projectiles.length, 0);
  assert.equal(s.blasts.length, 1);
  assert.ok(Math.abs(s.blasts[0].x) < 1e-8);
  assert.equal(s.players[1].hp4 / 4, 100);
});

test('两轮边界、线性缩圈、圈伤和返回圈边', () => {
  assert.deepEqual([0,600,800,1000,1600,1800,2000].map(t => ringAt(t).radius), [60,60,47.5,35,35,25,15]);
  assert.equal(outside(xy(15,0), ringAt(2000)), false);
  assert.equal(outside(xy(15.01,0), ringAt(2000)), true);
  const s = empty(), [p,b] = s.players;
  s.tick = 2000; p.x = 15.01; p.y = b.x = b.y = 0;
  for (let i = 0; i < 40; i++) step(s, {}, {});
  assert.equal(p.hp4 / 4, 80);
  p.x = 15; step(s, {}, {});
  assert.equal(p.hp4 / 4, 80);
});

test('同一步都倒下判平局，结算后不再推进', () => {
  const s = empty();
  s.tick = 2000;
  for (const p of s.players) { p.x = 18; p.y = 0; p.hp4 = 2; }
  step(s, {}, {});
  assert.equal(s.result, '平局');
  step(s, {}, {});
  assert.equal(s.tick, 2001);
});

test('两分钟未分胜负时按生命、查克拉结算', () => {
  const s = empty(), [p,b] = s.players;
  p.x = p.y = b.x = b.y = 0;
  p.chakra4 = 300; p.regenAt = END_TICK + 5;
  s.tick = END_TICK - 1;
  step(s, {}, {});
  assert.equal(s.result, '落败');
});

test('同一初始状态与操作逐步重跑得到相同结果', () => {
  const run = () => {
    const s = createMatch('final');
    for (let i = 0; i < 510 && !s.result; i++) step(s, { x: i < 34 ? 1 : 0, angle: 0, seq: i % 67 === 0 ? i + 1 : undefined });
    assert.ok(s.result);
    return s;
  };
  assert.deepEqual(run(), run());
});
