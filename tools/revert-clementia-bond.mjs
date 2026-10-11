#!/usr/bin/env node
// [CUSTOM] 撤销 tools/apply-clementia-bond.mjs：把克莱门莎从盟约成员名单里移除。
// 幂等；已经撤销过就报「[已回退]」并以 0 退出。
//
// 用法：node tools/revert-clementia-bond.mjs [表路径] [--bond egirShip]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const bondFlag = args.indexOf('--bond');
const BOND = bondFlag >= 0 ? args[bondFlag + 1] : 'egirShip';
const TABLE = args.find((a, i) => !a.startsWith('--') && i !== bondFlag + 1)
  || '.cache/gamedata/excel/activity_table.json';
const BASE_ID = 'chess_char_6_21_a';

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
const bond = (find(JSON.parse(raw), 'bondInfoDict') || {})[BOND];
if (!bond || !Array.isArray(bond.chessIdList) || !bond.chessIdList.includes(BASE_ID)) {
  console.log(`[已回退] ${BOND} 的成员名单里没有 ${BASE_ID}，无需处理。`);
  process.exit(0);
}

const next = JSON.parse(raw);
const nBond = find(next, 'bondInfoDict')[BOND];
nBond.chessIdList = nBond.chessIdList.filter((x) => x !== BASE_ID);
const serialized = JSON.stringify(next);
JSON.parse(serialized);
if (nBond.chessIdList.includes(BASE_ID)) { console.error('[中止] 仍能匹配到，未写入任何文件。'); process.exit(1); }

copyFileSync(TABLE, TABLE + '.bak-clementia-bond-revert');
writeFileSync(TABLE, serialized);
console.log(`[完成] ${BOND} 成员名单已移除 ${BASE_ID}（现有 ${nBond.chessIdList.length} 人）`);
console.log(`[备份] ${TABLE}.bak-clementia-bond-revert`);
console.log('       data/bonds.json 要重跑一次 npm run build-data 才会同步更新。');
