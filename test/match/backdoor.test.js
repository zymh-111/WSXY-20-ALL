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
    bounties: [],
    gd: {
      maxShopLevel, upgradeBase: () => upgradePrice,
      chess: (id) => ({ id, isDiy: true, diyFor: 'p1' }),
      enemy: (key) => (key === 'enemy_dummy' ? { key, name: '假人' } : null),
      baseIdOf: (id) => id,
      raw: {
        // 生产路径：data/backups.json 挂在 raw.backups 下（dev.js 的 diyOf 优先读这里）
        // 阵容棋子表（give 的 roster 分支读它）
        chess: { chess_char_1_01_a: { charId: 'char_498_inside', name: '隐现', tier: 1, profession: 'SNIPER' } },
        // 敌人表（bounty / enemies 两个 op 读它）
        enemies: { enemy_dummy: { name: '假人', rank: 'NORMAL' } },
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
    acquireChess(id, o) {
      calls.push(['acquireChess', id, o]);
      const piece = { uid: 'u' + (this.hand.filter(Boolean).length + this.temp.filter(Boolean).length + 1), id };
      // 与游戏一致：先手牌，满了进整备区(temp)
      if (this.hand.filter(Boolean).length < 5) this.hand.push(piece); else this.temp.push(piece);
      return piece;
    },
  };
  return ps;
}

/** 假的房间 / 大厅：lobby._room 就是那个房间，开关状态写在它上面。 */
function fakeLobby({ mode = 'solo', started = true, ps = fakePlayer(), playerId = 'p1', dev = false } = {}) {
  const match = started ? {
    players: new Map(ps ? [[playerId, ps]] : []), gd: ps?.gd ?? null,
    // 模拟游戏自己的 Match.addBounty：校验敌人、生成 id、push 进 ps.bounties
    addBounty: (p, card) => {
      if (!p || !card || !p.gd.enemy(card.enemyKey)) return null;
      const b = { id: `bounty:${p.bounties.length + 1}`, card: { ...card }, roundsLeft: 1 };
      p.bounties.push(b);
      p.calls.push(['addBounty', card.enemyKey, card.count, card.coin]);
      return b.id;
    },
  } : null;
  const seat = { playerId, diy: {} };
  const room = { mode, match, devEnabled: dev, seatOf: (id) => (id === playerId ? seat : null), _seat: seat };
  const session = { playerId };
  return {
    roomOf: () => room, _room: room, _ps: ps, _seat: seat,
    // 模拟大厅的 room.diy：校验后存到 session 与座位
    diy: (s, { picks }) => { s.diy = picks; seat.diy = picks; return { ok: true }; },
    _session: session,
  };
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

test('opPool：返回【自选】与【阵容】两组干员（面板下拉用）', () => {
  const res = dev(withDev(fakeLobby()), SESSION, { op: 'opPool' }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.diyCount, 2, '自选池 2 人');
  assert.equal(res.rosterCount, 1, '阵容 1 人');
  assert.equal(res.count, 3);
  assert.equal(res.diy[0].charId, 'char_4217_makoto');
  assert.equal(res.diy[0].name, '结城理');
  assert.equal(res.diy[0].kind, 'diy');
  assert.equal(res.roster[0].id, 'chess_char_1_01_a', '阵容给的是棋子 id');
  assert.equal(res.roster[0].kind, 'roster');
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
    { op: 'give', charId: 'chess_char_1_01_a' }, { op: 'boost' },
    { op: 'enemies' }, { op: 'bounty', enemyKey: 'enemy_dummy' }, { op: 'unbounty' },
  ];
  for (const msg of msgs) {
    const r = handleDev(lobby, SESSION, msg, LOCAL);
    assert.equal(r.ok, true, `${msg.op} 应成功`);
    assert.ok(r.reply && typeof r.reply === 'object', `${msg.op} 必须带 reply（否则数据被丢弃）`);
    // 客户端 net.js: `typeof msg.t !== 'string' → return`（整帧丢弃）——reply 里必须带 t
    assert.equal(typeof r.reply.t, 'string', `${msg.op} 的 reply 必须带字符串 t，否则客户端会把整帧丢掉、请求超时`);
  }
});

test('give【阵容】：给一个 chess_* 就直接进手牌（不碰自选槽）', () => {
  const ps = fakePlayer();
  const lobby = withDev(fakeLobby({ ps }));
  const res = dev(lobby, SESSION, { op: 'give', charId: 'chess_char_1_01_a' }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'roster');
  const call = ps.calls.find((c) => c[0] === 'acquireChess');
  assert.equal(call[1], 'chess_char_1_01_a', '拿的就是那个阵容棋子');
  assert.equal(ps.hand.length, 1, '手牌多了一个');
});

