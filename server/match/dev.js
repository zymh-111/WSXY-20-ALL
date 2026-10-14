// server/match/dev.js — [CUSTOM] 测试后门（单人房里一个可切换开关）。
//
// 用途：不用刷就能验证某个干员的 kit（尤其自选干员结城理）。
//
// ⚠️ 门禁与风险（按需求改过，请注意）：
//   0) **运行时开关**：每个房间一个 dev 开关，**默认关闭**。所有会改状态的操作都要求它开着
//      （开启/查询开关本身不需要）。开关只存在于内存，服务重启即复位为关闭。
//   1) 来源：**默认不再限制本机/内网**（按需求"不需要本机内网"，方便朋友在公网对局里也用）。
//      想收回可用 DSH_DEV_LOCAL_ONLY=1 启动服务，即恢复"仅本机/内网"。
//      调用者的 ip 会随每次操作记进状态，便于事后追查。
//   2) 房间：**硬性只允许 solo 单人房**（改经济状态不该污染多人对局）。这是设计要求，
//      不提供放宽开关 —— 想用后门就跑单人房。
//   3) 身份：只能作用于**调用者自己的座位**。
//   4) 想彻底禁用后门：启动服务时带 DSH_DEV_DISABLED=1（此时连开关本身都不给用）。
//
// 协议：客户端发 `{ t: 'dev', op: '<name>', ...参数 }`；成功返回 `{ ok: true, ... }`。
// op 一览（除 devToggle/devStatus 外，都要求开关已开启，且只作用于自己的 PlayerState）：
//   devToggle on?     开/关本房间的后门开关（不传 on 则取反）
//   devStatus         读开关状态 + 来源/房间信息（不需要开关已开）
//   state             读自己的状态（资金 / 商店等级与升级价 / 各盟约层数 / 自选槽已选干员 / 已知盟约）
//   funds   n         加资金
//   level   n         升级商店 n 次（用游戏自己的价格与上限，每级照常发免费干员奖励）
//   refresh           免费刷新一次商店
//   layers  bondId n  给某盟约加 n 层（requireActive:false，未激活也可加）
//   layersAll n       给"当前局面涉及的所有盟约"各加 n 层
//   setLayers bondId n 把某盟约直接设成 n 层（可增可减）
//   pick slot charId [skillIndex]  把自选槽换成指定干员
//   opPool            自选池清单
//   ops               自选槽清单 + 房间信息（房间模式恒为 solo）
//
// 撤销：node tools/revert-dev-backdoor.mjs

import { ERR } from '../../shared/constants.js';
import { OK, fail } from './player/common.js';

/** DSH_DEV_DISABLED=1 ⇒ 彻底禁用（连开关都不可用）。 */
const DEV_DISABLED = String(process.env.DSH_DEV_DISABLED || '') === '1';
/** DSH_DEV_LOCAL_ONLY=1 ⇒ 恢复"仅本机/内网"限制（默认不限制）。 */
const LOCAL_ONLY = String(process.env.DSH_DEV_LOCAL_ONLY || '') === '1';
/** DSH_DEV_DEFAULT_ON=1 ⇒ 房间开关开局即为开（默认关闭，需在面板里点开）。 */
const DEFAULT_ON = String(process.env.DSH_DEV_DEFAULT_ON || '') === '1';

/**
 * 每个房间一个开关，直接记在 room 上（`room.devEnabled`；内存态，服务重启复位）。
 * 存属性而不是 WeakMap：更好排查（日志/调试能直接看到），测试也能直接置位。
 */
const devOn = (room) => (room.devEnabled === undefined ? DEFAULT_ON : !!room.devEnabled);

/**
 * @param {import('../lobby.js').Lobby} lobby
 * @param {import('../net.js').Session} session
 * @param {any} msg
 * @param {{ isLocal?: boolean, ip?: string|null }} [ctx] 来源信息（net.js 依据 conn.ip 传入）
 * @returns {{ ok: true, [k: string]: any } | { error: string, detail?: string }}
 */
