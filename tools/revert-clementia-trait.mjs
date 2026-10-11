#!/usr/bin/env node
// [CUSTOM] 撤销 tools/apply-clementia-trait.mjs：把她的卫戍特质还原成原来的加层记录。
//
// 撤销后：garrisonIds 回到 ['garrison_155_a','garrison_65_a']（精英 _b），并删除她专属的两条展示型记录。
// 与锏共用的 garrison_155_* / garrison_65_* 从头到尾没被改过，所以不需要从备份恢复。
//
// 用法：node tools/revert-clementia-trait.mjs [表路径]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const TABLE = process.argv[2] || '.cache/gamedata/excel/activity_table.json';
const BASE_A = 'chess_char_6_21_a';
const BASE_B = 'chess_char_6_21_b';
const NEW_A = 'garrison_155_clem_a';
const NEW_B = 'garrison_155_clem_b';
const ORIG_A = ['garrison_155_a', 'garrison_65_a'];
const ORIG_B = ['garrison_155_b', 'garrison_65_b'];

if (!existsSync(TABLE)) { console.error(`[中止] 找不到 ${TABLE}`); process.exit(1); }

function find(root, name) {
  let hit = null;
  (function walk(node, depth) {
    if (hit || !node || typeof node !== 'object' || depth > 6) return;
    for (const k of Object.keys(node)) {
      if (k === name && node[k] && typeof node[k] === 'object') { hit = node[k]; return; }
      walk(node[k], depth + 1);
    }
  })(root, 0);
  return hit;
}

const raw = readFileSync(TABLE, 'utf8');
const data = JSON.parse(raw);
const g = find(data, 'garrisonDataDict');
const c = find(data, 'charChessDataDict');
if (!g || !c) { console.error('[中止] 表里找不到 garrisonDataDict / charChessDataDict'); process.exit(1); }

const idsA = c[BASE_A]?.garrisonIds || [];
if (!g[NEW_A] && !g[NEW_B] && JSON.stringify(idsA) === JSON.stringify(ORIG_A)) {
  console.log('[已回退] 她用的是原生卫戍记录，无需处理。');
  process.exit(0);
}

const next = JSON.parse(raw);
const nG = find(next, 'garrisonDataDict');
const nC = find(next, 'charChessDataDict');
delete nG[NEW_A];
delete nG[NEW_B];
nC[BASE_A] = { ...nC[BASE_A], garrisonIds: [...ORIG_A] };
nC[BASE_B] = { ...nC[BASE_B], garrisonIds: [...ORIG_B] };

const serialized = JSON.stringify(next);
JSON.parse(serialized);
copyFileSync(TABLE, TABLE + '.bak-clementia-trait-revert');
writeFileSync(TABLE, serialized);

console.log('[完成] 已还原她的卫戍特质：');
console.log(`  ${BASE_A}.garrisonIds → ${JSON.stringify(nC[BASE_A].garrisonIds)}`);
console.log(`  ${BASE_B}.garrisonIds → ${JSON.stringify(nC[BASE_B].garrisonIds)}`);
console.log(`  已删除她专属的 ${NEW_A} / ${NEW_B}；与锏共用的记录本来就未改动。`);
console.log(`[备份] ${TABLE}.bak-clementia-trait-revert`);
console.log('注意：kit 里那段 [CUSTOM] 特质效果不会随之消失 —— 要一起去掉就把它删掉。');
