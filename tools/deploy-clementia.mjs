#!/usr/bin/env node
// [CUSTOM] 部署干员「克莱门莎」(char_4231_clemnt) 到本机 —— 自包含、幂等。
//
// 用途：把"手工做过的 4 件事"固化成可在任何机器上重放的脚本，
//       供协作者在自己服务器上一条命令完成部署。
//
// 背景（为什么需要它）：
//   1) 官方 character_table.json 里有她的完整数据（六星 / 本源近卫 / 三技能 / 两天赋），
//      但官方赛季棋池 activity.AUTOCESS_SEASON.act2autochess 未收录她 —— 该配置
//      定稿早于她 2026-10-09 上线，所以 build-data 不会把她生成为棋子。
//   2) tools/fetch-assets.mjs 的下载计划来自硬编码资源索引（209 个干员），
//      新增干员不在其中 —— 即便把她的条目写进 .cache/assets-ledger.json，
//      fetch-assets 也不会下载她（实测：[plan] 始终保持 209 chars）。
//   3) data/assets.json 与 .cache/ 都不随 git 传递（前者是构建产物，后者被忽略）。
//
// 素材来源（按优先级）：
//   a) tools/clementia-assets/   —— 随仓库传递，无需联网
//   b) 社区资源仓库下载          —— 仓库里没有时才走网络（国内用 gh-proxy 加速）
//
// 本脚本做的事（幂等，可重复运行）：
//   1. 把她的 9 个素材就位到 public/assets/
//   2. 把她的素材登记进 data/assets.json（chars + skills）
//   3. 往 .cache/gamedata/excel/activity_table.json 写入 4 条棋池记录
//      （charChessDataDict ×2、charShopChessDatas ×1、chessNormalIdLookupDict ×1）
//   4. 修正 tools/build-data.mjs 的可见棋子断言（112 → 113）
//   5. 调 tools/apply-clementia-bond.mjs 把她登记进盟约成员名单（阿戈尔；只加棋池三张表不够，
//      盟约面板的「成员」列表读的是活动表 bondInfoDict.egirShip.chessIdList）
//   6. 调 tools/apply-clementia-spine.mjs 补上 data/assets.json 的 spine 清单条目
//      （第 2 步只写立绘/头像/技能图标；没有 `spine` 字段客户端就画不出她的战场小人，
//        见 tools/apply-clementia-spine.mjs 顶部说明）
//
// 注意：第 3/5 步改的是 .cache 里的官方活动表、第 6 步改的是已生成的 data/assets.json，
//       所以顺序是「先 deploy → 再 npm run build-data → 若 data 被重建则再跑一次 deploy」
//       （脚本对缺文件是幂等跳过的）。
//
// 之后请运行：npm run build-data && 重启服务 && 浏览器硬刷新

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, basename } from 'node:path';

const ROOT = process.cwd();
const CHAR_ID = 'char_4231_clemnt';
const SKILLS = ['skchr_clemnt_1', 'skchr_clemnt_2', 'skchr_clemnt_3'];
const B1 = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main';
const B2 = 'https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine';
const PROXY = 'https://gh-proxy.com/';
const LOCAL = resolve(ROOT, 'tools/clementia-assets');

