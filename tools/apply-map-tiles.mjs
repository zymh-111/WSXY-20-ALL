// tools/apply-map-tiles.mjs — [CUSTOM] 业主自选的地形改动：把指定地图的若干格改成高台（远程位）。
//
// 为什么要这个脚本：`data/stages.json` 由 `tools/build-data.mjs` 从官方关卡数据生成，
// **重建数据会把它覆盖**。所以这类改动必须能一键重放 —— 本文件就是那份清单。
//
// 本次清单（业主 2026-10-13：「我想把这张地图的红框标记处变成高台」+「把 boss 战的也改了」）：
//   act2autochess_m01 = 战场#05(下半) 源石流发生装置 —— 13 张图里唯一带「源石流发生装置」的（8 台）。
//   第 6 列竖着三格（普通场）与它们在 boss 两个半场对应的格子，共 9 格：
//     普通场  stage (9,6) (10,6) (11,6)          —— 棋盘行 9–12 读的就是 stage 同行
//     boss 左 stage (2,6) (3,6) (4,6)            —— 棋盘行 r 读 stage 行 r−7
//     boss 右 stage (2,14)(3,14)(4,14)           —— 右半场列镜像 20−c
//   字形：官方 '#'（tile_forbidden：HIGH + buildable NONE，永不可部署）
//      → `h`（tile_wall：HIGH + buildable RANGED = 本图部署区里在用的**高台**字形，
//        见 stage (10,4)(11,4)(12,4)）→ 引擎判为 **ranged 远程位**。
//   ※ 一开始误用了 'A'（tile_achand）—— 那是**手牌台/大平台**的素材（'a' 还带 bb.isValidHand），
//     风格与本图高台不一致；业主指出后改用 `h`。两者在 board.js 里同为 'ranged'，差别在素材与语义。
//
// 影响：
//   · 普通场与 boss 两个半场的那三格都由「不可部署」变成 **ranged（只能放远程干员）**；
//   · 通行性不变（'#' 与高台都是 groundPassable=false），且实测这 9 格**不在任何 groundPaths /
//     groundPathsWithDevices 路线上** → **不影响任何敌人路线**；
//   · 因为 boss 侧也改了，「普通场能放 ⇒ 最终攻势也能放」这条不变量**重新成立**（不再有例外）。
//   · 三个部署表（normal 用棋盘坐标、bossLeft/bossRight 用半场坐标）都用引擎自己的 `buildDeployMap`
//     重算，保证与 `test/match/board.test.js`、`test/match/playtest5-deploy.test.js` 的断言一致。
//
// 用法：
//   node tools/apply-map-tiles.mjs            # 应用（幂等）
//   node tools/apply-map-tiles.mjs --revert   # 还原为官方地形并重算部署表
import { readFileSync, writeFileSync } from 'node:fs';
import { buildDeployMap, fieldTile } from '../server/match/board.js';

const FILE = new URL('../data/stages.json', import.meta.url);

/** 改动清单：`cells` 用 **stage** 坐标 [行, 列]（部署表由引擎重算，无需手写）。 */
const EDITS = [
  {
    stage: 'act2autochess_m01',
    glyph: 'h',        // tile_wall：HIGH + buildable RANGED = 本图的高台字形
    official: '#',     // tile_forbidden：官方原值
    cells: [
      [9, 6], [10, 6], [11, 6],      // 普通场
      [2, 6], [3, 6], [4, 6],        // boss 左半场（棋盘行 r 读 stage 行 r−7）
      [2, 14], [3, 14], [4, 14],     // boss 右半场（列镜像 20−c）
    ],
  },
];

const revert = process.argv.includes('--revert');
let out = readFileSync(FILE, 'utf8');
let changed = 0;

for (const e of EDITS) {
  const from = revert ? e.glyph : e.official;
  const to = revert ? e.official : e.glyph;
  const START = `"${e.stage}":{"id":"${e.stage}"`;
  const i0 = out.indexOf(START);
  if (i0 < 0) { console.error(`找不到 ${e.stage}`); process.exit(1); }
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
    if (rows[r][c] !== from) { console.error(`${e.stage} (${r},${c}) 既非 '${from}' 也非 '${to}'：'${rows[r][c]}'`); process.exit(1); }
    rows[r] = rows[r].slice(0, c) + to + rows[r].slice(c + 1);
    console.log(`  ${e.stage} rows[${r}][${c}]: '${from}' → '${to}'`);
    touched++;
  }
  if (!touched) { console.log(`  ${e.stage}：已是目标状态，跳过`); continue; }
  sec = sec.replace(rm[0], '"rows":' + JSON.stringify(rows));

  // ② 三个部署表：用引擎自己的算法重算（coordinates: normal=棋盘, bossX=半场）
  const dm = sec.match(/"deployTiles":\{.*?\},"groundPaths"/s);
  if (!dm) { console.error(`${e.stage} 找不到 deployTiles`); process.exit(1); }
  const deploy = JSON.parse(sec.slice(sec.indexOf('{', sec.indexOf('"deployTiles"')), sec.indexOf(',"groundPaths"')));
  const stage = { ...JSON.parse(sec.slice(sec.indexOf('{'), sec.lastIndexOf('}') + 1)), rows };
  const sortRC = (a, b) => a[0] - b[0] || a[1] - b[1];
  const fieldList = (field, v) => [...buildDeployMap(stage, { field })]
    .filter(([, x]) => x === v)
    .map(([k]) => { const [r, c] = k.split(',').map(Number); return field === 'normal' ? [r, c] : fieldTile(field, r, c); })
    .sort(sortRC);
  deploy.normal = { ...deploy.normal, melee: fieldList('normal', 'melee'), rangedOnly: fieldList('normal', 'ranged') };
  deploy.bossLeft = { ...deploy.bossLeft, melee: fieldList('bossL', 'melee'), rangedOnly: fieldList('bossL', 'ranged') };
  deploy.bossRight = { ...deploy.bossRight, melee: fieldList('bossR', 'melee'), rangedOnly: fieldList('bossR', 'ranged') };
  console.log(`  ${e.stage} 部署表重算：`
    + `normal ranged ${JSON.stringify(deploy.normal.rangedOnly)} | `
    + `bossLeft ranged ${JSON.stringify(deploy.bossLeft.rangedOnly)} | `
    + `bossRight ranged ${JSON.stringify(deploy.bossRight.rangedOnly)}`);
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
