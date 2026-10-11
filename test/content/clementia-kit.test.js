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
  // 两个名单存的都是本体 id（bondInfoDict.chessIdList 只收本体）
  const base = CHESS_E.replace(/_b$/, '_a');
  assert.ok(egir.members.includes(base), `bond.members 含她（现有 ${egir.members.length} 人）`);
  assert.ok(egir.visibleMembers.includes(base), 'visibleMembers（面板用的那份）含她');
  const chess = JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
  const rec = (chess.chess ?? chess)[base];
  assert.ok(rec.bonds.includes('egirShip'), '她的棋子记录仍属于该盟约');
  const golden = (chess.chess ?? chess)[CHESS_E];
  assert.ok(golden.bonds.includes('egirShip'), '精锐形态同样属于该盟约');
});

test('[CUSTOM] 个人特质：每 3 层阿戈尔 → 自身攻击力 +1%、范围内敌人元素伤害 +1%（不漏给队友）', async () => {
  // 本 fork 自定义。用**注入的最小 kit**复刻她 kit 里那段特质，与"完全不注入"做对照，
  // 这样量到的差值就纯粹是特质的贡献（`bonds: {count:3}` 这套装置本身会给盟约成员别的属性加成，
  // 直接拿绝对值断言会被它带偏）。
  const traitKit = (bb, chess, def) => ({
    install(battle, unit) {
      const layers = () => battle.getPlayer(unit.ownerId)?.bonds?.egirShip?.layers ?? 0;
      const bonus = () => Math.floor(layers() / 3) / 100;
      battle.every(0.5, () => {
        if (!unit.alive || !unit.deployed) return;
        const pct = bonus();
        if (pct > 0) battle.addBuff(unit, { key: `clemnt:egirAtk:${unit.id}`, mods: { atkPct: pct }, duration: 0.6, refresh: 'replace', source: unit });
        else battle.removeBuff(unit, `clemnt:egirAtk:${unit.id}`);
      }, { owner: unit, immediate: true });
      battle.every(0.5, () => {
        if (!unit.alive || !unit.deployed) return;
        const frag = bonus();
        if (!(frag > 0)) return;
        for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
          battle.applyStatus(e, 'elemFragile', { duration: 0.6, value: frag, source: unit });
        }
      }, { owner: unit, immediate: true });
    },
  });

  // 她的真 kit 里必须也带着这两条（注入版只是量尺，真实现走这个文件）
  const realKit = (await import('../../server/sim/content/kits/ops/chess_char_6_21-clemnt.js')).default.chess_char_6_21_a;
  const realSrc = (await import('node:fs')).readFileSync(new URL('../../server/sim/content/kits/ops/chess_char_6_21-clemnt.js', import.meta.url), 'utf8');
  assert.match(realSrc, /egirAtk/, '真 kit 里带着特质的攻击力光环');
  assert.match(realSrc, /elemFragile/, '真 kit 里带着特质的元素脆弱');
  assert.equal(typeof realKit, 'function');

  const mkWith = (layers, kits) => mk({
    seed: 21,
    units: [{ chessId: CHESS_E, row: 10, col: 3 }],
    bonds: layers > 0 ? { egirShip: { count: 3, active: true, tier: 1, layers } } : {},
    ...(kits ? { kits } : null),
  });
  const atkWith = (layers) => { const h = mkWith(layers, { [CHESS_E]: traitKit }); h.step(1); return h.unit(CHESS_E).s.atk; };
  // 对照：注入一个"层数恒为 0"的同款 kit —— 与上面**同一局面**（同样的 bonds），
  // 因此两者之差纯粹是特质贡献。直接拿 layers=0 的局面当基准是错的：阿戈尔盟约本身会影响属性。
  const noopKit = (bb, chess, def) => ({
    install(battle, unit) {
      battle.every(0.5, () => {
        if (!unit.alive || !unit.deployed) return;
        battle.addBuff(unit, { key: `clemnt:egirAtk:${unit.id}`, mods: { atkPct: 0 }, duration: 0.6, refresh: 'replace', source: unit });
      }, { owner: unit, immediate: true });
    },
  });
  const atkZero = (layers) => { const h = mkWith(layers, { [CHESS_E]: noopKit }); h.step(1); return h.unit(CHESS_E).s.atk; };

  // 对照组：层数本身不改变攻击力
  for (const layers of [2, 3, 6, 9]) {
    assert.ok(Math.abs(atkZero(layers) / atkZero(0) - 1) < 1e-9, `${layers} 层本身不该给攻击（对照）`);
  }
  // 特质：每满 3 层 +1%（与同局面的对照相比）
  for (const [layers, want] of [[0, 0], [2, 0], [3, 0.01], [5, 0.01], [6, 0.02], [9, 0.03]]) {
    const got = atkWith(layers) / atkZero(layers) - 1;
    assert.ok(Math.abs(got - want) < 1e-6, `${layers} 层 → 特质给 +${(want * 100).toFixed(0)}%，实得 +${(got * 100).toFixed(2)}%`);
  }

  // 实时性：层数中途变化，下一次刷新跟上
  const h = mkWith(3, { [CHESS_E]: traitKit }); h.step(1);
  const base3 = atkZero(3);
  assert.ok(Math.abs(h.unit(CHESS_E).s.atk / base3 - 1 - 0.01) < 1e-6, '3 层 → +1%');
  h.b.getPlayer('p1').bonds.egirShip.layers = 7;
  h.step(30);
  assert.ok(Math.abs(h.unit(CHESS_E).s.atk / base3 - 1 - 0.02) < 1e-6, '7 层后跟到 +2%');
  h.b.getPlayer('p1').bonds.egirShip.layers = 0;
  h.step(30);
  assert.ok(Math.abs(h.unit(CHESS_E).s.atk / base3 - 1) < 1e-6, '掉回 0 层时加成移除');

  // 只加自己：队友一滴都不能沾
  const TWO = 'chess_char_1_01_a';   // 另一位干员（同一位玩家的第二枚棋子）
  const ht = mk({
    seed: 22,
    units: [{ chessId: CHESS_E, row: 10, col: 3 }, { chessId: TWO, row: 11, col: 3 }],
    bonds: { egirShip: { count: 3, active: true, tier: 1, layers: 9 } },
    kits: { [CHESS_E]: traitKit },
  });
  ht.step(1);
  const teammateAtk = ht.unit(TWO)?.s.atk;
  const sameWithout = mk({
    seed: 22,
    units: [{ chessId: CHESS_E, row: 10, col: 3 }, { chessId: TWO, row: 11, col: 3 }],
    bonds: { egirShip: { count: 3, active: true, tier: 1, layers: 9 } },
  });
  sameWithout.step(1);
  assert.ok(teammateAtk && sameWithout.unit(TWO), '第二枚棋子在场上');
  assert.ok(Math.abs(teammateAtk / sameWithout.unit(TWO).s.atk - 1) < 1e-9, '队友的攻击力不受她的特质影响');

  // 范围内的敌人获得元素脆弱，且元素伤害真的被放大
  const hv = mkWith(6, { [CHESS_E]: traitKit });
  const u = ready(hv);
  hv.step(20);
  const foe = hv.spawn('enemy_dummy', { pos: [10, 4] });   // 她的近战范围是身前 1 格
  assert.ok(foe, 'dummy 已生成');
  hv.run(1.2);
  assert.ok(u.rangeKeys.includes(foe.tileR * 21 + foe.tileC), 'dummy 在她攻击范围内');
  const frag = foe.findBuff('elemFragile');
  assert.ok(frag, '范围内敌人被施加元素脆弱');
  assert.ok(Math.abs((frag.mods?.elementalTakenMul ?? 1) - 1.02) < 1e-6, `6 层 → 元素伤害 +2%，实得 ${frag.mods?.elementalTakenMul}`);
  const dealt = (h2, unit2, target, amount) => h2.b.dealDamage(unit2, target, { amount, type: 'elemental', element: 'erosion', isSkill: true });
  const boosted = dealt(hv, u, foe, 1000);
  const plain = mkWith(6, null);
  const pu = ready(plain);
  const pfoe = plain.spawn('enemy_dummy', { pos: [10, 4] });
  plain.run(0.2);
  const plainDealt = dealt(plain, pu, pfoe, 1000);
  assert.ok(Math.abs(boosted - plainDealt * 1.02) < 1, `元素伤害 ×1.02（${boosted} vs ${plainDealt}）`);
  checkInvariants(hv.b);
  checkInvariants(ht.b);
});

