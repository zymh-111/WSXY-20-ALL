// server/match/dev.js — [CUSTOM] 测试后门（仅本机/内网 + solo 单人房）。
//
// 用途：不用刷就能验证某个干员的 kit（尤其自选干员结城理）。
//
// 安全边界（按需求"只对本机/内网 + solo 单人房生效"）：
//   1) 来源必须是**本机/内网**：net.js 的 clientAddress 算出的 conn.ip 交给 isLocalIp 判定
//      （回环 / RFC1918 / link-local / CGNAT-Tailscale / IPv6 ULA），由 lobby 经 ctx.isLocal 传进来
//   2) 房间必须是 **solo 单人房**：这条会改经济状态，不能污染多人对局
//   3) 只能作用于**调用者自己的座位**：拿不到自己的 PlayerState 就拒绝
//   三条任一不满足 → ERR.BAD_TARGET，且不回显任何服务器内部信息。
//
// 协议：客户端发 `{ t: 'dev', op: '<name>', ...参数 }`；成功返回 `{ ok: true, ... }`。
// op 一览（都作用于调用者自己的 PlayerState）：
//   state             读自己的状态（资金 / 商店等级与升级价 / 各盟约层数 / 自选槽已选干员）
//   funds   n         加资金
//   level   n         升级商店 n 次（用游戏自己的价格与上限，每级照常发免费干员奖励）
//   refresh           免费刷新一次商店
//   layers  bondId n  给某盟约加 n 层（requireActive:false，未激活也可加）
//   layersAll n       给"当前局面涉及的所有盟约"各加 n 层
//
// 撤销：node tools/revert-dev-backdoor.mjs

import { ERR } from '../../shared/constants.js';
import { OK, fail } from './player/common.js';

/**
 * @param {import('../lobby.js').Lobby} lobby
 * @param {import('../net.js').Session} session
 * @param {any} msg
 * @param {{ isLocal?: boolean }} [ctx] 来源是否为本机/内网（net.js 依据 conn.ip 传入）
 * @returns {{ ok: true, [k: string]: any } | { error: string, detail?: string }}
 */
/** 放宽项：DSH_DEV_ANY_ROOM=1 时不再要求 solo 房间（默认仍然只允许 solo）。 */
const ANY_ROOM = String(process.env.DSH_DEV_ANY_ROOM || '') === '1';

