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
  'devStatus', 'devToggle']);

/** 发一条后门指令；失败把服务端的 error/detail 原样抛出来。 */
async function dev(op, fields = {}) {
  if (!OPS.includes(op)) throw new Error(`dev: unknown op ${op}`);
  try {
    return await net.request('dev', { op, ...fields });
  } catch (e) {
    const code = e && e.code ? e.code : 'ERROR';
    const detail = e && e.message ? e.message : String(e);
    throw new Error(`dev ${op} 失败：${code}${detail ? ' — ' + detail : ''}` +
      (code === 'BAD_TARGET' ? '（后门只对「本机/内网 + solo 单人房」生效）' : ''));
  }
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
  /** 自选槽换成指定干员（槽位为空则用六阶 diy1）。 */
  pick: (charId, slot = 'chess_char_6_diy1_a', skillIndex = 0) => dev('pick', { slot, charId, skillIndex }),
  /** 自选池清单（面板下拉用）。 */
  opPool: () => dev('opPool'),
  /** 槽位与房间信息（含放宽开关状态）。 */
  ops: () => dev('ops'),
  /** 后门开关状态（不需要开关已开）。 */
  devStatus: () => dev('devStatus'),
  /** 开/关本房间的后门开关。 */
  devToggle: (on) => dev('devToggle', typeof on === 'boolean' ? { on } : {}),
  dev,
};

let panel = null;

function el(tag, style, text) {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

function buildPanel() {
  const root = el('div', {
    position: 'fixed', top: '10px', right: '10px', zIndex: '99999', width: '260px',
    background: 'rgba(12,16,22,0.94)', color: '#d8e2ee', font: '12px/1.5 ui-monospace,monospace',
    border: '1px solid #2c3a4c', borderRadius: '8px', padding: '10px', boxShadow: '0 6px 24px rgba(0,0,0,.5)',
  });
  const head = el('div', { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' });
  head.append(el('b', { color: '#8fd0ff' }, '测试后门 (dev)'));
  const close = el('span', { cursor: 'pointer', color: '#ff9a9a' }, '✕');
  close.onclick = () => api.hide();
  head.append(close);
  root.append(head);

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
    try { const r = await api.state(); status.textContent = JSON.stringify(r, null, 1); return r; }
    catch (e) { status.textContent = String(e.message ?? e); return null; }
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
  const refreshOps = async () => {
    try {
      const { ops } = await api.opPool();
      opSel.replaceChildren(...ops.map((o) => {
        const opt = el('option', null, o.name + '  (' + o.charId + ')');
        opt.value = o.charId;
        return opt;
      }));
      const mk = ops.find((o) => o.charId === 'char_4217_makoto');
      if (mk) opSel.value = mk.charId;
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

  root.append(status);
  root.append(row([btn('读状态', async () => { const r = await show(); await refreshBonds(); await refreshOps(); return r; }), btn('+500 资金', () => api.funds(500))]));
  root.append(row([btn('+1 等级', () => api.level(1)), btn('+5 等级', () => api.level(5)), btn('免费刷新', () => api.refresh())]));
  root.append(row([bondSel, layerNum, btn('设层数', () => api.setLayers(bondSel.value, Number(layerNum.value) || 0))]));
  root.append(row([btn('全盟约 +3', () => api.layersAll(3))]));
  root.append(el('div', { marginTop: '6px', color: '#8fd0ff' }, '自选干员 → 塞进槽位（选完点“塞入”）'));
  root.append(row([slotSel, opSel]));
  root.append(row([btn('塞入', () => api.pick(opSel.value, slotSel.value))]));
  root.append(el('div', { marginTop: '6px', color: '#7b8ea3' }, '仅本机/内网；房间默认限 solo'));
  root.append(log);
  return root;
}

api.show = () => { if (!panel) panel = buildPanel(); document.body.append(panel); };
api.hide = () => { if (panel) { panel.remove(); panel = null; } };
/** 打开面板（`__dev.ensure()`）。 */
api.ensure = () => { if (!panel) api.show(); return api; };

if (typeof window !== 'undefined') window.__dev = api;

export default api;
export { dev };
