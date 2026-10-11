#!/usr/bin/env bash
# [CUSTOM] 一条命令把结城理装好（拉取更新后跑这个就够）。
#
# 做四件事（都可重复执行）：
#   1) 素材落地   tools/deploy-makoto.mjs          —— 从 tools/makoto-assets/（已入库）复制，不联网
#   2) 重建数据   tools/rebuild-makoto.sh          —— **带上必需的环境变量**，否则他会从自选池消失
#   3) 登记清单   tools/apply-makoto-assets.mjs    —— 头像 / 立绘 / 技能图标
#                 tools/apply-makoto-spine.mjs     —— spine（战场模型）
#   4) 提示重启
#
# 用法： bash tools/setup-makoto.sh
# 回退： node tools/revert-makoto-assets.mjs && node tools/revert-makoto-spine.mjs
#        （再跑一次普通的 npm run build-data 即回到不含他的数据）

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
FAILED=0
step() { echo; echo "──────── $* ────────"; }
run() { if ! node "$@"; then echo "  ✗ 失败: node $*"; FAILED=$((FAILED+1)); fi; }

step "1/4 素材落地（本地副本优先）"
run tools/deploy-makoto.mjs .

step "2/4 重建数据（自动带上 DSH_DIY_FORCE_* 变量）"
if ! bash tools/rebuild-makoto.sh; then echo "  ✗ 失败: rebuild-makoto.sh"; FAILED=$((FAILED+1)); fi

step "3/4 登记素材清单"
run tools/apply-makoto-assets.mjs .
run tools/apply-makoto-spine.mjs .

step "4/4 完成"
if [ "$FAILED" -eq 0 ]; then
  echo "  ✓ 全部成功。重启服务后自选槽（六阶）就能选到他了："
  echo "      systemctl restart stronghold        # 或你的启动方式"
  echo ""
  echo "  验证：浏览器硬刷新后，自选干员里搜「结城理」。"
else
  echo "  ✗ 有 $FAILED 步失败，请看上面的输出。"
  exit 1
fi
