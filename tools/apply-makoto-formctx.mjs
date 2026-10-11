#!/usr/bin/env node
// [CUSTOM] 让"切替身"把**形态**一并告诉客户端，客户端不再靠 skillIndex 猜动画。
//
// 问题：结城理的骨架里替身剪辑按技能分组（Doll_Skill_1_* / _2_* / _3_P1_*+P2_*）。
// 客户端原先用 UnitInfo.skillIndex 选剪辑，fx 到达那一刻它可能还没就绪，就退化成 S1（俄耳甫斯）
// —— 表现为"开技能先闪一瞬间俄耳甫斯再变塔纳托斯"。
// 实测：roles(undefined) → Doll_Skill_1_Idle（正是俄耳甫斯那套）。
//
// 改法（最小侵入，不影响其它干员）：
//   1) 引擎的 substitute fx 多带字段 makotoDoll（当前替身形态 key；无值时不带）
//   2) 客户端 _formSpec 优先用 fx 给的形态选剪辑，没有才退回 skillIndex
//
// 幂等；回退：node tools/revert-makoto-formctx.mjs
// 用法：node tools/apply-makoto-formctx.mjs [仓库根目录]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const PROF = join(ROOT, 'server/sim/professions.js');
const UNITS = join(ROOT, 'public/js/render/units.js');
const MARK = 'MAKOTO_FORM_CTX';
const die = (m) => { console.error('[中止] ' + m); process.exit(1); };
for (const [p, w] of [[PROF, 'server/sim/professions.js'], [UNITS, 'public/js/render/units.js']]) {
  if (!existsSync(p)) die(`找不到 ${w} —— 请在仓库根目录运行。`);
}

const PROF_OLD = `    battle.fx('substitute', at({ form: 'doll', dur }));`;
const PROF_NEW = `    // [CUSTOM ${MARK}] 替身形态一并下发（见 tools/apply-makoto-formctx.mjs）：结城理的替身剪辑按形态分组，
    // 客户端自己猜（skillIndex）会在 fx 早到时退化成 S1 的俄耳甫斯，闪一帧。有值时才带这个字段。
    battle.fx('substitute', at({ form: 'doll', dur, ...(unit.mem?.makotoDoll ? { makotoDoll: unit.mem.makotoDoll } : null) }));`;

const SPEC_OLD = `  _formSpec() {
    const f = this.form ? FORMS[this.info.spine || this.info.defId]?.[this.form] || null : null;
    // [CUSTOM MAKOTO_DOLL_FORMS] a form whose \`roles\` is a function picks its clip set by the unit's skill index
    // (结城理's skeleton has one 替身 set per skill: Doll_Skill_1_* / Doll_Skill_2_* / Doll_Skill_3_P1_*+P2_*).
    if (f && typeof f.roles === 'function') return { ...f, roles: f.roles(this.skillIndex) };
    return f;
  }`;
const SPEC_NEW = `  _formSpec(ctx = null) {
    const f = this.form ? FORMS[this.info.spine || this.info.defId]?.[this.form] || null : null;
    // [CUSTOM MAKOTO_DOLL_FORMS] a form whose \`roles\` is a function picks its clip set from the form context
    // (结城理's skeleton has one 替身 set per form: Doll_Skill_1_* / _2_* / _3_P1_*+P2_*).
    // ctx.doll (from the switching fx) wins over this.skillIndex — the fx can arrive before the loadout's skill
    // index is known, and guessing there flashed the wrong 替身 for one frame.
    if (f && typeof f.roles === 'function') return { ...f, roles: f.roles(ctx && ctx.doll != null ? ctx.doll : this.skillIndex) };
    return f;
  }`;

const SET_OLD = `    const prev = this._formSpec();
    this.form = k;
    this.info.form = k;
    const f = this._formSpec();`;
const SET_NEW = `    const prev = this._formSpec();
    this.form = k;
    this.info.form = k;
    // [CUSTOM ${MARK}] the switching fx may carry the form context (makotoDoll = which 替身) — see _formSpec.
    const f = this._formSpec(fx && typeof fx === 'object' ? { doll: fx.makotoDoll ?? null } : null);`;

const edits = [
  ['professions.js: substitute fx 带形态', PROF, PROF_OLD, PROF_NEW],
  ['units.js: _formSpec 接受上下文', UNITS, SPEC_OLD, SPEC_NEW],
  ['units.js: setForm 传上下文', UNITS, SET_OLD, SET_NEW],
];

if (readFileSync(PROF, 'utf8').includes(MARK) && readFileSync(UNITS, 'utf8').includes(MARK)) {
  console.log('[已应用] 形态上下文已经接好。');
  process.exit(0);
}
const byFile = new Map();
for (const [name, file, from, to] of edits) {
  const text = readFileSync(file, 'utf8');
  const n = text.split(from).length - 1;
  if (n !== 1) die(`“${name}”锚点出现 ${n} 次（期望 1 次）—— 上游可能已更新，本补丁需要复核。`);
  if (!byFile.has(file)) byFile.set(file, readFileSync(file, 'utf8'));
  byFile.set(file, byFile.get(file).replace(from, to));
}
for (const [file, out] of byFile) if (!out.includes(MARK)) die(`${file} 校验失败，未写入。`);
for (const [file, out] of byFile) {
  copyFileSync(file, file + '.bak-makoto-formctx');
  writeFileSync(file, out);
  console.log('[完成] ' + file.replace(ROOT + '/', ''));
}
console.log('');
console.log('注意：roles 现在按**形态 key**（thanatos/orpheus）选剪辑，需要 units.js 的 roles 定义接受它。');
