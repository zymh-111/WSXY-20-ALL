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
const OPS = Object.freeze(['state', 'funds', 'level', 'refresh', 'layers', 'layersAll']);

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
    try { const r = await api.state(); status.textContent = JSON.stringify(r, null, 1); }
    catch (e) { status.textContent = String(e.message ?? e); }
  };

  root.append(status);
  root.append(row([btn('读状态', show), btn('+500 资金', () => api.funds(500))]));
  root.append(row([btn('+1 等级', () => api.level(1)), btn('+5 等级', () => api.level(5)), btn('免费刷新', () => api.refresh())]));
  root.append(row([btn('+9 拉特兰层', () => api.layers('lateranoShip', 9)), btn('全盟约 +3', () => api.layersAll(3))]));
  root.append(el('div', { marginTop: '6px', color: '#7b8ea3' }, '仅本机/内网 + solo 单人房'));
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
