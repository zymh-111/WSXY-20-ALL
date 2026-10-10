#!/usr/bin/env node
// [CUSTOM] 联防：时限随兜怪人数增长 + 刷怪间隔随人数缩短。幂等；也能把旧版（+25% / -10%）升级到本版。
// 运行： node tools/apply-unite-time-patch.mjs
// 人数 H = 本回合参与联防的助手总数（已上场 + 本波 + 候补）
// 时限   = 回合作战时限 x 1.2^(H-2)，最多 300 现实秒（内部游戏秒 = x2）
// 间隔   = 官方间隔 x 0.95^(H-2)，最多 -40%
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PHASE = 'server/match/match/unitePhase.js';
const UNITE = 'server/match/unite.js';
const WAVES = 'server/match/waves.js';

// [文件, 已应用标记, [待替换片段...], 替换为, 可选(匹配不到就跳过)]
const EDITS = [
  // 旧版升级（只在你之前跑过 +25%/-10% 那版时才生效）
  [PHASE, 'const UNITE_TIME_FACTOR = 1.2;',
    ['const UNITE_TIME_STEP = 0.25;\nconst UNITE_TIME_MAX = 3;'],
    'const UNITE_TIME_FACTOR = 1.2;\nconst UNITE_TIME_MAX_SECONDS = 300;', true],

  [PHASE, 'const capGame = UNITE_TIME_MAX_SECONDS',
    ['    const scale = Math.min(UNITE_TIME_MAX, 1 + UNITE_TIME_STEP * Math.max(0, h - 2));\n    return { base, h, scale, limit: Math.round(base * scale) };'],
    '    const scale = Math.pow(UNITE_TIME_FACTOR, Math.max(0, h - 2));\n    const capGame = UNITE_TIME_MAX_SECONDS * (this.gameSpeed || 2);\n    const limit = Math.min(Math.round(base * scale), Math.round(capGame));\n    return { base, h, scale, limit };', true],

  [WAVES, 'const UNITE_HELPER_INTERVAL_STEP = 0.05;',
    ['const UNITE_HELPER_INTERVAL_STEP = 0.10;'],
    'const UNITE_HELPER_INTERVAL_STEP = 0.05;', true],

  // 全新安装
  [PHASE, 'const UNITE_TIME_FACTOR = 1.2;',
    ['export class MatchUnite {'],
    `/** [CUSTOM] 联防时限：2 人兜怪 = 回合作战时限（基准）；每多 1 名兜怪者 x1.2，最多 UNITE_TIME_MAX_SECONDS 现实秒。 */
const UNITE_TIME_FACTOR = 1.2;
const UNITE_TIME_MAX_SECONDS = 300;

export class MatchUnite {
  /** [CUSTOM] 本回合参与联防的助手总数（已上场 + 本波 + 候补）。 */
  uniteHelperCount(plan) {
    const n = (arr) => (Array.isArray(arr) ? arr.length : 0);
    return Math.max(1, n(plan && plan.usedHelpers) + n(plan && plan.helpers) + n(plan && plan.reserveHelpers));
  }

  /** [CUSTOM] 联防时限 = 本回合作战时限 x 1.2^(H-2)，最多 300 现实秒。 */
  uniteTimeLimitOf(plan) {
    const base = this.wave ? this.wave.timeLimit : 60;
    const h = this.uniteHelperCount(plan);
    const scale = Math.pow(UNITE_TIME_FACTOR, Math.max(0, h - 2));
    const capGame = UNITE_TIME_MAX_SECONDS * (this.gameSpeed || 2);
    const limit = Math.min(Math.round(base * scale), Math.round(capGame));
    return { base, h, scale, limit };
  }`],

  [PHASE, '{ limit } = this.uniteTimeLimitOf(plan);\n    const battle = this.newBattle',
    ['    const limit = this.wave ? this.wave.timeLimit : 60;\n    const battle = this.newBattle(this._uniteOpts(plan, limit));'],
    '    const { limit } = this.uniteTimeLimitOf(plan);\n    const battle = this.newBattle(this._uniteOpts(plan, limit));'],

  [PHASE, '{ limit } = this.uniteTimeLimitOf(plan);\n    const f = this._ccField',
    ['    const limit = this.wave ? this.wave.timeLimit : 60;\n    const f = this._ccField({ fieldId: \'u\', kind: \'unite\', players: plan.helpers.map((p) => p.playerId), opts: this._uniteOpts(plan, limit) });'],
    '    const { limit } = this.uniteTimeLimitOf(plan);\n    const f = this._ccField({ fieldId: \'u\', kind: \'unite\', players: plan.helpers.map((p) => p.playerId), opts: this._uniteOpts(plan, limit) });'],

  [UNITE, 'const helperTotal = ',
    ['  const wave = buildUniteWave(m.gd, plan.leaked, plan.helpers.length, timeLimit);'],
    `  // [CUSTOM] 本回合参与联防的助手总数（已上场 + 本波 + 候补）-> 刷怪间隔系数
  const helperTotal = (Array.isArray(plan.usedHelpers) ? plan.usedHelpers.length : 0)
    + plan.helpers.length + (Array.isArray(plan.reserveHelpers) ? plan.reserveHelpers.length : 0);
  const wave = buildUniteWave(m.gd, plan.leaked, plan.helpers.length, timeLimit, helperTotal);`],

  [WAVES, 'const UNITE_HELPER_INTERVAL_STEP = 0.05;',
    ['export function buildUniteWave(gd, leaked, helperCount, timeLimit) {'],
    `/** [CUSTOM] 联防刷怪间隔：每多 1 名兜怪者 -5%，最多 -40%。helperTotal = 本回合参与联防的助手总数。 */
const UNITE_HELPER_INTERVAL_STEP = 0.05;
const UNITE_HELPER_INTERVAL_MIN = 0.6;

export function buildUniteWave(gd, leaked, helperCount, timeLimit, helperTotal = helperCount) {
  // [CUSTOM] 间隔系数（2 人 = 1.0）
  const helperIntervalScale = Math.max(UNITE_HELPER_INTERVAL_MIN, Math.pow(1 - UNITE_HELPER_INTERVAL_STEP, Math.max(0, helperTotal - 2)));`],

  [WAVES, 'helperIntervalScale * Math.min(',
    ['const step = Math.min(Math.max(window / most, MIN_ACTION_INTERVAL_RATIO * window), UNITE_MAX_UNIT_STEP);'],
    'const step = helperIntervalScale * Math.min(Math.max(window / most, MIN_ACTION_INTERVAL_RATIO * window), UNITE_MAX_UNIT_STEP);'],

  [WAVES, 'UNITE_OWNER_STEP * helperIntervalScale',
    ['const start = t0 + k * UNITE_OWNER_STEP;'],
    'const start = t0 + k * UNITE_OWNER_STEP * helperIntervalScale;'],
];

