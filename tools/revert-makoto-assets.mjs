#!/usr/bin/env node
// [CUSTOM] 撤销 tools/apply-makoto-assets.mjs：从清单里移除结城理的头像/立绘/技能图标（保留 spine，由 spine 工具自己管）。
//
// 用法：node tools/revert-makoto-assets.mjs [仓库根目录]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const CHAR_ID = 'char_4217_makoto';
const SKILLS = ['skchr_makoto_1', 'skchr_makoto_2', 'skchr_makoto_3'];
const MANIFEST = join(ROOT, 'data/assets.json');
if (!existsSync(MANIFEST)) { console.error('[中止] 找不到 data/assets.json'); process.exit(1); }

const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (!m.chars?.[CHAR_ID] && !SKILLS.some((s) => m.skills?.[s])) {
  console.log('[已回退] 清单里没有他的素材登记。');
  process.exit(0);
}
const next = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (next.chars?.[CHAR_ID]) {
  const spine = next.chars[CHAR_ID].spine;
  if (spine) next.chars[CHAR_ID] = { spine }; else delete next.chars[CHAR_ID];
}
for (const s of SKILLS) if (next.skills) delete next.skills[s];
copyFileSync(MANIFEST, MANIFEST + '.bak-makoto-assets-revert');
writeFileSync(MANIFEST, JSON.stringify(next));
console.log(`[完成] 已移除 ${CHAR_ID} 的头像/立绘/技能图标登记（spine 条目保留）。`);
