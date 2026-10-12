// [CUSTOM] 给服务端接上测试后门（仅本机/内网 + solo 单人房）：
//   1) server/net.js  —— 把「来源是否为本机/内网」随消息一起交给 handler（conn.ip 由 clientAddress 算好）
//   2) server/lobby.js —— 挂上 `dev` 消息类型，转给 server/match/dev.js
//
// 幂等：两处都已存在则跳过；只改到一半则中止（不写文件）。
// 回退：node tools/revert-dev-backdoor.mjs
//
// 用法：node tools/apply-dev-backdoor.mjs [仓库根目录]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const NET = join(ROOT, 'server/net.js');
const LOBBY = join(ROOT, 'server/lobby.js');
const die = (m) => { console.error('[中止] ' + m); process.exit(1); };
for (const [p, what] of [[NET, 'server/net.js'], [LOBBY, 'server/lobby.js']]) {
  if (!existsSync(p)) die(`找不到 ${what} —— 请在仓库根目录运行。`);
}

const MARK = 'DEV_BACKDOOR';

// ── 1) net.js：把 isLocal 带上 ────────────────────────────────────────────────
const NET_OLD = '      else res = this.handler.onMessage(conn.session, msg);';
const NET_NEW = `      // [CUSTOM ${MARK}] 把「来源是否为本机/内网」一并交给 handler（conn.ip 由 clientAddress 算好，
      // 这里用 net.js 自己的 isLocalIp 判定）。只有测试后门用得到，见 server/match/dev.js。
      else res = this.handler.onMessage(conn.session, msg, { isLocal: isLocalIp(conn.ip) });`;

// ── 2) lobby.js：挂 dev 消息类型 ──────────────────────────────────────────────
const LOBBY_IMPORT_OLD = "import { LobbyDiscovery } from './lobbyDiscovery.js';";
const LOBBY_IMPORT_NEW = `import { LobbyDiscovery } from './lobbyDiscovery.js';
import { handleDev } from './match/dev.js';   // [CUSTOM ${MARK}] 测试后门（仅本机/内网 + solo）`;

const LOBBY_MSG_OLD = "      case 'room.spectate': return this.spectate(session, msg);";
const LOBBY_MSG_NEW = `      case 'room.spectate': return this.spectate(session, msg);
      // [CUSTOM ${MARK}] 测试后门：只对本机/内网 + solo 单人房生效，见 server/match/dev.js
      case 'dev': return handleDev(this, session, msg, ctx);`;

const LOBBY_SIG_OLD = `  onMessage(session, msg) {`;
const LOBBY_SIG_NEW = `  onMessage(session, msg, ctx = {}) {`;

const edits = [
  ['net.js: 传 isLocal', NET, NET_OLD, NET_NEW],
  ['lobby.js: 导入 handleDev', LOBBY, LOBBY_IMPORT_OLD, LOBBY_IMPORT_NEW],
  ['lobby.js: onMessage 接收 ctx', LOBBY, LOBBY_SIG_OLD, LOBBY_SIG_NEW],
  ['lobby.js: 挂 dev 分支', LOBBY, LOBBY_MSG_OLD, LOBBY_MSG_NEW],
];

// 幂等检查
const netText = readFileSync(NET, 'utf8');
const lobbyText = readFileSync(LOBBY, 'utf8');
if (netText.includes(MARK) && lobbyText.includes(MARK)) {
  console.log('[已应用] 测试后门已经接好（net.js + lobby.js）。');
  process.exit(0);
}

// 逐文件校验锚点唯一，再写
const byFile = new Map();
for (const [name, file, from, to] of edits) {
  const text = readFileSync(file, 'utf8');
  const n = text.split(from).length - 1;
  if (n !== 1) die(`“${name}”锚点出现 ${n} 次（期望 1 次）—— 上游可能已更新，本补丁需要复核。`);
  if (!byFile.has(file)) byFile.set(file, readFileSync(file, 'utf8'));
  byFile.set(file, byFile.get(file).replace(from, to));
}
for (const [file, out] of byFile) {
  const orig = readFileSync(file, 'utf8');
  if (out === orig || !out.includes(MARK)) die(`${file} 替换后校验失败，未写入任何文件。`);
}

for (const [file, out] of byFile) {
  copyFileSync(file, file + '.bak-dev-backdoor');
  writeFileSync(file, out);
  console.log('[完成] ' + file.replace(ROOT + '/', '') + `（备份 ${file.replace(ROOT + '/', '')}.bak-dev-backdoor）`);
}
console.log('');
console.log('后门已就位：服务端接受 `{ t: "dev", op: ... }`，仅本机/内网 + solo 单人房。');
console.log('测试：node --test test/match/dev-backdoor.test.js');
console.log('撤销：node tools/revert-dev-backdoor.mjs');