test('give【自选】：自动塞好槽位再发到手里（用户要的"直接给我"）', () => {
  const ps = fakePlayer();
  const lobby = withDev(fakeLobby({ ps }));
  // 没塞过 → 它应当自己先 setDiy，再 acquireChess(槽位)
  // 假对象里默认那个槽位装的是 char_4217_makoto；这里要一个**没塞过**的干员
  // （char_112_siege 在 ownedPool 里），才能验证 give 自己会先塞好。
  const res = dev(lobby, SESSION, { op: 'give', charId: 'char_112_siege', slot: 'chess_char_6_diy1_a' }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'diy');
  assert.ok(ps.calls.some((c) => c[0] === 'setDiy'), '自己先塞好了');
  const call = ps.calls.find((c) => c[0] === 'acquireChess');
  assert.equal(call[1], 'chess_char_6_diy1_a', '给的是槽位棋子');
  assert.equal(ps.hand.length, 1, '手牌多了一个');
  // 手牌塞满 5 个后继续给 → 落整备区，不失败
  for (let i = 0; i < 6; i++) dev(lobby, SESSION, { op: 'give', charId: 'char_112_siege', slot: 'chess_char_6_diy1_a' }, LOCAL);
  assert.ok(ps.hand.filter(Boolean).length <= 5, '手牌不超过容量');
  assert.ok(ps.temp.filter(Boolean).length >= 1, `溢出的进了整备区（${ps.temp.filter(Boolean).length}）`);
});

test('pick 在【对局开始前】也能用：写房间座位（开局时 setDiy(seat.diy) 会生效）', () => {
  // 这条顺序很关键：客户端渲染自选件靠它自己那份 m.private.diy 合成干员身体，
  // 而那份 picks 来自开局时的 seat.diy。若只在局中改 ps.diy，
  // 客户端学不到 pick → 合成不出人 → 界面显示"甄选干员"空模板。
  const ps = fakePlayer();
  const lobby = withDev(fakeLobby({ started: false, ps }));
  const res = dev(lobby, SESSION, { op: 'pick', slot: 'chess_char_6_diy1_a', charId: 'char_4217_makoto', skillIndex: 2 }, LOCAL);
  assert.equal(res.ok, true, '对局未开始也接受');
  assert.equal(res.pendingMatch, true, '标记为"开局时生效"');
  assert.deepEqual(lobby._seat.diy.chess_char_6_diy1_a,
    { charId: 'char_4217_makoto', skillIndex: 2, uniEquipId: null }, '写进了房间座位');
});

test('pick 未指定技能时【沿用】该槽位原有的 skillIndex（不能默认写成 S1）', () => {
  // 结城理 S1 的替身是俄耳甫斯、S2 是塔纳托斯、S3 是塔纳托斯→俄耳甫斯。
  // 若后门把用户选好的 S3 顺手写成 S1，表现就是"一开技能直接变成俄耳甫斯"。
  const ps = fakePlayer();
  ps.diy = { chess_char_6_diy1_a: { charId: 'char_4217_makoto', skillIndex: 2, uniEquipId: null } };
  const lobby = withDev(fakeLobby({ ps }));
  // 换成另一个干员，但不给 skillIndex → 应当沿用 2
  const res = dev(lobby, SESSION, { op: 'pick', slot: 'chess_char_6_diy1_a', charId: 'char_112_siege' }, LOCAL);
  assert.equal(res.ok, true);
  const call = ps.calls.find((c) => c[0] === 'setDiy');
  assert.equal(call[1].chess_char_6_diy1_a.skillIndex, 2, '沿用了原有的 skillIndex=2（S3）');
  // 显式给技能时以显式为准
  const res2 = dev(lobby, SESSION, { op: 'pick', slot: 'chess_char_6_diy1_a', charId: 'char_112_siege', skillIndex: 0 }, LOCAL);
  assert.equal(res2.ok, true);
  const call2 = ps.calls.filter((c) => c[0] === 'setDiy').pop();
  assert.equal(call2[1].chess_char_6_diy1_a.skillIndex, 0, '显式给 0 时用 0');
});

// ── 悬赏怪（自选敌人加入下一波）────────────────────────────────────────────

