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
| 2026-10-10 | `server/match/pool.js`、`server/match/player/prep.js`、`server/match/player/acquire.js`、`tools/apply-reward-patch.mjs` | 合成精锐的三选一奖励改为**额外获取**：点选不占用共享卡池（记 0 份并标记 `rewardFree`），卖掉/淘汰/升华均不影响池子；升华时不为该干员补足副本；奖励候选改为**不受共享池库存限制**（按设计份数 `cap` 加权，被抢光的干员仍会出现）。开关：`MERGE_REWARD_TAKES_POOL`、`MERGE_REWARD_IGNORES_POOL`。补充规则：额外副本参与三合一后，精锐只记其实际占用份数（如 2 份），卖掉只退回 2 份，额外那份随之消失、不回池。依据：玩家实测官方为额外获取，项目原实现标为 `[ASSUMED]`。 |
| 2026-10-11 | `server/sim/content/kits/ops/chess_char_6_21-clemnt.js`（新增）、`server/sim/content/kits/index.js`、`tools/apply-clementia-kit.mjs`、`tools/revert-clementia-kit.mjs` | **补齐克莱门莎的技能实现**。她已由 `apply-clementia-patch.mjs` 加入棋池（`data/chess.json` 的 `chess_char_6_21_a/_b`），但 `content/index.js` 的 `kitOf` 解析**普通棋池棋子**的 kit 只看 `def.baseId`，从不看 charId，所以她的 kit 若只以自选键 （`char_4231_clemnt`）注册就永远落不到她身上，每次作战都掉进 `content/generic.js` 通用兜底：两个天赋全丢、S1「冲蚀」的侵蚀损伤附着丢失、S2「风暴潮」的浮游放逐舱与漩涡完全没有、S3「与海为敌」退化成普通攻击。现在以棋池键 `chess_char_6_21_a` 注册她的三个技能（S1 205/225%、S2 220/230% 与溅射、S3 200% 与 10 发弹药轰炸）和两个天赋（生死定夺、习得性防御），并提供幂等的 `apply`/`revert` 工具与验收测试 `test/content/clementia-kit.test.js`（真跑战斗，6/6 通过）。 |

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
