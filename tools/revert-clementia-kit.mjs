#!/usr/bin/env node
// [CUSTOM] 撤销 tools/apply-clementia-kit.mjs：把克莱门莎的棋池 kit 文件移除，并从 KIT_FILES 注销。
// 幂等：已经撤销过就报「[已回退]」并以 0 退出；任何异常都不写文件。
//
// 用法：node tools/revert-clementia-kit.mjs [仓库根目录]      （默认当前目录）
//
// 注意：撤销后她会退回 server/sim/content/generic.js 的通用兜底 —— 三个技能和两个天赋都不是她自己的。

import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const KIT_REL = 'server/sim/content/kits/ops/chess_char_6_21-clemnt.js';
const INDEX_REL = 'server/sim/content/kits/index.js';
const KIT_FILE = join(ROOT, KIT_REL);
const INDEX_FILE = join(ROOT, INDEX_REL);
const FILE_NAME = 'chess_char_6_21-clemnt.js';
const RE = new RegExp(`,\\s*'${FILE_NAME.replace(/\./g, '\\.')}'`);

if (!existsSync(INDEX_FILE)) { console.error(`[中止] 找不到 ${INDEX_REL}，请在仓库根目录运行。`); process.exit(1); }

const text = readFileSync(INDEX_FILE, 'utf8');
if (!RE.test(text) && !existsSync(KIT_FILE)) {
  console.log('[已回退] 没有发现她的棋池 kit 登记或文件，无需处理。');
  process.exit(0);
}

const out = text.replace(RE, '');
if (out !== text) {
  const n = (out.match(new RegExp(FILE_NAME.replace(/\./g, '\\.'), 'g')) || []).length;
  if (n !== 0) { console.error(`[中止] 注销后仍残留 ${n} 处引用，未写入任何文件。`); process.exit(1); }
  copyFileSync(INDEX_FILE, INDEX_FILE + '.bak-clementia-kit-revert');
  writeFileSync(INDEX_FILE, out);
  console.log(`  [注销]   ${INDEX_REL}（备份 ${INDEX_FILE}.bak-clementia-kit-revert）`);
} else {
  console.log('  [跳过]   index.js 里没有该文件名');
}

if (existsSync(KIT_FILE)) {
  copyFileSync(KIT_FILE, KIT_FILE + '.bak-clementia-removed');
  unlinkSync(KIT_FILE);
  console.log(`  [移除]   ${KIT_REL}（备份 ${KIT_FILE}.bak-clementia-removed）`);
}

console.log('[完成] 她已退回通用兜底实现。想恢复：node tools/apply-clementia-kit.mjs');
