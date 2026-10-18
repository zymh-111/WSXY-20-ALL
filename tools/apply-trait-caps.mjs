// tools/apply-trait-caps.mjs — [CUSTOM] 业主决定：**移除两名干员特质的叠层上限**。
//
//   圣约送葬人（garrison_23_a/_b、garrison_55_a/_b）—— 原本「每场战斗至多触发 7 次 / 【远见】至多 21(42) 层」
//   荒芜拉普兰德（garrison_118_a 自身、garrison_117_b 给全【叙拉古】的那个）—— 原本 bb 上限 100 / 200
//
// 为什么这样改就够了：引擎把上限读成
//   `const cap = S.num(bb.max_add_count_per_battle, 0) > 0 ? S.num(bb.max_add_count_per_battle) : Infinity;`
//   （server/sim/content/garrisons/battle.js:69，server/match/fields.js:616 同款）
//   —— **字段不存在 ⇒ Infinity = 无上限**，所以删掉这个键即可，不用动引擎代码。
// 文字里的「（每场战斗至多…）」也一并去掉，否则游戏内描述与实际行为不符。
//
// 为什么要这个脚本：`data/garrisons.json` 由 tools/build-data.mjs 生成，**重建数据会还原上限**。
//
// 用法：
//   node tools/apply-trait-caps.mjs            # 应用（幂等）
//   node tools/apply-trait-caps.mjs --revert   # 还原上限与原文案
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../data/garrisons.json', import.meta.url);

/** cap = 原来的上限值；strip = 描述里要删掉的那段（revert 时追加回末尾）。 */
const EDITS = [
  { id: 'garrison_23_a', cap: 49, strip: '（每场战斗分别至多触发7次）' },
  { id: 'garrison_23_b', cap: 98, strip: '（每场战斗至多触发7次）' },
  { id: 'garrison_55_a', cap: 21, strip: '（【远见】每场战斗至多21层）' },
  { id: 'garrison_55_b', cap: 42, strip: '（【远见】每场战斗至多42层）' },
  { id: 'garrison_118_a', cap: 100, strip: '' },
  { id: 'garrison_117_b', cap: 200, strip: '' },
];

const revert = process.argv.includes('--revert');
const all = JSON.parse(readFileSync(FILE, 'utf8').toString());
let changed = 0;

for (const e of EDITS) {
  const g = all[e.id];
  if (!g) { console.error(`找不到 ${e.id}`); process.exit(1); }
  if (!g.bb || typeof g.bb !== 'object') g.bb = {};
  const had = Object.hasOwn(g.bb, 'max_add_count_per_battle');

  if (revert) {
    if (had && g.bb.max_add_count_per_battle === e.cap) { console.log(`  ${e.id}: 已是原状，跳过`); continue; }
    g.bb.max_add_count_per_battle = e.cap;
    if (e.strip) {
      for (const k of ['desc', 'descRaw']) if (typeof g[k] === 'string' && !g[k].includes(e.strip)) g[k] += e.strip;
    }
    console.log(`  ${e.id}: 还原上限 ${e.cap}`);
  } else {
    if (!had) { console.log(`  ${e.id}: 已无上限，跳过`); continue; }
    delete g.bb.max_add_count_per_battle;
    if (e.strip) {
      for (const k of ['desc', 'descRaw']) if (typeof g[k] === 'string') g[k] = g[k].split(e.strip).join('');
    }
    console.log(`  ${e.id}: 去掉上限 ${e.cap}${e.strip ? ' + 文案' : ''}`);
  }
  changed++;
}

if (changed) {
  writeFileSync(FILE, JSON.stringify(all));
  console.log(`已写入 data/garrisons.json（${revert ? '还原' : '移除'}上限：${changed} 条）`);
} else {
  console.log('无需写入（幂等）。');
}
