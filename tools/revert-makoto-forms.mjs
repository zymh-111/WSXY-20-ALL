#!/usr/bin/env node
// [CUSTOM] 撤销 tools/apply-makoto-forms.mjs：还原 public/js/render/units.js。
// 幂等；优先用备份逐字还原。
//
// 用法：node tools/revert-makoto-forms.mjs [仓库根目录]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const SRC = join(ROOT, 'public/js/render/units.js');
const BAK = SRC + '.bak-makoto-forms';
if (!existsSync(SRC)) { console.error(`[中止] 找不到 ${SRC}`); process.exit(1); }

if (!readFileSync(SRC, 'utf8').includes('MAKOTO_DOLL_FORMS')) {
  console.log('[已回退] units.js 里没有结城理的替身形态，无需处理。');
  process.exit(0);
}
if (!existsSync(BAK)) {
  console.error(`[中止] 找不到备份 ${BAK}，无法逐字还原（可 git checkout public/js/render/units.js）。`);
  process.exit(1);
}
copyFileSync(SRC, SRC + '.bak-makoto-forms-revert');
copyFileSync(BAK, SRC);
console.log('[完成] units.js 已从备份还原。');
console.log(`[备份] ${SRC}.bak-makoto-forms-revert（还原前的状态）`);
