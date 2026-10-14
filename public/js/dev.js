// public/js/dev.js — [CUSTOM] 测试后门的前端面板（仅本机/内网 + solo 单人房，服务端见 server/match/dev.js）。
//
// 用法：在**本机/内网**打开游戏 → 进一个 **solo 单人房** → 开始对局 → 浏览器控制台输入：
//     __dev.ensure()          // 打开面板
//   或直接调命令（不需要面板）：
//     await __dev.funds(500)  // 加资金（免抽卡）
//     await __dev.level(5)    // 升商店等级
//     await __dev.layers('egirShip', 9)
//     await __dev.state()     // 读状态
//
// 面板只做三件事：显示状态、给几个按钮、把服务端拒绝的原因原样显示出来
//（服务端的三重门禁拒绝时会回 BAD_TARGET，在这里能看见 —— 免得你以为后门坏了）。
//
// 客户端 → 服务端走 net.request（自带 rid 与超时）；协议里 t='dev' 的字段校验见 shared/protocol.js。

import { net } from './net.js';

/** 后门支持的操作（与服务端 handleDev 一一对应）。 */
const OPS = Object.freeze(['state', 'funds', 'level', 'refresh', 'layers', 'layersAll', 'setLayers', 'pick', 'opPool', 'ops',
  'devStatus', 'devToggle', 'boost', 'give', 'enemies', 'bounty', 'unbounty']);

/** 发一条后门指令；失败把服务端的 error/detail 原样抛出来。 */
async function dev(op, fields = {}) {
  if (!OPS.includes(op)) throw new Error(`dev: unknown op ${op}`);
  try {
    return await net.request('dev', { op, ...fields });
  } catch (e) {
    const code = e && e.code ? e.code : 'ERROR';
    // 服务端把具体原因放在 detail 里（例如「直接获取失败（HAND_FULL）：手牌满了」），
    // 只显示 message 的话永远只能看到通用的「无效的目标」，排查会很痛苦。
    const detail = [e && e.message, e && e.detail].filter(Boolean).join(' — ') || String(e);
    throw new Error(`dev ${op} 失败：${code}${detail ? ' — ' + detail : ''}` +
      (code === 'BAD_TARGET' ? '（后门只对「本机/内网 + solo 单人房」生效）' : ''));
  }
}

/**
 * [CUSTOM] 后门改完**服务端**之后，客户端本地那份 picks 也必须跟着改。
 * 自选编队是「本地 store 为准」：ui/loadoutSync.js 会在每次 welcome / 每次编辑后把 loadoutStore.diy
 * 推给服务端（room.diy）。只改服务端的话，下一次同步就把旧 pick 推回去覆盖掉 ——
 * 表现就是「后门明明选了 S2，进游戏还是 S3」（业主报过）。
 * 用动态 import：模块只在真正用到时加载，测试环境里不会因为多一条顶层 import 而产生副作用。
 */
let _syncMod = null;
async function syncLocalPick(slot, pick) {
  if (!slot || !pick || !pick.charId) return null;
  try {
    if (!_syncMod) _syncMod = await import('./ui/loadoutSync.js');
    const cur = _syncMod.loadoutStore.get().diy ?? {};
    const next = {
      ...cur,
      [slot]: {
        charId: pick.charId,
        skillIndex: Number.isInteger(pick.skillIndex) ? pick.skillIndex : null,
        uniEquipId: typeof pick.uniEquipId === 'string' ? pick.uniEquipId : null,
      },
    };
    _syncMod.setDiyPicks(next);
    return next[slot];
  } catch { return null; }
}

