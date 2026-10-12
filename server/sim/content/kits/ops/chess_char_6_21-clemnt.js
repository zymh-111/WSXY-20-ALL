// server/sim/content/kits/ops/chess_char_6_21-clemnt.js — 克莱门莎 (char_4231_clemnt) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.
//
// Why this file exists (local fork, 2026-10-11):
//   克莱门莎 is added to the chess pool by tools/apply-clementia-patch.mjs (data/chess.json chess_char_6_21_a/_b),
//   but `content/index.js kitOf` resolves a POOL chess's kit by `def.baseId` — never by charId — so an operator
//   implemented only as a 自选 kit (`ops/op-clemnt.js`, upstream LongQianChen/Stronghold-Protocol, registry key
//   `char_4231_clemnt`) never reaches her. Without this file she falls back to the generic kit: S1 keeps only its
//   ATK scale, S2 gets aspd + splash numbers but no 浮游放逐舱 / 漩涡, S3 is no skill at all, and both talents are lost.
//   This file is the upstream implementation of her three skills and two talents, re-registered under the pool id
//   and adapted to this build's SkillSpec surface (see "Adaptations" below). The 自选 file stays untouched.
//
// Sources: official CN tables (client 2.7.81, 2026-10-08) and PRTS 克莱门莎, 2026-10-09 — all skills at ranks 4/7
// (normal: ATK scale 205 % / 220 % / 180 %, elite: 225 % / 230 % / 200 %), both potential-sensitive talents at full
// potential (生死定夺: 25 % → 50 % and ×1.35; 习得性防御: 30 % → 50 % normal / 海怪). No module was released with her.
// https://prts.wiki/w/克莱门莎
//
// Adaptations to this build (0.2.2) against the upstream kit — every one verified against this repo's sources:
//   * `attack.onHit` → `spec.onHit`: this build's attack pipeline (server/sim/ai.js `_finishAttack`) calls the
//     ATTACK-level `onHit` with `{target, dealt, x, y}` only and never a per-skill `attack.onHit`; the skill-level
//     `spec.onHit` (S1, S3 riders) does get `{target, dealt}`. S2's splash is the ENGINE's (`attack.splashRadius`,
//     per live professions.js "splashRadius tiles around the struck target") instead of a hand-rolled `onEachHit`,
//     which this build also lacks.
//   * `battle.foesInRadius` + `canTargetEnemy(attacker, enemy, profile)` — same signatures as upstream.
//   * fx kinds that this build does not register: `blast` → `aoe` (live fx table registers `aoe`, and reads the `r`
//     radius key; `blast` is only an archetype), the vortex zone keeps `tide` (registered, radius via `r`).
//   * `skill.timeLeft` for the vortex duration: an ammo skill's `timeLeft` is Infinity, so the zone falls back to the
//     16 s skill duration through `Number.isFinite`.
//   * the 缴械 window ends when the cabin stops (PRTS: "放逐仓停止时提前结束"), not with the fixed 10 s cast buff.
//   * the kit's own `up(unit)` / `canAct` guards are inlined: this build's shared/tier1.js exports `up`, but a kit
//     file may not import the tier-6 barrel for one predicate, and both checks are one expression each.
//
// [ASSUMED] launch-day details that PRTS still marks unknown, kept from the upstream kit — the carriage's unresolved
// 放逐 combination = cannot walk/attack/be blocked, but remains damageable; its boundary clearance 0.4; the carriage
// updates once per sim tick; the vortex ends with the skill; S3's first bombardment at 0.5 s, then twice at 1 s
// intervals, and launched shots survive the skill's end.

import { num, talentBb, skillRec } from '../shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy } from '../../../targeting.js';
import { bodyInKeys, hitRect } from '../../../body.js';
import { dirVec } from '../../../dir.js';
import { COLS } from '../../../constants.js';
import { hasHp } from '../../../damage.js';