export function handleDev(lobby, session, msg, ctx = {}) {
  const op = String(msg.op ?? '');

  // ── 0) 彻底禁用 ─────────────────────────────────────────────────────────────
  if (DEV_DISABLED) return fail(ERR.BAD_TARGET, 'dev: disabled by DSH_DEV_DISABLED');

  const room = lobby.roomOf(session);
  if (!room) return fail(ERR.BAD_TARGET, 'dev: not in a room');
  const match = room.match;

  // 开关状态（不需要开关已开，也不要求对局已开始）
  const status = () => ({
    ok: true,
    reply: { t: 'dev',
    enabled: devOn(room),
    room: room.mode ?? null,
    localOnly: LOCAL_ONLY,
    defaultOn: DEFAULT_ON,
    fromLocal: !!ctx.isLocal,
    ip: ctx.ip ?? null,
    started: !!match,
    },
  });

  if (op === 'devStatus') return status();
  if (op === 'devToggle') {
    // ── 1) 来源限制：默认不限；DSH_DEV_LOCAL_ONLY=1 时恢复 ──────────────────────
    if (LOCAL_ONLY && !ctx.isLocal) return fail(ERR.BAD_TARGET, 'dev: local/LAN only (DSH_DEV_LOCAL_ONLY=1)');
    const want = typeof msg.on === 'boolean' ? msg.on : !devOn(room);
    room.devEnabled = want;
    return { ok: true, reply: { ...status().reply, enabled: want, toggled: true } };
  }

  // ── 共同检查：来源限制（若开启）+ 房间必须是 solo ────────────────────────────
  if (LOCAL_ONLY && !ctx.isLocal) return fail(ERR.BAD_TARGET, 'dev: local/LAN only (DSH_DEV_LOCAL_ONLY=1)');
  if (room.mode !== 'solo') return fail(ERR.BAD_TARGET, 'dev: solo rooms only');

  // 自己的 PlayerState（只读与改状态都要用；注意必须在下面的只读分支之前取，
  // 否则 state 分支会引用尚未初始化的 ps —— const 的 TDZ 会抛错并被包成 INTERNAL）
  const ps = match?.players?.get?.(session.playerId) ?? null;

  // ── 只读操作：**不要求开关已开** ─────────────────────────────────────────────
  // 读状态/读自选池本身不改变任何东西，而且面板正是靠它们填下拉框的。
  // （曾经把它们放在开关检查之后，导致面板在开关生效前构建 → 读到空池 → 下拉一片空白。）
  if (op === 'state') {
    if (!ps) return fail(ERR.BAD_TARGET, 'dev: no player state');
    return { ok: true, reply: { t: 'dev', ...snapshot(ps) } };
  }
  if (op === 'ops') return { ok: true, reply: { t: 'dev', ops: listOps(match, room, lobby) } };
  if (op === 'opPool') {
    // diy：自选池（char_*，只能经自选槽出场，含联动干员）
    // roster：本作阵容（chess_*，可直接获得）
    // ⚠️ 面板**还没开局时**也会读这两个（下拉要先填上，用户才能「塞入」再开局），
    //    所以数据源必须是 `match?.gd ?? lobby.safeData()`。以前直接写 match.gd：
    //    对局未开始时 match 是 null → TypeError → 面板两个下拉全空（还只能看到一条看不懂的 INTERNAL）。
    const gd = gdOf(match, lobby);
    const dd = diyOf(gd);
    const pool = dd?.ownedPool ?? [];
    const diy = pool.map((id) => {
      const o = dd?.operators?.[id] ?? {};
      return { id, kind: 'diy', charId: id, name: o.name ?? id, profession: o.profession ?? null, bonds: o.bonds ?? [] };
    });
    const chessRaw = gd?.raw?.chess ?? {};
    const seen = new Set();
    const roster = [];
    for (const cid of Object.keys(chessRaw)) {
      const c = chessRaw[cid];
      if (!c || !c.charId || c.isDiy) continue;
      if (/_b$/.test(cid) && seen.has(c.charId)) continue;   // 精锐变体只留一个
      if (seen.has(c.charId)) continue;
      seen.add(c.charId);
      roster.push({ id: cid, kind: 'roster', charId: c.charId, name: c.name ?? c.charId, tier: c.tier ?? null, profession: c.profession ?? null });
    }
    roster.sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || String(a.name).localeCompare(String(b.name)));
    return { ok: true, reply: { t: 'dev', count: diy.length + roster.length, diyCount: diy.length, rosterCount: roster.length, diy, roster } };
  }

  // ── pick 允许在**对局开始前**用：写房间座位，开局时 setDiy(seat.diy) 会生效 ──────
  // （否则只能"先开局再塞"，而客户端开局时那份 m.private.diy 已经定下，
  //   渲染自选件时会合成不出干员身体 → 空模板「甄选干员」。）
  if (op === 'pick' && !match) {
    if (!devOn(room)) return fail(ERR.BAD_TARGET, 'dev: 后门开关未开启（先在面板点「开启后门」）');
    const slot0 = String(msg.slot ?? '');
    const charId0 = String(msg.charId ?? '');
    if (!slot0) return fail(ERR.BAD_MSG, 'dev: pick needs slot');
    if (!charId0) return fail(ERR.BAD_MSG, 'dev: pick needs charId');
    const pool0 = diyOf(gdOf(match, lobby))?.ownedPool ?? null;
    const prev0 = (session.diy ?? {})[slot0] ?? null;
    const picks0 = { ...(session.diy ?? {}), [slot0]: { charId: charId0, skillIndex: pickSkillIndex(msg, prev0), uniEquipId: msg.uniEquipId ? String(msg.uniEquipId) : prev0?.uniEquipId ?? null } };
    if (pool0 && !pool0.includes(charId0)) return fail(ERR.BAD_TARGET, `dev: ${charId0} is not in the 自选 ownedPool`);
    let r0 = null;
    try { r0 = lobby.diy?.(session, { picks: picks0 }) ?? 'no-handler'; } catch (e) { r0 = 'throw:' + String(e && e.message); }
    if (r0 && r0.error && r0.error !== ERR.ROOM_STARTED) {
      return fail(ERR.BAD_TARGET, `dev: 座位自选被拒（${r0.error}）${r0.detail ? ' — ' + r0.detail : ''}`);
    }
    return { ok: true, reply: { t: 'dev', slot: slot0, charId: charId0, pendingMatch: true, seat: session.diy ?? null } };
  }

  if (op === 'enemies') {
    // 全部敌人（面板做悬赏下拉用）。⚠️ 这一支在"对局未开始"时也会被调用
    //（面板打开后 700ms 自动 reload 一次，那时通常还在房间里），所以不能写 match.gd —— match 可能是 null，
    // 会抛 TypeError 被包成 INTERNAL，面板上就显示一条看不懂的错误。
    if (!match) return fail(ERR.BAD_TARGET, 'dev: 对局还没开始，读不到敌人表（先在房间点开始模拟）');
    const all = match.gd?.raw?.enemies ?? {};
    const enemies = Object.keys(all).map((key) => ({
      key, name: all[key]?.name ?? key, rank: all[key]?.rank ?? null, fly: !!all[key]?.isFlyEnemy,
    })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    return { ok: true, reply: { t: 'dev', count: enemies.length, enemies } };
  }

  // ── 以下是会改状态的操作：还要求开关已开 + 对局已开始 + 自己的座位 ──────────
  if (!devOn(room)) return fail(ERR.BAD_TARGET, 'dev: 后门开关未开启（先在面板点「开启后门」）');
  if (!match) return fail(ERR.BAD_TARGET, 'dev: the match has not started');
  if (!ps) return fail(ERR.BAD_TARGET, 'dev: no player state');

  // 记一下调用者 ip（便于事后追查；不阻断）
  if (ctx.ip) (match.devLog ??= []).push({ t: op, ip: ctx.ip, at: match.time ?? null });

  switch (op) {
    case 'funds': {
      const n = reqInt(msg, 'n');
      if (n === null) return fail(ERR.BAD_MSG, 'dev: funds needs an integer n');
      const added = ps.addFunds(n, { reason: 'dev' });
      return { ok: true, reply: { t: 'dev', added, funds: ps.funds } };
    }
    case 'level': {
      const n = reqInt(msg, 'n');
      if (n === null) return fail(ERR.BAD_MSG, 'dev: level needs an integer n');
      const from = ps.shop.level;
      const cap = ps.gd?.maxShopLevel ?? 6;
      let up = 0;
      let topped = 0;
      let last = OK;
      // 宽松：临时摘掉 _gate()（它会在非休整期返回 WRONG_PHASE），并自动补钱。
      // 用游戏自己的 levelUp()，所以价格、栏位、每级奖励都照常走。
      const gate = ps._gate;
      if (typeof gate === 'function') ps._gate = () => null;
      try {
        for (let i = 0; i < Math.max(0, n); i++) {
          if (ps.shop.level >= cap) { last = { error: 'MAX_LEVEL' }; break; }
          const price = Math.max(0, ps.shop.upgradePrice);
          if (ps.funds < price) { topped += ps.addFunds(price - ps.funds, { reason: 'dev' }); }
          const r = ps.levelUp();
          if (r && r.error) { last = r; break; }
          up += 1;
        }
      } finally {
        if (typeof gate === 'function') ps._gate = gate;
      }
      return {
        ok: true,
        reply: { t: 'dev',
          from, level: ps.shop.level, funds: ps.funds,
          upgradePrice: ps.shop.upgradePrice, up, topped,
          stopped: up < n ? (last?.error ?? null) : null,
        },
      };
    }
    case 'inspect': {
      // [诊断用] 把自选槽在服务端的真实数据形状 dump 出来
      const slot = String(msg.slot ?? 'chess_char_6_diy1_a');
      const shrink = (o, n = 22) => {
        if (o == null) return o;
        if (typeof o !== 'object') return o;
        const out = {};
        for (const k of Object.keys(o).slice(0, n)) {
          const v = o[k];
          out[k] = (v && typeof v === 'object') ? (Array.isArray(v) ? `[${v.length}]` : '{…}') : v;
        }
        return out;
      };
      const rec = ps.gd?.chess?.(slot) ?? null;
      const shopIds = (ps.shop?.slots ?? []).map((x) => (x ? `${x.kind}:${x.id}` : 'null'));
      return { ok: true, reply: { t: 'dev',
        slot,
        baseIdOf: ps.gd?.baseIdOf?.(slot) ?? null,
        rec_isNull: !rec,
        rec_isDiy: rec?.isDiy ?? null,
        rec_diyFor: rec?.diyFor ?? null,
        rec_name: rec?.name ?? null,
        rec_keys: rec ? Object.keys(rec).slice(0, 30) : [],
        rec_shrink: shrink(rec),
        diyRecords_keys: ps._diyRecords ? [...ps._diyRecords.keys()] : null,
        diyStock_keys: ps.diyStock?.entries ? [...ps.diyStock.entries.keys()] : null,
        diy_picks: ps.diy ?? null,
        shopIds,
      } };
    }
    case 'give': {
      // 直接获取任意干员。两种目标：
      //   chess_*  → 阵容棋子，直接 acquireChess
      //   char_*   → 自选干员（含联动）：先确保该槽位的 pick 写好（含写回房间座位 +
      //              强制重发私有视图，客户端才能合成出干员身体），再 acquireChess(槽位)
      // acquireChess 内部会 stow(piece,{allowTemp:true})：手牌满了自动进整备区，不会被我拒掉。
      const target = String(msg.charId ?? msg.chessId ?? '');
      if (!target) return fail(ERR.BAD_MSG, 'dev: give needs charId (char_*) or chessId (chess_*)');
      const chessRaw = match.gd?.raw?.chess ?? {};

      // ① 阵容棋子：直接给
      if (chessRaw[target]) {
        const p = ps.acquireChess?.(target, { source: 'dev', fromPool: true });
        if (!p) return fail(ERR.BAD_TARGET, `dev: 获取 ${target} 失败（池子已空或该棋子不可用）`);
        ps.dirty?.();
        try { match._sendPrivate?.(ps, true); } catch { /* 忽略 */ }
        return { ok: true, reply: { t: 'dev', kind: 'roster', given: target, uid: p.uid ?? null, ...snapshot(ps) } };
      }

      // ② 自选干员：需要槽位 + pick
      const dd = diyOf(match.gd);
      const slots = Object.keys(dd?.slots ?? {});
      const normSlots = slots.filter((x) => !/_b$/.test(x));
      if (!normSlots.length) return fail(ERR.BAD_TARGET, 'dev: 本局没有可用的自选槽');
      const picked = (id) => ps.diy?.[id]?.charId === target;
      const slot = String(msg.slot && normSlots.includes(String(msg.slot)) ? msg.slot
        : normSlots.find(picked) ?? normSlots[normSlots.length - 1]);
      // 什么时候要重写 pick：
      //   · 换了人（charId 不同）；或
      //   · 显式给了 skillIndex / uniEquipId —— **即使槽里已经是他**。
      // 曾经只判 `if (!picked(slot))`，于是"槽里已经是他"时改技能会被整个忽略：
      // 面板选了 S2 再点「🎁 直接给我」，结果还是上一版的 S3（业主报的就是这个）。
      const sameChar = ps.diy?.[slot]?.charId === target;
      const wantsSkill = reqInt(msg, 'skillIndex') !== null;
      const wantsEquip = msg.uniEquipId != null;
      if (!sameChar || wantsSkill || wantsEquip) {
        const prevG = (ps.diy ?? session.diy ?? {})[slot] ?? null;
        const picks = { ...(ps.diy ?? session.diy ?? {}), [slot]: { charId: target, skillIndex: pickSkillIndex(msg, prevG), uniEquipId: msg.uniEquipId ? String(msg.uniEquipId) : prevG?.uniEquipId ?? null } };
        if (!match) {
          try { lobby.diy?.(session, { picks }); } catch { /* 忽略 */ }
        } else {
          if (!ps.setDiy?.(picks)) return fail(ERR.BAD_TARGET, `dev: 无法把 ${target} 放进 ${slot}（不在自选池，或该干员没有 kit）`);
          try { ps.initDiyStock?.(new Set(match.bannedBondIds ?? [])); } catch { /* 忽略 */ }
          try { ps.rollShop?.({ keepFrozen: false }); } catch { /* 忽略 */ }
          try { lobby.diy?.(session, { picks }); } catch { /* 忽略 */ }
        }
      }
      const rec = ps.gd?.chess?.(slot);
      if (!rec) return fail(ERR.BAD_TARGET, `dev: 槽位 ${slot} 不可用`);
      if (rec.isDiy && !rec.diyFor) return fail(ERR.BAD_TARGET, `dev: 槽位 ${slot} 还没有合成为干员（可能是当前局开始后再改的，先把 pick 设好再开局）`);
      // 自选件库存留一份
      try {
        const base = ps.gd.baseIdOf(slot);
        const e = ps.diyStock?.entries?.get(base);
        if (e && !(e.left > 0)) e.left = 1;
      } catch { /* 忽略 */ }
      const piece = ps.acquireChess?.(slot, { source: 'dev', fromPool: true }) ?? null;
      if (!piece) return fail(ERR.BAD_TARGET, 'dev: 获取失败 —— 手牌与整备区都满了，先上场几个或撤回一个再试');
      ps.dirty?.();
      try { match._sendPrivate?.(ps, true); } catch { /* 忽略 */ }
      return { ok: true, reply: { t: 'dev', kind: 'diy', given: slot, charId: target, uid: piece.uid ?? null, ...snapshot(ps) } };
    }

    case 'bounty': {
      // 自选悬赏怪 → 加进「下一波」。
      // 走游戏自己的 Match.addBounty(ps, card)：它会校验敌人存在、生成 id、算 roundsLeft、并 ps.dirty()；
      // 之后 withBounties()（combat.js）就会把它并进下一场战斗的生成列表，客户端预告里也会出现 source:'bounty' 那一行。
      const enemyKey = String(msg.enemyKey ?? '');
      if (!enemyKey) return fail(ERR.BAD_MSG, 'dev: bounty needs enemyKey');
      const erec = match.gd?.enemy?.(enemyKey);
      if (!erec) return fail(ERR.BAD_TARGET, `dev: 没有这个敌人 ${enemyKey}`);
      const count = Math.max(1, Math.min(20, reqInt(msg, 'count') ?? 1));
      const coin = Math.max(0, reqInt(msg, 'coin') ?? 2);
      const card = {
        name: `悬赏·${erec.name ?? enemyKey}`, desc: 'dev backdoor', tier: 1,
        coin, payout: 'kill', enemyKey, count,
      };
      const id = match.addBounty?.(ps, card);
      if (!id) return fail(ERR.BAD_TARGET, `dev: 加入失败（${enemyKey}）`);
      return { ok: true, reply: { t: 'dev', added: id, enemyKey, count, coin, bounties: (ps.bounties ?? []).length } };
    }
    case 'unbounty': {
      const n = (ps.bounties ?? []).length;
      ps.bounties = [];
      ps.dirty?.();
      return { ok: true, reply: { t: 'dev', cleared: n, bounties: 0 } };
    }
    case 'boost': {
      // 一键到位：钱补到 9999 → 等级拉满 → 刷新商店。
      // 之所以要刷新商店：自选干员是按 slot.shopLevel（六阶=6）才上架的，
      // 光升级不刷新，货架上仍是旧牌。
      const cap = ps.gd?.maxShopLevel ?? 6;
      const gate = ps._gate;
      if (typeof gate === 'function') ps._gate = () => null;
      let up = 0;
      try {
        if (ps.funds < 9999) ps.addFunds(9999 - ps.funds, { reason: 'dev' });
        for (let i = 0; i < 64 && ps.shop.level < cap; i++) {
          const price = Math.max(0, ps.shop.upgradePrice);
          if (ps.funds < price) ps.addFunds(price - ps.funds, { reason: 'dev' });
          const r = ps.levelUp();
          if (r && r.error) break;
          up += 1;
        }
      } finally {
        if (typeof gate === 'function') ps._gate = gate;
      }
      try { ps.rollShop?.({ keepFrozen: false }); } catch { /* 老版本没有这个方法就算了 */ }
      ps.dirty?.();
      return { ok: true, reply: { t: 'dev', up, ...snapshot(ps) } };
    }
    case 'refresh': {
      ps.shop.freeRefreshes += 1;
      ps.dirty?.();
      return { ok: true, reply: { t: 'dev', freeRefreshes: ps.shop.freeRefreshes } };
    }
    case 'layers': {
      const n = reqInt(msg, 'n');
      const bondId = String(msg.bondId ?? '');
      if (n === null) return fail(ERR.BAD_MSG, 'dev: layers needs an integer n');
      if (!bondId) return fail(ERR.BAD_MSG, 'dev: layers needs bondId');
      ps.addLayers(bondId, n, { requireActive: false, reason: 'dev' });
      return { ok: true, reply: { t: 'dev', bondId, layers: ps.layers?.[bondId] ?? null } };
    }
    case 'layersAll': {
      const n = reqInt(msg, 'n');
      if (n === null) return fail(ERR.BAD_MSG, 'dev: layersAll needs an integer n');
      // 用 knownBonds（激活的 ∪ 已有层数的）——与面板下拉、snapshot 完全一致。
      // 以前只遍历 ps.bonds，于是"有层数但当前没激活"的盟约被漏掉，面板上却列着它。
      const ids = knownBonds(ps);
      for (const id of ids) ps.addLayers(id, n, { requireActive: false, reason: 'dev' });
      return { ok: true, reply: { t: 'dev', count: ids.length } };
    }
    case 'setLayers': {
      // 直接设成指定层数（可增可减）；层数上限由 layerGainRoom 决定（超出时报 unchanged 而不是假装成功）
      const n = reqInt(msg, 'n');
      const bondId = String(msg.bondId ?? '');
      if (n === null) return fail(ERR.BAD_MSG, 'dev: setLayers needs an integer n');
      if (n < 0) return fail(ERR.BAD_MSG, 'dev: setLayers needs n >= 0');
      if (!bondId) return fail(ERR.BAD_MSG, 'dev: setLayers needs bondId');
      const before = ps.layers?.[bondId] ?? 0;
      let after = before;
      if (n > before) {
        ps.addLayers(bondId, n - before, { requireActive: false, reason: 'dev' });
        after = ps.layers?.[bondId] ?? before;
      } else if (n < before) {
        ps.layers[bondId] = n;
        ps.recompute?.();
        after = ps.layers?.[bondId] ?? n;
      }
      return { ok: true, reply: { t: 'dev', bondId, from: before, to: after, capped: after !== n } };
    }
    case 'pick': {
      // 自选干员：把某个自选槽换成指定 charId（走游戏自己的 setDiy → 校验 + 重建记录）
      const slot = String(msg.slot ?? '');
      const charId = String(msg.charId ?? '');
      if (!slot) return fail(ERR.BAD_MSG, 'dev: pick needs slot（如 chess_char_6_diy1_a）');
      if (!charId) return fail(ERR.BAD_MSG, 'dev: pick needs charId');
      const pool = diyOf(match.gd)?.ownedPool ?? [];
      if (pool.length && !pool.includes(charId)) return fail(ERR.BAD_TARGET, `dev: ${charId} is not in the 自选 ownedPool`);
      const picks = { ...(ps.diy ?? {}) };
      const prevPick = picks[slot] ?? null;
      picks[slot] = { charId, skillIndex: pickSkillIndex(msg, prevPick), uniEquipId: msg.uniEquipId ? String(msg.uniEquipId) : prevPick?.uniEquipId ?? null };
      const ok = ps.setDiy?.(picks);
      if (!ok) return fail(ERR.BAD_TARGET, 'dev: setDiy refused（槽位/干员不合法，或该干员没有 kit）');
      // 刷新自选库存，商店才会按新配置出牌
      try { ps.initDiyStock?.(new Set(match.bannedBondIds ?? [])); } catch { /* 兼容旧签名 */ }
      // 塞入后刷新商店：否则货架上还是上一轮的牌，看不到新塞的干员
      try { ps.rollShop?.({ keepFrozen: false }); } catch { /* 忽略 */ }
      ps.dirty?.();
      // ① 同时写回房间座位（lobby.diy 会校验并存到 session.diy / seat.diy）。
      //    不写的话，下一次开局 PlayerState 构造时的 setDiy(seat.diy) 会把这个 pick 覆盖掉。
      let seatSync = null;
      try { seatSync = lobby.diy?.(session, { picks }) ?? 'no-handler'; } catch (e) { seatSync = 'throw:' + String(e && e.message); }
      // ② 强制重发私有视图：客户端要靠 m.private.diy 里的 pick 才能合成出干员身体，
      //    否则它只能画槽位占位记录（表现为空模板「甄选干员」）。
      try { match._sendPrivate?.(ps, true); } catch { /* 忽略 */ }
      try { match._notifyPrepScouts?.(ps); } catch { /* 忽略 */ }
      return { ok: true, reply: { t: 'dev', slot, charId, diy: snapshot(ps).diy, seatSync } };
    }
    default:
      return fail(ERR.BAD_MSG, `dev: unknown op ${op.slice(0, 32)}`);
  }
}

