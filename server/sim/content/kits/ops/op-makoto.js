// server/sim/content/kits/ops/op-makoto.js — 结城理 (char_4217_makoto) kit.
//
// 他是「自选干员」池里的联动 6★ 特种/傀儡师（P3 联动，teamId = sees，隐藏势力拉特兰）。
// 他没有原型的 补位 行，所以本文件按 kit 注册表的 OPERATOR_KIT_FILES（自选干员）约定命名：
// 文件名 `op-<codename>.js`、**注册键 = 他的 charId**、三个技能全部写在 `skills` 里（自选棋子没有默认技能）。
//
// 官方数据来源：官方 CN 表（2026-10-08 档）与 PRTS 结城理，双源核对；三条技能的 rank1/4/7 与
// 两个天赋的各精英档（含潜能差）都取自表内黑board，不硬编码等级数值。
//
// 分支机制（引擎已实现，server/sim/professions.js installDollkeeper）：傀儡师受致命伤不撤退，
// 切换为<替身>作战 20 秒（`unit.trait.doll`），期间替身阻挡数为 0、持阻回；切换动画 1 秒内不死/无敌。
// 本 kit 负责的是"替身状态下他做什么"：
//   不羁之力（天赋 1）  <替身>状态下攻击间隔 +0.4、攻击力 +a%、生命值 +m%；从<本体>切进<替身>时
//                       使<替身>攻击范围内敌人停顿 sluggish 秒
//   俄耳甫斯（S1 被动） 攻击造成攻击力 N% 的法术伤害；攻击范围内有生命值低于 50% 的友方干员时改为治疗该友方
//   塔纳托斯（S2 被动） 攻击对至多 T 名敌人造成攻击力 N% 的法术伤害，并有 P% 概率恐惧 F 秒；
//                       范围**内**恐惧中的敌人若生命值低于其攻击力的 K% 则立刻倒下
//   开辟明日的剑刃（S3）初始召唤塔纳托斯（同上）；塔纳托斯在场时，开启技能或受致命伤改为召唤俄耳甫斯：
//                       阻挡数 +B、范围内友方获得 P% 物理与法术闪避、每秒治疗范围内至多 H 名友方相当于攻击力 N% 的生命
//   S.E.E.S.队长（天赋 2）<替身>状态结束后（先切<总攻击>）对周围一定范围内所有敌人造成攻击力 A% 真实伤害
//
// [ASSUMED] 几处 PRTS 未量化、或本引擎没有对应机制的地方（都写在这里，便于日后核对）：
//   · 停顿/恐惧/斩杀的"周围一定范围"= 该形态的攻击范围（<本体>与<替身>范围不同，见 data/chess.json 的 rangeGrid）；
//     PRTS 只写"一定范围"。
//   · "立刻倒下"按 bb 的 attack@kill_damage（9999999）造成**一次法术伤害**（受无敌/护盾/减伤约束），
//     与官方"生命值低于 K%×攻击力则立刻倒下"在无敌单位上会有差异。
//   · <总攻击>形态本引擎没有建模：总攻击的效果（周围范围真实伤害 + 期间无敌/静默）直接结算，
//     不新增 form 与对应动画（骨架里有 Skill_AllOutAttack_Loop/_End）。
//   · "可叠加"（多段总攻击）按每名 S.E.E.S. 队员各结算一次来实现；本模式里 S.E.E.S. 队员的判定见下面 SEES。
//   · 俄耳甫斯的治疗目标选择"范围内生命值低于 50% 的友方干员"取生命比例最低者。

import { num, talentBb } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_makoto_1', S2 = 'skchr_makoto_2', S3 = 'skchr_makoto_3';
/** <替身>形态的切换动画时长（引擎 professions.js DOLL_SWITCH）。 */
const DOLL_SWITCH = 1;
/** 官方 teamId：S.E.E.S. 小队（天赋 2 的作用范围围绕队员）。本模式里除他以外没有其他队员，判空即可。 */
const SEES_TEAM = 'sees';