// path（相对 public/assets/）→ { url, bytes, local }
const ASSETS = {
  [`char/avatar/${CHAR_ID}.png`]: { url: `${B1}/avatar/${CHAR_ID}.png`, bytes: 60030, local: `${CHAR_ID}.png` },
  [`char/portrait/${CHAR_ID}_1.png`]: { url: `${B1}/portrait/${CHAR_ID}_1.png`, bytes: 123182, local: `${CHAR_ID}_1.png` },
  [`char/portrait/${CHAR_ID}_2.png`]: { url: `${B1}/portrait/${CHAR_ID}_2.png`, bytes: 122030, local: `${CHAR_ID}_2.png` },
  'skill/skchr_clemnt_1.png': { url: `${B1}/skill/skill_icon_skchr_clemnt_1.png`, bytes: 19847, local: 'skchr_clemnt_1.png' },
  'skill/skchr_clemnt_2.png': { url: `${B1}/skill/skill_icon_skchr_clemnt_2.png`, bytes: 25967, local: 'skchr_clemnt_2.png' },
  'skill/skchr_clemnt_3.png': { url: `${B1}/skill/skill_icon_skchr_clemnt_3.png`, bytes: 28112, local: 'skchr_clemnt_3.png' },
  [`spine/op/${CHAR_ID}/front/${CHAR_ID}.atlas`]: { url: `${B2}/${CHAR_ID}/${CHAR_ID}/Front/${CHAR_ID}.atlas`, bytes: 11719, local: 'spine-front/char_4231_clemnt.atlas' },
  [`spine/op/${CHAR_ID}/front/${CHAR_ID}.skel`]: { url: `${B2}/${CHAR_ID}/${CHAR_ID}/Front/${CHAR_ID}.skel`, bytes: 1014317, local: 'spine-front/char_4231_clemnt.skel' },
  [`spine/op/${CHAR_ID}/front/${CHAR_ID}.png`]: { url: `${B2}/${CHAR_ID}/${CHAR_ID}/Front/${CHAR_ID}.png`, bytes: 217471, local: 'spine-front/char_4231_clemnt.png' },
};

const log = (...a) => console.log(...a);
let failed = 0;

// ─────────────────────────────────────────────
// 1) 素材就位（本地优先，下载兜底）
// ─────────────────────────────────────────────
log('=== 1) 素材就位 ===');
const sizeOk = (p, want) => existsSync(p) && statSync(p).size === want;

for (const [rel, { url, bytes, local }] of Object.entries(ASSETS)) {
  const dest = resolve(ROOT, 'public/assets', rel);
  if (sizeOk(dest, bytes)) { log('  [已有]   ' + rel); continue; }
  mkdirSync(dirname(dest), { recursive: true });

  // a) 仓库内的副本
  const src = resolve(LOCAL, local);
  if (sizeOk(src, bytes)) {
    copyFileSync(src, dest);
    log('  [本地]   ' + rel);
    continue;
  }
  if (existsSync(src)) {
    log('  [警告]   ' + local + ' 大小不符（期望 ' + bytes + '，实际 ' + statSync(src).size + '），改走下载');
  }

  // b) 网络下载
  let ok = false;
  for (const u of [PROXY + url, url]) {
    try {
      execFileSync('curl', ['-sS', '-L', '--retry', '2', '--retry-delay', '3', '--max-time', '180', '--connect-timeout', '30', '-o', dest, u], { stdio: 'inherit' });
      if (sizeOk(dest, bytes)) { log('  [下载]   ' + rel); ok = true; break; }
    } catch (e) { /* 换下一个源 */ }
  }
  if (!ok) { log('  [失败]   ' + rel + ' —— 网络问题；可把文件放进 tools/clementia-assets/ 后重跑'); failed++; }
}

if (failed) { log('\n[中止] 有 ' + failed + ' 个文件没就位，请处理后重跑本脚本。'); process.exit(1); }

// ─────────────────────────────────────────────
// 2) 登记进 data/assets.json
// ─────────────────────────────────────────────
log('\n=== 2) 登记 data/assets.json ===');
const AP = resolve(ROOT, 'data/assets.json');
if (!existsSync(AP)) { log('  [跳过] data/assets.json 不存在（先跑一次 npm run build-data 再重跑本脚本）'); }
else {
  const a = JSON.parse(readFileSync(AP, 'utf8'));
  const before = Object.keys(a.chars).length;
  const want = {
    avatar: `/assets/char/avatar/${CHAR_ID}.png`,
    portrait: `/assets/char/portrait/${CHAR_ID}_1.png`,
    portrait2: `/assets/char/portrait/${CHAR_ID}_2.png`,
  };
  let dirty = false;
  if (JSON.stringify(a.chars[CHAR_ID]) !== JSON.stringify(want)) { a.chars[CHAR_ID] = want; dirty = true; }
  for (const s of SKILLS) {
    const v = `/assets/skill/${s}.png`;
    if (a.skills[s] !== v) { a.skills[s] = v; dirty = true; }
  }
  if (!dirty) log('  [已登记] 无需改动');
  else {
    if (a.stats) { a.stats.chars = Object.keys(a.chars).length; a.stats.skills = Object.keys(a.skills).length; }
    const out = JSON.stringify(a);
    JSON.parse(out);
    copyFileSync(AP, AP + '.bak-clementia');
    writeFileSync(AP, out);
    log('  [完成]   chars ' + before + ' -> ' + Object.keys(a.chars).length + '，skills +' + SKILLS.length);
    log('  她的条目: ' + JSON.stringify(a.chars[CHAR_ID]));
  }
}