/** 自选槽清单（客户端面板用来做下拉）。 */
function listOps(match, room, lobby = null) {
  // 同上：房间里还没开局时也要能列出槽位（面板靠它做槽位下拉）
  const gd = gdOf(match, lobby);
  const slots = diyOf(gd)?.slots ?? {};
  return {
    slots: Object.entries(slots).map(([id, s]) => ({ slot: id, tier: s.tier, shopLevel: s.shopLevel })),
    room: room?.mode ?? null,
  };
}

const reqInt = (msg, k) => (Number.isFinite(msg[k]) ? Math.trunc(msg[k]) : null);

/**
 * 该用哪个 skillIndex。
 * ⚠️ 绝不能默认写成 0(S1)：结城理 S1 的替身是**俄耳甫斯**，S2 才是塔纳托斯，S3 是二段形态 ——
 * 用户在干员调配里选好 S3 后，如果后门"塞入/直接给我"顺手把它写成 S1，
 * 表现就是"一开技能直接变成俄耳甫斯"。所以：显式给的优先，否则**沿用该槽位原有的选择**。
 */
const pickSkillIndex = (msg, prev) => {
  const explicit = reqInt(msg, 'skillIndex');
  if (explicit !== null) return explicit;
  if (prev && Number.isInteger(prev.skillIndex)) return prev.skillIndex;
  return 0;
};