const key = (r, c) => r * COLS + c;
const tile = (u) => [Math.round(u.y), Math.round(u.x)];
const up = (u) => !!u && u.alive && u.deployed;
/** 恐惧是一个 flag（buffs.js `fear: { flags: { fear: true } }`），不是 buff key。 */
const feared = (u) => !!(u && (u.s?.flags?.fear || u.hasFlag?.('fear')));

/**
 * <替身>的攻击范围：官方 range_table 的 `x-1`，**13 格菱形**
 * （中心 + 上下左右各 2 格 + 四个斜角各 1 格），与 PRTS「<替身>的攻击范围」图示一致。
 * 本体是 `1-1`（只有 自己 + 身前 1 格），所以切进替身时必须换掉 unit.rangeGrid。
 */
const DOLL_RANGE_GRID = Object.freeze([
  [0, 0], [0, 1], [0, 2], [0, -1], [0, -2],
  [1, 0], [1, 1], [1, -1],
  [-1, 0], [-1, 1], [-1, -1],
  [2, 0], [-2, 0],
]);

/**
 * 他的 kit。
 * @param {object} bb 所选出技能的黑板（rank 4 或 7）
 * @param {object} raw 棋子原始记录（取另两个技能的黑板 / 天赋 / 范围）
 * @param {object} def 规范化后的 def（unit.def：raw / isGolden / rangeGrid…）
 */