// ─────────────────────────────────────────────
// 3) 写入棋池（activity_table.json）
// ─────────────────────────────────────────────
log('\n=== 3) 写入棋池记录 ===');
const TP = resolve(ROOT, '.cache/gamedata/excel/activity_table.json');
if (!existsSync(TP)) { log('  [跳过] ' + TP + ' 不存在（先跑一次 npm run build-data）'); }
else {
  const find = (root, name) => {
    let hit = null;
    (function walk(node, path, depth) {
      if (hit || !node || typeof node !== 'object' || depth > 6) return;
      for (const k of Object.keys(node)) {
        if (k === name && node[k] && typeof node[k] === 'object') { hit = node[k]; return; }
        walk(node[k], path + '.' + k, depth + 1);
      }
    })(root, 'activity_table', 0);
    return hit;
  };
  const raw = readFileSync(TP, 'utf8');
  const data = JSON.parse(raw);
  const cd = find(data, 'charChessDataDict');
  const pool = find(data, 'charShopChessDatas');
  const look = find(data, 'chessNormalIdLookupDict');
  if (!cd || !pool || !look) { log('  [跳过] 三个字典没找全，上游结构可能变了'); }
  else {
    const inPool = Object.keys(pool).filter((k) => pool[k] && pool[k].charId === CHAR_ID);
    if (inPool.length) log('  [已写入] 棋池里已有她：' + JSON.stringify(inPool));
    else {
      const LEVEL = 6;                                  // 她的部署费用 19→23，属最高档
      const prefix = 'chess_char_' + LEVEL + '_';
      const used = [];
      Object.keys(cd).forEach((k) => {
        if (k.indexOf(prefix) !== 0) return;
        const parts = k.split('_');
        if (parts.length !== 5) return;
        const n = parseInt(parts[3], 10);
        if (Number.isInteger(n)) used.push(n);
      });
      const next = (used.length ? Math.max(...used) : 0) + 1;
      const pad = (n) => String(n).padStart(2, '0');
      const baseId = prefix + pad(next) + '_a';
      const goldenId = prefix + pad(next) + '_b';
      const ids = Object.keys(cd).map((k) => cd[k] && cd[k].identifier).filter((n) => Number.isInteger(n));
      const maxIdent = ids.length ? Math.max(...ids) : 0;

      // equipLevel 必须为 0：build-data.mjs:977 的规则是 equipLevel > 0 才算激活模组，
      // 而她尚无模组（uniequip 表里搜不到 clemnt），否则触发 inconsistent module choices。
      const cdA = {
        chessId: baseId, identifier: maxIdent + 1, isGolden: false,
        status: { evolvePhase: 'PHASE_2', charLevel: 1, skillLevel: 4, favorPoint: 0, equipLevel: 0 },
        upgradeChessId: goldenId, upgradeNum: 3,
        bondIds: ['egirShip'],                          // 她 nationId = egir → 阿戈尔
        garrisonIds: ['garrison_155_a', 'garrison_65_a'],
      };
      const cdB = {
        chessId: goldenId, identifier: maxIdent + 2, isGolden: true,
        status: { evolvePhase: 'PHASE_2', charLevel: 60, skillLevel: 7, favorPoint: 0, equipLevel: 0 },
        upgradeChessId: null, upgradeNum: 0,
        bondIds: ['egirShip'],
        garrisonIds: ['garrison_155_b', 'garrison_65_b'],
      };
      // charShopChessDatas 只存本体（_a）；精锐（_b）通过 lookup 指回本体
      const shopA = {
        chessId: baseId, goldenChessId: goldenId, chessLevel: LEVEL,
        shopLevelSortId: next, chessType: 'NORMAL', charId: CHAR_ID,
        tmplId: null, defaultSkillIndex: 1, defaultUniequipId: null,
        backupCharId: 'char_601_cguard', backupTmplId: null,
        backupCharSkillIndex: 2, backupCharUniequipId: null,
        backupCharPotRank: 0, isHidden: false,
      };

      const nextData = JSON.parse(raw);
      const nCd = find(nextData, 'charChessDataDict');
      const nPool = find(nextData, 'charShopChessDatas');
      const nLook = find(nextData, 'chessNormalIdLookupDict');
      nCd[baseId] = cdA;
      nCd[goldenId] = cdB;
      nPool[baseId] = shopA;
      nLook[goldenId] = baseId;

      const out = JSON.stringify(nextData);
      JSON.parse(out);
      if (!nCd[baseId] || !nCd[goldenId] || !nPool[baseId] || nLook[goldenId] !== baseId) {
        log('  [中止] 写入校验失败，未落盘'); process.exit(1);
      }
      copyFileSync(TP, TP + '.bak-clementia');
      writeFileSync(TP, out);
      log('  [完成]   ' + baseId + ' / ' + goldenId + '（identifier ' + (maxIdent + 1) + '/' + (maxIdent + 2) + '）');
    }
  }
}