const S1 = 'skchr_clemnt_1', S2 = 'skchr_clemnt_2', S3 = 'skchr_clemnt_3';
const GROUND = Object.freeze({ canHitFly: false, groundOnly: true });
const AIR = Object.freeze({ canHitFly: true });
const SPEED = 2, DISTANCE = 3, CATCH_HALF = 0.55, VORTEX_RADIUS = 1.5;
const SPLASH_RADIUS = 1.1; // PRTS 2026-10-10: collision test; four secondary targets take 100% ATK.
const FIRST_BOMB = 0.5; // [ASSUMED] Neither PRTS nor the edited official demo settles the first landing offset.
const CAST = 'clemnt:cast', CARRY = 'clemnt:carry:';
const skillBb = (raw, id) => skillRec(raw, id)?.bb ?? {};
const tile = (u) => [Math.round(u.y), Math.round(u.x)];
const up = (u) => !!u && u.alive && u.deployed;
const immunity = (e) => e.def?.raw?.stats?.otherImmunities ?? [];
// No current mode enemy has the three named teleport immunities. Also honour explicit normalized flags for custom data.
const cannotCarry = (e) => e.s.flags.selfBound || e.def?.immune?.has('exile') || e.def?.immune?.has('teleport')
  || immunity(e).some((s) => /teleport|transmit|exile/i.test(String(s)));

/** [CUSTOM] 阿戈尔层数（实时）：自己所属玩家在这场战斗里的该盟约层数，读不到按 0。 */
const bondLayers = (battle, unit, bondId) =>
  num(battle.getPlayer?.(unit?.ownerId)?.bonds?.[bondId]?.layers, 0);

/** Cabin's 1.1 × 1.1 collision square; huge bodies use the engine hit rectangle. */
function touches(e, x, y) {
  const r = hitRect(e);
  return r ? r.x1 >= x - CATCH_HALF && r.x0 <= x + CATCH_HALF && r.y1 >= y - CATCH_HALF && r.y0 <= y + CATCH_HALF
    : Math.abs(e.x - x) <= CATCH_HALF + 1e-9 && Math.abs(e.y - y) <= CATCH_HALF + 1e-9;
}

