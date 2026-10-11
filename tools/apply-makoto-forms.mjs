// 结城理的替身动画角色（写进客户端 FORMS 表）+ _formSpec 的函数式 roles 支持
//
// 骨架里他的替身是三套按技能分组的剪辑：
//   Doll_Skill_1_Attack / Idle / Die / Stun / SwitchIn / SwitchOut
//   Doll_Skill_2_Loop / Die / Stun / SwitchIn / SwitchOut
//   Doll_Skill_3_P1_Attack_A / Attack_B / Idle / Stun / SwitchIn / SwitchOut
//   Doll_Skill_3_P1toP2_ChangeBegin / ChangeEnd  +  Doll_Skill_3_P2_Loop / Die / Stun / SwitchOut
// 本体：Idle / Attack_A / Attack_B / Start / Stun / SwitchOut / Skill_AllOutAttack_Loop+End
//
// 用法：node tools/apply-makoto-forms.mjs [仓库根目录]      （默认当前目录）
// 回退：node tools/revert-makoto-forms.mjs

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const SRC = join(ROOT, 'public/js/render/units.js');
const die = (m) => { console.error('[中止] ' + m); process.exit(1); };
if (!existsSync(SRC)) die(`找不到 ${SRC}，请在仓库根目录运行。`);

const text = readFileSync(SRC, 'utf8');
const MARK = 'MAKOTO_DOLL_FORMS';

// ── 1) _formSpec：roles 允许是函数（按当前技能选剪辑）──
const OLD_SPEC = `  _formSpec() {
    return this.form ? FORMS[this.info.spine || this.info.defId]?.[this.form] || null : null;
  }`;
const NEW_SPEC = `  _formSpec() {
    const f = this.form ? FORMS[this.info.spine || this.info.defId]?.[this.form] || null : null;
    // [CUSTOM ${MARK}] a form whose \`roles\` is a function picks its clip set by the unit's skill index
    // (结城理's skeleton has one 替身 set per skill: Doll_Skill_1_* / Doll_Skill_2_* / Doll_Skill_3_P1_*+P2_*).
    if (f && typeof f.roles === 'function') return { ...f, roles: f.roles(this.skillIndex) };
    return f;
  }`;

// ── 2) FORMS 条目：插在风丸那条之后 ──
const OLD_FORMS = `  char_4016_kazema: Object.freeze({
    doll: Object.freeze({ change: 'Start_B', leave: 'Start', roles: dollRoles('Idle_B', 'Die_B', 'Attack_B') }),
  }),`;
const NEW_FORMS = `  char_4016_kazema: Object.freeze({
    doll: Object.freeze({ change: 'Start_B', leave: 'Start', roles: dollRoles('Idle_B', 'Die_B', 'Attack_B') }),
  }),
  // [CUSTOM ${MARK}] 结城理 (char_4217_makoto): one 替身 clip set per skill (Doll_Skill_<n>_*), so \`roles\` is a function
  // of the skill index (UnitView._formSpec). The 本体 comes back on SwitchOut; a 替身 knocked out lies on its own Die.
  char_4217_makoto: Object.freeze({
    doll: Object.freeze({
      change: 'Doll_Skill_1_SwitchIn', leave: 'SwitchOut',
      roles: (skillIndex) => {
        if (skillIndex === 1) {
          return Object.freeze({ idle: 'Doll_Skill_2_Loop', deploy: 'Doll_Skill_2_Loop', die: 'Doll_Skill_2_Die',
            stun: 'Doll_Skill_2_Stun', attack: null, attackDown: null, skill: null });
        }
        if (skillIndex === 2) {
          return Object.freeze({ idle: 'Doll_Skill_3_P1_Idle', deploy: 'Doll_Skill_3_P1_Idle', die: 'Doll_Skill_3_P2_Die',
            stun: 'Doll_Skill_3_P1_Stun', attack: null, attackDown: null, skill: null });
        }
        return Object.freeze({ idle: 'Doll_Skill_1_Idle', deploy: 'Doll_Skill_1_Idle', die: 'Doll_Skill_1_Die',
          stun: 'Doll_Skill_1_Stun',
          attack: Object.freeze({ begin: null, loop: 'Doll_Skill_1_Attack', end: null }), attackDown: null, skill: null });
      },
    }),
  }),`;

if (text.includes(MARK)) {
  if (text.includes('typeof f.roles === \'function\'')) {
    console.log('[已应用] units.js 已含结城理的替身形态（' + MARK + '），无需处理。');
    process.exit(0);
  }
  die('检测到部分应用（有 ' + MARK + ' 但没有函数式 roles）—— 请先回退再重跑。');
}

for (const [name, from] of [['_formSpec 函数式 roles', OLD_SPEC], ['FORMS 条目锚点', OLD_FORMS]]) {
  const n = text.split(from).length - 1;
  if (n !== 1) die(`“${name}”锚点出现 ${n} 次（期望 1 次）—— units.js 可能已更新，本补丁需要复核。`);
}

let out = text.replace(OLD_SPEC, NEW_SPEC).replace(OLD_FORMS, NEW_FORMS);
if (!out.includes(MARK) || !out.includes('char_4217_makoto: Object.freeze({')) die('替换后校验失败，未写入任何文件。');
// 键只能出现一次（注释里也会提到这个名字，所以不能按出现次数断言）
const keyCount = out.split('char_4217_makoto: Object.freeze({').length - 1;
if (keyCount !== 1) die(`FORMS 条目出现 ${keyCount} 次（期望 1 次），未写入任何文件。`);

copyFileSync(SRC, SRC + '.bak-makoto-forms');
writeFileSync(SRC, out);
console.log('[完成] 已给客户端加上结城理的替身形态：');
console.log('  · public/js/render/units.js FORMS.char_4217_makoto.doll（roles 按技能索引选 Doll_Skill_<n>_* 剪辑）');
console.log('  · UnitView._formSpec 支持函数式 roles（原来只支持固定对象）');
console.log(`[备份] ${SRC}.bak-makoto-forms`);
console.log('');
console.log('注意：这是客户端文件，改完需要重启服务 + 浏览器硬刷新（Ctrl+Shift+R）。');
