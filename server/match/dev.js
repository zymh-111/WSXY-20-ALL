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

  // 以下是会改状态的操作：来源/房间/开关/身份 四道检查
  if (LOCAL_ONLY && !ctx.isLocal) return fail(ERR.BAD_TARGET, 'dev: local/LAN only (DSH_DEV_LOCAL_ONLY=1)');
  if (!devOn(room)) return fail(ERR.BAD_TARGET, 'dev: 后门开关未开启（先在面板点「开启后门」）');
  // ── 2) 房间：**硬性只允许 solo 单人房**（这是设计要求，不提供放宽开关）──────
  if (room.mode !== 'solo') {
    return fail(ERR.BAD_TARGET, 'dev: solo rooms only');
  }
  if (!match) return fail(ERR.BAD_TARGET, 'dev: the match has not started');
  // ── 3) 身份：只允许自己的座位 ────────────────────────────────────────────────
  const ps = match.players?.get?.(session.playerId) ?? null;
  if (!ps) return fail(ERR.BAD_TARGET, 'dev: no player state');

  // 记一下调用者 ip（便于事后追查；不阻断）
  if (ctx.ip) (match.devLog ??= []).push({ t: op, ip: ctx.ip, at: match.time ?? null });

  if (op === 'state') return { ok: true, reply: { t: 'dev', ...snapshot(ps) } };
  if (op === 'ops') return { ok: true, reply: { t: 'dev', ops: listOps(match, room) } };

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
      let last = OK;
      for (let i = 0; i < Math.max(0, n); i++) {
        last = ps.levelUp();                       // 自己判上限与价格，并照常发每级奖励
        if (last !== OK && last?.ok !== true) break;
      }
      return {
        ok: true,
        reply: { t: 'dev',
          from, level: ps.shop.level, funds: ps.funds,
          upgradePrice: ps.shop.upgradePrice,
          stopped: ps.shop.level < from + n ? (last?.error ?? null) : null,
        },
      };
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
      const ids = Object.keys(ps.bonds ?? {});
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
      picks[slot] = { charId, skillIndex: reqInt(msg, 'skillIndex') ?? 0, uniEquipId: msg.uniEquipId ? String(msg.uniEquipId) : null };
      const ok = ps.setDiy?.(picks);
      if (!ok) return fail(ERR.BAD_TARGET, 'dev: setDiy refused（槽位/干员不合法，或该干员没有 kit）');
      // 刷新自选库存，商店才会按新配置出牌
      try { ps.initDiyStock?.(new Set(match.bannedBondIds ?? [])); } catch { /* 兼容旧签名 */ }
      ps.dirty?.();
      return { ok: true, reply: { t: 'dev', slot, charId, diy: snapshot(ps).diy } };
    }
    case 'opPool': {
      const data = match.gd?.raw ?? null;
      const pool = diyOf(match.gd)?.ownedPool ?? [];
      const ops = pool.map((id) => {
        const o = diyOf(match.gd)?.operators?.[id] ?? {};
        return { charId: id, name: o.name ?? id, profession: o.profession ?? null, bonds: o.bonds ?? [] };
      });
      return { ok: true, reply: { t: 'dev', count: ops.length, ops } };
    }
    default:
      return fail(ERR.BAD_MSG, `dev: unknown op ${op.slice(0, 32)}`);
  }
}

/** 自选槽清单（客户端面板用来做下拉）。 */
function listOps(match, room) {
  const data = match.gd?.raw ?? null;
  const slots = diyOf(match.gd)?.slots ?? {};
  return {
    slots: Object.entries(slots).map(([id, s]) => ({ slot: id, tier: s.tier, shopLevel: s.shopLevel })),
    room: room?.mode ?? null,
  };
}

const reqInt = (msg, k) => (Number.isFinite(msg[k]) ? Math.trunc(msg[k]) : null);

/**
 * 取本局的 自选(diy) 数据。data/backups.json 的顶层是 `{units, tokens, diy}`，
 * 但服务端把它加载到 `raw.backups` 这个键下 —— 所以既要试 `raw.backups.diy`（真实路径），
 * 也兼容 `raw.diy`（万一以后改了挂法）。
 */
const diyOf = (gd) => gd?.raw?.backups?.diy ?? gd?.raw?.diy ?? null;

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
