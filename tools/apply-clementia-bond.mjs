#!/usr/bin/env node
// [CUSTOM] 把干员「克莱门莎」(char_4231_clemnt) 登记进她所属盟约的成员名单。
//
// 背景（为什么需要它）：
//   apply-clementia-patch.mjs 只往棋池三张表写了记录（charChessDataDict / charShopChessDatas /
//   chessNormalIdLookupDict），**没有**动盟约成员表 activity_table 的 `bondInfoDict[bondId].chessIdList`。
//   官方那份名单定稿早于她上线，所以里面没有她。后果：
//     · data/bonds.json 的 egirShip.members / visibleMembers 不含她
//       → 休整期/作战中的盟约面板「成员」列表里看不到她（public/js/ui/gameLogic/bonds.js bondMembers
//         用的就是 visibleMembers）
//     · 她的盟约**计数与效果其实是生效的**（server/match/bondsMeta.js 的 membership() 读棋子自己的
//         `bonds[]`，她的记录是 egirShip），所以这只是名单/展示层的缺失，不是效果失效
//   两个名单必须一致，否则 panel 与计数对不上。
//
// 本工具做的事：
//   把 `chess_char_6_21_a` 追加进 `bondInfoDict[bondId].chessIdList`（bondId 默认 egirShip → 阿戈尔）。
//   幂等：已在名单里则跳过；任何校验不过则一个字节都不写。
//
// 用法：node tools/apply-clementia-bond.mjs [表路径] [--bond egirShip]
//   （默认 .cache/gamedata/excel/activity_table.json，与 apply-clementia-patch.mjs 一致）
// 之后请运行：npm run build-data        # data/bonds.json 的 members/visibleMembers 会带上她
// 回退：node tools/revert-clementia-bond.mjs

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const bondFlag = args.indexOf('--bond');
const BOND = bondFlag >= 0 ? args[bondFlag + 1] : 'egirShip';
const TABLE = args.find((a, i) => !a.startsWith('--') && i !== bondFlag + 1)
  || '.cache/gamedata/excel/activity_table.json';
const CHAR_ID = 'char_4231_clemnt';
const BASE_ID = 'chess_char_6_21_a';   // apply-clementia-patch.mjs 为她的本体分配的棋池 id

if (!existsSync(TABLE)) {
  console.error(`[中止] 找不到 ${TABLE}，请在仓库根目录运行（或把表路径作为参数传入）。`);
  console.error('       该文件由 build-data 从 .cache 里的官方表生成，先跑一次 npm run build-data。');
  process.exit(1);
}

const raw = readFileSync(TABLE, 'utf8');
const data = JSON.parse(raw);

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

const bondInfo = find(data, 'bondInfoDict');
if (!bondInfo) {
  console.error('[中止] 表里找不到 bondInfoDict —— 上游结构可能变了，本工具需要更新。');
  process.exit(1);
}
const bond = bondInfo[BOND];
if (!bond || !Array.isArray(bond.chessIdList)) {
  console.error(`[中止] bondInfoDict.${BOND} 不存在或没有 chessIdList。现有盟约：${Object.keys(bondInfo).join(', ')}`);
  process.exit(1);
}

if (bond.chessIdList.includes(BASE_ID)) {
  console.log(`[已应用] ${BOND} 的成员名单里已有 ${BASE_ID}（共 ${bond.chessIdList.length} 人），无需处理。`);
  process.exit(0);
}

// 也要确认她的棋池记录存在，否则名单指向一个不存在的棋子（build-data 会 warn）
const chessDict = find(data, 'charChessDataDict');
const pool = find(data, 'charShopChessDatas');
if (!chessDict?.[BASE_ID] || !pool?.[BASE_ID]) {
  console.error(`[中止] 棋池里没有 ${BASE_ID} —— 先跑 node tools/apply-clementia-patch.mjs。`);
  process.exit(1);
}
if (pool[BASE_ID].charId !== CHAR_ID) {
  console.error(`[中止] ${BASE_ID} 的 charId 是 ${pool[BASE_ID].charId}，期望 ${CHAR_ID}，序号推导可能变了。`);
  process.exit(1);
}

const before = bond.chessIdList.length;
const next = JSON.parse(raw);
const nBond = find(next, 'bondInfoDict')[BOND];
nBond.chessIdList = [...nBond.chessIdList, BASE_ID];
const serialized = JSON.stringify(next);
JSON.parse(serialized);   // 语法自检
const after = nBond.chessIdList.length;
if (after !== before + 1 || !nBond.chessIdList.includes(BASE_ID)) {
  console.error(`[中止] 校验失败：成员数 ${before} → ${after}，未写入任何文件。`);
  process.exit(1);
}

copyFileSync(TABLE, TABLE + '.bak-clementia-bond');
writeFileSync(TABLE, serialized);
console.log(`[完成] ${BOND}（阿戈尔）成员名单 ${before} → ${after} 人，已加入 ${BASE_ID}`);
console.log(`[备份] ${TABLE}.bak-clementia-bond`);
console.log('');
console.log('下一步：npm run build-data    # 期望 data/bonds.json 的 egirShip.members 含 ' + BASE_ID);
