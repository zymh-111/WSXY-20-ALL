#!/usr/bin/env node
// [CUSTOM] 合成精锐奖励改造：额外获取（不占共享卡池）+ 候选不受池库存限制 + 升华不补票。
// 幂等：可重复运行，已应用的改动会跳过。运行： node tools/apply-reward-patch.mjs
// 回退（行为层）：prep.js 的 MERGE_REWARD_TAKES_POOL 改成 true；acquire.js 的 MERGE_REWARD_IGNORES_POOL 改成 false。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PREP = 'server/match/player/prep.js';
const ACQ = 'server/match/player/acquire.js';
const POOL = 'server/match/pool.js';

// [文件, 已应用标记, [待替换片段...], 替换为]
const EDITS = [
  [POOL, 'ignoreLeft = false }',
    ['  _eligible({ maxTier = 6, tier = null, filter = null, extra = null } = {}) {'],
    '  _eligible({ maxTier = 6, tier = null, filter = null, extra = null, ignoreLeft = false } = {}) {'],

  [POOL, 'const weight = ignoreLeft ?',
    [`      for (const [id, e] of list) {
        if (e.left <= 0) continue;
        if (tier != null ? e.tier !== tier : e.tier > maxTier) continue;
        if (filter && !filter(id, e)) continue;
        out.push([id, e.left]);
      }`],
    `      for (const [id, e] of list) {
        // [CUSTOM] ignoreLeft: weigh by the designed copies (cap) instead of the pool's stock
        const weight = ignoreLeft ? (e.cap ?? e.left) : e.left;
        if (weight <= 0) continue;
        if (tier != null ? e.tier !== tier : e.tier > maxTier) continue;
        if (filter && !filter(id, e)) continue;
        out.push([id, weight]);
      }`],
  [PREP, 'const MERGE_REWARD_TAKES_POOL = false;',
    ['export class PlayerPrep {'],
    `/** [CUSTOM] 合成精锐的奖励是否占用共享卡池：false = 额外获取（不扣池、不受库存限制，卖掉也不返还副本）。 */
const MERGE_REWARD_TAKES_POOL = false;

export class PlayerPrep {`],

  [PREP, 'const rewardFree = ',
    ['    const offer = this.offers[0];'],
    `    const offer = this.offers[0];
    // [CUSTOM] 合成奖励：额外获取，不占共享池
    const rewardFree = !MERGE_REWARD_TAKES_POOL && offer.source === 'merge';`],

  [PREP, '!rewardFree && pool.has(base)',
    ['      if (pool.has(base) && pool.left(base) < need) return fail(ERR.SOLD_OUT);'],
    '      if (!rewardFree && pool.has(base) && pool.left(base) < need) return fail(ERR.SOLD_OUT);'],

  [PREP, 'piece.rewardFree = true',
    [`      else this.acquireChess(slot.id, { source: 'reward' });`,
      `      else this.acquireChess(slot.id, { source: 'reward', fromPool: !rewardFree });`],
    `      else {
        const piece = this.acquireChess(slot.id, { source: 'reward', fromPool: !rewardFree });
        if (rewardFree && piece) piece.rewardFree = true;
      }`],
  [ACQ, 'const MERGE_REWARD_IGNORES_POOL = true;',
    ['export class PlayerAcquire {'],
    `/** [CUSTOM] 合成奖励的候选是否忽略共享池库存：true = 池子被抢光的干员仍会出现在奖励里（按设计份数加权）。 */
const MERGE_REWARD_IGNORES_POOL = true;

export class PlayerAcquire {`],

  [ACQ, 'const ignoreLeft = MERGE_REWARD_IGNORES_POOL',
    [`  pushRewardOffer(source = 'merge', { tier = null, ids = null, label = null } = {}) {
    const ro = this.gd.rewardOffer();`],
    `  pushRewardOffer(source = 'merge', { tier = null, ids = null, label = null } = {}) {
    // [CUSTOM] 合成奖励的候选忽略共享池库存
    const ignoreLeft = MERGE_REWARD_IGNORES_POOL && source === 'merge';
    const ro = this.gd.rewardOffer();`],

  [ACQ, 'extra: this.diyRollEntries(), ignoreLeft }',
    ['        for (let tt = t; tt >= 1 && !id; tt--) id = this.pool.roll(this.m.rngShop, { tier: tt, filter: fresh, extra: this.diyRollEntries() });'],
    '        for (let tt = t; tt >= 1 && !id; tt--) id = this.pool.roll(this.m.rngShop, { tier: tt, filter: fresh, extra: this.diyRollEntries(), ignoreLeft });'],

  [ACQ, 'piece.rewardFree ? 0 :',
    ['    const extra = Math.max(0, this.gd.goldenCopies - (piece.poolCopies || 0));'],
    `    // [CUSTOM] 合成奖励额外获得的干员不补票（它本来就不占池）
    const extra = piece.rewardFree ? 0 : Math.max(0, this.gd.goldenCopies - (piece.poolCopies || 0));`],
];
const files = [...new Set(EDITS.map((e) => e[0]))];
const buf = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
let applied = 0, skipped = 0;
for (const [f, marker, froms, to] of EDITS) {
  const s = buf.get(f);
  if (s.includes(marker)) { console.log('[已应用] ' + f + ' :: ' + marker); skipped++; continue; }
  const hits = froms.filter((x) => s.split(x).length - 1 === 1);
  if (hits.length !== 1) {
    console.error('[中止] ' + f + ' :: ' + marker + ' -- 匹配到 ' + hits.length + ' 个待替换片段（期望 1）。未写入任何文件。');
    process.exit(1);
  }
  buf.set(f, s.replace(hits[0], to));
  console.log('[改写]   ' + f + ' :: ' + marker);
  applied++;
}
for (const [f, txt] of buf) if (txt !== readFileSync(f, 'utf8')) writeFileSync(f, txt);
console.log('\n新改 ' + applied + ' 处，已是最新 ' + skipped + ' 处\n');
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); console.log('语法 OK  ' + f); }
  catch (e) { console.error('语法失败 ' + f + '\n' + (e.stderr ? e.stderr.toString() : e)); process.exit(1); }
}
console.log('\n完成。下一步：');
console.log('  grep -n "MERGE_REWARD_TAKES_POOL\\|rewardFree" server/match/player/prep.js');
console.log('  grep -n "MERGE_REWARD_IGNORES_POOL\\|ignoreLeft\\|rewardFree" server/match/player/acquire.js');
console.log('  grep -n "ignoreLeft" server/match/pool.js');
console.log('  node tools/matchrun.mjs --mode coop --players 4 --humans 4 --seeds 2 --check --quiet');