test('bounty：自选悬赏怪写进 ps.bounties（走游戏自己的 addBounty）；unbounty 清空', () => {
  const ps = fakePlayer();
  const lobby = withDev(fakeLobby({ ps }));
  const res = dev(lobby, SESSION, { op: 'bounty', enemyKey: 'enemy_dummy', count: 2, coin: 5 }, LOCAL);
  assert.equal(res.ok, true);
  assert.equal(res.bounties, 1, '列表里有 1 条');
  assert.equal(ps.bounties.length, 1);
  assert.equal(ps.bounties[0].card.enemyKey, 'enemy_dummy');
  assert.equal(ps.bounties[0].card.count, 2, '数量 2');
  assert.equal(ps.bounties[0].card.coin, 5, '赏金 5');
  assert.equal(ps.bounties[0].roundsLeft, 1, '只作用于下一波');
  assert.ok(ps.calls.some((c) => c[0] === 'addBounty'), '调了 Match.addBounty');
  // state 里也能看到
  assert.equal(dev(lobby, SESSION, { op: 'state' }, LOCAL).bounties.length, 1);
  // 不存在的敌人要被拒
  assert.ok(dev(lobby, SESSION, { op: 'bounty', enemyKey: 'enemy_nope' }, LOCAL).error, '未知敌人被拒');
  // 清空
  const c = dev(lobby, SESSION, { op: 'unbounty' }, LOCAL);
  assert.equal(c.cleared, 1);
  assert.equal(ps.bounties.length, 0);
});

test('enemies：返回全部敌人清单（面板下拉用）', () => {
  const res = dev(withDev(fakeLobby()), SESSION, { op: 'enemies' }, LOCAL);
  assert.equal(res.ok, true);
  assert.ok(res.count >= 1);
  assert.equal(res.enemies[0].key, 'enemy_dummy');
  assert.equal(res.enemies[0].name, '假人');
});

// ── 修掉的 4 个 bug 的回归测试 ────────────────────────────────────────────────

test('give 尊重显式技能：槽里已经是他时，skillIndex 仍要写进去（业主报的"选 S2 却还是 S3"）', () => {
  // 曾经是 `if (!picked(slot))` 才写 pick —— 槽里已经是他时**整个跳过**，
  // 于是面板里把技能从 S3 改成 S2 再点「🎁 直接给我」，技能根本没改。
  const ps = fakePlayer();
  assert.equal(ps.diy.chess_char_6_diy1_a.skillIndex, 0, '初值是 S1');
  const res = dev(withDev(fakeLobby({ ps })), SESSION,
    { op: 'give', charId: 'char_4217_makoto', slot: 'chess_char_6_diy1_a', skillIndex: 1 }, LOCAL);
  assert.equal(res.ok, true, '获取成功');
  assert.equal(ps.diy.chess_char_6_diy1_a.skillIndex, 1, '技能 S1 → S2 生效');
  const setDiy = ps.calls.filter((c) => c[0] === 'setDiy').pop();
  assert.ok(setDiy, '确实重写了 pick');
  assert.equal(setDiy[1].chess_char_6_diy1_a.skillIndex, 1);
  // 没给 skillIndex 时不能乱改（沿用原值）
  const ps2 = fakePlayer();
  dev(withDev(fakeLobby({ ps: ps2 })), SESSION, { op: 'give', charId: 'char_4217_makoto', slot: 'chess_char_6_diy1_a' }, LOCAL);
  assert.equal(ps2.diy.chess_char_6_diy1_a.skillIndex, 0, '未显式给 → 沿用原有技能');
});

test('enemies：对局还没开始时给干净的报错，而不是 match.gd 抛 TypeError（面板自动刷新会踩到）', () => {
  const lobby = fakeLobby({ started: false, ps: fakePlayer() });
  const r = handleDev(lobby, SESSION, { op: 'enemies' }, LOCAL);   // 不展开 reply，看原始返回
  assert.ok(r && !r.ok, '应是失败返回');
  assert.equal(typeof r.error, 'string', '带 error 码');
  assert.match(String(r.detail ?? ''), /对局|模拟/, `detail 要说清原因：${r.detail}`);
});

test('state：diyPicks 带出每个槽位的干员与技能（面板靠它显示"谁 + 几技能"）', () => {
  const res = dev(withDev(fakeLobby({ ps: fakePlayer() })), SESSION, { op: 'state' }, LOCAL);
  assert.equal(res.diy.chess_char_6_diy1_a, 'char_4217_makoto', 'diy 仍是 charId 映射（兼容旧读取）');
  assert.deepEqual(res.diyPicks.chess_char_6_diy1_a,
    { charId: 'char_4217_makoto', skillIndex: 0, uniEquipId: null, name: '结城理' }, 'diyPicks 带技能与名字');
});

test('layersAll：覆盖「激活的 ∪ 已有层数的」全部盟约（与面板下拉、knownBonds 一致）', () => {
  const ps = fakePlayer();
  ps.bonds = { egirShip: { active: true, layers: 0 } };
  ps.layers = { lateranoShip: 3 };            // 有层数但当前没激活
  const res = dev(withDev(fakeLobby({ ps })), SESSION, { op: 'layersAll', n: 3 }, LOCAL);
  assert.equal(res.count, 2, '两个盟约都要加到');
  assert.equal(ps.layers.egirShip, 3, '激活的加到了');
  assert.equal(ps.layers.lateranoShip, 6, '未激活但有层数的也加到了（以前会漏）');
});
