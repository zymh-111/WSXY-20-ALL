#!/usr/bin/env bash
# [CUSTOM] 重建本体数据（**必须用这个脚本**，不要直接跑 `npm run build-data`）。
#
# 为什么：结城理是"联动 6★"出身，上游因版权把他排除在自选池外（build-data.mjs 的
# DIY_EXCLUDED_TEAMS）。本 fork 通过两个**默认关闭**的环境变量把他收进来：
#   DSH_DIY_FORCE_PICKS   —— 无视联动排除，进自选池
#   DSH_DIY_FORCE_BONDS   —— 指定他的盟约（拉特兰 + 突袭）
# 不带这两个变量跑 build-data，data/backups.json 会被重建为**不含他**的版本，
# 他会从自选池里消失（外观上像"人没了"）。
#
# 用法： bash tools/rebuild-makoto.sh
#        （或 node tools/rebuild-makoto.sh 会失败——这是 shell 脚本）

set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

echo "=== 重建本体数据（含结城理）==="
DSH_DIY_FORCE_PICKS='char_4217_makoto' \
DSH_DIY_FORCE_BONDS='char_4217_makoto=lateranoShip|raidShip' \
  node tools/build-data.mjs

echo
echo "=== 校验 ==="
node -e '
const fs = require("fs");
const b = JSON.parse(fs.readFileSync("data/backups.json", "utf8"));
const id = "char_4217_makoto";
const inPool = (b.diy.ownedPool ?? []).includes(id);
const u = b.units?.[id];
const o = b.diy.operators?.[id];
if (!inPool || !u || !o) {
  console.error("  ✗ 重建结果里没有他 —— 构建可能没带上环境变量！");
  process.exit(1);
}
console.log("  ✓ 自选池:", b.diy.ownedPool.length, "人（含他）");
console.log("  ✓ 形态  :", Object.keys(u.forms).join(", "));
console.log("  ✓ 盟约  :", JSON.stringify(o.bonds));
const ok = JSON.stringify(o.bonds) === JSON.stringify(["lateranoShip","raidShip"]);
if (!ok) { console.error("  ✗ 盟约不对（期望 [\"lateranoShip\",\"raidShip\"]）"); process.exit(1); }
console.log("");
console.log("  下一步（若素材尚未登记）：");
console.log("    node tools/deploy-makoto.mjs && node tools/apply-makoto-assets.mjs && node tools/apply-makoto-spine.mjs");
'
