// test/client/dev-panel-dom.test.js — [CUSTOM] 后门面板的 DOM 构建与自动弹出。
//
// dev-panel.test.js 只测了 API 转发；这里补上"面板真的能构建出来、且会自动弹出"：
// 用最小的假 document/localStorage，加载 public/js/dev.js，然后
//   ① 调用 __dev.ensure() 构建面板（不能抛错、且确实挂进 body）
//   ② 自动弹出逻辑会在 readyState 非 loading 时安排一次 tick（用假 setTimeout 捕获）
// 这能挡住"面板只在控制台里能用"或"构建时炸掉"这类回归。

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** 极简假 DOM：只需 dev.js 用到的那几个 API。 */
function makeFakeDom() {
  const make = (tag) => {
    const n = {
      tagName: String(tag).toUpperCase(), children: [], style: {}, dataset: {}, options: [],
      textContent: '', value: '', checked: false, type: '', className: '',
      append(...kids) { for (const k of kids) if (k) { k.parent = this; this.children.push(k); } },
      appendChild(k) { k.parent = this; this.children.push(k); return k; },
      replaceChildren(...kids) { for (const k of this.children) k.parent = null; this.children = kids.filter(Boolean); for (const k of this.children) k.parent = this; },
      remove() {
        this.removed = true;
        const p = this.parent;
        if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); this.parent = null; }
      },
      setAttribute(k, v) { this[k] = v; },
      addEventListener() {},
      setPointerCapture() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 260, height: 200 }; },
    };
    return n;
  };
  const body = make('body');
  const app = make('div');
  app.childElementCount = 1;   // 假装已经挂载了内容
  const byId = { app };
  const doc = {
    readyState: 'complete',
    body,
    documentElement: make('html'),
    createElement: (t) => make(t),
    getElementById: (id) => byId[id] ?? null,
    addEventListener() {},
  };
  return { doc, body, app };
}

function installFakeGlobals() {
  const { doc, body } = makeFakeDom();
  const timers = [];
  const store = new Map();
  globalThis.window = { innerWidth: 1280, innerHeight: 720, addEventListener() {} };
  globalThis.document = doc;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.setTimeout = ((fn) => { timers.push(fn); return timers.length; });
  return { body, timers, restore: () => {
    delete globalThis.window; delete globalThis.document; delete globalThis.localStorage;
    delete globalThis.setTimeout;
  } };
}

/** 统计一棵假 DOM 树里的元素数量。 */
function count(node) {
  let n = 1;
  for (const c of node.children ?? []) n += count(c);
  return n;
}

test('面板：__dev.ensure() 能构建出面板并挂进 body', async () => {
  const g = installFakeGlobals();
  try {
    const mod = await import('../../public/js/dev.js?case=1');   // 查询串避免模块缓存
    assert.equal(typeof globalThis.window.__dev, 'object', '__dev 挂在 window 上');
    assert.equal(g.body.children.length, 0, '一开始 body 是空的');
    mod.default.ensure();
    assert.equal(g.body.children.length, 1, 'ensure() 后 body 里有一个面板节点');
    const panel = g.body.children[0];
    assert.ok(count(panel) > 15, `面板里有足够多的控件（实得 ${count(panel)} 个节点）`);
    // 面板上应当有开关用的 checkbox（type=checkbox）
    const hasCheckbox = (function walk(n) {
      if (n.type === 'checkbox') return true;
      return (n.children ?? []).some(walk);
    })(panel);
    assert.equal(hasCheckbox, true, '面板上有开关勾选框');
    // 再调一次不应重复挂
    mod.default.ensure();
    assert.equal(g.body.children.length, 1, 'ensure() 幂等');
    // hide() 能收起来
    mod.default.hide();
    assert.equal(panel.removed, true, 'hide() 移除了面板');
  } finally { g.restore(); }
});

test('面板：不再自动弹出（改由房间界面的「测试模式」开关触发）', async () => {
  const g = installFakeGlobals();
  try {
    await import('../../public/js/dev.js?case=2');
    // 模块加载后**不应**有排队的自动弹出回调
    assert.equal(g.timers.length, 0, '没有自动弹出的延迟调用');
    assert.equal(g.body.children.length, 0, 'body 仍是空的（不上来就弹窗）');
    // 只有显式调用（房间开关 / 控制台）才出现
    globalThis.window.__dev.ensure();
    assert.equal(g.body.children.length, 1, '__dev.ensure() 仍可用（房间开关走的就是它）');
  } finally { g.restore(); }
});

test('面板：ensure() 是幂等的，hide() 后可以再 ensure()', async () => {
  const g = installFakeGlobals();
  try {
    const mod = await import('../../public/js/dev.js?case=3');
    mod.default.ensure();
    mod.default.ensure();
    assert.equal(g.body.children.length, 1, '重复 ensure 不重复挂载');
    mod.default.hide();
    mod.default.ensure();
    assert.equal(g.body.children.length, 1, 'hide() 之后还能再打开');
  } finally { g.restore(); }
});
