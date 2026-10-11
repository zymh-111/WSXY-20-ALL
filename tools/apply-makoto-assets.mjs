#!/usr/bin/env node
// [CUSTOM] 把结城理的素材登记进 data/assets.json（chars + skills 两部分）。
// deploy-makoto.mjs 只负责把文件放到 public/assets/，本工具写清单 —— 客户端读的是清单。
//
// 用法：node tools/apply-makoto-assets.mjs [仓库根目录]
// 回退：node tools/revert-makoto-assets.mjs

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const CHAR_ID = 'char_4217_makoto';
const SKILLS = ['skchr_makoto_1', 'skchr_makoto_2', 'skchr_makoto_3'];
const MANIFEST = join(ROOT, 'data/assets.json');
const die = (m) => { console.error('[中止] ' + m); process.exit(1); };
if (!existsSync(MANIFEST)) die('找不到 data/assets.json —— 先跑 npm run build-data。');

// 文件必须都在（否则清单会指向 404）
for (const rel of [`char/avatar/${CHAR_ID}.png`, `char/avatar/${CHAR_ID}_2.png`,
  `char/portrait/${CHAR_ID}_1.png`, `char/portrait/${CHAR_ID}_2.png`,
  ...SKILLS.map((s) => `skill/${s}.png`)]) {
  if (!existsSync(join(ROOT, 'public/assets', rel))) die(`素材缺失：public/assets/${rel} —— 先跑 node tools/deploy-makoto.mjs。`);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const wantChar = {
  avatar: `/assets/char/avatar/${CHAR_ID}.png`,
  avatarE2: `/assets/char/avatar/${CHAR_ID}_2.png`,
  portrait: `/assets/char/portrait/${CHAR_ID}_1.png`,
  portraitE2: `/assets/char/portrait/${CHAR_ID}_2.png`,
  // spine 由 tools/apply-makoto-spine.mjs 单独写；这里保留已有的
  ...(manifest.chars?.[CHAR_ID]?.spine ? { spine: manifest.chars[CHAR_ID].spine } : null),
};
const wantSkills = Object.fromEntries(SKILLS.map((s) => [s, `/assets/skill/${s}.png`]));

// 幂等判断：逐字段比（不能比 JSON.stringify —— 键顺序不同会误判成"没应用"）
const cur = manifest.chars?.[CHAR_ID] ?? {};
const charOk = Object.entries(wantChar).every(([k, v]) => JSON.stringify(cur[k]) === JSON.stringify(v))
  && Object.keys(cur).every((k) => k in wantChar);   // 没有多余字段
const skillsOk = SKILLS.every((s) => manifest.skills?.[s] === wantSkills[s]);
if (charOk && skillsOk) {
  console.log(`[已应用] ${CHAR_ID} 的头像/立绘/技能图标已在清单里。`);
  process.exit(0);
}

const next = JSON.parse(readFileSync(MANIFEST, 'utf8'));
next.chars = next.chars ?? {};
next.skills = next.skills ?? {};
next.chars[CHAR_ID] = { ...(next.chars[CHAR_ID] ?? {}), ...wantChar };
for (const [k, v] of Object.entries(wantSkills)) next.skills[k] = v;

copyFileSync(MANIFEST, MANIFEST + '.bak-makoto-assets');
writeFileSync(MANIFEST, JSON.stringify(next));
console.log('[完成] 已登记：');
console.log('  chars[' + CHAR_ID + '] = ' + JSON.stringify(wantChar));
for (const [k, v] of Object.entries(wantSkills)) console.log('  skills[' + k + '] = ' + v);
console.log(`[备份] ${MANIFEST}.bak-makoto-assets`);
