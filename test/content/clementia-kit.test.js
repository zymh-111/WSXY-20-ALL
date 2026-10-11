// test/content/clementia-kit.test.js — 克莱门莎 (char_4231_clemnt, chess_char_6_21_a) fights with her own kit.
//
// Added with tools/apply-clementia-kit.mjs. She is in the chess pool (data/chess.json chess_char_6_21_a/_b), and
// `content/index.js kitOf` resolves a POOL chess's kit by `def.baseId` — never by charId — so her hand-authored kit
// has to be registered under `chess_char_6_21_a`. Without that registration she falls back to content/generic.js:
// both talents lost, S1's 侵蚀损伤 rider lost, S2's 浮游放逐舱 + 漩涡 entirely missing, S3 degraded into a plain attack.
//
// Hook notes: an element gauge fill goes through the `damaged` hook (`type: 'element'`), never `hit` — `hit` sees
// physical / arts / 元素伤害 instances only. The riders below are therefore asserted on `damaged`.
//
// Official texts (PRTS 克莱门莎; official CN tables 2026-10-08, skills at ranks 4/7, full potential):
//   S1 冲蚀     — 下次攻击的攻击力提高至205/225%, 并造成相当于物理伤害25/30%的侵蚀损伤
//   S2 风暴潮   — 攻击范围扩大, 攻击速度+100, 每次攻击对目标及其周围最多5名地面敌人造成220/230%攻击力的物理伤害;
//                 向前方召唤浮游放逐舱 (累计不超过8重量、最多15名地面敌人不断向前移动), 移动3格后消失并留下漩涡
//                 (半径1.5、可对空): 敌人移动速度-70%, 每秒200点侵蚀损伤 + 265/285%攻击力的物理伤害
//   S3 与海为敌 — 弹药10发: 200%攻击力攻击 + 20%侵蚀损伤; 侵蚀爆发锁定目标并轰炸 (270%物理 + 200%元素伤害)
//   天赋 生死定夺   — 造成物理伤害时25% (目标防御力低于初始值时50%) 概率攻击力提升至135%
//   天赋 习得性防御 — 受到自身前方单位/自身阻挡单位的物理和法术伤害降低30% (【海怪】50%)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const CHESS_E = 'chess_char_6_21_b';        // 精英2 Lv60, 技能 rank 7, ATK 902
const ATK = 902;
const HOOKS = ['damaged', 'hit', 'elementBurst', 'ammoUsed', 'statusApplied', 'skillStart', 'skillEnd'];
const DEFS = { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0, def: 200 }) } };

const mk = (opts) => makeBattle({ defs: DEFS, timeLimit: 0, autoFinish: false, hooks: HOOKS, captureNoisy: true, ...opts });
/** Deploy her (a board unit starts undeployed: `activate` refuses an undeployed unit). */
const ready = (h) => { h.step(1); return h.unit(CHESS_E); };

test('S1 冲蚀: 225% ATK physical and 侵蚀损伤 = 30% of the damage dealt', () => {
  const h = mk({ seed: 11, units: [{ chessId: CHESS_E, row: 10, col: 3, skillIndex: 0 }] });
  const u = ready(h);
  assert.ok(u, 'her elite piece is on the field');
  assert.equal(u.skill.id, 'skchr_clemnt_1', 'the loadout selected S1');
  assert.equal(u.skill.kind, 'instant', 'S1 is a next-attack (instant) skill');
  assert.equal(u.skill.spec.attack.atkScale, 2.25, 'S1 elite: ATK scale 225%');
  const foe = h.spawn('enemy_dummy', { pos: [10, 4] });   // her melee range is the tile in front
  assert.ok(foe, 'the dummy spawned in front of her');
  h.b.rng = () => 0.99;                      // no 生死定夺 proc: plain numbers
  assert.equal(u.skill.activate('test', { free: true }), true, 'S1 activated');
  assert.ok(h.b.forceAttack(u, [foe], {}), 'the pending attack fired');
  const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.target === foe);
  const phys = hits.filter((c) => c.type === 'phys');
  const gauge = hits.filter((c) => c.type === 'element');
  const want = ATK * 2.25 - 200;             // `damaged.amount` is the post-mitigation HP damage (the dummy's 200 DEF)
  assert.equal(phys.length, 1, 'one physical instance');
  assert.ok(Math.abs(phys[0].amount - want) < 3, `hit ${phys[0].amount} = 225% ATK − DEF (${want})`);
  assert.equal(gauge.length, 1, 'the 侵蚀损伤 rider filled the erosion gauge');
  assert.equal(gauge[0].dmg.element, 'erosion');
  assert.ok(Math.abs(gauge[0].amount - phys[0].amount * 0.3) < 4, `rider ${gauge[0].amount} = 30% of the damage dealt`);
  checkInvariants(h.b);
});

