#!/usr/bin/env node
// [CUSTOM] 让干员「克莱门莎」(char_4231_clemnt) 真的用上她自己的三个技能和两个天赋。
//
// 问题（为什么需要这个工具）：
//   她已经被 tools/apply-clementia-patch.mjs 写进棋池（data/chess.json 的 chess_char_6_21_a/_b），
//   但 server/sim/content/index.js 的 kitOf() 解析**普通棋池棋子**的 kit 时只看 `def.baseId`，从不看
//   charId —— 只有「补位」和「自选」棋子才按 charId 找。她的技能实现若只以自选键（char_4231_clemnt）
//   注册，就永远落不到她身上，每次作战都掉进 server/sim/content/generic.js 的通用兜底：
//     S1 冲蚀   —— 只剩攻击倍率，25% 侵蚀损伤 rider 丢失
//     S2 风暴潮 —— 只有攻速/溅射数值，浮游放逐舱、漩涡、位移全无
//     S3 与海为敌 —— 弹药式轰炸完全不生效（退化成普通攻击）
//     天赋      —— 生死定夺、习得性防御两个都不在
//
// 本工具做的事（幂等，可重复运行）：
//   1. 写入 server/sim/content/kits/ops/chess_char_6_21-clemnt.js
//      （她三个技能 + 两个天赋的完整实现，注册键 = 棋池 baseId `chess_char_6_21_a`）
//   2. 在 server/sim/content/kits/index.js 的 KIT_FILES 第 6 档末尾追加该文件名
// 已就位时直接报「[已应用]」并以 0 退出；任何校验不过则一个字节都不写。
//
// 用法：node tools/apply-clementia-kit.mjs [仓库根目录]      （默认当前目录）
// 回退：node tools/revert-clementia-kit.mjs

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] || process.cwd());
const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_REL = 'server/sim/content/kits/ops/chess_char_6_21-clemnt.js';
const INDEX_REL = 'server/sim/content/kits/index.js';
const KIT_FILE = join(ROOT, KIT_REL);
const INDEX_FILE = join(ROOT, INDEX_REL);
// 优先用与本脚本同目录的副本（tools/<文件>）、随仓库传递的 tools/clementia-kit-assets/，否则用 kits/ops 里已有的同名文件
const KIT_SRC = [
  join(HERE, 'chess_char_6_21-clemnt.js'),
  join(HERE, 'clementia-kit', 'chess_char_6_21-clemnt.js'),
  join(HERE, 'clementia-kit-assets', 'chess_char_6_21-clemnt.js'),
  KIT_FILE,
].find((p) => existsSync(p));

const FILE_NAME = 'chess_char_6_21-clemnt.js';
const ANCHOR = `'chess_char_6_20-agoat2.js'`;

function die(msg) { console.error('[中止] ' + msg); process.exit(1); }

if (!existsSync(INDEX_FILE)) die(`找不到 ${INDEX_REL}，请在仓库根目录运行（或把根目录作为参数传入）。`);
if (!KIT_SRC) die(`找不到 kit 源文件 ${FILE_NAME} —— 请把它放在 tools/ 下与本脚本一起，或直接放进 ${KIT_REL}。`);

const kitSrc = readFileSync(KIT_SRC, 'utf8');
for (const need of ['chess_char_6_21_a', 'skchr_clemnt_1', 'skchr_clemnt_2', 'skchr_clemnt_3', '生死定夺', '习得性防御']) {
  if (!kitSrc.includes(need)) die(`kit 源文件里缺少 “${need}”，它可能不是预期的那份，未写入任何文件。`);
}

const text = readFileSync(INDEX_FILE, 'utf8');
const registered = new RegExp(`['"]${FILE_NAME.replace(/\./g, '\\.')}['"]`).test(text);
const kitPresent = existsSync(KIT_FILE) && readFileSync(KIT_FILE, 'utf8') === kitSrc;

if (registered && kitPresent) {
  console.log(`[已应用] ${KIT_REL} 已就位，且已在 ${INDEX_REL} 的 KIT_FILES 中登记，无需处理。`);
  process.exit(0);
}

// —— 在 KIT_FILES 的 tier 6 组末尾插入文件名 ——
function insertFile(src) {
  if (new RegExp(`['"]${FILE_NAME.replace(/\./g, '\\.')}['"]`).test(src)) return src;
  const at = src.indexOf(ANCHOR);
  if (at < 0) return null;
  const close = src.indexOf(']', at);
  if (close < 0) return null;
  const indent = '    ';
  return src.slice(0, close) + `, ${indent}'${FILE_NAME}'` + src.slice(close);
}

const out = insertFile(text);
if (out === null) {
  die(`在 ${INDEX_REL} 里没找到锚点 ${ANCHOR}（上游可能改了 KIT_FILES 的结构），未写入任何文件。`);
}
const count = (out.match(new RegExp(`['"]${FILE_NAME.replace(/\./g, '\\.')}['"]`, 'g')) || []).length;
if (count !== 1) die(`插入后该文件名出现 ${count} 次（期望 1 次），未写入任何文件。`);

// —— 全部校验通过才落盘 ——
mkdirSync(dirname(KIT_FILE), { recursive: true });
if (kitPresent) {
  console.log(`  [已有]   ${KIT_REL}`);
} else {
  if (existsSync(KIT_FILE)) copyFileSync(KIT_FILE, KIT_FILE + '.bak-clementia');
  writeFileSync(KIT_FILE, kitSrc);
  console.log(`  [写入]   ${KIT_REL}`);
}
copyFileSync(INDEX_FILE, INDEX_FILE + '.bak-clementia-kit');
writeFileSync(INDEX_FILE, out);
console.log(`  [登记]   ${INDEX_REL}: KIT_FILES 第 6 档追加 '${FILE_NAME}'`);
console.log(`[备份] ${INDEX_FILE}.bak-clementia-kit`);

// —— 校验：真的能解析出她的 kit，且三个技能都有专属 spec ——
try {
  const { KITS } = await import('file://' + INDEX_FILE);
  const fn = KITS['chess_char_6_21_a'];
  if (typeof fn !== 'function') die('登记后 KITS[chess_char_6_21_a] 仍不是函数。');
  const skills = Object.keys(fn({}, { skills: [], talents: [] }, {})?.skills ?? {});
  if (skills.length !== 3) die(`她的 kit 只写出 ${skills.length} 个技能（期望 3）。`);
  console.log(`[校验] KITS['chess_char_6_21_a'] 命中，技能: ${skills.join(', ')}`);
} catch (e) {
  die('导入校验失败：' + (e && e.message));
}

console.log('');
console.log('下一步：');
console.log('  1) node --test test/content/clementia-kit.test.js   # 真跑一场战斗，验收三个技能');
console.log('  2) 重启服务（systemctl restart stronghold）；浏览器硬刷新（Ctrl+Shift+R）');
console.log('  3) 在 MODIFICATIONS.md 的「## 修改记录」里登记这次改动');
