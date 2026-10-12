// [CUSTOM] 接入测试后门的前端（协议登记 + 客户端面板）。
// 三处改动（都幂等，可回退 node tools/revert-dev-client.mjs）：
//   1) shared/protocol.js —— C2S 表里登记 `dev`（客户端 validateC2S 对未登记的 t 直接拒发）
//   2) public/js/dev.js   —— 新增（面板 + __dev API）
//   3) public/js/main.js  —— 把 dev 挂到已有的全局命名空间 __SP__ 上
//
// 用法：node tools/apply-dev-client.mjs [仓库根目录]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const PROTO = join(ROOT, 'shared/protocol.js');
const MAIN = join(ROOT, 'public/js/main.js');
const die = (m) => { console.error('[中止] ' + m); process.exit(1); };
for (const [p, what] of [[PROTO, 'shared/protocol.js'], [MAIN, 'public/js/main.js']]) {
  if (!existsSync(p)) die(`找不到 ${what} —— 请在仓库根目录运行。`);
}
const MARK = 'DEV_BACKDOOR';

const PROTO_OLD = `  'room.removeSpectator': { playerId: isId },`;
const PROTO_NEW = `  'room.removeSpectator': { playerId: isId },
  // [CUSTOM ${MARK}] 测试后门：{ t:'dev', op, ...参数 } —— 仅本机/内网 + solo 单人房，
  // 服务端见 server/match/dev.js。字段校验只判类型，真正的门禁在服务端。
  dev: { op: (v) => typeof v === 'string' && v.length > 0 && v.length <= 32, n: (v) => v == null || Number.isSafeInteger(v), bondId: (v) => v == null || (typeof v === 'string' && v.length <= 64), $optional: ['n', 'bondId'] },`;

const MAIN_OLD = '  globalThis.__SP__ = { store, net, data, version: 1 };';
const MAIN_NEW = `  globalThis.__SP__ = { store, net, data, version: 1 };
  // [CUSTOM ${MARK}] 测试后门面板（仅本机/内网 + solo 单人房）：控制台 __dev.ensure() 打开，或 __SP__.dev.show()
  import('./dev.js').then((m) => { globalThis.__SP__.dev = m.default; }).catch((e) => console.warn('[dev] panel failed to load', e));`;

const edits = [
  ['protocol.js: 登记 dev', PROTO, PROTO_OLD, PROTO_NEW],
  ['main.js: 挂 __SP__.dev', MAIN, MAIN_OLD, MAIN_NEW],
];

const protoText = readFileSync(PROTO, 'utf8');
const mainText = readFileSync(MAIN, 'utf8');
if (protoText.includes(MARK) && mainText.includes(MARK)) {
  console.log('[已应用] 测试后门的前端已接好（protocol.js + main.js）。');
  process.exit(0);
}

const byFile = new Map();
for (const [name, file, from, to] of edits) {
  const text = readFileSync(file, 'utf8');
  const n = text.split(from).length - 1;
  if (n !== 1) die(`“${name}”锚点出现 ${n} 次（期望 1 次）—— 上游可能已更新，本补丁需要复核。`);
  if (!byFile.has(file)) byFile.set(file, readFileSync(file, 'utf8'));
  byFile.set(file, byFile.get(file).replace(from, to));
}
for (const [file, out] of byFile) {
  if (!out.includes(MARK)) die(`${file} 替换后校验失败，未写入任何文件。`);
}
for (const [file, out] of byFile) {
  copyFileSync(file, file + '.bak-dev-client');
  writeFileSync(file, out);
  console.log('[完成] ' + file.replace(ROOT + '/', ''));
}
console.log('');
console.log('用法（本机/内网 + solo 单人房，进对局后）：');
console.log('  浏览器控制台：__dev.ensure()      # 打开面板');
console.log('  或：await __dev.funds(500)       # 免抽卡加资金');