export function handleDev(lobby, session, msg, ctx = {}) {
  // ── 1) 来源：只允许本机 / 内网（这条是安全底线，不提供开关）───────────────────
  if (!ctx.isLocal) return fail(ERR.BAD_TARGET, 'dev: local/LAN only');

  const room = lobby.roomOf(session);
  if (!room) return fail(ERR.BAD_TARGET, 'dev: not in a room');
  // ── 2) 房间：默认只允许 solo；共测可用 DSH_DEV_ANY_ROOM=1 放宽到任意房型 ──────
  if (room.mode !== 'solo' && !ANY_ROOM) {
    return fail(ERR.BAD_TARGET, 'dev: solo rooms only（共测请用 DSH_DEV_ANY_ROOM=1 启动服务）');
  }
  const match = room.match;
  if (!match) return fail(ERR.BAD_TARGET, 'dev: the match has not started');
  // ── 3) 身份：只允许自己的座位 ────────────────────────────────────────────────
  const ps = match.players?.get?.(session.playerId) ?? null;
  if (!ps) return fail(ERR.BAD_TARGET, 'dev: no player state');

  const op = String(msg.op ?? '');
  if (op === 'state') return { ok: true, ...snapshot(ps) };
  if (op === 'ops') return { ok: true, ops: listOps(match, room) };

  switch (op) {
    case 'funds': {
      const n = reqInt(msg, 'n');
      if (n === null) return fail(ERR.BAD_MSG, 'dev: funds needs an integer n');
      const added = ps.addFunds(n, { reason: 'dev' });
      return { ok: true, added, funds: ps.funds };
    }
    case 'level': {
      const n = reqInt(msg, 'n');
      if (n === null) return fail(ERR.BAD_MSG, 'dev: level needs an integer n');
      const from = ps.shop.level;
      let last = OK;
      for (let i = 0; i < Math.max(0, n); i++) {
        last = ps.levelUp();                       // 自己判上限与价格，并照常发每级奖励
        if (last !== OK && last?.ok !== true) break;
      }
      return {
        ok: true, from, level: ps.shop.level, funds: ps.funds,
        upgradePrice: ps.shop.upgradePrice,
        stopped: ps.shop.level < from + n ? (last?.error ?? null) : null,
      };
    }
    case 'refresh': {
      ps.shop.freeRefreshes += 1;
      ps.dirty?.();
      return { ok: true, freeRefreshes: ps.shop.freeRefreshes };
    }
    case 'layers': {
      const n = reqInt(msg, 'n');
      const bondId = String(msg.bondId ?? '');
      if (n === null) return fail(ERR.BAD_MSG, 'dev: layers needs an integer n');
      if (!bondId) return fail(ERR.BAD_MSG, 'dev: layers needs bondId');
      ps.addLayers(bondId, n, { requireActive: false, reason: 'dev' });
      return { ok: true, bondId, layers: ps.layers?.[bondId] ?? null };
    }
    case 'layersAll': {
      const n = reqInt(msg, 'n');
      if (n === null) return fail(ERR.BAD_MSG, 'dev: layersAll needs an integer n');
      const ids = Object.keys(ps.bonds ?? {});
      for (const id of ids) ps.addLayers(id, n, { requireActive: false, reason: 'dev' });
      return { ok: true, count: ids.length };
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
      return { ok: true, bondId, from: before, to: after, capped: after !== n };
    }
    case 'pick': {
      // 自选干员：把某个自选槽换成指定 charId（走游戏自己的 setDiy → 校验 + 重建记录）
      const slot = String(msg.slot ?? '');
      const charId = String(msg.charId ?? '');
      if (!slot) return fail(ERR.BAD_MSG, 'dev: pick needs slot（如 chess_char_6_diy1_a）');
      if (!charId) return fail(ERR.BAD_MSG, 'dev: pick needs charId');
      const pool = match.gd?.raw?.diy?.ownedPool ?? [];
      if (pool.length && !pool.includes(charId)) return fail(ERR.BAD_TARGET, `dev: ${charId} is not in the 自选 ownedPool`);
      const picks = { ...(ps.diy ?? {}) };
      picks[slot] = { charId, skillIndex: reqInt(msg, 'skillIndex') ?? 0, uniEquipId: msg.uniEquipId ? String(msg.uniEquipId) : null };
      const ok = ps.setDiy?.(picks);
      if (!ok) return fail(ERR.BAD_TARGET, 'dev: setDiy refused（槽位/干员不合法，或该干员没有 kit）');
      // 刷新自选库存，商店才会按新配置出牌
      try { ps.initDiyStock?.(new Set(match.bannedBondIds ?? [])); } catch { /* 兼容旧签名 */ }
      ps.dirty?.();
      return { ok: true, slot, charId, diy: snapshot(ps).diy };
    }
    case 'opPool': {
      const data = match.gd?.raw ?? null;
      const pool = data?.diy?.ownedPool ?? [];
      const ops = pool.map((id) => {
        const o = data?.diy?.operators?.[id] ?? {};
        return { charId: id, name: o.name ?? id, profession: o.profession ?? null, bonds: o.bonds ?? [] };
      });
      return { ok: true, count: ops.length, ops };
    }
    default:
      return fail(ERR.BAD_MSG, `dev: unknown op ${op.slice(0, 32)}`);
  }
}

/** 自选槽清单（客户端面板用来做下拉）。 */
function listOps(match, room) {
  const data = match.gd?.raw ?? null;
  const slots = data?.diy?.slots ?? {};
  return {
    slots: Object.entries(slots).map(([id, s]) => ({ slot: id, tier: s.tier, shopLevel: s.shopLevel })),
    room: room?.mode ?? null,
    anyRoom: ANY_ROOM,
  };
}

const reqInt = (msg, k) => (Number.isFinite(msg[k]) ? Math.trunc(msg[k]) : null);

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
  for (const [slot, pick] of Object.entries(ps.diy ?? {})) diy[slot] = pick?.charId ?? null;
  return {
    funds: ps.funds,
    shopLevel: ps.shop?.level ?? null,
    upgradePrice: ps.shop?.upgradePrice ?? null,
    freeRefreshes: ps.shop?.freeRefreshes ?? 0,
    maxShopLevel: ps.gd?.maxShopLevel ?? null,
    layers,
    knownBonds: knownBonds(ps),
    diy,
    standIns: (ps.standIns ?? []).length,
  };
}

export default { handleDev };
