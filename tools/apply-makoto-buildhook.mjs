#!/usr/bin/env node
// [CUSTOM] 给 tools/build-data.mjs 加三处小改动，让「自选池额外收录」成为可配置项，并让它可以被程序化调用。
//
// 为什么要改（而不是在别处重写一遍）：
//   自选池的构成、每个干员的形态（stats/trait/talents/skills/modules）都由 build-data 的 buildBackups /
//   buildUnitHead / buildUnitForm 决定，口径很细（潜能、精英档、技能等级、模组 stage）。在外部复制这套逻辑
//   必然漂移，所以让 build-data 自己生成，本补丁只加"入口"：
//     1) DIY_FORCE_PICKS：环境变量 DSH_DIY_FORCE_PICKS（逗号分隔 charId）；里面的人即使属于
//        DIY_EXCLUDED_TEAMS（联动 6★，原作者因版权排除）也照样进自选池。
//        默认空 —— 不设置环境变量时构建结果与上游**逐字节一致**。
//     2) 导出 buildBackups / buildChess / loadContext，便于工具复用同一套口径。
//     3) main() 加"直接执行才运行"的守卫，使它可以被 import 而不触发整次构建。
//
// 幂等：三处都已存在则跳过；只改到一半则中止（不写文件）。
// 回退：node tools/revert-makoto-buildhook.mjs
//
// 用法：node tools/apply-makoto-buildhook.mjs [build-data.mjs 路径]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.argv[2] || 'tools/build-data.mjs');
const die = (m) => { console.error('[中止] ' + m); process.exit(1); };
if (!existsSync(SRC)) die(`找不到 ${SRC}，请在仓库根目录运行（或把路径作为参数传入）。`);

const text = readFileSync(SRC, 'utf8');
const MARK = 'DIY_FORCE_PICKS';

// 声明放模块级（buildBackups 之外），否则 excluded 里引用不到
const OLD_POOL = 'function buildBackups(ctx, chess) {';
const NEW_POOL = `/**
 * [CUSTOM] 额外收录进「自选池」的 charId（逗号分隔的环境变量 DSH_DIY_FORCE_PICKS）。
 * 里面的人即使属于 DIY_EXCLUDED_TEAMS（联动 6★，原作者 2026-10-05 因版权排除）也照样进池。
 * 默认空 ⇒ 不设置环境变量时，构建结果与上游**逐字节一致**。见 tools/apply-makoto-patch.mjs。
 */
const DIY_FORCE_PICKS = new Set(String(process.env.DSH_DIY_FORCE_PICKS || '').split(',').map((s) => s.trim()).filter(Boolean));

function buildBackups(ctx, chess) {`;

const OLD_EXCL = '  const excluded = legal6.filter((id) => teamsOf(charTable[id]).some((t) => excludedTeams.has(t)) || collabNumber(charTable[id]));';
const NEW_EXCL = '  const excluded = legal6.filter((id) => !DIY_FORCE_PICKS.has(id)\n    && (teamsOf(charTable[id]).some((t) => excludedTeams.has(t)) || collabNumber(charTable[id])));';

const OLD_WARN = '  for (const t of DIY_EXCLUDED_TEAMS) if (!excluded.some((id) => teamsOf(charTable[id]).includes(t))) warn(`DIY_EXCLUDED_TEAMS: no owned-6★ pick of team ${t}`);';
const NEW_WARN = '  for (const t of DIY_EXCLUDED_TEAMS) {\n    const forced = [...DIY_FORCE_PICKS].filter((id) => charTable[id] && teamsOf(charTable[id]).includes(t));\n    if (forced.length) continue;   // [CUSTOM] 该联动队伍由 DSH_DIY_FORCE_PICKS 手动收录，不再告警\n    if (!excluded.some((id) => teamsOf(charTable[id]).includes(t))) warn(`DIY_EXCLUDED_TEAMS: no owned-6★ pick of team ${t}`);\n  }';

// 盟约覆盖：指定了 DSH_DIY_FORCE_BONDS 就用给定的，否则按阵营推导
const OLD_BONDS = `    const hit = coreBonds.filter((b) => b.powerIdList.some((x) => powers.includes(x))).map((b) => b.bondId);
    operators[id] = {`;