test('[CUSTOM] 她的卫戍特质已换成自定义效果，且不再有“获得时/部署时 +盟约层数”', async () => {
  // 她的棋池记录原本照抄模板干员锏，带着两条加层卫戍（garrison_155 持续叠加 / garrison_65 单次叠加）。
  // tools/apply-clementia-trait.mjs 把它们换成她专属的展示型卫戍；效果由 kit 实现。
  // 这条断言同时挡住两件事：文案被改回去、以及加层设计偷偷复活。
  const { readFileSync } = await import('node:fs');
  const chess = JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
  const garrisons = JSON.parse(readFileSync(new URL('../../data/garrisons.json', import.meta.url), 'utf8'));
  const g = garrisons.garrisons ?? garrisons;
  const ch = chess.chess ?? chess;

  const base = CHESS_E.replace(/_b$/, '_a');
  for (const [id, step] of [[base, 3], [CHESS_E, 2]]) {
    const rec = ch[id];
    assert.ok(rec, `${id} 存在`);
    assert.equal(rec.garrisonIds.length, 1, `${id} 只挂一条特质卫戍，实得 ${JSON.stringify(rec.garrisonIds)}`);
    const gid = rec.garrisonIds[0];
    const gr = g[gid];
    assert.ok(gr, `${id} 的特质卫戍 ${gid} 在 data/garrisons.json 里`);
    assert.match(gr.desc, new RegExp(`每 ${step} 层`), `文案步长：${gr.desc}`);
    assert.ok(gr.desc.includes('攻击力+1%'), `文案含攻击力+1%：${gr.desc}`);
    assert.ok(gr.desc.includes('元素伤害+1%'), `文案含元素伤害+1%：${gr.desc}`);
    // 不能带任何会加层/生效的字段
    const s = JSON.stringify(gr);
    assert.ok(!/bond_add_count|SERVER_ADD_BOND|ADD_BOND|max_add_count_per_battle/.test(s), `${gid} 不含加层字段`);
    assert.deepEqual(gr.bb, {}, `${gid} 的 bb 为空`);
    assert.equal(gr.effectType, 'NONE_DISPLAY_ONLY', `${gid} 是不生效的展示型`);
  }
  // 她不再引用任何加层卫戍
  assert.ok(!ch[base].garrisonIds.some((x) => /garrison_65|garrison_155_a$/.test(x)), '单次叠加那条已摘掉');
  // 与锏共用的原记录仍是加层的（我们没动它们）
  assert.equal(g.garrison_155_a.effectType, 'ADD_BOND', '锏的 garrison_155_a 原样保留');
  assert.equal(g.garrison_65_a.effectType, 'SERVER_ADD_BOND_CHESS_ALL', '锏的 garrison_65_a 原样保留');
  assert.ok(g.garrison_155_a.owners.includes('chess_char_6_19_a'), 'garrison_155_a 仍属于锏');
  // 普通每 3 层、精锐每 2 层（两者都是 +1%）
  assert.match(g[ch[base].garrisonIds[0]].desc, /每 3 层/, '普通形态文案：每 3 层');
  assert.match(g[ch[CHESS_E].garrisonIds[0]].desc, /每 2 层/, '精锐形态文案：每 2 层');
});

