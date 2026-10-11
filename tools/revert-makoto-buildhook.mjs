#!/usr/bin/env node
// [CUSTOM] 撤销 tools/apply-makoto-buildhook.mjs：把 build-data.mjs 还原成上游形态。
// 幂等；任何异常都不写文件。
//
// 用法：node tools/revert-makoto-buildhook.mjs [build-data.mjs 路径]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.argv[2] || 'tools/build-data.mjs');
if (!existsSync(SRC)) { console.error(`[中止] 找不到 ${SRC}`); process.exit(1); }

const text = readFileSync(SRC, 'utf8');
if (!text.includes('DIY_FORCE_PICKS')) {
  console.log('[已回退] build-data.mjs 里没有 DIY_FORCE_PICKS 钩子，无需处理。');
  process.exit(0);
}
const BAK = SRC + '.bak-makoto-buildhook';
if (!existsSync(BAK)) {
  console.error(`[中止] 找不到备份 ${BAK}，无法逐字还原。`);
  console.error('       请从备份恢复该文件（或 git checkout tools/build-data.mjs）后重来。');
  process.exit(1);
}
copyFileSync(SRC, SRC + '.bak-makoto-buildhook-revert');
copyFileSync(BAK, SRC);
console.log('[完成] build-data.mjs 已从备份还原：');
console.log(`  ${BAK} → ${SRC}`);
console.log(`[备份] ${SRC}.bak-makoto-buildhook-revert（还原前的状态）`);