const files = [...new Set(EDITS.map((e) => e[0]))];
const buf = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
let applied = 0, skipped = 0, nouse = 0;
for (const [f, marker, froms, to, optional] of EDITS) {
  const s = buf.get(f);
  if (s.includes(marker)) { console.log('[已应用] ' + f + ' :: ' + marker); skipped++; continue; }
  const hits = froms.filter((x) => s.split(x).length - 1 === 1);
  if (hits.length !== 1) {
    if (optional && hits.length === 0) { console.log('[跳过]   ' + f + ' :: ' + marker + '（不适用）'); nouse++; continue; }
    console.error('[中止] ' + f + ' :: ' + marker + ' -- 匹配到 ' + hits.length + ' 个待替换片段（期望 1）。未写入任何文件。');
    process.exit(1);
  }
  buf.set(f, s.replace(hits[0], to));
  console.log('[改写]   ' + f + ' :: ' + marker);
  applied++;
}
for (const [f, txt] of buf) if (txt !== readFileSync(f, 'utf8')) writeFileSync(f, txt);
console.log('\n新改 ' + applied + ' 处，已是最新 ' + skipped + ' 处，不适用 ' + nouse + ' 处\n');
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); console.log('语法 OK  ' + f); }
  catch (e) { console.error('语法失败 ' + f + '\n' + (e.stderr ? e.stderr.toString() : e)); process.exit(1); }
}
console.log('\n完成。下一步：');
console.log('  node tools/matchrun.mjs --mode coop --players 8 --humans 8 --seeds 2 --check --quiet');
console.log('  git add server/match/match/unitePhase.js server/match/unite.js server/match/waves.js tools/apply-unite-time-patch.mjs');
console.log('  git commit -m "联防时限 1.2^(H-2) 封顶 300s、刷怪间隔 -5%/人"');
console.log('  git push origin main');
console.log('  sudo systemctl restart stronghold');