/**
 * 取本局的 自选(diy) 数据。data/backups.json 的顶层是 `{units, tokens, diy}`，
 * 但服务端把它加载到 `raw.backups` 这个键下 —— 所以既要试 `raw.backups.diy`（真实路径），
 * 也兼容 `raw.diy`（万一以后改了挂法）。
 */
const diyOf = (gd) => gd?.raw?.backups?.diy ?? gd?.raw?.diy ?? null;

/**
 * 统一的数据源：对局中 = `match.gd`（GameData 包装对象，数据包在 `.raw`）；
 * 房间里**还没开局** = `lobby.safeData()`，它**直接返回数据包**，所以要包成 `{ raw: data }` 才是同一形状。
 * ⚠️ 以前有处写成 `diyOf(lobby.safeData())` —— 那是在数据包上找 `.raw`，永远 undefined，
 *    于是"开局前的自选池校验"其实一直没生效。
 */
const gdOf = (match, lobby) => {
  if (match?.gd) return match.gd;
  const data = lobby?.safeData?.() ?? null;
  return data ? { raw: data } : null;
};

/** 本局已知的盟约 id（当前激活的 + 自己已有的层数，去重排序）——面板用来做下拉。 */
function knownBonds(ps) {
  const ids = new Set([...Object.keys(ps.bonds ?? {}), ...Object.keys(ps.layers ?? {})]);
  return [...ids].sort();
}