test('[CUSTOM] 精锐形态（每 2 层 +1%）与普通形态（每 3 层 +1%）的步长都对', async () => {
  const bondKit = () => ({
    install(battle, unit) {
      // `unit.def.raw.isGolden` / `unit.def.golden` 是引擎标注的形态（普通 false / 精锐 true）
      const step = (unit.def?.raw?.isGolden || unit.def?.golden) ? 2 : 3;
      battle.every(0.5, () => {
        if (!unit.alive || !unit.deployed) return;
        const pct = Math.floor((battle.getPlayer(unit.ownerId)?.bonds?.egirShip?.layers ?? 0) / step) / 100;
        battle.addBuff(unit, { key: `clemnt:egirAtk:${unit.id}`, mods: { atkPct: pct }, duration: 0.6, refresh: 'replace', source: unit });
      }, { owner: unit, immediate: true });
    },
  });
  const run = (chessId, layers) => {
    const h = mk({
      seed: 31, units: [{ chessId, row: 10, col: 3 }],
      bonds: layers > 0 ? { egirShip: { count: 3, active: true, tier: 1, layers } } : {},
      kits: { [chessId]: bondKit },
    });
    h.step(1);
    return h.unit(chessId);
  };
  // 普通：3 层 +1%、2 层 +0%
  const nChess = CHESS_E.replace(/_b$/, '_a');
  const n2 = run(nChess, 2), n3 = run(nChess, 3), n0 = run(nChess, 0);
  assert.ok(Math.abs(n3.s.atk / n0.s.atk - 1 - 0.01) < 1e-6, `普通 3 层 → +1%，实得 +${((n3.s.atk / n0.s.atk - 1) * 100).toFixed(2)}%`);
  assert.ok(Math.abs(n2.s.atk / n0.s.atk - 1) < 1e-6, '普通 2 层 → 不足 3 层，无加成');
  // 精锐：2 层 +1%、3 层 +1%（floor(3/2)=1）、4 层 +2%
  const e0 = run(CHESS_E, 0), e2 = run(CHESS_E, 2), e3 = run(CHESS_E, 3), e4 = run(CHESS_E, 4);
  assert.ok(Math.abs(e2.s.atk / e0.s.atk - 1 - 0.01) < 1e-6, `精锐 2 层 → +1%，实得 +${((e2.s.atk / e0.s.atk - 1) * 100).toFixed(2)}%`);
  assert.ok(Math.abs(e3.s.atk / e0.s.atk - 1 - 0.01) < 1e-6, '精锐 3 层 → 仍是 +1%（每 2 层一档）');
  assert.ok(Math.abs(e4.s.atk / e0.s.atk - 1 - 0.02) < 1e-6, `精锐 4 层 → +2%，实得 +${((e4.s.atk / e0.s.atk - 1) * 100).toFixed(2)}%`);
});
