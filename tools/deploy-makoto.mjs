#!/usr/bin/env node
// [CUSTOM] 部署干员「结城理」(char_4217_makoto) 的素材 —— 头像 / 立绘 / 技能图标 / 战场模型(spine)
// 与 deploy-clementia.mjs 同一套路：本地副本优先（随仓库传递），否则从社区资源仓库下载。
//
// 用法：node tools/deploy-makoto.mjs [仓库根目录]
// 之后：node tools/apply-makoto-patch.mjs && npm run build-data && node tools/apply-makoto-spine.mjs

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const CHAR_ID = 'char_4217_makoto';
const SKILLS = ['skchr_makoto_1', 'skchr_makoto_2', 'skchr_makoto_3'];
const B1 = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main';
const B2 = 'https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine';
const PROXY = 'https://gh-proxy.com/';
const LOCAL = resolve(ROOT, 'tools/makoto-assets');

// path（相对 public/assets/）→ { url, local }（字节数不硬编码：下完自己校验非空 + PNG 魔术）
const ASSETS = {
  [`char/avatar/${CHAR_ID}.png`]: { url: `${B1}/avatar/${CHAR_ID}.png`, local: `${CHAR_ID}.png` },
  [`char/avatar/${CHAR_ID}_2.png`]: { url: `${B1}/avatar/${CHAR_ID}_2.png`, local: `${CHAR_ID}_2.png` },
  [`char/portrait/${CHAR_ID}_1.png`]: { url: `${B1}/portrait/${CHAR_ID}_1.png`, local: `${CHAR_ID}_1.png` },
  [`char/portrait/${CHAR_ID}_2.png`]: { url: `${B1}/portrait/${CHAR_ID}_2.png`, local: `${CHAR_ID}_2.png` },
  [`skill/${SKILLS[0]}.png`]: { url: `${B1}/skill/skill_icon_${SKILLS[0]}.png`, local: `${SKILLS[0]}.png` },
  [`skill/${SKILLS[1]}.png`]: { url: `${B1}/skill/skill_icon_${SKILLS[1]}.png`, local: `${SKILLS[1]}.png` },
  [`skill/${SKILLS[2]}.png`]: { url: `${B1}/skill/skill_icon_${SKILLS[2]}.png`, local: `${SKILLS[2]}.png` },
  [`spine/op/${CHAR_ID}/front/${CHAR_ID}.atlas`]: { url: `${B2}/${CHAR_ID}/${CHAR_ID}/Front/${CHAR_ID}.atlas`, local: 'spine-front/char_4217_makoto.atlas' },
  [`spine/op/${CHAR_ID}/front/${CHAR_ID}.skel`]: { url: `${B2}/${CHAR_ID}/${CHAR_ID}/Front/${CHAR_ID}.skel`, local: 'spine-front/char_4217_makoto.skel' },
  [`spine/op/${CHAR_ID}/front/${CHAR_ID}.png`]: { url: `${B2}/${CHAR_ID}/${CHAR_ID}/Front/${CHAR_ID}.png`, local: 'spine-front/char_4217_makoto.png' },
};

const log = (...a) => console.log(...a);
let failed = 0;

/** 文件可信判据：存在 + 非空 +（PNG 看魔术字节 / 文本看内容）。 */
function valid(abs, rel) {
  if (!existsSync(abs)) return false;
  const st = statSync(abs);
  if (st.size < 64) return false;
  if (rel.endsWith('.png')) {
    const b = readFileSync(abs).subarray(0, 8);
    return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  }
  if (rel.endsWith('.atlas')) return readFileSync(abs, 'utf8').includes('.png');
  return true; // .skel: 非空即可（真正解析交给 spine 工具）
}

log('=== 素材就位 ===');
for (const [rel, { url, local }] of Object.entries(ASSETS)) {
  const dest = resolve(ROOT, 'public/assets', rel);
  if (valid(dest, rel)) { log('  [已有]   ' + rel); continue; }
  mkdirSync(dirname(dest), { recursive: true });

  const src = resolve(LOCAL, local);
  if (valid(src, rel)) { copyFileSync(src, dest); log('  [本地]   ' + rel); continue; }

  let ok = false;
  for (const u of [PROXY + url, url]) {
    try {
      execFileSync('curl', ['-sS', '-L', '--retry', '2', '--retry-delay', '3', '--max-time', '240',
        '--connect-timeout', '30', '-o', dest, u], { stdio: 'ignore' });
      if (valid(dest, rel)) { log('  [下载]   ' + rel + '  (' + statSync(dest).size + ' B)'); ok = true; break; }
    } catch { /* 换下一个源 */ }
  }
  if (!ok) { log('  [失败]   ' + rel + ' —— 可把文件放进 tools/makoto-assets/ 后重跑'); failed++; }
}

if (failed) {
  log('\n[中止] 有 ' + failed + ' 个文件没就位，请处理后重跑本脚本。');
  process.exit(1);
}
log('\n[完成] 10 个素材已就位。');
log('下一步：');
log('  1) node tools/apply-makoto-patch.mjs   # 收录进自选池');
log('  2) npm run build-data');
log('  3) node tools/apply-makoto-spine.mjs   # 写 data/assets.json 的 spine 条目');
log('  4) 重启服务');