/** 自己的状态快照（只回自己的东西，方便客户端面板与排错）。 */
function snapshot(ps) {
  const layers = {};
  for (const [id, n] of Object.entries(ps.layers ?? {})) if (n) layers[id] = n;
  const diy = {};
  const diyPicks = {};
  const names = diyOf(ps.gd)?.operators ?? null;
  for (const [slot, pick] of Object.entries(ps.diy ?? {})) {
    diy[slot] = pick?.charId ?? null;
    // 面板要能一眼看出"这个槽位现在是谁、带的几技能"——只给 charId 的话，
    // 「后门选了 S2 到底生效没有」根本无从确认（业主就是因此怀疑后门坏了）。
    diyPicks[slot] = { charId: pick?.charId ?? null, skillIndex: pick?.skillIndex ?? null,
      uniEquipId: pick?.uniEquipId ?? null, name: names?.[pick?.charId]?.name ?? null };
  }
  return {
    funds: ps.funds,
    shopLevel: ps.shop?.level ?? null,
    upgradePrice: ps.shop?.upgradePrice ?? null,
    freeRefreshes: ps.shop?.freeRefreshes ?? 0,
    maxShopLevel: ps.gd?.maxShopLevel ?? null,
    layers,
    knownBonds: knownBonds(ps),
    diy,
    diyPicks,
    standIns: (ps.standIns ?? []).length,
    bounties: (ps.bounties ?? []).map((b) => ({ enemyKey: b?.card?.enemyKey ?? null, count: b?.card?.count ?? 0, roundsLeft: b?.roundsLeft ?? 0 })),
    hand: (ps.hand ?? []).filter(Boolean).length,
    temp: (ps.temp ?? []).filter(Boolean).length,
  };
}

export default { handleDev };
