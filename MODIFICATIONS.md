# 修改说明（MODIFICATIONS）

本仓库是「卫戍协议：盟约」非官方同人复刻项目的**个人修改版**，基于
[LongQianChen/Stronghold-Protocol](https://github.com/LongQianChen/Stronghold-Protocol) 的
`feat/IncreasePlayerCapacity` 分支，其上游原始项目为
[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)。

依据 GPL-3.0-or-later 第 5(a) 条，此处显著声明：**本仓库包含修改**，修改内容与日期如下。

## 修改记录

| 日期 | 文件 | 修改内容 |
|---|---|---|
| 2026-10-09 | `shared/playerCapacity.js`、`server/match/unite.js` | 联防（联合防守）波数改为随开局人数增长：每 2 人一波、上限 10 波（`uniteRoundLimit = ceil(人数/2)`，`MAX_UNITE_ROUNDS = ceil(MAX_SEATS/2)`）。原实现为「存活 ≥8 人时最多 2 波」。 |
| 2026-10-09 | `data/chess.json` | 干员「归溟幽灵鲨」的 X 模组「唱片」收藏箱（`uniequip_002_ghost2`，PUM-X）对天赋「拥抱自我」的覆盖：替身周围敌人移动速度 -40% → **-60%**，每秒伤害 相当于攻击力 40% → **80%**。基础值（不带该模组）保持 40% / 40% 不变。 |

## 与上游的关系

- 上游原始项目：`sganggs/Stronghold-Protocol`（作者 sganggs）
- 本修改基于：`LongQianChen/Stronghold-Protocol` 的 `feat/IncreasePlayerCapacity`（20 人房间等扩展，作者 LongQianChen）
- 本仓库仅包含上表所列改动，未改动其他游戏规则
- 同步上游更新：`git fetch origin` 后合并 `origin/feat/IncreasePlayerCapacity`，再重新应用上表改动

## 许可

- **代码**：GPL-3.0-or-later（见 [LICENSE](LICENSE)），与上游一致
- **游戏素材**（美术、音频、Spine 模型、字体、文本）：版权归上海鹰角网络 / Yostar 所有，**仅限非商业同人使用**（见 [NOTICE.md](NOTICE.md)）；本仓库**不包含**素材
- 第三方组件见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
- 本项目为**非官方**作品，与鹰角网络 / Yostar 无关联，**禁止任何商业使用**
