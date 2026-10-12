// test/match/dev-backdoor.test.js — [CUSTOM] 测试后门（server/match/dev.js）的门禁与操作。
//
// 这个后门能改玩家经济，所以最要紧的是"门关得严"。当前门禁（按需求做过调整）：
//   0) **运行时开关**：每个房间 room.devEnabled，**默认关闭**；所有改状态的操作都要求它开着
//      （devToggle / devStatus 不需要）。想开局即开可用 DSH_DEV_DEFAULT_ON=1。
//   1) 来源：**默认不再限制本机/内网**；想收回用 DSH_DEV_LOCAL_ONLY=1。
//   2) 房间：默认只允许 solo；共测用 DSH_DEV_ANY_ROOM=1 放宽。
//   3) 身份：只能作用于调用者自己的座位。
//   4) DSH_DEV_DISABLED=1 则彻底禁用。
// 用假的 lobby / session / PlayerState 直接驱动 handleDev（纯函数，不起服务器）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleDev } from '../../server/match/dev.js';

const SESSION = { playerId: 'p1' };
const LOCAL = { isLocal: true };

/** 假的 PlayerState：只提供后门用到的方法/字段，并记录调用。 */
function fakePlayer({ funds = 10, shopLevel = 1, maxShopLevel = 6, upgradePrice = 4, bondIds = ['egirShip'] } = {}) {
  const calls = [];
  const ps = {
    funds, calls,
    shop: { level: shopLevel, upgradePrice, freeRefreshes: 0, slots: [] },
    layers: {}, bonds: Object.fromEntries(bondIds.map((b) => [b, { active: false, layers: 0 }])),
    diy: { chess_char_6_diy1_a: { charId: 'char_4217_makoto', skillIndex: 0 } },
    standIns: [],
    gd: {
      maxShopLevel, upgradeBase: () => upgradePrice,
      raw: {
        diy: {
          ownedPool: ['char_4217_makoto', 'char_112_siege'],
          operators: { char_4217_makoto: { name: '结城理', profession: 'SPECIAL', bonds: ['lateranoShip', 'raidShip'] } },
          slots: { chess_char_6_diy1_a: { tier: 6, shopLevel: 6 } },
        },
      },
    },
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
    recompute() { calls.push(['recompute']); },
    setDiy(picks) { calls.push(['setDiy', picks]); this.diy = { ...picks }; return true; },
    initDiyStock() { calls.push(['initDiyStock']); },
  };
  return ps;
}

/** 假的房间 / 大厅：lobby._room 就是那个房间，开关状态写在它上面。 */
function fakeLobby({ mode = 'solo', started = true, ps = fakePlayer(), playerId = 'p1', dev = false } = {}) {
  const match = started ? { players: new Map(ps ? [[playerId, ps]] : []), gd: ps?.gd ?? null } : null;
  const room = { mode, match, devEnabled: dev };
  return { roomOf: () => room, _room: room, _ps: ps };
}
/** 打开房间开关（等价于在面板里点「开启后门」）。 */
const withDev = (lobby) => { lobby._room.devEnabled = true; return lobby; };

// ── 门禁 ─────────────────────────────────────────────────────────────────────

test('开关：默认关闭；关闭时改状态的操作全被拒；devToggle 可开可关', () => {
  const lobby = fakeLobby();
  assert.equal(handleDev(lobby, SESSION, { op: 'devStatus' }, LOCAL).enabled, false, '默认关闭');
  assert.equal(handleDev(lobby, SESSION, { op: 'funds', n: 1 }, LOCAL).error, 'BAD_TARGET', '关闭时 funds 被拒');
  assert.match(handleDev(lobby, SESSION, { op: 'funds', n: 1 }, LOCAL).detail ?? '', /开关未开启/);

  const on = handleDev(lobby, SESSION, { op: 'devToggle', on: true }, LOCAL);
  assert.equal(on.enabled, true, '开关打开');
  assert.equal(handleDev(lobby, SESSION, { op: 'funds', n: 1 }, LOCAL).ok, true, '开启后可用');

  const back = handleDev(lobby, SESSION, { op: 'devToggle', on: false }, LOCAL);
  assert.equal(back.enabled, false, '再关回去');
  assert.equal(handleDev(lobby, SESSION, { op: 'funds', n: 1 }, LOCAL).error, 'BAD_TARGET', '关闭后又被拒');
  assert.equal(handleDev(lobby, SESSION, { op: 'devToggle' }, LOCAL).enabled, true, '不传 on 则取反');
  assert.equal(handleDev(lobby, SESSION, { op: 'devStatus' }, LOCAL).ok, true, 'devStatus 永远可用');
});

