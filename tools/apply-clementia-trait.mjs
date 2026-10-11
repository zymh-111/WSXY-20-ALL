#!/usr/bin/env node
// [CUSTOM] 把克莱门莎的“获得时/部署时 +阿戈尔层数”卫戍特质，换成自定义的阿戈尔特质。
//
// 背景（角色面板红框里那两条「特质」）：
//   她的棋池记录带 garrisonIds = ['garrison_155_a','garrison_65_a']（当初照抄模板干员锏
//   chess_char_6_19_a 的记录，这两条 garrison 都是与锏**共用**的官方卫戍）：
//     garrison_155  <获得时>自身所属的盟约层数+8 / <部署时>使自身已激活的盟约层数+8（至多24层）  [持续叠加]
//     garrison_65   <获得时>自身所属盟约层数+8（无需激活盟约）                                  [单次叠加]
//   于是她的面板「特质」区块显示的就是这两条阿戈尔加层效果。
//
// 本工具做的事（幂等）：
//   1. 在活动表里**新建**两条她专属的卫戍 garrison_155_clem_a / garrison_155_clem_b
//      （绝不改动与锏共用的 garrison_155_* / garrison_65_*），文案改成自定义特质、
//      且不含任何会加层的 bbStr/effectKey —— 纯展示：
//        <阿戈尔>每 3 层，克莱门莎攻击力+1%、其攻击范围内敌人受到的元素伤害+1%
//   2. 把她两条棋池记录（_a/_b）的 garrisonIds 换成各自那条新记录，
//      于是「获得时/部署时 +层数」两条加层效果都不再挂在她身上。
//
// 效果本身由她的 kit 实现（kits/ops/chess_char_6_21-clemnt.js 的 [CUSTOM] 段）：
// 卫戍系统只能表达“加多少层”，表达不了“每 3 层给攻击/元素易伤”。
//
// 用法：node tools/apply-clementia-trait.mjs [表路径]
// 回退：node tools/revert-clementia-trait.mjs
// 之后请运行：npm run build-data && 重启服务

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const TABLE = process.argv[2] || '.cache/gamedata/excel/activity_table.json';
const BASE_A = 'chess_char_6_21_a';
const BASE_B = 'chess_char_6_21_b';
/** 她专属的新卫戍 id（不复用与锏共用的 garrison_155_*）。 */
const NEW_A = 'garrison_155_clem_a';
const NEW_B = 'garrison_155_clem_b';

const DESC_A = '<@ba.kw>阿戈尔</>每 3 层，克莱门莎攻击力<@ba.vup>+1%</>，其攻击范围内敌人受到的元素伤害<@ba.vup>+1%</>';
const DESC_B = '<@ba.kw>阿戈尔</>每 3 层，克莱门莎攻击力<@ba.vup>+2%</>，其攻击范围内敌人受到的元素伤害<@ba.vup>+2%</>';

if (!existsSync(TABLE)) {
  console.error(`[中止] 找不到 ${TABLE}，请在仓库根目录运行（或把表路径作为参数传入）。`);
  process.exit(1);
}

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
const garrisons = find(data, 'garrisonDataDict');
const chessDict = find(data, 'charChessDataDict');
const pool = find(data, 'charShopChessDatas');
for (const [k, v] of [['garrisonDataDict', garrisons], ['charChessDataDict', chessDict], ['charShopChessDatas', pool]]) {
  if (!v) { console.error(`[中止] 表里找不到 ${k} —— 上游结构可能变了。`); process.exit(1); }
}
if (!chessDict[BASE_A] || !chessDict[BASE_B] || !pool[BASE_A]) {
  console.error(`[中止] 棋池里没有 ${BASE_A}/${BASE_B} —— 先跑 node tools/apply-clementia-patch.mjs。`);
  process.exit(1);
}

/**
 * 一条纯展示特质：**整条克隆官方同型记录**（保留 eventTypeSmallIcon 等未知字段），只替换文案，
 * 并清空 blackboard —— 于是没有 bb、没有 bbStr.key、battleRuneKey 置空、effectType 换成引擎不认识的类型，
 * 卫戍系统不会安装任何东西（既不执行 ADD_BOND，也不执行 SERVER_ADD_BOND_CHESS_ALL）。
 * build-data 的 buildGarrisons 读的是 `garrisonDesc` / `description` 与 `blackboard`，所以字段名必须照官方来。
 */
