#!/usr/bin/env node
// [CUSTOM] 给干员「结城理」(char_4217_makoto) 补上 data/assets.json 里的 Spine 清单条目。
//
// 与 tools/apply-clementia-spine.mjs 同一套做法（客户端只认 data/assets.json 的
// chars[charId].spine.front，fetch-assets 的硬编码资源索引不含联动干员，所以清单里没有他）。
// 自选棋子在棋盘上画的就是所选干员的模型，所以这一步是必需的，不是可选。
//
// 用法：node tools/apply-makoto-spine.mjs [仓库根目录]
// 回退：node tools/revert-makoto-spine.mjs

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseSkel, skelParserAvailable } from './assets/skel.mjs';
import { atlasInfo, normalizeAtlas } from './assets/atlas.mjs';
import { resolveRoles, roleAnimationNames } from './assets/anim-roles.mjs';

const ROOT = resolve(process.argv[2] || process.cwd());
const CHAR_ID = 'char_4217_makoto';
const REL_DIR = `spine/op/${CHAR_ID}/front/`;
const ATLAS = join(ROOT, 'public/assets', REL_DIR, `${CHAR_ID}.atlas`);
const SKEL = join(ROOT, 'public/assets', REL_DIR, `${CHAR_ID}.skel`);
const MANIFEST = join(ROOT, 'data/assets.json');

const die = (m) => { console.error('[中止] ' + m); process.exit(1); };
if (!skelParserAvailable()) die('拿不到 @pixi-spine/runtime-3.8（先 npm install），无法解析 .skel。');
for (const [p, what] of [[ATLAS, 'atlas'], [SKEL, 'skel'], [MANIFEST, 'data/assets.json']]) {
  if (!existsSync(p)) die(`找不到 ${what}: ${p} —— 先跑 node tools/deploy-makoto.mjs。`);
}

const pngSize = (abs) => {
  const buf = readFileSync(abs);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

// 1) atlas 规范化（补 size 行；幂等）
const before = atlasInfo(readFileSync(ATLAS, 'utf8'));
const norm = normalizeAtlas(readFileSync(ATLAS, 'utf8'), {
  pageSize: (name) => pngSize(join(ROOT, 'public/assets', REL_DIR, name)), pma: false, renamePage: (p) => p,
});
if (norm.missingSize.length) die(`atlas 页面量不到尺寸: ${norm.missingSize.join(', ')}`);
if (norm.changed) {
  copyFileSync(ATLAS, ATLAS + '.bak-makoto');
  writeFileSync(ATLAS, norm.text);
  console.log(`[atlas] 已补 size 行（原 hasSize=${before.hasSize}；备份 ${ATLAS}.bak-makoto）`);
} else console.log('[atlas] 已是规范形态');

// 2/3) 解析骨架 + 动画角色（skillIndices 三个技能）
const info = atlasInfo(readFileSync(ATLAS, 'utf8'));
const sk = parseSkel(readFileSync(SKEL), info.regions);
if (!sk.animations.length) die('骨架里没有动画。');
if (sk.missingRegions.length) console.warn(`[警告] ${sk.missingRegions.length} 个挂点不在 atlas 里（例如 ${sk.missingRegions[0]}）`);
const roles = resolveRoles(sk.animations, { skillIndices: [0, 1, 2], durations: sk.durations });
const unknown = roleAnimationNames(roles).filter((n) => !sk.animations.includes(n));
if (unknown.length) die(`角色指向不存在的动画: ${unknown.join(', ')}`);

const entry = {
  skel: `/assets/${REL_DIR}${CHAR_ID}.skel`,
  atlas: `/assets/${REL_DIR}${CHAR_ID}.atlas`,
  textures: info.pages.map((p) => `/assets/${REL_DIR}${p}`),
  pma: false,
  anims: roles,
  animations: sk.durations,
  events: sk.events,
  hits: sk.hits,
  bounds: sk.bounds,
};

// 4) 写清单（保留他已有的头像/立绘/技能图标）
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (JSON.stringify(manifest.chars?.[CHAR_ID]?.spine?.front) === JSON.stringify(entry)) {
  console.log(`[已应用] ${CHAR_ID} 的 spine 条目已存在且一致。`);
  process.exit(0);
}
const next = JSON.parse(readFileSync(MANIFEST, 'utf8'));
next.chars[CHAR_ID] = { ...(next.chars[CHAR_ID] ?? {}), spine: { front: entry } };
copyFileSync(MANIFEST, MANIFEST + '.bak-makoto-spine');
writeFileSync(MANIFEST, JSON.stringify(next));

console.log(`[清单] chars['${CHAR_ID}'].spine.front 已写入（备份 ${MANIFEST}.bak-makoto-spine）`);
console.log(`       动画 ${sk.animations.length} 个 · 事件 ${JSON.stringify(sk.events)} · bounds ${JSON.stringify(sk.bounds)}`);
console.log(`       idle=${roles.idle} deploy=${roles.deploy} attack=${roles.attack?.loop} die=${roles.die}`);
console.log(`       skills=${JSON.stringify(Object.fromEntries(Object.entries(roles.skills ?? {}).map(([k, v]) => [k, v.loop ?? v.begin])))}`);
console.log('');
console.log('下一步：重启服务；自选槽里选他时棋盘上会画他的模型。');
