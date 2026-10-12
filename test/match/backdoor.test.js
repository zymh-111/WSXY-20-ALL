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
    hand: [], temp: [],
    gd: {
      maxShopLevel, upgradeBase: () => upgradePrice,
      chess: (id) => ({ id, isDiy: true, diyFor: 'p1' }),
      baseIdOf: (id) => id,
      raw: {
        // 生产路径：data/backups.json 挂在 raw.backups 下（dev.js 的 diyOf 优先读这里）
        backups: {
        diy: {
          ownedPool: ['char_4217_makoto', 'char_112_siege'],
          operators: { char_4217_makoto: { name: '结城理', profession: 'SPECIAL', bonds: ['lateranoShip', 'raidShip'] } },
          slots: { chess_char_6_diy1_a: { tier: 6, shopLevel: 6 } },
        },
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
    rollShop(o) { calls.push(['rollShop', o]); },
    buy(i) { calls.push(['buy', i]); this.hand.push({ id: this.shop.slots[i] && this.shop.slots[i].id }); return { ok: true }; },
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

/**
 * 调用后门并展开 `reply` —— 服务端的成功返回是 `{ ok: true, reply: {...} }`，
 * 因为 server/net.js 只把 `res.reply` 发给客户端（`{ ...res.reply, rid }`）。
 * 返回里若少了 reply，数据会被整个丢掉：客户端 resolve 到的是 `{ t: 'ok', rid }`，
 * 于是 r.enabled/r.funds/r.ops 全是 undefined —— 这正是"点了开关没反应"的原因。
 */
const dev = (lobby, session, msg, ctx) => {
  const r = handleDev(lobby, session, msg, ctx);
  return r && r.ok && r.reply ? { ...r.reply, ok: true } : r;
};

// ── 门禁 ─────────────────────────────────────────────────────────────────────

test('开关：默认关闭；关闭时改状态的操作全被拒；devToggle 可开可关', () => {
  const lobby = fakeLobby();
  assert.equal(dev(lobby, SESSION, { op: 'devStatus' }, LOCAL).enabled, false, '默认关闭');
  assert.equal(dev(lobby, SESSION, { op: 'funds', n: 1 }, LOCAL).error, 'BAD_TARGET', '关闭时 funds 被拒');
  assert.match(dev(lobby, SESSION, { op: 'funds', n: 1 }, LOCAL).detail ?? '', /开关未开启/);

  const on = dev(lobby, SESSION, { op: 'devToggle', on: true }, LOCAL);
  assert.equal(on.enabled, true, '开关打开');
  assert.equal(dev(lobby, SESSION, { op: 'funds', n: 1 }, LOCAL).ok, true, '开启后可用');

  const back = dev(lobby, SESSION, { op: 'devToggle', on: false }, LOCAL);
  assert.equal(back.enabled, false, '再关回去');
  assert.equal(dev(lobby, SESSION, { op: 'funds', n: 1 }, LOCAL).error, 'BAD_TARGET', '关闭后又被拒');
  assert.equal(dev(lobby, SESSION, { op: 'devToggle' }, LOCAL).enabled, true, '不传 on 则取反');
  assert.equal(dev(lobby, SESSION, { op: 'devStatus' }, LOCAL).ok, true, 'devStatus 永远可用');
});

test('来源：默认不再限制本机/内网（未开开关时仍拒）', () => {
  const lobby = fakeLobby();
  const remote = { isLocal: false, ip: '1.2.3.4' };
  assert.match(dev(lobby, SESSION, { op: 'funds', n: 1 }, remote).detail ?? '', /开关未开启/);
  withDev(lobby);
  assert.equal(dev(lobby, SESSION, { op: 'funds', n: 5 }, remote).ok, true, '公网来源在开关开启后可用');
  assert.equal(lobby._ps.funds, 15);
  const st = dev(lobby, SESSION, { op: 'devStatus' }, remote);
  assert.equal(st.fromLocal, false);
  assert.equal(st.ip, '1.2.3.4');
  assert.equal(st.localOnly, false, '默认不限制本机');
});

test('房间：默认只允许 solo（coop 即使开了开关也被拒）', () => {
  const lobby = withDev(fakeLobby({ mode: 'coop' }));
  const res = dev(lobby, SESSION, { op: 'funds', n: 1 }, LOCAL);
  assert.equal(res.error, 'BAD_TARGET');
  assert.match(res.detail ?? '', /solo rooms only/);
});

test('身份：不在房间 / 对局未开始 / 没有自己的座位 都拒绝', () => {
  assert.equal(dev({ roomOf: () => null }, SESSION, { op: 'devStatus' }, LOCAL).error, 'BAD_TARGET');
  assert.equal(dev(withDev(fakeLobby({ started: false })), SESSION, { op: 'funds', n: 1 }, LOCAL).error, 'BAD_TARGET');
  assert.equal(dev(withDev(fakeLobby({ ps: null })), SESSION, { op: 'funds', n: 1 }, LOCAL).error, 'BAD_TARGET');
  assert.equal(dev(withDev(fakeLobby()), { playerId: 'someone-else' }, { op: 'funds', n: 1 }, LOCAL).error, 'BAD_TARGET');
});

test('参数：非法参数（缺整数 / 未知 op）拒绝，且无副作用', () => {
  const lobby = withDev(fakeLobby());
  for (const msg of [{ op: 'funds' }, { op: 'funds', n: 'x' }, { op: 'nope' }, {}]) {
    assert.ok(dev(lobby, SESSION, msg, LOCAL).error, `拒绝 ${JSON.stringify(msg)}`);
  }
  assert.equal(lobby._ps.funds, 10, '没有副作用');
  assert.equal(lobby._ps.calls.length, 0, '没有任何方法被调用');
});

// ── 操作 ─────────────────────────────────────────────────────────────────────

test('state：返回资金 / 商店 / 盟约层数 / 已知盟约 / 自选已选干员', () => {
  const ps = fakePlayer({ funds: 42, shopLevel: 3 });
  ps.layers.egirShip = 7;
  const res = dev(withDev(fakeLobby({ ps })), SESSION, { op: 'state' }, LOCAL);
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
  const res = dev(withDev(fakeLobby({ ps })), SESSION, { op: 'funds', n: 500 }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.added, 500);
  assert.equal(res.funds, 510);
  assert.deepEqual(ps.calls[0], ['addFunds', 500, { reason: 'dev' }]);
});

test('level：升级商店走游戏自己的价格与上限（照常发每级奖励）', () => {
  const ps = fakePlayer({ funds: 100, shopLevel: 1, maxShopLevel: 4, upgradePrice: 4 });
  const res = dev(withDev(fakeLobby({ ps })), SESSION, { op: 'level', n: 5 }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.from, 1);
  assert.equal(res.level, 4, '到上限就停');
  assert.equal(res.stopped, 'MAX_LEVEL');
  assert.equal(ps.funds, 100 - 4 * 3, '按每次升级的价格扣钱');
  assert.equal(ps.calls.filter((c) => c[0] === 'levelUp').length, 3);
});

test('level（宽松版）：跳过阶段检查、钱不够自动补，照样升上去', () => {
  // 旧版 level 会因"非休整期"（_gate → WRONG_PHASE）或钱不够而停下；
  // 按需求放宽后：临时摘掉 _gate，并自动补足升级费。
  const ps = fakePlayer({ funds: 5, shopLevel: 1, maxShopLevel: 6, upgradePrice: 4 });
  const res = dev(withDev(fakeLobby({ ps })), SESSION, { op: 'level', n: 3 }, LOCAL);
  assert.equal(res.level, 4, '升了 3 级（钱是补上的）');
  assert.equal(res.up, 3);
  assert.ok(res.topped > 0, `补了钱（${res.topped}）`);
  assert.equal(res.stopped, null, '没有因为钱不够停下');
  assert.ok(ps.calls.some((c) => c[0] === 'addFunds'), '确实补过钱');
});

test('boost：一键到位（等级拉满 + 刷新商店）', () => {
  const ps = fakePlayer({ funds: 0, shopLevel: 1, maxShopLevel: 6, upgradePrice: 4 });
  const res = dev(withDev(fakeLobby({ ps })), SESSION, { op: 'boost' }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.shopLevel, 6, '等级拉满');
  assert.ok(res.funds >= 9999 - 1000, '钱补到位');
  assert.ok(ps.calls.some((c) => c[0] === 'rollShop'), '刷新了商店（自选干员才会真的上架）');
});

test('pick：塞入后刷新商店（否则货架上还是旧牌）', () => {
  const ps = fakePlayer();
  const res = dev(withDev(fakeLobby({ ps })), SESSION,
    { op: 'pick', slot: 'chess_char_6_diy1_a', charId: 'char_4217_makoto' }, LOCAL);
  assert.equal(res.ok, true);
  assert.ok(ps.calls.some((c) => c[0] === 'rollShop'), '调了 rollShop');
});

test('layers / layersAll：加盟约层数（未激活也能加）', () => {
  const ps = fakePlayer({ bondIds: ['egirShip', 'siracusaShip'] });
  const lobby = withDev(fakeLobby({ ps }));
  const one = dev(lobby, SESSION, { op: 'layers', bondId: 'egirShip', n: 9 }, LOCAL);
  assert.equal(one.layers, 9);
  assert.deepEqual(ps.calls.at(-1), ['addLayers', 'egirShip', 9, { requireActive: false, reason: 'dev' }]);
  const all = dev(lobby, SESSION, { op: 'layersAll', n: 3 }, LOCAL);
  assert.equal(all.count, 2);
  assert.equal(ps.layers.egirShip, 12);
  assert.equal(ps.layers.siracusaShip, 3);
});

test('setLayers：直接设成指定层数（可增可减；设相同值不变）', () => {
  const ps = fakePlayer({ bondIds: ['egirShip'] });
  const lobby = withDev(fakeLobby({ ps }));
  let res = dev(lobby, SESSION, { op: 'setLayers', bondId: 'egirShip', n: 12 }, LOCAL);
  assert.equal(res.from, 0);
  assert.equal(res.to, 12);
  res = dev(lobby, SESSION, { op: 'setLayers', bondId: 'egirShip', n: 3 }, LOCAL);
  assert.equal(res.to, 3, '减到 3 层');
  assert.ok(ps.calls.some((c) => c[0] === 'recompute'), '减层后调了 recompute');
  res = dev(lobby, SESSION, { op: 'setLayers', bondId: 'egirShip', n: 3 }, LOCAL);
  assert.equal(res.to, 3);
  assert.equal(res.capped, false);
  assert.ok(dev(lobby, SESSION, { op: 'setLayers', bondId: 'egirShip', n: -1 }, LOCAL).error);
  assert.ok(dev(lobby, SESSION, { op: 'setLayers', n: 5 }, LOCAL).error);
});

test('refresh：加免费刷新次数', () => {
  const ps = fakePlayer();
  const res = dev(withDev(fakeLobby({ ps })), SESSION, { op: 'refresh' }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(ps.shop.freeRefreshes, 1);
});

test('pick：把自选槽换成指定干员（走 setDiy + 刷新库存）', () => {
  const ps = fakePlayer();
  const lobby = withDev(fakeLobby({ ps }));
  const res = dev(lobby, SESSION,
    { op: 'pick', slot: 'chess_char_6_diy1_a', charId: 'char_4217_makoto', skillIndex: 2 }, LOCAL);
  assert.equal(res.ok, true);
  const call = ps.calls.find((c) => c[0] === 'setDiy');
  assert.deepEqual(call[1].chess_char_6_diy1_a, { charId: 'char_4217_makoto', skillIndex: 2, uniEquipId: null });
  assert.ok(ps.calls.some((c) => c[0] === 'initDiyStock'), '刷新自选库存');
  assert.equal(res.diy.chess_char_6_diy1_a, 'char_4217_makoto');
  assert.equal(dev(lobby, SESSION, { op: 'pick', slot: 'chess_char_6_diy1_a', charId: 'char_999_nope' }, LOCAL).error,
    'BAD_TARGET', '池外干员被拒');
});

test('opPool：返回自选池清单（面板下拉用）', () => {
  const res = dev(withDev(fakeLobby()), SESSION, { op: 'opPool' }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.count, 2);
  assert.equal(res.ops[0].charId, 'char_4217_makoto');
  assert.equal(res.ops[0].name, '结城理');
  assert.deepEqual(res.ops[0].bonds, ['lateranoShip', 'raidShip']);
});

test('ops：返回自选槽清单 + 房间信息与放宽开关状态', () => {
  const res = dev(withDev(fakeLobby()), SESSION, { op: 'ops' }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.ops.room, 'solo');
  assert.ok(res.ops.slots.some((s) => s.slot === 'chess_char_6_diy1_a' && s.tier === 6));
});

// ── 形状契约（防回归）────────────────────────────────────────────────────────

test('形状契约：每个成功返回都必须带 reply，否则 server/net.js 会把数据全部丢弃', () => {
  // server/net.js: `res?.reply ? { ...res.reply, rid } : { t: 'ok', rid }`
  // —— 少一层 reply，客户端就只收到空 ok，所有字段变 undefined。
  const ps = fakePlayer({ bondIds: ['egirShip'] });
  const lobby = withDev(fakeLobby({ ps }));
  const msgs = [
    { op: 'devStatus' }, { op: 'devToggle', on: true }, { op: 'state' }, { op: 'ops' },
    { op: 'funds', n: 1 }, { op: 'level', n: 1 }, { op: 'refresh' },
    { op: 'layers', bondId: 'egirShip', n: 1 }, { op: 'layersAll', n: 1 },
    { op: 'setLayers', bondId: 'egirShip', n: 2 }, { op: 'opPool' },
    { op: 'pick', slot: 'chess_char_6_diy1_a', charId: 'char_4217_makoto' },
    { op: 'give', slot: 'chess_char_6_diy1_a' }, { op: 'boost' },
  ];
  for (const msg of msgs) {
    const r = handleDev(lobby, SESSION, msg, LOCAL);
    assert.equal(r.ok, true, `${msg.op} 应成功`);
    assert.ok(r.reply && typeof r.reply === 'object', `${msg.op} 必须带 reply（否则数据被丢弃）`);
    // 客户端 net.js: `typeof msg.t !== 'string' → return`（整帧丢弃）——reply 里必须带 t
    assert.equal(typeof r.reply.t, 'string', `${msg.op} 的 reply 必须带字符串 t，否则客户端会把整帧丢掉、请求超时`);
  }
});

test('give：直接获取（插 0 价货位 + 走游戏自己的 buy）', () => {
  // 用户要的"直接拿到干员"：不走商店随机、也不用刷等级，
  // 而是把该自选槽做成 0 价货位再调 buy()，手牌/库存/事件都按游戏逻辑走。
  const ps = fakePlayer();
  const lobby = withDev(fakeLobby({ ps }));
  const res = dev(lobby, SESSION, { op: 'give', slot: 'chess_char_6_diy1_a' }, LOCAL);
  assert.equal(res.ok, true);
  const buy = ps.calls.find((c) => c[0] === 'buy');
  assert.ok(buy, '调了游戏自己的 buy()');
  assert.equal(ps.hand.length, 1, '手牌多了一个');
  const slot = ps.shop.slots[buy[1]];
  assert.equal(slot.basePrice, 0, '0 价（等于免费）');
  assert.equal(slot.id, 'chess_char_6_diy1_a', '货位就是那个自选槽');
  dev(lobby, SESSION, { op: 'give', slot: 'chess_char_6_diy1_a' }, LOCAL);
  assert.equal(ps.hand.length, 2, '可以重复获取');
});