const displayGarrison = (tpl, descRaw, owner) => ({
  ...tpl,
  garrisonDesc: descRaw,
  description: descRaw,
  effectType: 'NONE_DISPLAY_ONLY',
  battleRuneKey: null,
  blackboard: [],
});

const idsA = chessDict[BASE_A].garrisonIds || [];
const idsB = chessDict[BASE_B].garrisonIds || [];
const done = garrisons[NEW_A]?.garrisonDesc && garrisons[NEW_B]?.garrisonDesc
  && garrisons[NEW_A]?.effectType === 'NONE_DISPLAY_ONLY'
  && garrisons[NEW_B]?.effectType === 'NONE_DISPLAY_ONLY'
  && idsA.length === 1 && idsA[0] === NEW_A
  && idsB.length === 1 && idsB[0] === NEW_B;
if (done) {
  console.log(`[已应用] ${BASE_A}/${BASE_B} 已挂上专属的展示型特质卫戍，无需处理。`);
  console.log(`         ${NEW_A}: ${garrisons[NEW_A].garrisonDesc.replace(/<[^>]+>/g, '')}`);
  process.exit(0);
}

// 与锏共用的原记录必须先快照，落盘后逐字比对，确保没被改
const shared = ['garrison_155_a', 'garrison_155_b', 'garrison_65_a', 'garrison_65_b'];
const sharedBefore = Object.fromEntries(shared.map((id) => [id, JSON.stringify(garrisons[id])]));

const next = JSON.parse(raw);
const nG = find(next, 'garrisonDataDict');
const nC = find(next, 'charChessDataDict');

nG[NEW_A] = displayGarrison(garrisons['garrison_155_a'], DESC_A, BASE_A);
nG[NEW_B] = displayGarrison(garrisons['garrison_155_b'], DESC_B, BASE_B);
nC[BASE_A] = { ...nC[BASE_A], garrisonIds: [NEW_A] };
nC[BASE_B] = { ...nC[BASE_B], garrisonIds: [NEW_B] };

// —— 校验 ——
for (const id of shared) {
  if (JSON.stringify(nG[id]) !== sharedBefore[id]) {
    console.error(`[中止] 误改了与锏共用的 ${id}，未写入任何文件。`);
    process.exit(1);
  }
}
for (const id of [NEW_A, NEW_B]) {
  if (/bond_add_count|SERVER_ADD_BOND|ADD_BOND|max_add_count_per_battle/.test(JSON.stringify(nG[id]))) {
    console.error(`[中止] 新记录 ${id} 仍含加层字段，未写入任何文件。`);
    process.exit(1);
  }
}
for (const [rec, id] of [[BASE_A, NEW_A], [BASE_B, NEW_B]]) {
  const gids = nC[rec].garrisonIds;
  if (gids.length !== 1 || gids[0] !== id) { console.error(`[中止] ${rec}.garrisonIds 未按预期改写，未写入。`); process.exit(1); }
  if (gids.some((g) => /garrison_65/.test(g))) { console.error('[中止] 单次叠加那条没摘干净，未写入。'); process.exit(1); }
}

const serialized = JSON.stringify(next);
JSON.parse(serialized);
copyFileSync(TABLE, TABLE + '.bak-clementia-trait');
writeFileSync(TABLE, serialized);

console.log('[完成] 她的卫戍特质已换成自定义阿戈尔特质：');
console.log(`  ${BASE_A}.garrisonIds : ${JSON.stringify(idsA)} → ${JSON.stringify(nC[BASE_A].garrisonIds)}`);
console.log(`  ${BASE_B}.garrisonIds : ${JSON.stringify(idsB)} → ${JSON.stringify(nC[BASE_B].garrisonIds)}`);
console.log('  新增 ' + NEW_A + ' : ' + nG[NEW_A].garrisonDesc.replace(/<[^>]+>/g, ''));
console.log(`  新增 ${NEW_B} : ${nG[NEW_B].garrisonDesc.replace(/<[^>]+>/g, '')}`);
console.log(`  与锏共用的 garrison_155_* / garrison_65_* 四条原记录逐字未改。`);
console.log(`[备份] ${TABLE}.bak-clementia-trait`);
console.log('');
console.log('effectType = NONE_DISPLAY_ONLY 是引擎不认识的类型 ⇒ 卫戍系统不安装任何效果，');
console.log('“获得时/部署时 +层数”因此彻底失效；实际效果由她的 kit [CUSTOM] 段实现。');
console.log('');
console.log('下一步：npm run build-data && 重启服务');