test('S2 风暴潮: aspd +100, the 浮游放逐舱 flies 3 tiles then leaves a vortex at its stop tile', () => {
  const h = mk({ seed: 12, units: [{ chessId: CHESS_E, row: 10, col: 3 }] });
  const u = ready(h);
  assert.equal(u.skill.id, 'skchr_clemnt_2', 'S2 is her default skill (data defaultSkillIndex)');
  assert.equal(u.skill.duration, 16, '16 s duration from the data');
  assert.equal(u.skill.spec.mods.aspd, 100, 'aspd +100 while it runs');
  assert.equal(u.skill.activate('test', { free: true }), true, 'S2 activated');
  const cabin = u.mem.clemntCabin;
  assert.ok(cabin, 'the 浮游放逐舱 is summoned');
  assert.equal(cabin.mass, 8, 'its passenger capacity starts at 8 weight');
  assert.equal(cabin.distance, 3, 'it flies 3 tiles');
  assert.ok(u.findBuff('clemnt:cast'), 'she is 强制缴械 while it flies');
  assert.ok(h.runUntil(() => u.mem.clemntCabin?.stopped || !u.mem.clemntCabin, 4), 'the cabin stops');
  assert.equal(cabin.x, 6, 'it stopped 3 tiles in front of her (col 3 → 6)');
  assert.ok(!u.findBuff('clemnt:cast'), '缴械 ends when the cabin stops (PRTS: 放逐仓停止时提前结束)');
  const tide = h.eventsOf('fx').find((e) => e[1] === 'tide');
  assert.ok(tide, 'the vortex fx is emitted at the stopping tile');
  checkInvariants(h.b);
});

test('S2 vortex: −70% move speed, 200 侵蚀损伤 + 285% ATK physical per second, and it hits air', () => {
  const h = mk({ seed: 12, units: [{ chessId: CHESS_E, row: 10, col: 3 }] });
  const u = ready(h);
  assert.equal(u.skill.activate('test', { free: true }), true, 'S2 activated');
  for (let i = 0; i < 200 && !u.mem.clemntCabin?.stopped; i++) h.step();
  assert.ok(u.mem.clemntCabin?.stopped, 'the cabin stopped');
  const c = u.mem.clemntCabin;
  const col = Math.round(c.x);                 // the vortex centre (radius 1.5)
  const ground = h.spawn('enemy_dummy', { pos: [10, col] });
  const flyer = h.spawn('enemy_dummy', { pos: [10, Math.min(20, col + 1)], mods: { motion: 'FLY' } });
  assert.ok(ground && flyer, 'both dummies spawned in the vortex');
  const before = ground.hp;
  // step until the vortex's first second is up and BOTH instances (侵蚀损伤 + physical) are in: the gauge fill and the
  // HP damage of one tick are separate `damaged` hooks, and `run` fights the per-skill tick accumulator.
  const vortexHits = () => h.hooksOf('damaged').filter((k) => k.dmg.tags?.includes('clemnt:vortex'));
  for (let i = 0; i < 200 && !(vortexHits().some((k) => k.type === 'element') && vortexHits().some((k) => k.type === 'phys')); i++) h.step();
  const slow = ground.findBuff(`clemnt:vortex:${u.id}`);
  assert.ok(slow, 'a ground enemy in the vortex is slowed');
  assert.ok(Math.abs((slow.mods?.moveMul ?? 1) - 0.3) < 1e-6, 'move speed −70%');
  // the vortex's HP damage is tagged 'clemnt:vortex' and its 侵蚀损伤 'clemnt:vortex:erosion'
  const mine = (x) => h.hooksOf('damaged').filter((k) => k.target === x && k.dmg.tags?.some((t) => String(t).startsWith('clemnt:vortex')));
  const hitGround = mine(ground);
  const hitFlyer = mine(flyer);
  assert.ok(hitGround.length >= 1, 'the vortex damages the ground enemy');
  assert.ok(hitFlyer.length >= 1, 'the vortex hits air (canHitFly)');
  const phys = hitGround.find((x) => x.type === 'phys');
  const gauge = hitGround.find((x) => x.type === 'element');
  assert.ok(Math.abs(phys.amount - (u.s.atk * 2.85 - 200)) < 3, `285% ATK − DEF per second (${phys.amount})`);
  assert.equal(gauge.amount, 200, '200 侵蚀损伤 per second');
  assert.equal(gauge.dmg.element, 'erosion');
  assert.ok(ground.hp < before, 'the ground enemy lost HP');
  checkInvariants(h.b);
});