function clemnt(bb, raw, def) {
  const t0 = talentBb(raw, 0), t1 = talentBb(raw, 1);
  const b1 = skillBb(raw, S1), b2 = skillBb(raw, S2), b3 = skillBb(raw, S3);
  // S1 冲蚀 / S3 与海为敌 riders: "造成相当于本次攻击伤害 N% 的侵蚀损伤" (element gauge, type 'element').
  const rider = ({ battle, unit, target, dealt }, ratio) => {
    if (dealt > 0 && hasHp(target)) battle.dealDamage(unit, target, {
      amount: dealt * ratio, type: 'element', element: 'erosion', isSkill: true, tags: ['skill', 'clemnt:rider'],
    });
  };
  const freePassengers = (battle, unit) => {
    const c = unit.mem.clemntCabin;
    if (c) for (const e of c.passengers) battle.removeBuff(e, CARRY + unit.id);
    battle.removeBuff(unit, CAST);
  };
  const finishCabin = (battle, unit, c) => {
    if (c.stopped) return;
    c.stopped = true;
    freePassengers(battle, unit);
    // PRTS: vortex at the cabin's actual stopping position, radius 1.5, can hit air; it lasts as long as the skill.
    c.tick = 0;
    const dur = Number.isFinite(unit.skill?.timeLeft) ? Math.max(0, unit.skill.timeLeft) : num(skillRec(raw, S2)?.duration, 0);
    battle.fx('tide', { x: c.x, y: c.y, r: VORTEX_RADIUS, dur, id: unit.id });
  };
  const startCabin = (battle, unit) => {
    const [dr, dc] = dirVec(unit.dir), [r, col] = tile(unit);
    let distance = DISTANCE;
    for (let d = 1; d <= DISTANCE + 1; d++) {
      const rr = r + dr * d, cc = col + dc * d, t = battle.grid.tile(rr, cc);
      if (!battle.grid.groundPassable(rr, cc) || t.height === 'HIGH' || t.key === 'tile_hole') {
        // [ASSUMED] PRTS's provisional rule: stop 0.4 tiles before the impassable edge.
        distance = Math.min(distance, Math.max(0, d - 0.5 - 0.4)); break;
      }
    }
    const c = unit.mem.clemntCabin = { x: col, y: r, ox: col, oy: r, dr, dc, distance, moved: 0,
      mass: num(b2['attack@max_passenger_mass'], 8), passengers: [], stopped: false, tick: 0 };
    // 强制缴械 while the cabin flies: PRTS "技能开启后…进入10秒的强制缴械（放逐仓停止时提前结束）".
    battle.addBuff(unit, { key: CAST, duration: 10, flags: { disarm: true }, tags: ['skill'] });
    battle.fx('anchor', { x: col + dc * distance, y: r + dr * distance, fromX: col, fromY: r, id: unit.id, dur: distance / SPEED });
    if (distance <= 1e-9) finishCabin(battle, unit, c);
  };
  const tickCabin = (battle, unit, dt) => {
    const c = unit.mem.clemntCabin;
    if (!c || !up(unit)) return;
    if (!c.stopped) {
      c.moved = Math.min(c.distance, c.moved + SPEED * dt);
      c.x = c.ox + c.dc * c.moved; c.y = c.oy + c.dr * c.moved;
      // Release before either boarding limit is checked: invalid riders occupy neither a slot
      // nor weight. Return their current weight, including modifiers applied during the ride.
      for (let i = c.passengers.length - 1; i >= 0; i--) {
        const e = c.passengers[i], [er, ec] = tile(e);
        if (!e.alive || e.hidden || cannotCarry(e)
          || !battle.grid.findPath(er, ec, Math.round(c.y), Math.round(c.x))) {
          battle.removeBuff(e, CARRY + unit.id);
          c.passengers.splice(i, 1);
          c.mass += e.weight;
        }
      }
      const cap = num(b2['attack@max_passenger_cnt'], 15);
      for (const e of battle.enemies) {
        if (c.passengers.length >= cap) break;
        if (!e.alive || !e.deployed || e.hidden || e.isFlying || cannotCarry(e) || c.passengers.includes(e)
          || e.weight > c.mass + 1e-9 || !touches(e, c.x, c.y)) continue;
        const [er, ec] = tile(e);
        if (!battle.grid.findPath(er, ec, Math.round(c.y), Math.round(c.x))) continue;
        c.mass -= e.weight;
        c.passengers.push(e);
        battle._unblock(e);
        // [ASSUMED] PRTS has not yet resolved every status in 放逐; no invulnerability or hide is invented.
        battle.addBuff(e, { key: CARRY + unit.id, flags: { noMove: true, disarm: true, unblockable: true }, source: unit, tags: ['skill'] });
      }
      for (const e of c.passengers) {
        if (!e.findBuff(CARRY + unit.id)) continue;
        const fromX = e.x, fromY = e.y;
        e.x = c.x; e.y = c.y;
        if (e.route) e.route.pts = null;
        battle.fx('teleport', { x: e.x, y: e.y, fromX, fromY, id: e.id, src: unit.id });
      }
      if (c.moved >= c.distance - 1e-9) finishCabin(battle, unit, c);
      return;
    }
    const foes = battle.foesInRadius(c.x, c.y, VORTEX_RADIUS).filter((e) => canTargetEnemy(unit, e, AIR));
    for (const e of foes) battle.addBuff(e, { key: `clemnt:vortex:${unit.id}`, duration: 0.1,
      mods: { moveMul: 1 + num(b2['attack@move_speed'], -0.7) }, source: unit, tags: ['skill'] });
    c.tick += dt;
    if (c.tick < 1 - 1e-9) return;
    c.tick -= 1;
    for (const e of foes) {
      // 每秒受到200点侵蚀损伤 (gauge, type 'element') + 相当于攻击力 N% 的物理伤害 (HP damage).
      battle.dealDamage(unit, e, { amount: num(b2['attack@water_element'], 200), type: 'element',
        element: 'erosion', isSkill: true, canDodge: false, tags: ['skill', 'dot', 'clemnt:vortex:erosion'] });
      if (hasHp(e)) battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2['attack@physical_atk_scale']),
        type: 'phys', canDodge: false, isSkill: true, tags: ['skill', 'dot', 'clemnt:vortex'] });
    }
  };
  const bombard = (battle, unit, e, m, skill) => {
    const [r, c] = tile(e), key = r * COLS + c;
    if ((m.tiles.get(key) ?? -1) > battle.time) {
      console.log(`[clemnt] 齐射被同格冷却挡下 | 格=(${r},${c}) 剩余 ${((m.tiles.get(key) ?? 0) - battle.time).toFixed(1)}s`);
      return false;
    }
    m.tiles.set(key, battle.time + num(b3.projectile_life_time, 5));
    const keys = new Set([[r, c], [r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]].map(([rr, cc]) => rr * COLS + cc));
    const atk = unit.s.atk;
    battle.fx('lock', { x: c, y: r, id: e.id, src: unit.id, dur: FIRST_BOMB });
    for (let n = 0; n < 3; n++) battle.after(FIRST_BOMB + n, () => {
      battle.fx('aoe', { x: c, y: r, r: 1.5, id: unit.id });
      for (const t of battle.enemies) {
        if (!canTargetEnemy(unit, t, GROUND) || !bodyInKeys(t, keys)) continue;
        battle.dealDamage(unit, t, { amount: atk * num(b3.s3_atk_scale), type: 'phys', canDodge: false,
          isSkill: true, tags: ['skill', 'clemnt:bomb'] });
        if (hasHp(t)) battle.dealDamage(unit, t, { amount: atk * num(b3.ep_damage_scale), type: 'elemental', element: 'erosion',
          canDodge: false, isSkill: true, tags: ['skill', 'clemnt:bomb'] });
      }
    }, { owner: unit, holdsBattle: true });
    skill.ammoLeft--;
    battle.emit('ammoUsed', { unit, left: skill.ammoLeft, skill });
    return true;
  };
  return {
    // 本源近卫 attacks are physical and 优先攻击自身阻挡的单位 (professions.js reads the sub-profession); the three skills:
    //   S1 冲蚀 — ATK scale + 侵蚀损伤 rider (25 % / 30 % of the damage dealt)
    //   S2 风暴潮 — aspd + 100, 1.1 splash around the struck target (max 5 ground), 浮游放逐舱 → 漩涡
    //   S3 与海为敌 — 10 ammo: 1.8/2.0 ATK + 20 % 侵蚀损伤 rider, and every 侵蚀爆发 locks the target for a 3-shell barrage
    skills: {
      [S1]: {
        kind: 'instant',
        // PRTS: "此技能的损伤于本次技能攻击成功造成伤害时产生，损伤数值根据本次攻击造成的伤害数额" — the rider is per
        // victim, so it hangs off `attack.onEachHit` (the engine calls it for the main target and every splash victim).
        // `spec.onHit` would be wrong here: the engine only reaches it while the skill is still `active`, which an
        // instant (next-attack) skill no longer is when a projectile lands.
        attack: { atkScale: num(b1.atk_scale, 1),
          onEachHit(c) { rider(c, num(b1.ep_damage_ratio)); } },
      },
      [S2]: {
        kind: 'duration', mods: { aspd: num(b2.attack_speed) },
        targeting: { rangeGrid: skillRec(raw, S2)?.rangeGrid },
        attack: { atkScale: num(b2['attack@aoe_atk_scale'], 1), groundOnly: true,
          // PRTS 备注: 攻击溅射半径 1.1（碰撞判定）, 100 % ATK, 最多溅射 4 名地面敌人 (the main victim + 4).
          splashRadius: SPLASH_RADIUS, splashScale: 1, splashOthersOnly: true, maxTargets: num(b2['attack@max_target'], 5) },
        onStart({ battle, unit }) { startCabin(battle, unit); },
        onTick({ battle, unit, dt }) { tickCabin(battle, unit, dt); },
        onEnd({ battle, unit }) { freePassengers(battle, unit); unit.mem.clemntCabin = null; },
      },
      [S3]: {
        kind: 'ammo', ammo: num(b3.trigger_time, 10),
        targeting: { rangeGrid: skillRec(raw, S3)?.rangeGrid, maxTargets: num(b3['attack@max_target'], 3) },
        attack: { atkScale: num(b3['attack@atk_scale'], 1),
          onEachHit(c) { rider(c, num(b3['attack@ep_damage_ratio'])); } },
        onAttack(c) { c.noAmmo = true; },
        onStart({ unit }) { unit.mem.clemntBombs = { marks: new Map(), tiles: new Map() }; },
        onTick({ battle, unit, skill }) {
          const m = unit.mem.clemntBombs;
          if (!m || !unit.canAct) return;
          const choices = [];
          for (const [e, until] of m.marks) {
            if (until < battle.time - 1e-9 || !e.alive || e.hidden) { m.marks.delete(e); continue; }
            if (canTargetEnemy(unit, e, GROUND)) choices.push(e);
          }
          const dist2 = (e) => { const dx = e.x - unit.x, dy = e.y - unit.y; return dx * dx + dy * dy; };
          choices.sort((a, b) => dist2(a) - dist2(b) || a.spawnSeq - b.spawnSeq);
          for (const e of choices) if (bombard(battle, unit, e, m, skill)) {
            // PRTS：「成功发射舰船轰炸弹道时，消耗1发弹药并去除轰炸目标地块上**所有敌人**的【可轰炸标记】」
            // —— 原先只删了目标自己，同格其它敌人还留着标记（下一帧会再炸同格，被弹道冷却挡下，属无害但语义不符）。
            const [tr, tc] = tile(e);
            for (const [other] of m.marks) {
              const [or_, oc] = tile(other);
              if (or_ === tr && oc === tc) m.marks.delete(other);
            }
            break;
          }
          if (skill.ammoLeft <= 0) skill.end('ammo');
        },
        onEnd({ unit }) { unit.mem.clemntBombs = null; },
      },
    },
    talents: [
      { install(battle, unit) { // 生死定夺: 25 % (目标防御力低于初始值时 50 %) 概率攻击力提升至 120/135 %, per phys instance
        battle.on('hit', ({ source, target, dmg }) => {
          if (source !== unit || dmg.type !== 'phys' || !target || target.side !== 'enemy') return;
          const chance = target.s.def < target.base.def ? num(t0.prob_special) : num(t0.prob_normal);
          if (battle.rng() < chance) dmg.amount *= num(t0.t1_atk_scale, 1);
        }, { owner: unit });
      } },
      { install(battle, unit) { // 习得性防御: source tile in the forward half-plane (dot product ≥ 0), plus every enemy she blocks
        battle.on('hit', ({ source, target, dmg }) => {
          if (target !== unit || !source || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
          const [dr, dc] = dirVec(unit.dir), [r, c] = tile(source);
          if (source.blockedBy !== unit && (r - unit.tileR) * dr + (c - unit.tileC) * dc < 0) return;
          const sea = source.def?.tags?.includes('seamonster');
          dmg.mul *= 1 - num(sea ? t1.damage_resistance_seamonster : t1.damage_resistance_normal);
        }, { owner: unit });
      } },
    ],
    install(battle, unit) {
      // ── [CUSTOM] 本分支自定义：克莱门莎的个人特质（在阿戈尔阵营中生效）─────────────────────────────
      // 每 N 层阿戈尔：克莱门莎自身攻击力 +1%；她攻击范围内的敌人受到的元素伤害 +1%（元素脆弱）。
      //   · 普通形态：每 3 层 +1%
      //   · 精锐形态：每 2 层 +1%
      // 这是**她个人的特质**，不是阿戈尔盟约的改动（data/bonds.json 未改）、也不是策略效果：
      //   · 攻击力只加在她自己身上（不给队友）
      //   · 元素脆弱只挂在她攻击范围内的敌人身上（对任何来源的元素伤害都生效，符合官方「元素脆弱」语义）
      // 触发条件读**实时**层数（battle.getPlayer(unit.ownerId).bonds.egirShip.layers）：阿戈尔战斗开始时的
      // 吞噬本身会加层，用一次性快照会算少。
      //
      // 注意：引擎的 content/traitMods.js 只识别「攻击范围内存在N名敌人时攻击速度+X」这一种条件形态，
      // 所以这种"每N层"的条件只能写在 kit 里，改 chess.trait 的 bb 是不生效的。
      //
      // 攻击力走 atkPct 乘区（units.js 的 atk 计算链）；元素易伤走 elemFragile（elementalTakenMul，
      // 只作用于「元素伤害」这一类型，不影响侵蚀损伤的填条）。
      {
        const EGIR_BOND = 'egirShip';
        const LAYERS_NORMAL = 3;   // 普通：每 3 层 +1%
        const LAYERS_ELITE = 2;    // 精锐：每 2 层 +1%
        const stepOf = () => (raw?.isGolden || def?.isGolden || def?.golden ? LAYERS_ELITE : LAYERS_NORMAL);
        const layerBonus = () => Math.floor(bondLayers(battle, unit, EGIR_BOND) / stepOf()) / 100;
        // 自己的攻击力（只挂在自己身上）
        battle.every(0.5, () => {
          if (!up(unit)) return;
          const pct = layerBonus();
          if (pct > 0) {
            battle.addBuff(unit, { key: `clemnt:egirAtk:${unit.id}`, mods: { atkPct: pct }, duration: 0.6, refresh: 'replace', source: unit, tags: ['trait', 'clemnt:egir'] });
          } else {
            battle.removeBuff(unit, `clemnt:egirAtk:${unit.id}`);
          }
        }, { owner: unit, immediate: true });
        // 攻击范围内的敌人：元素脆弱
        battle.every(0.5, () => {
          if (!up(unit)) return;
          const frag = layerBonus();
          if (!(frag > 0)) return;
          for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, AIR)) {
            battle.applyStatus(e, 'elemFragile', { duration: 0.6, value: frag, source: unit });
          }
        }, { owner: unit, immediate: true });
      }

      if (unit.skill?.id === S2) {
        // The extended attack grid of S2 hits air while her normal attacks do not: hand the skill a trigger range
        // whose profile allows flyers, so 自动/手动 opening it also counts enemies in the enlarged range.
        unit.skill.addTriggerRange(() => [{
          keys: absoluteRangeKeys(skillRec(raw, S2)?.rangeGrid, unit.tileR, unit.tileC, unit.dir, unit.s.baseRangeExtend || 0),
          profile: AIR,
        }]);
      }
      battle.on('elementBurst', ({ source, target, element }) => {
        // [TEMP-LOG-CLEMNT] 诊断：为什么不锁定（排查"珊比爆发了却没伤害"）
        if (element === 'erosion') {
          const why = !up(unit) ? '她不在场/已阵亡'
            : !unit.skill?.active ? '技能未开启（弹药耗尽或没开）'
            : unit.skill.id !== S3 ? `带的是 ${unit.skill.id}（不是 S3）`
            : !target || !canTargetEnemy(unit, target, GROUND) ? '目标不可选（隐匿/无敌/飞行/未部署/隐藏）'
            : null;
          console.log(`[clemnt] 侵蚀爆发 | 目标=${target?.defId ?? '?'} 来源=${source?.defId ?? '无'} `
            + `弹药=${unit.skill?.ammoLeft ?? '-'} 技能=${unit.skill?.id ?? '-'} → ${why ? '不锁定（' + why + '）' : '获得【可轰炸标记】(1 秒窗口，每帧尝试发射)'}`);
          if (why) return;
        }
        if (element !== 'erosion' || !up(unit) || !unit.skill?.active || unit.skill.id !== S3
          || !canTargetEnemy(unit, target, GROUND)) return;
        // PRTS S3 备注：「技能期间场上**所有可选**的敌方地面单位侵蚀损伤爆发时获得1秒的【可轰炸标记】Buff」
        // —— **没有来源限制**，她自己齐射打出的爆发同样要标记（用户实测报过：只认外部爆发是错的）。
        // 不会因此无限连环，限制来自官方另外三条：
        //   ① 标记只有 1 秒窗口（bb ep_break_duration）；
        //   ② 「无法选择目前存在未结束的舰船轰炸弹道（中心判定）作为轰炸目标」—— 同格 5 秒内不能再发射
        //      （bb projectile_life_time，见 bombard 的 m.tiles）；
        //   ③ 每帧至多发射一次（onTick 里命中即 break）。
        // 于是同格反复爆条最多 5 秒 1 发；只有**跨地块**的爆条才可能连续发射，这是规则本身允许的。
        unit.mem.clemntBombs?.marks.set(target, battle.time + num(b3.ep_break_duration, 1));
      }, { owner: unit });
    },
  };
}

export default {
  chess_char_6_21_a: clemnt,
};