const api = {
  state: () => dev('state'),
  funds: (n = 100) => dev('funds', { n }),
  level: (n = 1) => dev('level', { n }),
  refresh: () => dev('refresh'),
  layers: (bondId, n = 1) => dev('layers', { bondId, n }),
  layersAll: (n = 1) => dev('layersAll', { n }),
  /** 直接设成指定层数（可增可减）。 */
  setLayers: (bondId, n) => dev('setLayers', { bondId, n }),
  /** 自选槽换成指定干员。skillIndex 不传 = 保持该槽位原有的技能选择。
   *  成功后会把同一个 pick 写进**客户端本地**的自选编队 store（见 syncLocalPick）。 */
  pick: async (charId, slot = 'chess_char_6_diy1_a', skillIndex) => {
    const r = await dev('pick', { slot, charId, ...(Number.isInteger(skillIndex) ? { skillIndex } : {}) });
    const finalPick = (r.diyPicks ?? {})[slot] ?? { charId, skillIndex };
    const localPick = await syncLocalPick(slot, finalPick);
    return { ...r, localPick };
  },
  /** 自选池清单（面板下拉用）。 */
  opPool: () => dev('opPool'),
  /** 槽位与房间信息（含放宽开关状态）。 */
  ops: () => dev('ops'),
  /** 直接给我：把该槽位的干员直接塞进手牌（走游戏自己的 buy）。
   *  自选件成功后同样把 pick 写进客户端本地 store。 */
  give: async (id, slot, skillIndex) => {
    const r = await dev('give', { charId: id, slot, ...(Number.isInteger(skillIndex) ? { skillIndex } : {}) });
    const gs = r.kind === 'diy' ? r.given : null;
    const localPick = gs ? await syncLocalPick(gs, (r.diyPicks ?? {})[gs] ?? null) : null;
    return { ...r, localPick };
  },
  /** 全部敌人清单（悬赏下拉用）。 */
  enemies: () => dev('enemies'),
  /** 把指定敌人作为悬赏加进【下一波】。coin = 击杀赏金。 */
  bounty: (enemyKey, count = 1, coin = 2) => dev('bounty', { enemyKey, count, coin }),
  /** 清空自己的悬赏。 */
  unbounty: () => dev('unbounty'),
  /** 一键到位：补钱 + 等级拉满 + 刷新商店（自选干员才会真的上架）。 */
  boost: () => dev('boost'),
  /**
   * 本地诊断：打印"客户端自己以为的"私有数据（store.match.private）里的 picks。
   * 自选件能不能显示成真干员，取决于客户端这份 picks 能不能合成出身体
   * （public/js/ui/gameLogic/diy.js 的 ownDiyPick + diyRecordFor）。
   * 服务端的 state 正确但这里为空 → 渲染成「甄选干员」空模板。
   */
  priv: () => {
    const st = globalThis.__SP__ && globalThis.__SP__.store;
    const priv = st && st.match ? st.match.private : null;
    const out = { hasStore: !!st, hasPrivate: !!priv, diy: (priv && priv.diy) || null,
      diyBanned: (priv && priv.diyBanned) || null, ops: (priv && priv.ops) || null };
    console.log('[dev] 客户端私有 picks =', JSON.stringify(out, null, 1));
    return out;
  },
  /** 重新读状态并刷新两个下拉（面板上「⟳ 刷新」用）。
   *  注意别叫 refresh —— 那个名字属于服务端的「免费刷新」op。 */
  reload: () => api._reload ? api._reload() : Promise.resolve(),
  /** 后门开关状态（不需要开关已开）。 */
  devStatus: () => dev('devStatus'),
  /** 开/关本房间的后门开关。 */
  devToggle: (on) => dev('devToggle', typeof on === 'boolean' ? { on } : {}),
  dev,
};

let panel = null;

/**
 * 把 state.diyPicks 汇成一行：「T6 克莱门莎 S2 · T5 珊比 S3」。
 * 只给 charId 的话，「后门选了 S2 到底生效没有」在面板上完全看不出来（业主就是因此以为后门坏了）。
 */
function summarizePicks(st) {
  const picks = st && st.diyPicks;
  const slots = picks ? Object.keys(picks) : [];
  if (!slots.length) return '槽位：（还没有塞干员）';
  return '槽位：' + slots.map((slot) => {
    const p = picks[slot] ?? {};
    const tier = (slot.match(/char_(\d+)_/) ?? [])[1] ?? '?';
    const sk = Number.isInteger(p.skillIndex) ? ` S${Number(p.skillIndex) + 1}` : '';
    return `T${tier} ${p.name ?? p.charId ?? '空'}${sk}`;
  }).sort().join(' · ');
}