test('S3 与海为敌: 10 bullets, normal attacks are free, an 侵蚀爆发 locks the target and fires three shells', () => {
  const h = mk({ seed: 13, units: [{ chessId: CHESS_E, row: 10, col: 3, skillIndex: 2 }] });
  const u = ready(h);
  assert.equal(u.skill.id, 'skchr_clemnt_3', 'the loadout selected S3');
  assert.equal(u.skill.kind, 'ammo', 'S3 is an ammo skill');
  assert.equal(u.skill.ammo, 10, '10 bullets (attack@trigger_time)');
  assert.equal(u.skill.spec.attack.atkScale, 2, 'S3 elite: 200% ATK attack');
  const foe = h.spawn('enemy_dummy', { pos: [10, 5] });
  assert.ok(foe, 'the dummy spawned');
  assert.equal(u.skill.activate('test', { free: true }), true, 'S3 activated');
  assert.ok(u.mem.clemntBombs, 'S3 allocates its lock state on start');
  h.b.forceAttack(u, [foe], {});
  assert.equal(u.skill.ammoLeft, 10, 'a normal attack spends no bullet');
  h.b.emit('elementBurst', { source: u, target: foe, element: 'erosion' });
  assert.equal(u.mem.clemntBombs.marks.size, 1, 'the 侵蚀爆发 marks the target for a barrage');
  h.step(1);
  assert.equal(u.skill.ammoLeft, 9, 'one barrage spends one bullet');
  assert.ok(h.eventsOf('fx').some((e) => e[1] === 'lock'), 'the aim reticle is drawn');
  h.run(2.5);                                 // 0.5 s, +1 s, +1 s
  const bombs = h.hooksOf('damaged').filter((c) => c.dmg.tags?.includes('clemnt:bomb'));
  const phys = bombs.filter((c) => c.type === 'phys');
  const elem = bombs.filter((c) => c.type === 'elemental');
  assert.equal(phys.length, 3, 'three physical shells (PRTS: 首次 0.5 s, 之后每 1 秒一次, 共 3 发)');
  assert.equal(elem.length, 3, 'three 元素伤害 instances');
  assert.ok(Math.abs(phys[0].amount - (ATK * 4.05 - 200)) < 4, `physical shell = (270% + 200%) ATK − DEF (${phys[0].amount})`);
  assert.ok(Math.abs(elem[0].amount - ATK * 2) < 3, `元素伤害 shell 200% ATK (${elem[0].amount})`);
  assert.equal(elem[0].dmg.element, 'erosion');
  checkInvariants(h.b);
});

test('talent 生死定夺: physical damage is scaled up when the roll is below the chance', () => {
  const h = mk({ seed: 14, units: [{ chessId: CHESS_E, row: 10, col: 3 }] });
  const u = ready(h);
  const foe = h.spawn('enemy_dummy', { pos: [10, 4] });   // in her melee range
  assert.ok(foe, 'the dummy spawned');
  const strike = () => {
    const n = h.hooksOf('damaged').filter((c) => c.source === u && c.target === foe && c.type === 'phys').length;
    h.b.forceAttack(u, [foe], {});
    return h.hooksOf('damaged').filter((c) => c.source === u && c.target === foe && c.type === 'phys').slice(n).at(-1);
  };
  h.b.rng = () => 0.99;
  const low = strike();
  h.b.rng = () => 0.01;
  const high = strike();
  assert.ok(low && high, 'two physical instances landed');
  assert.ok(high.amount > low.amount * 1.2, `a 生死定夺 proc hits harder (${high.amount} vs ${low.amount})`);
  checkInvariants(h.b);
});

test('talent 习得性防御: physical damage from a source in front of her is cut by 35% (full potential)', () => {
  const h = mk({ seed: 15, units: [{ chessId: CHESS_E, row: 10, col: 3 }] });
  const u = ready(h);
  const foe = h.spawn('enemy_dummy', { pos: [10, 4] });   // in front: she faces RIGHT
  assert.ok(foe, 'the dummy spawned in front of her');
  h.b.rng = () => 0.99;
  const before = u.hp;
  const front = h.b.dealDamage(foe, u, { amount: 1000, type: 'phys', isAttack: true });
  assert.ok(front > 0 && front < 700, `front damage is reduced (${front} of 1000)`);
  assert.ok(u.hp < before, 'she lost HP');
  // the same hit from behind is not reduced (she faces RIGHT, the source sits at col 1)
  const back = h.spawn('enemy_dummy', { pos: [10, 1] });
  const rear = h.b.dealDamage(back, u, { amount: 1000, type: 'phys', isAttack: true });
  assert.ok(rear > front, `damage from behind is not cut (${rear} > ${front})`);
  checkInvariants(h.b);
});

test('她登记在阿戈尔盟约的成员名单里（面板成员列表与计数一致）', async () => {
  // 两个名单必须一致：计数读棋子自己的 bonds[]（bondsMeta.membership），面板读 bond.members /
  // visibleMembers（buildBonds 从官方活动表的 bondInfoDict[bondId].chessIdList 生成，
  // 由 tools/apply-clementia-bond.mjs 补上她；只加棋池三张表是不够的）。
  const { readFileSync } = await import('node:fs');
  const bonds = JSON.parse(readFileSync(new URL('../../data/bonds.json', import.meta.url), 'utf8'));
  const list = bonds.bonds ?? bonds;
  const egir = list.egirShip;
  assert.ok(egir, '阿戈尔（egirShip）盟约存在');
  assert.ok(egir.members.includes(CHESS_E), `bond.members 含她（现有 ${egir.members.length} 人）`);
  assert.ok(egir.visibleMembers.includes(CHESS_E), 'visibleMembers（面板用的那份）含她');
  const chess = JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
  const rec = (chess.chess ?? chess)[CHESS_E];
  assert.ok(rec.bonds.includes('egirShip'), '她的棋子记录仍属于该盟约');
});
