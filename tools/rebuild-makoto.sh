#!/usr/bin/env bash
# [CUSTOM] 重建本体数据（**需要 .cache/**；没有就跳过，因为 data/ 已经入库了）。
#
# 为什么需要这个脚本：结城理是"联动 6★"出身，上游因版权把他排除在自选池外
# （build-data.mjs 的 DIY_EXCLUDED_TEAMS）。本 fork 用两个**默认关闭**的环境变量收他进来：
#   DSH_DIY_FORCE_PICKS  无视联动排除进自选池
#   DSH_DIY_FORCE_BONDS  指定盟约（拉特兰 + 突袭）
# **不带这两个变量**跑 build-data，data/backups.json 会被重建为不含他的版本，他会从自选池消失。
#
# 关于 .cache/：它是官方游戏表（121MB），被 .gitignore 排除、**不在库里**。
#   · 本机/线上服务器有它（跑过 tools/fetch-data 之类）→ 正常重建
#   · 朋友新克隆的仓库没有它 → **跳过重建**，直接用库里的 data/（已含结城理），
#     退出码 0（不算失败），因为 data/ 是入库的构建产物。
#
# 用法： bash tools/rebuild-makoto.sh

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

TABLES=".cache/gamedata/excel"
if [ ! -f "$TABLES/character_table.json" ]; then
  echo "=== 跳过重建：没有官方游戏表（$TABLES）==="
  echo "  这是正常的 —— .cache/ 不在版本库里（121MB，被 .gitignore 排除）。"
  echo "  库里的 data/ 已经是构建产物，且已包含结城理，直接可用。"
  echo
  echo "  若你确实要重建（例如改了 content 或 data 生成逻辑），需要先准备官方表："
  echo "    见 docs/DATA.md 的取数说明（tools/ 下的取数脚本）"
  exit 0
fi

echo "=== 重建本体数据（含结城理）==="
DSH_DIY_FORCE_PICKS='char_4217_makoto' \
DSH_DIY_FORCE_BONDS='char_4217_makoto=lateranoShip|raidShip' \
  node tools/build-data.mjs || exit 1

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
if (JSON.stringify(o.bonds) !== JSON.stringify(["lateranoShip","raidShip"])) {
  console.error("  ✗ 盟约不对（期望 [\"lateranoShip\",\"raidShip\"]）");
  process.exit(1);
}
'
