#!/usr/bin/env node
// [CUSTOM] 给干员「克莱门莎」(char_4231_clemnt) 补上 data/assets.json 里的 Spine 清单条目。
//
// 背景（为什么需要它）：
//   客户端解析战场小人只认 data/assets.json 的 `chars[charId].spine.front`（public/js/assets.js spineEntry）；
//   清单里没有 `spine` 字段就拿不到任何 URL，模型只能退回占位符。而这份清单由 tools/fetch-assets.mjs 生成，
//   它的下载计划来自硬编码的 209 人资源索引 —— 克莱门莎不在其中（她 2026-10-09 才上线），所以
//   deploy-clementia.mjs 把 .skel/.atlas/.png 放到 public/assets/ 之后，清单里始终没有她这一条。
//
// 本工具做的事（与 fetch-assets.mjs 的官方管线同一套函数，不是另写一套解析）：
//   1. 规范化她的 .atlas：补上页面缺的 `size: W,H`（fexli 原始 atlas 没有这一行，而 pixi-spine 需要；
//      tools/assets/atlas.mjs normalizeAtlas，幂等）
//   2. 用 tools/assets/skel.mjs parseSkel 解析 .skel（动画名/时长/事件/OnAttack 命中帧/bounds）
//   3. 用 tools/assets/anim-roles.mjs resolveRoles 解析动画角色（idle/deploy/attack/skill/die…）
//   4. 把条目写进 data/assets.json 的 chars['char_4231_clemnt'].spine（front；她官方没有 back 模型）
//
// 幂等：条目已存在且内容一致则跳过；任何一步失败都不写文件。
// 用法：node tools/apply-clementia-spine.mjs [仓库根目录]      （默认当前目录）
// 回退：node tools/revert-clementia-spine.mjs

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseSkel, skelParserAvailable } from './assets/skel.mjs';
import { atlasInfo, normalizeAtlas } from './assets/atlas.mjs';
import { resolveRoles, roleAnimationNames } from './assets/anim-roles.mjs';

const ROOT = resolve(process.argv[2] || process.cwd());
const CHAR_ID = 'char_4231_clemnt';
const REL_DIR = `spine/op/${CHAR_ID}/front/`;
const FILE = CHAR_ID;
const ATLAS = join(ROOT, 'public/assets', REL_DIR, `${FILE}.atlas`);
const SKEL = join(ROOT, 'public/assets', REL_DIR, `${FILE}.skel`);
const MANIFEST = join(ROOT, 'data/assets.json');

const die = (m) => { console.error('[中止] ' + m); process.exit(1); };

if (!skelParserAvailable()) die('拿不到 @pixi-spine/runtime-3.8（先 npm install），无法解析 .skel。');
for (const [p, what] of [[ATLAS, 'atlas'], [SKEL, 'skel'], [MANIFEST, 'data/assets.json']]) {
  if (!existsSync(p)) die(`找不到 ${what}: ${p}`);
}

/** PNG 尺寸（IHDR），用于 normalizeAtlas 补/校 `size:` 行。 */
function pngSize(abs) {
  const buf = readFileSync(abs);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// —— 1. atlas 规范化（补 size，幂等）——
const before = atlasInfo(readFileSync(ATLAS, 'utf8'));
const norm = normalizeAtlas(readFileSync(ATLAS, 'utf8'), {
  pageSize: (name) => pngSize(join(ROOT, 'public/assets', REL_DIR, name)),
  pma: false,
  renamePage: (p) => p,
});
if (norm.missingSize.length) die(`atlas 页面量不到尺寸: ${norm.missingSize.join(', ')}`);
if (norm.changed) {
  copyFileSync(ATLAS, ATLAS + '.bak-clementia');
  writeFileSync(ATLAS, norm.text);
  console.log(`[atlas] 已补 size 行（原 hasSize=${before.hasSize}；备份 ${ATLAS}.bak-clementia）`);
} else {
  console.log('[atlas] 已是规范形态，无需改动');
}

// —— 2/3. 解析 skel + 动画角色 ——
const info = atlasInfo(readFileSync(ATLAS, 'utf8'));
const sk = parseSkel(readFileSync(SKEL), info.regions);
if (!sk.animations.length) die('骨架里没有动画，无法生成条目。');
if (sk.missingRegions.length) console.warn(`[警告] ${sk.missingRegions.length} 个挂点不在 atlas 里（例如 ${sk.missingRegions[0]}）`);
const roles = resolveRoles(sk.animations, { skillIndices: [0, 1, 2], durations: sk.durations });
const unknown = roleAnimationNames(roles).filter((n) => !sk.animations.includes(n));
if (unknown.length) die(`角色指向不存在的动画: ${unknown.join(', ')}`);

const entry = {
  skel: `/assets/${REL_DIR}${FILE}.skel`,
  atlas: `/assets/${REL_DIR}${FILE}.atlas`,
  textures: info.pages.map((p) => `/assets/${REL_DIR}${p}`),
  pma: false,
  anims: roles,
  animations: sk.durations,
  events: sk.events,
  hits: sk.hits,
  bounds: sk.bounds,
};

// —— 4. 写清单 ——
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (!manifest.chars?.[CHAR_ID]) die(`data/assets.json 的 chars 里没有 ${CHAR_ID}（先跑 deploy-clementia.mjs）。`);
if (JSON.stringify(manifest.chars[CHAR_ID].spine?.front) === JSON.stringify(entry)) {
  console.log(`[已应用] ${CHAR_ID} 的 spine 条目已存在且一致，无需处理。`);
  process.exit(0);
}
const next = JSON.parse(readFileSync(MANIFEST, 'utf8'));
next.chars[CHAR_ID] = { ...next.chars[CHAR_ID], spine: { front: entry } };
copyFileSync(MANIFEST, MANIFEST + '.bak-clementia-spine');
writeFileSync(MANIFEST, JSON.stringify(next));

console.log(`[清单] chars['${CHAR_ID}'].spine.front 已写入（备份 ${MANIFEST}.bak-clementia-spine）`);
console.log(`       动画 ${sk.animations.length} 个 · 事件 ${JSON.stringify(sk.events)} · bounds ${JSON.stringify(sk.bounds)}`);
console.log(`       idle=${roles.idle} deploy=${roles.deploy} attack=${roles.attack?.loop} skill=${roles.skill?.loop} die=${roles.die}`);
console.log(`       命中帧 hits=${JSON.stringify(sk.hits)}`);
console.log('');
console.log('下一步：重启服务（或让浏览器硬刷新）后，她的战场小人与详情卡应显示官方模型。');
