// 真实数据接线测试：后门加的悬赏（ps.bounties 的卡片形状）经游戏自己的 withBounties()
// 是否真的进入下一波的生成列表、并在预告里带上 source:'bounty'。
// 这就是后门"加悬赏怪"最终能不能出现在场上的关键一环（探针无法走完整局协议，故用这层验证）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '/opt/stronghold/server/data.js';
import { GameData } from '/opt/stronghold/server/match/gamedata.js';
import { buildNormalWave, withBounties, previewOf } from '/opt/stronghold/server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';

const DATA = getData({ log: { info() {}, warn() {}, error() {} } });
const KEY = 'enemy_1001_bigbo';

test('后门加了悬赏 → withBounties 把它并进下一波，预告里出现 source:bounty', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  const round = 3;
  const wave = buildNormalWave(gd, createRng(7), ['TIMES', 'INVISIBLE', 'FLY'], round);
  // 后门的 bounty op 产出的就是这种 ps.bounties 元素（Match.addBounty 的返回形状）
  const bounties = [{ id: 'dev:1', card: { enemyKey: KEY, count: 2, coin: 5, payout: 'kill' }, roundsLeft: 1 }];
  const spawns = withBounties(gd, round, wave, bounties, 'p1');

  const b = spawns.filter((s) => s && s.tag === 'bounty' && s.enemyKey === KEY);
  assert.ok(b.length >= 1, `生成列表里有悬赏怪（${b.length} 条）`);
  assert.equal(b.reduce((n, s) => n + s.count, 0), 2, '数量 ×2 保留');
  assert.ok(b[0].mods && b[0].mods.bountyId === 'dev:1', '带上 bountyId（结算赏金要用）');

  const pv = previewOf(spawns).filter((x) => x.source === 'bounty');
  assert.ok(pv.length >= 1, '预告里有悬赏行');
  assert.equal(pv[0].enemyKey, KEY, '预告里的就是它');

  // 对照：不加悬赏时，生成列表里没有 tag:bounty
  const plain = withBounties(gd, round, wave, [], 'p1');
  assert.equal(plain.filter((s) => s && s.tag === 'bounty').length, 0, '不加就没有悬赏怪');
});