function el(tag, style, text) {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

function buildPanel() {
  const root = el('div', {
    position: 'fixed', top: '10px', right: '10px', zIndex: '99999', width: '268px', maxHeight: '92vh', overflow: 'auto',
    background: 'rgba(12,16,22,0.94)', color: '#d8e2ee', font: '12px/1.5 ui-monospace,monospace',
    border: '1px solid #2c3a4c', borderRadius: '8px', padding: '10px', boxShadow: '0 6px 24px rgba(0,0,0,.5)',
  });
  const head = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', cursor: 'move' });
  head.append(el('b', { color: '#8fd0ff' }, '测试后门 (dev)'));
  const tools = el('span', { display: 'flex', gap: '8px' });
  const collapse = el('span', { cursor: 'pointer', color: '#ffd479', title: '折叠/展开' }, '－');
  const close = el('span', { cursor: 'pointer', color: '#ff9a9a', title: '收起（可用 __dev.ensure() 再打开）' }, '✕');
  close.onclick = () => api.hide();
  tools.append(collapse, close);
  head.append(tools);
  root.append(head);

  // 面板主体（折叠时只留标题栏）
  const body = el('div');
  root.append(body);
  collapse.onclick = () => {
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    collapse.textContent = hidden ? '－' : '＋';
  };

  // 拖动：按住标题栏移动整个面板（位置记在 localStorage）
  try {
    const saved = JSON.parse(localStorage.getItem('dshDevPos') || 'null');
    if (saved) { root.style.left = saved.x + 'px'; root.style.top = saved.y + 'px'; root.style.right = 'auto'; }
  } catch { /* 忽略 */ }
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target === close || e.target === collapse) return;
    const r = root.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture?.(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - drag.dx));
    const y = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - drag.dy));
    root.style.left = x + 'px'; root.style.top = y + 'px'; root.style.right = 'auto';
    try { localStorage.setItem('dshDevPos', JSON.stringify({ x, y })); } catch { /* 忽略 */ }
  });
  head.addEventListener('pointerup', () => { drag = null; });

  // ── 后门开关（每个房间一个；默认关闭）──
  const swWrap = el('div', { display: 'flex', alignItems: 'center', gap: '6px', margin: '4px 0 6px' });
  const sw = el('input', { cursor: 'pointer' }); sw.type = 'checkbox';
  const swLabel = el('span', { color: '#ffd479' }, '后门：读状态…');
  sw.onchange = async () => {
    try {
      const r = await api.devToggle(sw.checked);
      swLabel.style.color = '#9fe6a0';
      swLabel.textContent = '后门：' + (r.enabled ? '已开启' : '已关闭') + '（' + (r.room ?? '?') + '）';
      sw.checked = !!r.enabled;
    } catch (e) {
      swLabel.style.color = '#ff9a9a';
      swLabel.textContent = String(e.message ?? e);
      sw.checked = !sw.checked;
    }
  };
  swWrap.append(sw, swLabel);
  root.append(swWrap);
  (async () => {
    try {
      const r = await api.devStatus();
      sw.checked = !!r.enabled;
      swLabel.style.color = r.enabled ? '#9fe6a0' : '#ffd479';
      swLabel.textContent = '后门：' + (r.enabled ? '已开启' : '未开启') + '（' + (r.room ?? '?') + '）'
        + (r.localOnly ? ' · 限本机' : ' · 不限于本机');
    } catch (e) { swLabel.textContent = String(e.message ?? e); }
  })();

  const status = el('div', { minHeight: '3.2em', whiteSpace: 'pre-wrap', color: '#9fb3c8' }, '（点“读状态”）');
  /** 槽位一览（谁 + 几技能）；在 show() 里刷新。 */
  const pickLine = el('div', { marginTop: '2px', whiteSpace: 'pre-wrap', color: '#9fe6a0' }, '槽位：—');
  const log = el('div', { marginTop: '6px', minHeight: '2.4em', whiteSpace: 'pre-wrap', color: '#ffd479' });

  const row = (children) => { const d = el('div', { display: 'flex', gap: '4px', marginTop: '4px' }); d.append(...children); return d; };
  const btn = (label, fn) => {
    const b = el('button', {
      flex: '1', cursor: 'pointer', background: '#1d2a3a', color: '#d8e2ee',
      border: '1px solid #33475e', borderRadius: '4px', padding: '4px 6px', font: 'inherit',
    }, label);
    b.onclick = async () => {
      log.textContent = '…';
      try { const r = await fn(); log.style.color = '#9fe6a0'; log.textContent = JSON.stringify(r); }
      catch (e) { log.style.color = '#ff9a9a'; log.textContent = String(e.message ?? e); }
    };
    return b;
  };
  const show = async () => {
    try {
      const r = await api.state();
      status.textContent = JSON.stringify(r, null, 1);
      pickLine.textContent = summarizePicks(r);
      return r;
    } catch (e) { status.textContent = String(e.message ?? e); return null; }
  };

  // ── 盟约层数：下拉选盟约 + 输入层数 → 直接设值 ──
  const bondSel = el('select', { flex: '1', background: '#1d2a3a', color: '#d8e2ee', border: '1px solid #33475e', borderRadius: '4px', padding: '2px' });
  const layerNum = el('input', { width: '52px', background: '#1d2a3a', color: '#d8e2ee', border: '1px solid #33475e', borderRadius: '4px', padding: '2px 4px' });
  layerNum.value = '9';
  const refreshBonds = async () => {
    try {
      const st = await api.state();
      const ids = st.knownBonds ?? [];
      bondSel.replaceChildren(...ids.map((id) => el('option', null, id)));
      if (ids.includes('lateranoShip')) bondSel.value = 'lateranoShip';
      else if (ids.includes('egirShip')) bondSel.value = 'egirShip';
    } catch { /* 读不到就留空 */ }
  };
  refreshBonds();

  // ── 自选干员：下拉选池子里的干员 → 塞进六阶自选槽 ──
  const opSel = el('select', { flex: '1', background: '#1d2a3a', color: '#d8e2ee', border: '1px solid #33475e', borderRadius: '4px', padding: '2px' });
  const slotSel = el('select', { width: '74px', background: '#1d2a3a', color: '#d8e2ee', border: '1px solid #33475e', borderRadius: '4px', padding: '2px' });
  // 技能选择：不选 = 保持槽位原有选择（关键！结城理 S1 的替身是俄耳甫斯，S2 是塔纳托斯）
  const skillSel = el('select', { width: '64px', background: '#1d2a3a', color: '#d8e2ee', border: '1px solid #33475e', borderRadius: '4px', padding: '2px' });
  for (const [label, val] of [['技能保持', ''], ['S1', '0'], ['S2', '1'], ['S3', '2']]) {
    const o = el('option', null, label); o.value = val; skillSel.append(o);
  }
  const refreshOps = async () => {
    try {
      const pool = await api.opPool();
      const diy = pool.diy ?? [];
      const roster = pool.roster ?? [];
      const mkOpt = (o) => {
        const opt = el('option', null, (o.kind === 'roster' ? '[阵容] ' : '[自选] ') + o.name + '  (' + o.id + ')');
        opt.value = o.id;
        return opt;
      };
      if (!diy.length && !roster.length) {
        const ph = el('option', null, '（没读到干员，点「⟳ 刷新」）');
        ph.value = '';
        opSel.replaceChildren(ph);
      }
      // 自选干员排在前面（后门主要是给他们用的），阵容在后
      opSel.replaceChildren(...diy.map(mkOpt), ...roster.map(mkOpt));
      const mk = [...diy, ...roster].find((o) => o.charId === 'char_4217_makoto');
      if (mk) opSel.value = mk.id;
      const { ops: info } = await api.ops();
      slotSel.replaceChildren(...(info.slots ?? []).filter((s) => s.tier >= 5).map((s) => {
        const opt = el('option', null, 'T' + s.tier);
        opt.value = s.slot;
        return opt;
      }));
      if ([...slotSel.options].some((o) => o.value === 'chess_char_6_diy1_a')) slotSel.value = 'chess_char_6_diy1_a';
    } catch { /* 读不到就留空 */ }
  };
  refreshOps();

  api._reload = async () => { await refreshBonds(); await refreshOps(); await refreshEnemies(); return show(); };
  // 首次打开时，两个下拉的读取是异步的；若刚好赶上开关/连接未就绪，会留下空下拉。
  // 这里在构建后 700ms 再自动补一次，免去手动点「⟳ 刷新」。
  setTimeout(() => { api._reload().catch(() => {}); }, 700);
  body.append(status);
  body.append(row([btn('⟳ 刷新', () => api.reload()), btn('+500 资金', () => api.funds(500))]));
  body.append(row([btn('⏫ 一键到位（钱+等级满+刷新）', () => api.boost())]));
  body.append(row([btn('+1 等级', () => api.level(1)), btn('+5 等级', () => api.level(5)), btn('免费刷新', () => api.refresh())]));
  body.append(row([bondSel, layerNum, btn('设层数', () => api.setLayers(bondSel.value, Number(layerNum.value) || 0))]));
  body.append(row([btn('全盟约 +3', () => api.layersAll(3))]));
  body.append(el('div', { marginTop: '6px', color: '#8fd0ff' }, '自选干员 → 塞进槽位（选完点“塞入”）'));
  body.append(row([slotSel, skillSel, opSel]));
  const skillArg = () => (skillSel.value === '' ? undefined : Number(skillSel.value));
  body.append(row([btn('塞入', () => api.pick(opSel.value, slotSel.value, skillArg())),
    btn('🎁 直接给我', () => api.give(opSel.value, slotSel.value, skillArg()))]));

  // ── 悬赏怪 → 加入下一波 ──
  body.append(el('div', { marginTop: '6px', color: '#8fd0ff' }, '悬赏怪 → 加进下一波（下场战斗出现）'));
  const enemySel = el('select', { flex: '1', minWidth: '0', background: '#1d2a3a', color: '#d8e2ee', border: '1px solid #33475e', borderRadius: '4px', padding: '2px' });
  const cntIn = el('input', { width: '42px', background: '#1d2a3a', color: '#d8e2ee', border: '1px solid #33475e', borderRadius: '4px', padding: '2px 4px' });
  cntIn.value = '1';
  const coinIn = el('input', { width: '42px', background: '#1d2a3a', color: '#d8e2ee', border: '1px solid #33475e', borderRadius: '4px', padding: '2px 4px' });
  coinIn.value = '2';
  const refreshEnemies = async () => {
    try {
      const r = await api.enemies();
      const list = r.enemies ?? [];
      if (!list.length) { const ph = el('option', null, '（没读到敌人，点「⟳ 刷新」）'); ph.value = ''; enemySel.replaceChildren(ph); return; }
      enemySel.replaceChildren(...list.map((e) => {
        const opt = el('option', null, `${e.name}  (${e.key})`);
        opt.value = e.key;
        return opt;
      }));
      if ([...enemySel.options].some((o) => o.value === 'enemy_1001_bigbo')) enemySel.value = 'enemy_1001_bigbo';
    } catch { /* 读不到就留空 */ }
  };
  refreshEnemies();
  body.append(row([enemySel]));
  body.append(row([el('span', { color: '#7b8ea3' }, '数量'), cntIn, el('span', { color: '#7b8ea3' }, '赏金'), coinIn,
    btn('加入下一波', () => api.bounty(enemySel.value, Number(cntIn.value) || 1, Number(coinIn.value) || 0)),
    btn('清空悬赏', () => api.unbounty())]));
  body.append(el('div', { marginTop: '6px', color: '#7b8ea3' }, '仅本机/内网；房间默认限 solo'));
  body.append(pickLine);
  body.append(log);
  return root;
}

