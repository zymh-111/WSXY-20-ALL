#!/usr/bin/env bash
# [CUSTOM] 一条命令把结城理装好（拉取更新后跑这个就够）。
#
# 做三件事（都可重复执行；不需要 .cache/，也不需要联网）：
#   1) 素材落地   tools/deploy-makoto.mjs       —— 从 tools/makoto-assets/（已入库）复制
#   2) 重建数据   tools/rebuild-makoto.sh       —— 有 .cache/ 才真重建；没有就跳过
#                                                 （库里的 data/ 已含他，所以跳过也是对的）
#   3) 登记清单   tools/apply-makoto-assets.mjs —— 头像 / 立绘 / 技能图标
#                 tools/apply-makoto-spine.mjs  —— spine（战场模型）
#
# 前置：public/assets/ 不在库里（.gitignore 排除），所以第 1 步是必须的。
# 用法： bash tools/setup-makoto.sh

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
FAILED=0
step() { echo; echo "──────── $* ────────"; }
run() { if ! node "$@"; then echo "  ✗ 失败: node $*"; FAILED=$((FAILED+1)); fi; }

step "1/3 素材落地（从 tools/makoto-assets/ 复制，不联网）"
run tools/deploy-makoto.mjs .

step "2/3 数据（有官方表就重建；没有就用库里已验证的 data/）"
if ! bash tools/rebuild-makoto.sh; then echo "  ✗ 失败: rebuild-makoto.sh"; FAILED=$((FAILED+1)); fi

step "3/3 登记素材清单"
run tools/apply-makoto-assets.mjs .
run tools/apply-makoto-spine.mjs .

step "完成"
if [ "$FAILED" -eq 0 ]; then
  echo "  ✓ 全部成功。重启服务后，自选槽（六阶）就能选到「结城理」："
  echo "      systemctl restart stronghold        # 或你习惯的启动方式"
  echo ""
  echo "  验证：浏览器硬刷新（Ctrl+Shift+R）后，在自选干员里搜「结城理」。"
else
  echo "  ✗ 有 $FAILED 步失败，请看上面的输出。"
  exit 1
fi
