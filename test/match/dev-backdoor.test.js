// test/match/dev-backdoor.test.js — [CUSTOM] 测试后门（server/match/dev.js）的**安全边界**与操作。
//
// 这个后门能改玩家经济，所以最要紧的是"门关得严"：
//   1) 非本机/内网来源一律拒绝（否则等于公网开挂）
//   2) 非 solo 房间一律拒绝（不能污染多人对局）
//   3) 拿不到自己的 PlayerState 就拒绝
// 用假的 lobby / session / PlayerState 直接驱动 handleDev —— 它是纯函数，可以不起服务器。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleDev } from '../../server/match/dev.js';

/** 假的 PlayerState：只提供后门用到的那几个方法，并记录调用。 */
function fakePlayer({ funds = 10, shopLevel = 1, maxShopLevel = 6, upgradePrice = 4, bondIds = ['egirShip'] } = {}) {
  const calls = [];
  const ps = {
    funds, calls,
    shop: { level: shopLevel, upgradePrice, freeRefreshes: 0, slots: [] },
    layers: {}, bonds: Object.fromEntries(bondIds.map((b) => [b, { active: false, layers: 0 }])),
    diy: { chess_char_6_diy1_a: { charId: 'char_4217_makoto', skillIndex: 0 } },
    standIns: [],
    gd: { maxShopLevel, upgradeBase: () => upgradePrice },
    addFunds(n, opts) { calls.push(['addFunds', n, opts]); this.funds += n; return n; },
    levelUp() {
      if (this.shop.level >= maxShopLevel) return { error: 'MAX_LEVEL' };
      if (this.funds < upgradePrice) return { error: 'NO_FUNDS' };
      this.funds -= upgradePrice;
      this.shop.level++;
      calls.push(['levelUp', this.shop.level]);
      return { ok: true };
    },
    addLayers(bondId, n, opts) {
      calls.push(['addLayers', bondId, n, opts]);
      this.layers[bondId] = (this.layers[bondId] ?? 0) + n;
      return n;
    },
    dirty() { calls.push(['dirty']); },
  };
  return ps;
}

/** 假的房间 / 大厅 / 会话。 */
function fakeLobby({ mode = 'solo', started = true, ps = fakePlayer(), playerId = 'p1' } = {}) {
  const match = started ? { players: new Map(ps ? [[playerId, ps]] : []) } : null;
  const room = { mode, match };
  return { roomOf: () => room, _room: room, _ps: ps };
}
const session = { playerId: 'p1' };

// ── 安全边界 ────────────────────────────────────────────────────────────────

test('门禁：非本机/内网来源一律拒绝', () => {
  const lobby = fakeLobby();
  const res = handleDev(lobby, session, { op: 'funds', n: 999 }, { isLocal: false });
  assert.equal(res.error, 'BAD_TARGET', '公网来源被拒');
  assert.equal(lobby._ps.funds, 10, '资金没被动过');
  // 连读状态也拒绝（不泄露服务器内部信息）
  assert.equal(handleDev(lobby, session, { op: 'state' }, { isLocal: false }).error, 'BAD_TARGET');
  // 缺省 ctx 同样按"非本机"处理（失败要关闭，不能默认放行）
  assert.equal(handleDev(lobby, session, { op: 'funds', n: 1 }, undefined).error, 'BAD_TARGET');
});

test('门禁：只有 solo 单人房可用（多人房拒绝）', () => {
  for (const mode of ['coop', 'multi', 'funny']) {
    const lobby = fakeLobby({ mode });
    const res = handleDev(lobby, session, { op: 'funds', n: 999 }, { isLocal: true });
    assert.equal(res.error, 'BAD_TARGET', `${mode} 房被拒`);
    assert.equal(lobby._ps.funds, 10, `${mode} 房资金没被动过`);
  }
});

test('门禁：不在房间 / 对局未开始 / 没有自己的 PlayerState 都拒绝', () => {
  const noRoom = { roomOf: () => null };
  assert.equal(handleDev(noRoom, session, { op: 'funds', n: 1 }, { isLocal: true }).error, 'BAD_TARGET');

  const notStarted = fakeLobby({ started: false });
  assert.equal(handleDev(notStarted, session, { op: 'funds', n: 1 }, { isLocal: true }).error, 'BAD_TARGET');

  const noPs = fakeLobby({ ps: null });
  assert.equal(handleDev(noPs, session, { op: 'funds', n: 1 }, { isLocal: true }).error, 'BAD_TARGET');

  // 别人的座位：session.playerId 不在 match.players 里 → 拒绝
  const other = fakeLobby();
  assert.equal(handleDev(other, { playerId: 'someone-else' }, { op: 'funds', n: 1 }, { isLocal: true }).error, 'BAD_TARGET');
});

