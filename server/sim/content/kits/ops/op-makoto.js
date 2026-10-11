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
  /** 该形态的攻击范围钥匙（替身与本体范围不同，引擎已按形态重建 rangeKeys）。 */
  const rangeKeysOf = (u) => u.rangeKeys ?? [];
  /**
   * "攻击范围内"的敌人。`enemiesInKeys` 要求目标 `deployed`（sim/targeting.js canTargetEnemy），而**敌人在本引擎里
   * 不是 deployed 单位**，所以这里按范围半径取：与他同格或其攻击范围内的钥匙覆盖到的敌人，走 `foesInRadius`。
   * 替身范围一般只有 1–2 格，半径 1.5 与官方"一定范围"一致（[ASSUMED]）。
   */
  const enemiesInRange = (battle, u) => {
    const out = [];
    for (const k of rangeKeysOf(u)) {
      const r = Math.floor(k / COLS), c = k % COLS;
      for (const e of battle.foesInRadius?.(c, r, 1.5, true) ?? []) if (!out.includes(e)) out.push(e);
    }
    return out.length ? out : (battle.foesInRadius?.(u.tileC, u.tileR, 1.5, true) ?? []);
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
   * 一次替身攻击的结算。`mode` 取 'orpheus'（俄耳甫斯）或 'thanatos'（塔纳托斯）。
   *
   * 引擎的普通攻击管线在他身上已经先打了一段**物理**普通伤害（他是 MELEE、分支给定物理），而官方这两套
   * 替身攻击是**法术**且倍率是 210% / 220%。`spec.attack` 的覆盖只在技能 `active` 时生效
   * （ai.js effectiveProfile → skill.attackOverride()），而他的技能是"被动形态 + 主动切换"、被动下没有
   * override，所以这里按**补齐差额**结算：(目标倍率 − 100%) × 攻击力 的一段法术伤害，
   * 使一次攻击的总伤害 = 目标倍率 × 攻击力。[ASSUMED] 伤害类型构成（物理基础 + 法术补差）与官方
   * "整段法术"不同，但总倍率一致；恐惧/斩杀/治疗都按官方语义独立结算。
   */
  const dollAttack = (battle, unit, mode) => {
    const src = mode === 'orpheus' ? s1 : s2;
    const scale = num(mode === 'orpheus'
      ? (s1['attack@atk_scale'] ?? bb['attack@atk_scale'])
      : (s2['attack@atk_scale'] ?? bb['attack@atk_scale']), 1);
    const atk = unit.s.atk;

    // 俄耳甫斯：范围内有生命值低于 50% 的友方干员时"改为"治疗他 → 这一次攻击不造成伤害
    if (mode === 'orpheus') {
      const hurt = (battle.injuredAlliesInKeys?.(rangeKeysOf(unit), unit) ?? [])
        .filter((a) => up(a) && a.hp < a.s.maxHp * 0.5);
      if (hurt.length) {
        const heal = atk * num(s1['attack@heal_scale'] ?? bb['attack@heal_scale'], 0);
        if (heal > 0) battle.heal(unit, hurt[0], heal, { skillHeal: true });
        return;
      }
    }

    const targets = mode === 'orpheus'
      ? enemiesInRange(battle, unit).slice(0, 1)
      : enemiesInRange(battle, unit).slice(0, Math.max(1, num(s2['attack@max_target'], 1)));
    const bonus = atk * Math.max(0, scale - 1);
    if (bonus > 0) for (const e of targets) {
      battle.dealDamage(unit, e, { amount: bonus, type: 'arts', isAttack: true, tags: ['skill', 'makoto:doll'] });
    }
    if (mode === 'thanatos') {
      const p = num(s2['attack@prob'], 0);
      if (p > 0) for (const e of targets) {
        if (e.alive && battle.rng() < p) battle.applyStatus(e, 'fear', { duration: num(s2['attack@fear'], 0), source: unit });
      }
      // 范围内**恐惧中**的敌人，生命值低于攻击力 K% 则立刻倒下
      const k = num(s2['attack@kill_atk_scale'], 0);
      const dmg = num(s2['attack@kill_damage'], 9999999);
      if (k > 0) for (const e of enemiesInRange(battle, unit)) {
        if (!e.alive || !feared(e)) continue;
        if (e.hp < atk * k) {
          battle.dealDamage(unit, e, { amount: dmg, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'makoto:execute'] });
        }
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

  // ── 技能 spec：三者都是"被动形态 + 主动切换" ────────────────────────────────────────────────
  const switchToDoll = (battle, unit) => {
    // "主动：立即切换为<替身>状态作战"。S3 时：塔纳托斯在场 → 改为召唤俄耳甫斯
    if (unit.trait?.doll) {
      // 已经是替身：S3 在塔纳托斯形态下再开一次 → 换俄耳甫斯（P1 → P2）
      if (unit.skill?.id === S3 && unit.mem.makotoDoll === 'thanatos') {
        unit.mem.makotoDoll = 'orpheus';
        battle.addBuff(unit, { key: 'makoto:blockUp', duration: (unit.profile.dollDuration ?? 20) + DOLL_SWITCH, refresh: 'replace', mods: { blockCnt: num(s3['attack@block_cnt'], 0) }, source: unit, tags: ['skill'] });
        battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, skill: 'makotoP2' });
      }
      return;
    }
    unit.mem.makotoDoll = 'thanatos';   // 默认召唤塔纳托斯
    battle.emit('dollSwitch', { unit, reason: 'skill', done: false });
  };

  return {
    skills: {
      // 三个技能都是"被动（替身形态行为）+ 主动（立即切换）"，所以 spec 形状相同，只有切换后的形态不同
      [S1]: { kind: 'passive', onStart({ battle, unit }) { switchToDoll(battle, unit); } },
      [S2]: { kind: 'passive', onStart({ battle, unit }) { switchToDoll(battle, unit); } },
      [S3]: { kind: 'passive', onStart({ battle, unit }) { switchToDoll(battle, unit); } },
    },
    talents: [
      { install: installTalent1 },
      { install(battle, unit) { installOrpheusAura(battle, unit); } },
    ],
    install(battle, unit) {
      // 替身形态的数值与攻击行为：进入替身时挂上，离开时清掉
      battle.on('dollSwap', ({ unit: u, form }) => {
        if (u !== unit) return;
        if (form === 'doll') { applyTalentMods(battle, unit); installDollAttack(battle, unit); }
        else removeTalentMods(battle, unit);
      }, { owner: unit, priority: -10 });
      if (inDoll(unit)) { applyTalentMods(battle, unit); installDollAttack(battle, unit); }
    },
  };

  // ── 内部：替身数值 / 替身攻击接线 ──────────────────────────────────────────────────────────
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