test('来源：默认不再限制本机/内网（未开开关时仍拒）', () => {
  const lobby = fakeLobby();
  const remote = { isLocal: false, ip: '1.2.3.4' };
  assert.match(handleDev(lobby, SESSION, { op: 'funds', n: 1 }, remote).detail ?? '', /开关未开启/);
  withDev(lobby);
  assert.equal(handleDev(lobby, SESSION, { op: 'funds', n: 5 }, remote).ok, true, '公网来源在开关开启后可用');
  assert.equal(lobby._ps.funds, 15);
  const st = handleDev(lobby, SESSION, { op: 'devStatus' }, remote);
  assert.equal(st.fromLocal, false);
  assert.equal(st.ip, '1.2.3.4');
  assert.equal(st.localOnly, false, '默认不限制本机');
});

test('房间：默认只允许 solo（coop 即使开了开关也被拒）', () => {
  const lobby = withDev(fakeLobby({ mode: 'coop' }));
  const res = handleDev(lobby, SESSION, { op: 'funds', n: 1 }, LOCAL);
  assert.equal(res.error, 'BAD_TARGET');
  assert.match(res.detail ?? '', /solo rooms only/);
});

test('身份：不在房间 / 对局未开始 / 没有自己的座位 都拒绝', () => {
  assert.equal(handleDev({ roomOf: () => null }, SESSION, { op: 'devStatus' }, LOCAL).error, 'BAD_TARGET');
  assert.equal(handleDev(withDev(fakeLobby({ started: false })), SESSION, { op: 'funds', n: 1 }, LOCAL).error, 'BAD_TARGET');
  assert.equal(handleDev(withDev(fakeLobby({ ps: null })), SESSION, { op: 'funds', n: 1 }, LOCAL).error, 'BAD_TARGET');
  assert.equal(handleDev(withDev(fakeLobby()), { playerId: 'someone-else' }, { op: 'funds', n: 1 }, LOCAL).error, 'BAD_TARGET');
});

test('参数：非法参数（缺整数 / 未知 op）拒绝，且无副作用', () => {
  const lobby = withDev(fakeLobby());
  for (const msg of [{ op: 'funds' }, { op: 'funds', n: 'x' }, { op: 'nope' }, {}]) {
    assert.ok(handleDev(lobby, SESSION, msg, LOCAL).error, `拒绝 ${JSON.stringify(msg)}`);
  }
  assert.equal(lobby._ps.funds, 10, '没有副作用');
  assert.equal(lobby._ps.calls.length, 0, '没有任何方法被调用');
});

// ── 操作 ─────────────────────────────────────────────────────────────────────

test('state：返回资金 / 商店 / 盟约层数 / 已知盟约 / 自选已选干员', () => {
  const ps = fakePlayer({ funds: 42, shopLevel: 3 });
  ps.layers.egirShip = 7;
  const res = handleDev(withDev(fakeLobby({ ps })), SESSION, { op: 'state' }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.funds, 42);
  assert.equal(res.shopLevel, 3);
  assert.equal(res.maxShopLevel, 6);
  assert.deepEqual(res.layers, { egirShip: 7 });
  assert.ok(Array.isArray(res.knownBonds) && res.knownBonds.includes('egirShip'), '给出已知盟约');
  assert.equal(res.diy.chess_char_6_diy1_a, 'char_4217_makoto');
});

test('funds：加资金（走游戏自己的 addFunds）', () => {
  const ps = fakePlayer({ funds: 10 });
  const res = handleDev(withDev(fakeLobby({ ps })), SESSION, { op: 'funds', n: 500 }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.added, 500);
  assert.equal(res.funds, 510);
  assert.deepEqual(ps.calls[0], ['addFunds', 500, { reason: 'dev' }]);
});

test('level：升级商店走游戏自己的价格与上限（照常发每级奖励）', () => {
  const ps = fakePlayer({ funds: 100, shopLevel: 1, maxShopLevel: 4, upgradePrice: 4 });
  const res = handleDev(withDev(fakeLobby({ ps })), SESSION, { op: 'level', n: 5 }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.from, 1);
  assert.equal(res.level, 4, '到上限就停');
  assert.equal(res.stopped, 'MAX_LEVEL');
  assert.equal(ps.funds, 100 - 4 * 3, '按每次升级的价格扣钱');
  assert.equal(ps.calls.filter((c) => c[0] === 'levelUp').length, 3);
});

