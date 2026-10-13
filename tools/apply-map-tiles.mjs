// tools/apply-map-tiles.mjs — [CUSTOM] 业主自选的地形改动：把指定地图的若干格改成高台（远程位）。
//
// 为什么要这个脚本：`data/stages.json` 由 `tools/build-data.mjs` 从官方关卡数据生成，
// **重建数据会把它覆盖**。所以这类改动必须能一键重放 —— 本文件就是那份清单。
//
// 本次清单（业主 2026-10-13：「我想把这张地图的红框标记处变成高台」）：
//   act2autochess_m01 = 战场#05(下半) 源石流发生装置 —— 13 张图里唯一带「源石流发生装置」的（共 8 台）。
//   棋盘 (9,6) (10,6) (11,6)（第 6 列竖着三格）：
//     官方 '#' → tile_forbidden（HIGH / buildable NONE：永不可部署）
//     改为 'A' → tile_achand（HIGH / buildable ALL：高台，引擎判为 ranged = 远程位）
//
// 影响：
//   · 普通场这三格由「不可部署」变成 **ranged（只能放远程干员）**；
//   · 通行性不变（高台本来就不让地面敌人走），**不影响任何敌人路线**；
//   · ⚠️ 最终攻势（boss 轮）的 boss 半场读同一张图**第 2–4 行**，官方那几格是 'r' 路（近战位），
//     所以「普通场能放 ⇒ boss 半场也能放」这条不变量在这三格上不成立 —— 已在
//     `test/match/playtest5-deploy.test.js` 的 CUSTOM_TILES 里登记放行（有意接受；
//     改 boss 侧那几格会挡住上半张图的地面路线，代价更大）。
//   · `deployTiles.normal` 用引擎自己的 `buildDeployMap` 重算，保证与 `test/match/board.test.js` 的断言一致。
//
// 用法：
//   node tools/apply-map-tiles.mjs            # 应用（幂等）
//   node tools/apply-map-tiles.mjs --revert   # 还原为官方地形并重算部署表
import { readFileSync, writeFileSync } from 'node:fs';
import { buildDeployMap } from '../server/match/board.js';

const FILE = new URL('../data/stages.json', import.meta.url);

/** 改动清单：`cells` 用棋盘坐标 [行, 列]。 */
const EDITS = [
  {
    stage: 'act2autochess_m01',
    glyph: 'A',        // tile_achand：HIGH + buildable ALL = 高台（远程位）
    official: '#',     // tile_forbidden：官方原值
    cells: [[9, 6], [10, 6], [11, 6]],
  },
];

const revert = process.argv.includes('--revert');
const from = revert ? 'A' : '#';
const to = revert ? '#' : 'A';
let out = readFileSync(FILE, 'utf8');
let changed = 0;

for (const e of EDITS) {
  const START = `"${e.stage}":{"id":"${e.stage}"`;
  const i0 = out.indexOf(START);
  if (i0 < 0) { console.error(`找不到 ${e.stage}`); process.exit(1); }
  // 该图的区块：到下一张图（或文件末尾）为止
  const rest = out.slice(i0 + START.length);
  const nextRel = rest.search(/"act[0-9a-z_]*":\{"id":"act/);
  const i1 = nextRel < 0 ? out.length : i0 + START.length + nextRel;
  let sec = out.slice(i0, i1);

  // ① rows：定点改字符（幂等）
  const rm = sec.match(/"rows":\[[^\]]*\]/);
  if (!rm) { console.error(`${e.stage} 找不到 rows`); process.exit(1); }
  const rows = JSON.parse(rm[0].slice('"rows":'.length));
  let touched = 0;
  for (const [r, c] of e.cells) {
    if (rows[r][c] === to) continue;
    if (rows[r][c] !== from) { console.error(`${e.stage} (${r},${c}) 既不是 '${from}' 也不是 '${to}'：'${rows[r][c]}'`); process.exit(1); }
    rows[r] = rows[r].slice(0, c) + to + rows[r].slice(c + 1);
    console.log(`  ${e.stage} rows[${r}][${c}]: '${from}' → '${to}'  (${rows[r]})`);
    touched++;
  }
  if (!touched) { console.log(`  ${e.stage}：已是目标状态，跳过`); continue; }
  sec = sec.replace(rm[0], '"rows":' + JSON.stringify(rows));

  // ② deployTiles：用引擎自己的算法重算（只换 normal；boss 半场读第 2–5 行，不受影响）
  const dm = sec.match(/"deployTiles":\{.*?\},"groundPaths"/s);
  if (!dm) { console.error(`${e.stage} 找不到 deployTiles`); process.exit(1); }
  const d0 = sec.indexOf('{', sec.indexOf('"deployTiles"'));
  const d1 = sec.indexOf(',"groundPaths"');
  const deploy = JSON.parse(sec.slice(d0, d1));
  const stage = { ...JSON.parse(sec.slice(sec.indexOf('{'), sec.lastIndexOf('}') + 1)), rows };
  const map = buildDeployMap(stage);
  const list = (v) => [...map].filter(([, x]) => x === v).map(([k]) => k.split(',').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  deploy.normal = { ...deploy.normal, melee: list('melee'), rangedOnly: list('ranged') };
  console.log(`  ${e.stage} deployTiles.normal: melee ${deploy.normal.melee.length} 格, rangedOnly ${JSON.stringify(deploy.normal.rangedOnly)}`);
  sec = sec.replace(dm[0], '"deployTiles":' + JSON.stringify(deploy) + ',"groundPaths"');

  out = out.slice(0, i0) + sec + out.slice(i1);
  changed++;
}

if (changed) {
  writeFileSync(FILE, out);
  console.log(`已写入 data/stages.json（${revert ? '还原为官方' : '应用改动'}：${changed} 张图）`);
} else {
  console.log('无需写入（幂等）。');
}