const NEW_BONDS = `    const hit = coreBonds.filter((b) => b.powerIdList.some((x) => powers.includes(x))).map((b) => b.bondId);
    // [CUSTOM] DSH_DIY_FORCE_BONDS 里指定的盟约优先（见文件上方注释）
    const forcedBonds = DIY_FORCE_BONDS[id];
    operators[id] = {`;
const OLD_BONDS_LINE = '      obtainable: !ch.isNotObtainable, powers, bonds: hit.length ? hit : [fallback],';
const NEW_BONDS_LINE = '      obtainable: !ch.isNotObtainable, powers, bonds: forcedBonds ? forcedBonds.split("|") : (hit.length ? hit : [fallback]),';

const OLD_MAIN = 'main().catch((e) => {';
const NEW_MAIN = `// [CUSTOM] 直接执行才构建；被 import 时只提供函数（供 tools/apply-makoto-patch.mjs 复用同一套口径）。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
main().catch((e) => {`;
const OLD_MAIN_END = `  console.error('build-data failed:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
});`;
const NEW_MAIN_END = `  console.error('build-data failed:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
}`;

const OLD_EXPORTS = 'async function main() {';
const NEW_EXPORTS = `/**
 * [CUSTOM] 自选干员的盟约覆盖：charId → bondId 数组（环境变量 DSH_DIY_FORCE_BONDS，
 * 形如 char_4217_makoto=emptyShip）。给的就是这个数组，不再按阵营推导 —— 用于把某个
 * 自选干员指定到特定盟约（例如结城理按需求归入「协防干员」emptyShip，而不是他隐藏势力对应的拉特兰）。
 * 默认空 ⇒ 不设置环境变量时行为与上游一致。
 */
const DIY_FORCE_BONDS = Object.fromEntries(String(process.env.DSH_DIY_FORCE_BONDS || '')
  .split(',').map((s) => s.split('=').map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1]));

// [CUSTOM] 导出给工具复用（tools/apply-makoto-patch.mjs）：自选池与形态的唯一口径在 buildBackups 里。
export { buildBackups, buildChess, loadContext };

async function main() {`;

const parts = [
  ['模块级 DIY_FORCE_PICKS 声明', OLD_POOL, NEW_POOL],
  ['排除名单放行', OLD_EXCL, NEW_EXCL],
  ['联动告警放宽', OLD_WARN, NEW_WARN],
  ['盟约覆盖声明', OLD_BONDS, NEW_BONDS],
  ['盟约覆盖赋值', OLD_BONDS_LINE, NEW_BONDS_LINE],
  ['入口守卫', OLD_MAIN, NEW_MAIN],
  ['入口守卫收尾', OLD_MAIN_END, NEW_MAIN_END],
  ['导出内部函数', OLD_EXPORTS, NEW_EXPORTS],
];

if (text.includes(MARK)) {
  const missing = parts.filter(([, , to]) => !text.includes(to.split('\n')[0].trim()) && !text.includes(to));
  console.log('[已应用] build-data.mjs 已含 DIY_FORCE_PICKS 钩子，无需处理。');
  process.exit(0);
}

let out = text;
for (const [name, from, to] of parts) {
  const n = out.split(from).length - 1;
  if (n !== 1) die(`“${name}”锚点出现 ${n} 次（期望 1 次）—— build-data.mjs 可能已更新，本补丁需要复核。`);
  out = out.replace(from, to);
}
for (const [name, , to] of parts) {
  if (!out.includes(to.split('\n')[0].trim()) && !out.includes(to)) die(`“${name}”替换后校验失败，未写入任何文件。`);
}
// 只认“声明”这一行（钩子在代码里会被引用多次，不能按出现次数断言）
if (out.includes('const DIY_FORCE_PICKS = new Set(') === false) die('DIY_FORCE_PICKS 声明缺失，未写入任何文件。');

copyFileSync(SRC, SRC + '.bak-makoto-buildhook');
writeFileSync(SRC, out);
console.log('[完成] 已给 build-data.mjs 加上自选池额外收录钩子：');
console.log('  · DIY_FORCE_PICKS ← 环境变量 DSH_DIY_FORCE_PICKS（默认空，不影响默认构建）');
console.log('  · 导出 buildBackups / buildChess / loadContext');
console.log('  · main() 改为“直接执行才运行”');
console.log(`[备份] ${SRC}.bak-makoto-buildhook`);
console.log('');
console.log('用法：DSH_DIY_FORCE_PICKS=char_4217_makoto npm run build-data');