test('level：钱不够时停下并报 NO_FUNDS（不静默加等级）', () => {
  const ps = fakePlayer({ funds: 5, shopLevel: 1, maxShopLevel: 6, upgradePrice: 4 });
  const res = handleDev(withDev(fakeLobby({ ps })), SESSION, { op: 'level', n: 3 }, LOCAL);
  assert.equal(res.level, 2, '只升得起一级');
  assert.equal(res.stopped, 'NO_FUNDS');
  assert.equal(ps.funds, 1);
});

test('layers / layersAll：加盟约层数（未激活也能加）', () => {
  const ps = fakePlayer({ bondIds: ['egirShip', 'siracusaShip'] });
  const lobby = withDev(fakeLobby({ ps }));
  const one = handleDev(lobby, SESSION, { op: 'layers', bondId: 'egirShip', n: 9 }, LOCAL);
  assert.equal(one.layers, 9);
  assert.deepEqual(ps.calls.at(-1), ['addLayers', 'egirShip', 9, { requireActive: false, reason: 'dev' }]);
  const all = handleDev(lobby, SESSION, { op: 'layersAll', n: 3 }, LOCAL);
  assert.equal(all.count, 2);
  assert.equal(ps.layers.egirShip, 12);
  assert.equal(ps.layers.siracusaShip, 3);
});

test('setLayers：直接设成指定层数（可增可减；设相同值不变）', () => {
  const ps = fakePlayer({ bondIds: ['egirShip'] });
  const lobby = withDev(fakeLobby({ ps }));
  let res = handleDev(lobby, SESSION, { op: 'setLayers', bondId: 'egirShip', n: 12 }, LOCAL);
  assert.equal(res.from, 0);
  assert.equal(res.to, 12);
  res = handleDev(lobby, SESSION, { op: 'setLayers', bondId: 'egirShip', n: 3 }, LOCAL);
  assert.equal(res.to, 3, '减到 3 层');
  assert.ok(ps.calls.some((c) => c[0] === 'recompute'), '减层后调了 recompute');
  res = handleDev(lobby, SESSION, { op: 'setLayers', bondId: 'egirShip', n: 3 }, LOCAL);
  assert.equal(res.to, 3);
  assert.equal(res.capped, false);
  assert.ok(handleDev(lobby, SESSION, { op: 'setLayers', bondId: 'egirShip', n: -1 }, LOCAL).error);
  assert.ok(handleDev(lobby, SESSION, { op: 'setLayers', n: 5 }, LOCAL).error);
});

test('refresh：加免费刷新次数', () => {
  const ps = fakePlayer();
  const res = handleDev(withDev(fakeLobby({ ps })), SESSION, { op: 'refresh' }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(ps.shop.freeRefreshes, 1);
});

test('pick：把自选槽换成指定干员（走 setDiy + 刷新库存）', () => {
  const ps = fakePlayer();
  const lobby = withDev(fakeLobby({ ps }));
  const res = handleDev(lobby, SESSION,
    { op: 'pick', slot: 'chess_char_6_diy1_a', charId: 'char_4217_makoto', skillIndex: 2 }, LOCAL);
  assert.equal(res.ok, true);
  const call = ps.calls.find((c) => c[0] === 'setDiy');
  assert.deepEqual(call[1].chess_char_6_diy1_a, { charId: 'char_4217_makoto', skillIndex: 2, uniEquipId: null });
  assert.ok(ps.calls.some((c) => c[0] === 'initDiyStock'), '刷新自选库存');
  assert.equal(res.diy.chess_char_6_diy1_a, 'char_4217_makoto');
  assert.equal(handleDev(lobby, SESSION, { op: 'pick', slot: 'chess_char_6_diy1_a', charId: 'char_999_nope' }, LOCAL).error,
    'BAD_TARGET', '池外干员被拒');
});

test('opPool：返回自选池清单（面板下拉用）', () => {
  const res = handleDev(withDev(fakeLobby()), SESSION, { op: 'opPool' }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.count, 2);
  assert.equal(res.ops[0].charId, 'char_4217_makoto');
  assert.equal(res.ops[0].name, '结城理');
  assert.deepEqual(res.ops[0].bonds, ['lateranoShip', 'raidShip']);
});

test('ops：返回自选槽清单 + 房间信息与放宽开关状态', () => {
  const res = handleDev(withDev(fakeLobby()), SESSION, { op: 'ops' }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.ops.room, 'solo');
  assert.ok(res.ops.slots.some((s) => s.slot === 'chess_char_6_diy1_a' && s.tier === 6));
});
