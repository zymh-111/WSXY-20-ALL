// test/client/dev-panel.test.js — [CUSTOM] 测试后门前端：协议登记 + __dev 面板 API 的转发与报错。
//
// 服务端的门禁由 test/match/dev-backdoor.test.js 覆盖；这里只管客户端这一侧：
//   1) shared/protocol.js 的 C2S 表登记了 dev（否则 validateC2S 直接拒发，后门在浏览器里根本用不了）
//   2) public/js/dev.js 发的 op / 字段正确，且把服务端的拒绝原因原样报出来（BAD_TARGET 会给出提示）
//      —— 用假的 window + 假 net 验证（dev.js 是浏览器模块，测试里注入 globalThis.window 即可加载）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateC2S } from '../../shared/protocol.js';

// ── 协议登记 ────────────────────────────────────────────────────────────────

test('协议：C2S 登记了 dev，合法消息通过、非法字段被拒', () => {
  assert.equal(validateC2S({ t: 'dev', op: 'state' }), null, 'state 合法');
  assert.equal(validateC2S({ t: 'dev', op: 'funds', n: 500 }), null, 'funds + n 合法');
  assert.equal(validateC2S({ t: 'dev', op: 'layers', bondId: 'lateranoShip', n: 9 }), null, 'layers 合法');
  assert.equal(validateC2S({ t: 'dev', op: 'refresh' }), null, 'refresh 合法');

  assert.ok(validateC2S({ t: 'dev' }), '缺 op 被拒');
  assert.ok(validateC2S({ t: 'dev', op: '' }), 'op 为空被拒');
  assert.ok(validateC2S({ t: 'dev', op: 'funds', n: 1.5 }), 'n 非整数被拒');
  assert.ok(validateC2S({ t: 'dev', op: 'funds', n: '500' }), 'n 非数字被拒');
  assert.ok(validateC2S({ t: 'dev', op: 'layers', bondId: 123 }), 'bondId 非字符串被拒');
  assert.ok(validateC2S({ t: 'dev', op: 'state', rid: 'x' }), 'rid 非法被拒');
});

// ── 面板 API（浏览器模块，注入假 window 后加载）──────────────────────────────

/** 装一个最小 window 与假的 net.request，返回加载后的 dev 模块。 */
async function loadPanel({ request } = {}) {
  const calls = [];
  globalThis.window = {};
  const netMod = await import('../../public/js/net.js');
  const orig = netMod.net.request;
  netMod.net.request = async (t, fields) => {
    calls.push([t, fields]);
    if (request) return request(t, fields);
    return { ok: true, echo: fields };
  };
  const mod = await import('../../public/js/dev.js');
  return { mod, calls, restore: () => { netMod.net.request = orig; delete globalThis.window; } };
}

test('面板：__dev 暴露在 window 上，且每个方法发对应的 op', async () => {
  const { mod, calls, restore } = await loadPanel();
  try {
    assert.equal(globalThis.window.__dev, mod.default, '__dev 挂在 window 上');
    assert.equal(typeof globalThis.window.__dev.ensure, 'function', '有 ensure()');

    await mod.default.state();
    await mod.default.funds(500);
    await mod.default.level(3);
    await mod.default.refresh();
    await mod.default.layers('lateranoShip', 9);
    await mod.default.layersAll(3);

    assert.deepEqual(calls.map((c) => c[0]), ['dev', 'dev', 'dev', 'dev', 'dev', 'dev'], '全部走 t=dev');
    assert.deepEqual(calls[0][1], { op: 'state' });
    assert.deepEqual(calls[1][1], { op: 'funds', n: 500 });
    assert.deepEqual(calls[2][1], { op: 'level', n: 3 });
    assert.deepEqual(calls[3][1], { op: 'refresh' });
    assert.deepEqual(calls[4][1], { op: 'layers', bondId: 'lateranoShip', n: 9 });
    assert.deepEqual(calls[5][1], { op: 'layersAll', n: 3 });
  } finally { restore(); }
});

test('面板：未知 op 在本地就拒掉，不发请求', async () => {
  const { mod, calls, restore } = await loadPanel();
  try {
    await assert.rejects(() => mod.dev('nope'), /unknown op/);
    assert.equal(calls.length, 0, '没有发出去');
  } finally { restore(); }
});

test('面板：服务端拒绝（BAD_TARGET）时把原因报出来，并提示门禁范围', async () => {
  const { mod, restore } = await loadPanel({
    request: () => { const e = new Error('solo rooms only'); e.code = 'BAD_TARGET'; throw e; },
  });
  try {
    await assert.rejects(() => mod.default.funds(10), (e) => {
      assert.match(e.message, /BAD_TARGET/, '带上错误码');
      assert.match(e.message, /solo rooms only/, '带上服务端的原因');
      assert.match(e.message, /本机\/内网 \+ solo 单人房/, '提示门禁范围');
      return true;
    });
  } finally { restore(); }
});
