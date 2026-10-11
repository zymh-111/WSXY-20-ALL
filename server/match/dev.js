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
export function handleDev(lobby, session, msg, ctx = {}) {
  // ── 1) 来源：只允许本机 / 内网 ───────────────────────────────────────────────
  if (!ctx.isLocal) return fail(ERR.BAD_TARGET, 'dev: local/LAN only');

  const room = lobby.roomOf(session);
  if (!room) return fail(ERR.BAD_TARGET, 'dev: not in a room');
  // ── 2) 房间：只允许 solo 单人房 ──────────────────────────────────────────────
  if (room.mode !== 'solo') return fail(ERR.BAD_TARGET, 'dev: solo rooms only');
  const match = room.match;
  if (!match) return fail(ERR.BAD_TARGET, 'dev: the match has not started');
  // ── 3) 身份：只允许自己的座位 ────────────────────────────────────────────────
  const ps = match.players?.get?.(session.playerId) ?? null;
  if (!ps) return fail(ERR.BAD_TARGET, 'dev: no player state');

  const op = String(msg.op ?? '');
  if (op === 'state') return { ok: true, ...snapshot(ps) };

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
    default:
      return fail(ERR.BAD_MSG, `dev: unknown op ${op.slice(0, 32)}`);
  }
}

const reqInt = (msg, k) => (Number.isFinite(msg[k]) ? Math.trunc(msg[k]) : null);

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
    diy,
    standIns: (ps.standIns ?? []).length,
  };
}

export default { handleDev };