api.show = () => { if (!panel) panel = buildPanel(); document.body.append(panel); };
api.hide = () => { if (panel) { panel.remove(); panel = null; } };
/** 打开面板（`__dev.ensure()`）。 */
api.ensure = () => { if (!panel) api.show(); return api; };

if (typeof window !== 'undefined') window.__dev = api;

// [CUSTOM] 键盘快捷键：Ctrl+Shift+D 开/关测试面板（不依赖房间界面那个按钮，
// 万一按钮被别的元素挡住也能用）。每次按都打一行日志，便于确认按键有没有生效。
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || !e.shiftKey) return;
    if (String(e.key).toLowerCase() !== 'd') return;
    e.preventDefault();
    if (panel) { api.hide(); console.log('[dev] hotkey → 面板已收起'); }
    else { api.ensure(); console.log('[dev] hotkey → 面板已打开'); }
  });
  console.log('[dev] 已加载：Ctrl+Shift+D 开/关测试面板；控制台可用 __dev.ensure() / await __dev.funds(500)');
}
window.__dev = api;   // 标记：dshDevHotkey

// [CUSTOM] 不再自动弹出：改由房间界面（单人房「测试模式」开关）调用 __dev.ensure()。
// 控制台仍然可以手动用 __dev.ensure() / __dev.show()。

export default api;
export { dev };
