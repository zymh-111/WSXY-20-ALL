#!/usr/bin/env node
// [CUSTOM] 撤销 tools/apply-dev-client.mjs：还原 shared/protocol.js 与 public/js/main.js。
// public/js/dev.js 本身保留（不挂载即不可达）；要一并删除请手动 rm。
//
// 用法：node tools/revert-dev-client.mjs [仓库根目录]

import { readFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
let done = 0;
for (const rel of ['shared/protocol.js', 'public/js/main.js']) {
  const src = join(ROOT, rel);
  const bak = src + '.bak-dev-client';
  if (!existsSync(src)) { console.error(`[跳过] 找不到 ${rel}`); continue; }
  if (!readFileSync(src, 'utf8').includes('DEV_BACKDOOR')) { console.log(`[已回退] ${rel} 里没有后门接线。`); continue; }
  if (!existsSync(bak)) {
    console.error(`[中止] 找不到备份 ${rel}.bak-dev-client，无法逐字还原（可 git checkout ${rel}）。`);
    process.exit(1);
  }
  copyFileSync(src, src + '.bak-dev-client-revert');
  copyFileSync(bak, src);
  console.log(`[完成] ${rel} 已从备份还原。`);
  done++;
}
console.log(`[汇总] 还原 ${done} 个文件。`);
