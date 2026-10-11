#!/usr/bin/env node
// [CUSTOM] 撤销 tools/apply-clementia-spine.mjs：把 her spine 条目从 data/assets.json 移除。
// 幂等；atlas 的 size 修正是无害的规范化，不撤销（它让客户端能正确读图）。
//
// 用法：node tools/revert-clementia-spine.mjs [仓库根目录]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const CHAR_ID = 'char_4231_clemnt';
const MANIFEST = join(ROOT, 'data/assets.json');

if (!existsSync(MANIFEST)) { console.error('[中止] 找不到 data/assets.json'); process.exit(1); }
const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const c = m.chars?.[CHAR_ID];
if (!c || !c.spine) { console.log('[已回退] 清单里没有她的 spine 条目，无需处理。'); process.exit(0); }

const next = JSON.parse(readFileSync(MANIFEST, 'utf8'));
delete next.chars[CHAR_ID].spine;
copyFileSync(MANIFEST, MANIFEST + '.bak-clementia-spine-revert');
writeFileSync(MANIFEST, JSON.stringify(next));
console.log(`[完成] 已移除 chars['${CHAR_ID}'].spine（备份 ${MANIFEST}.bak-clementia-spine-revert）`);
console.log('       撤销后她又会退回占位小人 —— 想恢复：node tools/apply-clementia-spine.mjs');