test('门禁：参数非法（缺整数 / 未知 op）拒绝，且不产生副作用', () => {
  const lobby = fakeLobby();
  for (const msg of [{ op: 'funds' }, { op: 'funds', n: 'x' }, { op: 'funds', n: 1.5e400 }, { op: 'nope' }, {}]) {
    const res = handleDev(lobby, session, msg, { isLocal: true });
    assert.ok(res.error, `拒绝 ${JSON.stringify(msg)}`);
  }
  assert.equal(lobby._ps.funds, 10, '没有副作用');
  assert.equal(lobby._ps.calls.length, 0, '没有任何方法被调用');
});

// ── 正常功能（本机 + solo）──────────────────────────────────────────────────

test('state：返回自己的资金 / 商店 / 盟约层数 / 自选已选干员', () => {
  const ps = fakePlayer({ funds: 42, shopLevel: 3 });
  ps.layers.egirShip = 7;
  const res = handleDev(fakeLobby({ ps }), session, { op: 'state' }, { isLocal: true });
  assert.equal(res.ok, true);
  assert.equal(res.funds, 42);
  assert.equal(res.shopLevel, 3);
  assert.equal(res.maxShopLevel, 6);
  assert.deepEqual(res.layers, { egirShip: 7 });
  assert.equal(res.diy.chess_char_6_diy1_a, 'char_4217_makoto', '能看到自选槽里选的是他');
});

test('funds：加资金（这正是"免抽卡"要的）', () => {
  const ps = fakePlayer({ funds: 10 });
  const res = handleDev(fakeLobby({ ps }), session, { op: 'funds', n: 500 }, { isLocal: true });
  assert.equal(res.ok, true);
  assert.equal(res.added, 500);
  assert.equal(res.funds, 510);
  assert.deepEqual(ps.calls[0], ['addFunds', 500, { reason: 'dev' }], '走的是游戏自己的 addFunds');
});

test('level：升级商店走游戏自己的价格与上限（照常发每级奖励）', () => {
  const ps = fakePlayer({ funds: 100, shopLevel: 1, maxShopLevel: 4, upgradePrice: 4 });
  const res = handleDev(fakeLobby({ ps }), session, { op: 'level', n: 5 }, { isLocal: true });
  assert.equal(res.ok, true);
  assert.equal(res.from, 1);
  assert.equal(res.level, 4, '到上限就停');
  assert.equal(res.stopped, 'MAX_LEVEL', '并报告停下的原因');
  assert.equal(ps.funds, 100 - 4 * 3, '按每次升级的价格扣钱');
  assert.equal(ps.calls.filter((c) => c[0] === 'levelUp').length, 3, '调了 3 次 levelUp');
});

test('level：钱不够时停下并报 NO_FUNDS（不静默加等级）', () => {
  const ps = fakePlayer({ funds: 5, shopLevel: 1, maxShopLevel: 6, upgradePrice: 4 });
  const res = handleDev(fakeLobby({ ps }), session, { op: 'level', n: 3 }, { isLocal: true });
  assert.equal(res.level, 2, '只升得起一级');
  assert.equal(res.stopped, 'NO_FUNDS');
  assert.equal(ps.funds, 1);
});

test('layers / layersAll：加盟约层数（未激活也能加，用 requireActive:false）', () => {
  const ps = fakePlayer({ bondIds: ['egirShip', 'siracusaShip'] });
  const one = handleDev(fakeLobby({ ps }), session, { op: 'layers', bondId: 'egirShip', n: 9 }, { isLocal: true });
  assert.equal(one.ok, true);
  assert.equal(one.layers, 9);
  assert.deepEqual(ps.calls.at(-1), ['addLayers', 'egirShip', 9, { requireActive: false, reason: 'dev' }]);

  const all = handleDev(fakeLobby({ ps }), session, { op: 'layersAll', n: 3 }, { isLocal: true });
  assert.equal(all.ok, true);
  assert.equal(all.count, 2);
  assert.equal(ps.layers.egirShip, 12);
  assert.equal(ps.layers.siracusaShip, 3);
});

test('refresh：加免费刷新次数', () => {
  const ps = fakePlayer();
  const res = handleDev(fakeLobby({ ps }), session, { op: 'refresh' }, { isLocal: true });
  assert.equal(res.ok, true);
  assert.equal(ps.shop.freeRefreshes, 1);
});