// ─────────────────────────────────────────────
// 4) 把她登记进所属盟约的成员名单（阿戈尔 / egirShip）
// ─────────────────────────────────────────────
log('\n=== 4) 登记盟约成员名单（阿戈尔）===');
const BOND_TOOL = resolve(ROOT, 'tools/apply-clementia-bond.mjs');
if (!existsSync(BOND_TOOL)) log('  [跳过] tools/apply-clementia-bond.mjs 不存在，请手动把 ' + CHAR_ID + ' 加入 bondInfoDict.egirShip.chessIdList');
else {
  try {
    execFileSync('node', [BOND_TOOL], { stdio: 'inherit', cwd: ROOT });
  } catch (e) {
    log('  [失败] apply-clementia-bond.mjs 未成功（退出码 ' + (e && e.status) + '）—— 详情见上面输出');
    failed++;
  }
}

// ─────────────────────────────────────────────
// 5) 修正 build-data.mjs 的可见棋子断言
// ─────────────────────────────────────────────
log('\n=== 5) 修正构建断言（可见棋子 112 → 113）===');
const BP = resolve(ROOT, 'tools/build-data.mjs');
if (!existsSync(BP)) log('  [跳过] tools/build-data.mjs 不存在');
else {
  const t = readFileSync(BP, 'utf8');
  const OLD = 'if (visible.length !== 112) err(';
  const NEW = 'if (visible.length !== 113) err(';
  if (t.indexOf(NEW) >= 0) log('  [已修正] 已是 113');
  else if (t.indexOf(OLD) < 0) log('  [跳过] 没找到该断言（上游可能改了），请手动检查：grep -n "visible non-DIY" tools/build-data.mjs');
  else {
    const out = t.split(OLD).join(NEW);
    if (out.indexOf(OLD) >= 0) { log('  [中止] 替换后仍有残留'); process.exit(1); }
    copyFileSync(BP, BP + '.bak-clementia-check');
    writeFileSync(BP, out);
    log('  [完成]   112 → 113');
  }
}

// ─────────────────────────────────────────────
// 6) 补 data/assets.json 的 spine 清单条目
// ─────────────────────────────────────────────
log('\n=== 6) 补 spine 清单条目（客户端靠它加载战场小人）===');
const SP = resolve(ROOT, 'tools/apply-clementia-spine.mjs');
if (!existsSync(SP)) log('  [跳过] tools/apply-clementia-spine.mjs 不存在，请手动补 spine 条目');
else {
  try {
    execFileSync('node', [SP, ROOT], { stdio: 'inherit' });
  } catch (e) {
    log('  [失败] apply-clementia-spine.mjs 未成功（退出码 ' + (e && e.status) + '）—— 详情见上面输出');
    failed++;
  }
}

log('\n===== 全部完成 =====');
log('下一步：');
log('  1) npm run build-data      # 期望 chess=268');
log('  2) 重启服务                # 然后浏览器硬刷新（Ctrl+Shift+R）');
