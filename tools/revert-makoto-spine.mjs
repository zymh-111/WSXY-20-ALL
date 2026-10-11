#!/usr/bin/env node
// [CUSTOM] 撤销 tools/apply-makoto-spine.mjs：移除结城理的 spine 清单条目。
// 幂等。atlas 的 size 规范化不撤销（无害且客户端需要）。
//
// 用法：node tools/revert-makoto-spine.mjs [仓库根目录]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const CHAR_ID = 'char_4217_makoto';
const MANIFEST = join(ROOT, 'data/assets.json');
if (!existsSync(MANIFEST)) { console.error('[中止] 找不到 data/assets.json'); process.exit(1); }

const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (!m.chars?.[CHAR_ID]?.spine) { console.log('[已回退] 清单里没有他的 spine 条目。'); process.exit(0); }

const next = JSON.parse(readFileSync(MANIFEST, 'utf8'));
delete next.chars[CHAR_ID].spine;
copyFileSync(MANIFEST, MANIFEST + '.bak-makoto-spine-revert');
writeFileSync(MANIFEST, JSON.stringify(next));
console.log(`[完成] 已移除 chars['${CHAR_ID}'].spine（备份 ${MANIFEST}.bak-makoto-spine-revert）`);