function makoto(bb, raw, def) {
  const t0 = talentBb(raw, 0);   // 不羁之力
  const t1 = talentBb(raw, 1);   // S.E.E.S.队长
  /**
   * 某个技能的黑板。**当前所选的技能一律用 `bb`**（形态与 rank 一定正确）。
   * 另两个技能从 `def.skills` / `raw.skills` 里找——注意自选干员的记录里这两处可能只带**较低 rank** 的黑板
   * （实测：普通形态 def.skills 为空、raw.skills 是 rank4 的 150/160/170%），
   * 所以这里的倍率只用于"被动形态行为"的兜底，凡是所选出技能自己用到的值都直接读 `bb`。
   */
  const bbOf = (id) => {
    const hit = (def?.skills ?? []).find((s) => s?.skillId === id) ?? (raw?.skills ?? []).find((s) => s?.skillId === id);
    return hit?.bb ?? {};
  };
  /** 当前所选出技能的黑板（形态与 rank 一定正确）。def.skill 的键名有 id / skillId 两种，都认。 */
  const curId = () => def?.skill?.id ?? def?.skill?.skillId ?? raw?.skill?.skillId ?? null;
  const bbCur = (id) => (curId() === id ? bb : bbOf(id));
  const s1 = bbCur(S1), s2 = bbCur(S2), s3 = bbCur(S3);
  const inDoll = (u) => !!u.trait?.doll;
  /** 该形态的攻击范围钥匙（替身是 13 格菱形，本体是近战 2 格 —— 见 DOLL_RANGE_GRID）。 */
  const rangeKeysOf = (u) => u.rangeKeys ?? [];
  /**
   * "攻击范围内"的敌人。`enemiesInKeys` 要求目标 `deployed`（sim/targeting.js canTargetEnemy），而**敌人在本引擎里
   * 不是 deployed 单位**，所以逐格取（`foesInRadius` 半径 1 正好覆盖该格）。
   * `air = false` 时排除飞行单位（S2 不能对空，PRTS 备注：仅 S1/S3 可对空）。
   */
  const enemiesInRange = (battle, u, air = true) => {
    const out = [];
    for (const k of rangeKeysOf(u)) {
      const r = Math.floor(k / COLS), c = k % COLS;
      for (const e of battle.foesInRadius?.(c, r, 1, true) ?? []) {
        if (!air && e.isFlying) continue;
        if (!out.includes(e)) out.push(e);
      }
    }
    return out;
  };

  // ── 不羁之力（天赋 1）：替身形态的数值 + 切换时的停顿 ─────────────────────────────────────────
  const installTalent1 = (battle, unit) => {
    battle.on('dollSwap', ({ unit: u, form }) => {
      if (u !== unit) return;
      if (form === 'doll') {
        // 只有"本体 → 替身"才停顿（由替身切到另一替身不触发，PRTS 备注）
        const secs = num(t0.sluggish, 0);
        if (secs > 0) for (const e of enemiesInRange(battle, unit)) {
          battle.applyStatus(e, 'sluggish', { duration: secs, source: unit });
        }
      } else {
        // <替身>结束 → 先切<总攻击>再回<本体>（本引擎无总攻击 form，直接结算天赋 2）
        seesAllOutAttack(battle, unit);
      }
    }, { owner: unit });
  };

  // ── S.E.E.S.队长（天赋 2）：替身结束后带队总攻击 ────────────────────────────────────────────
  const seesAllOutAttack = (battle, unit) => {
    const scale = num(t1.atk_scale, 0);
    if (!(scale > 0) || !up(unit)) return;
    // 队员列表：本模式里只有他带 teamId=sees，所以只有他自己一处落点（多队员时逐人结算）
    const members = (battle.allyUnits ?? []).filter((a) => up(a) && a.kind === 'op'
      && (a.def?.raw?.teamId === SEES_TEAM || a.def?.teamId === SEES_TEAM));
    const anchors = members.length ? members : [unit];
    // 总攻击期间他持有无敌与静默（PRTS 备注）—— 用极短窗口表达，避免被打断
    battle.addBuff(unit, { key: 'makoto:allout', duration: 0.5, flags: { invulnerable: true, silence: true, disarm: true }, tags: ['talent'] });
    battle.fx('aoe', { x: unit.x, y: unit.y, r: 1.5, id: unit.id, skill: 'makotoAllOut' });
    const atk = unit.s.atk;
    for (const a of anchors) {
      const [r, c] = tile(a);
      // "队员周围一定范围"：按 1.5 格半径（[ASSUMED]，PRTS 未量化）
      for (const e of battle.foesInRadius(c, r, 1.5, true)) {
        if (!e.alive || e.hidden) continue;
        battle.dealDamage(unit, e, { amount: atk * scale, type: 'true', isSkill: true, canDodge: false, tags: ['talent', 'makoto:allout'] });
      }
    }
  };

  // ── 替身的攻击：三技能各自的形态 ──────────────────────────────────────────────────────────
  /**
   * 一次替身攻击的结算。**黑板按"所选的技能"取，不按形态名取** —— 这是关键：
   * S3 的形态2 也是塔纳托斯（同一个面具、同一套动画），但它用的是 S3 自己的黑板（弱点伤害），
   * 没有斩杀、没有恐惧。早先按形态名取黑板，导致 S3 形态2 把 S2 的斩杀（attack@kill_damage=9999999）
   * 也一起带了出来 —— 实测就是伤害里蹦出 9999999。
   */
  const dollAttack = (battle, unit, mode) => {
    const cur = curId();
    // 所属技能：S1 → s1（俄耳甫斯），S2 → s2（塔纳托斯：多目标/恐惧/斩杀），S3 → s3（弱点伤害/治疗/闪避）
    const src = cur === S1 ? s1 : cur === S2 ? s2 : s3;
    const isOrpheus = cur === S1 || mode === 'orpheus';   // S1 的替身本就是俄耳甫斯；S3 形态3 也走俄耳甫斯
    // 对空：官方备注只有 S1/S3 可对空，S2 不可（PRTS 结城理 技能备注）
    const air = cur !== S2;
    const scale = num(src['attack@atk_scale'] ?? bb['attack@atk_scale'], 1);
    const atk = unit.s.atk;

    // 俄耳甫斯：范围内有生命值低于 50% 的友方干员时"改为"治疗他 → 这一次攻击不造成伤害
    if (isOrpheus) {
      const hurt = (battle.injuredAlliesInKeys?.(rangeKeysOf(unit), unit) ?? [])
        .filter((a) => up(a) && a.hp < a.s.maxHp * 0.5);
      if (hurt.length) {
        const heal = atk * num(s1['attack@heal_scale'] ?? src['attack@heal_scale'] ?? bb['attack@heal_scale'], 0);
        if (heal > 0) battle.heal(unit, hurt[0], heal, { skillHeal: true });
        return;
      }
    }

    const maxTargets = isOrpheus ? 1 : Math.max(1, num(src['attack@max_target'], 1));
    const targets = enemiesInRange(battle, unit, air).slice(0, maxTargets);

    // 斩杀判定读**攻击前**的血量（官方"攻击的同时，范围内恐惧中的敌人若生命值低于阈值则立刻倒下"）。
    // 钩子是在引擎的普通攻击伤害之后跑的，所以若在这里读 e.hp，血量已被打掉一段，
    // 会出现"该斩的没斩、要靠普攻补刀"的偏差。所以先按当前血量记下该倒下的目标。
    const executed = new Set();
    if (cur === S2) {
      const k = num(s2['attack@kill_atk_scale'], 0);
      const dmg = num(s2['attack@kill_damage'], 9999999);
      if (k > 0) for (const e of enemiesInRange(battle, unit, air)) {
        if (!e.alive || !feared(e) || executed.has(e)) continue;
        if (e.hp < atk * k) {
          battle.dealDamage(unit, e, { amount: dmg, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'makoto:execute'] });
          executed.add(e);
        }
      }
    }

    const bonus = atk * Math.max(0, scale - 1);
    if (bonus > 0) for (const e of targets) {
      if (executed.has(e) || !e.alive) continue;   // 已被斩杀的目标不再补伤害
      battle.dealDamage(unit, e, { amount: bonus, type: 'arts', isAttack: true, tags: ['skill', 'makoto:doll'] });
    }

    // 恐惧只有 S2（塔纳托斯的囚锁）有（官方：S3 是"弱点伤害"，没有恐惧与斩杀）
    if (cur === S2) {
      const p = num(s2['attack@prob'], 0);
      if (p > 0) for (const e of targets) {
        if (e.alive && battle.rng() < p) battle.applyStatus(e, 'fear', { duration: num(s2['attack@fear'], 0), source: unit });
      }
    }
  };

  // ── 俄耳甫斯形态（S3 第二阶段）：阻挡 + 闪避 + 每秒治疗 ──────────────────────────────────────
  const installOrpheusAura = (battle, unit) => {
    const p = num(s3['attack@prob'], 0);
    const every = Math.max(0.1, num(s3['attack@interval'], 1));
    const maxHeal = Math.max(1, num(s3['attack@max_target_heal'], 1));
    const healScale = num(s3['attack@heal_scale'], 0);
    battle.every(every, () => {
      if (!up(unit) || !inDoll(unit) || unit.mem.makotoDoll !== 'orpheus') return;
      // 范围内友方：物理与法术闪避（同名取最高，本 kit 用固定 key 覆盖刷新）
      for (const a of battle.alliesFor?.(unit) ?? []) {
        if (!up(a)) continue;
        const inside = rangeKeysOf(unit).includes(key(a.tileR, a.tileC)) || a === unit;
        if (!inside) continue;
        battle.addBuff(a, { key: 'makoto:orpheusDodge', duration: every + 0.2, refresh: 'replace', mods: { dodgePhys: p, dodgeArts: p }, source: unit, tags: ['talent', 'skill'] });
      }
      if (!(healScale > 0)) return;
      const hurt = (battle.injuredAlliesInKeys?.(rangeKeysOf(unit), unit) ?? []).filter((a) => up(a) && a.hp < a.s.maxHp);
      for (const a of hurt.slice(0, maxHeal)) battle.heal(unit, a, unit.s.atk * healScale, { skillHeal: true });
    }, { owner: unit });
  };

  // ── 技能 spec：三者都是"本体常态 + 开技能切替身" ──────────────────────────────────────────────
  //
  // 形态由**技能触发方式**决定（不是技能序号），共三态：
  //   形态1 <本体>        —— 没开技能时；官方"初始处于本体形态"
  //   形态2 塔纳托斯      —— **开启技能**（或受致命伤）切入替身时的形态：多目标 / 恐惧 / 斩杀
  //   形态3 俄耳甫斯      —— 形态2 中**再次开启技能**（S3）切换后的形态：阻挡+2 / 闪避 / 每秒治疗
  // S1 开技能直接是俄耳甫斯（它的替身就是俄耳甫斯），S2 开技能直接是塔纳托斯；
  // S3 走完整的三态（塔纳托斯 → 俄耳甫斯）。
  // 形态3 **不自动开技能**（官方此时靠"开启技能或受到致命伤"切换），所以进形态3时把触发规则改成
  // NEVER，回到<本体>时恢复 SKILL_RANGE —— 见 removeTalentMods。
  const switchToDoll = (battle, unit) => {
    const cur = curId();
    const phase = unit.mem.makotoPhase ?? 0;
    // 形态3 → 形态2：俄耳甫斯在场时再开一次技能，切回塔纳托斯
    if (unit.trait?.doll && phase === 3) {
      unit.mem.makotoPhase = 2;
      unit.mem.makotoDoll = 'thanatos';
      unit.skill?.setTrigger?.('SKILL_RANGE');   // 形态2 恢复自动开启
      battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, skill: 'makotoP2toP1' });
      return;
    }
    // 形态2 → 形态3：塔纳托斯在场时开技能，切到俄耳甫斯（S3 专属）
    if (unit.trait?.doll && phase === 2) {
      if (cur !== S3) return;                    // S1/S2 没有第三形态
      unit.mem.makotoPhase = 3;
      unit.mem.makotoDoll = 'orpheus';
      unit.skill?.setTrigger?.('NEVER');         // 形态3 不自动开技能
      battle.addBuff(unit, {
        key: 'makoto:blockUp', duration: (unit.profile.dollDuration ?? 20) + DOLL_SWITCH, refresh: 'replace',
        mods: { blockCnt: num(s3['attack@block_cnt'], 0) }, source: unit, tags: ['skill'],
      });
      battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, skill: 'makotoP2' });
      return;
    }
    if (unit.trait?.doll) return;
    // 形态1 → 形态2（或 S1 直达俄耳甫斯）：开技能切入替身
    unit.mem.makotoPhase = cur === S1 ? 3 : 2;
    unit.mem.makotoDoll = cur === S1 ? 'orpheus' : 'thanatos';
    battle.emit('dollSwitch', { unit, reason: 'skill', done: false });
  };

  return {
    skills: {
      // 技能结构照官方描述：
      //   "被动：<替身>状态召唤塔纳托斯/俄耳甫斯…（替身形态下的能力）"
      //   "主动：立即切换为<替身>状态作战"
      // ⚠️ 关键是 kind 必须是 'instant' 而**不能是 'passive'**：'passive' 会被引擎在部署瞬间开成"常驻"
      //（this.active=true、spCost=0），于是根本没有"开技能"这个动作，形态2/形态3 无从发生 ——
      // 实测表现为一上场就永久替身。'instant' 才对应官方"开启技能瞬间切换"。
      // 触发规则保持官方数据的 SKILL_RANGE（技能范围内存在敌人时开启，本模式常态自动开启）；
      // 形态3 由 kit 用 setTrigger('NEVER') 关掉自动开启（见 switchToDoll）。
      [S1]: { kind: 'instant', attack: { canHitFly: true }, onStart({ battle, unit }) { switchToDoll(battle, unit); } },
      [S2]: { kind: 'instant', onStart({ battle, unit }) { switchToDoll(battle, unit); } },
      [S3]: { kind: 'instant', attack: { canHitFly: true }, onStart({ battle, unit }) { switchToDoll(battle, unit); } },
    },
    talents: [
      { install: installTalent1 },
      { install(battle, unit) { installOrpheusAura(battle, unit); } },
    ],
    install(battle, unit) {
      // 只在**切进替身**时挂替身范围/数值与攻击接线（开场是<本体>，什么都没有）；
      // 受致命伤由引擎的傀儡师分支自己触发 dollSwap，所以这条覆盖"开技能"和"血条空了"两条路径。
      battle.on('dollSwap', ({ unit: u, form }) => {
        if (u !== unit) return;
        if (form === 'doll') { applyDollRange(battle, unit); applyTalentMods(battle, unit); installDollAttack(battle, unit); }
        else { restoreBodyRange(battle, unit); removeTalentMods(battle, unit); }
      }, { owner: unit, priority: -10 });
    },
  };

  // ── 内部：替身范围 / 数值 / 攻击接线 ────────────────────────────────────────────────────────
  /**
   * 切进<替身>：换成官方的 13 格菱形攻击范围（本体是 `1-1` 的近战 2 格），
   * 并按技能决定**能不能对空**（官方备注：S1/S3 可对空，S2 不可）。
   *
   * 对空为什么改 profile：`ai.js` 判 `prof.canHitFly`，而 prof = 数据 profile 或**技能 active 时的
   * `attackOverride()`**。他的技能是 `kind:'instant'`（开完 active 就是 false），
   * 所以 spec.attack 里的 canHitFly **根本不会被读到**（实测 attackOverride()=null）。
   * `unit.profile` 是每个单位自己解析出来的对象，直接改它、离开时还原最稳妥，也不影响共享表。
   */
  function applyDollRange(battle, unit) {
    if (unit.mem.makotoBaseGrid === undefined) unit.mem.makotoBaseGrid = unit.rangeGrid ?? null;
    unit.rangeGrid = DOLL_RANGE_GRID;
    battle.refreshRange?.(unit);
    if (unit.profile && unit.mem.makotoBaseFly === undefined) {
      unit.mem.makotoBaseFly = !!unit.profile.canHitFly;
      unit.profile.canHitFly = curId() !== S2;   // S1/S3 可对空，S2 不可
    }
  }
  function restoreBodyRange(battle, unit) {
    if (unit.mem.makotoBaseGrid !== undefined) {
      unit.rangeGrid = unit.mem.makotoBaseGrid;
      unit.mem.makotoBaseGrid = undefined;
      battle.refreshRange?.(unit);
    }
    if (unit.profile && unit.mem.makotoBaseFly !== undefined) {
      unit.profile.canHitFly = unit.mem.makotoBaseFly;
      unit.mem.makotoBaseFly = undefined;
    }
  }
  function applyTalentMods(battle, unit) {
    const atk = num(t0.atk, 0);
    const hp = num(t0.max_hp_t1, 0);
    const bat = num(t0.base_attack_time, 0);
    const mods = {};
    if (atk) mods.atkPct = atk;
    if (hp) mods.hpPct = hp;
    if (bat) mods.batPct = bat;   // "攻击间隔增大(+0.4)" = 基础攻击间隔的加法
    if (Object.keys(mods).length) {
      battle.addBuff(unit, { key: 'makoto:dollStats', duration: (unit.profile.dollDuration ?? 20) + DOLL_SWITCH, refresh: 'replace', mods, source: unit, tags: ['talent'] });
    }
  }
  function removeTalentMods(battle, unit) {
    battle.removeBuff(unit, 'makoto:dollStats');
    battle.removeBuff(unit, 'makoto:blockUp');
    battle.removeBuff(unit, 'makoto:orpheusDodge');
    unit.mem.makotoDoll = null;
    unit.mem.makotoPhase = 0;
    // 替身结束、回到<本体>（形态1）后恢复官方的自动开启规则（形态3 曾把它改成 NEVER）
    if (unit.skill?.id === S3) unit.skill.setTrigger?.('SKILL_RANGE');
  }
  function installDollAttack(battle, unit) {
    // 引擎的一次攻击结束后按形态补算（多目标 / 恐惧 / 斩杀 / 治疗）—— 钩子名是 'attack'，ctx.attacker 是出手者
    battle.on('attack', (ctx) => {
      if (ctx.attacker !== unit || !inDoll(unit)) return;
      const mode = unit.mem.makotoDoll === 'orpheus' ? 'orpheus' : 'thanatos';
      dollAttack(battle, unit, mode);
    }, { owner: unit, priority: -20 });
  }
}

export default {
  char_4217_makoto: makoto,
};
