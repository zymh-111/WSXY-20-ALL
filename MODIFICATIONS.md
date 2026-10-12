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

| 2026-10-11 | `data/assets.json`、`tools/apply-clementia-spine.mjs`（新增）、`tools/revert-clementia-spine.mjs`（新增）、`tools/deploy-clementia.mjs` | **补上克莱门莎的 Spine 清单条目**。客户端解析战场小人只认 `data/assets.json` 的 `chars[charId].spine.front`（`public/js/assets.js spineEntry`），没有 `spine` 字段就拿不到任何 URL、模型只能退回占位符；而该清单由 `tools/fetch-assets.mjs` 生成，其下载计划来自硬编码的 209 人资源索引，她 2026-10-09 才上线、不在其中，所以素材就位后清单里始终缺这一条。新增的 `apply-clementia-spine.mjs` 用官方同一套函数（`tools/assets/skel.mjs` `parseSkel`、`anim-roles.mjs` `resolveRoles`、`atlas.mjs` `normalizeAtlas`）生成并写入条目，并给她的 `.atlas` 补上页面缺的 `size: W,H` 行；`deploy-clementia.mjs` 第 5 步自动调用它。 |

| 2026-10-11 | `data/bonds.json`、`tools/apply-clementia-bond.mjs`（新增）、`tools/revert-clementia-bond.mjs`（新增）、`tools/deploy-clementia.mjs`、`test/content/clementia-kit.test.js` | **把克莱门莎登记进阿戈尔盟约的成员名单**。`apply-clementia-patch.mjs` 当初只写了棋池三张表，没动盟约成员表 `bondInfoDict.egirShip.chessIdList`（官方那份名单定稿早于她上线），于是 `data/bonds.json` 的 `egirShip.members` / `visibleMembers` 不含她 —— 盟约面板的「成员」列表读的正是这份（`public/js/ui/gameLogic/bonds.js bondMembers`），所以她在阿戈尔里看不到；而盟约**计数与效果其实一直生效**（`server/match/bondsMeta.js membership()` 读棋子自己的 `bonds[]`）。新增工具把 `chess_char_6_21_a` 补进该名单并接进 `deploy-clementia.mjs` 第 4 步，两个名单现已一致；测试增加一条断言锁住它。 |

| 2026-10-11 | `server/sim/content/kits/ops/chess_char_6_21-clemnt.js`、`data/chess.json`、`data/garrisons.json`、`tools/apply-clementia-trait.mjs`（新增）、`tools/revert-clementia-trait.mjs`（新增）、`tools/deploy-clementia.mjs` | **把克莱门莎的「获得时/部署时 +阿戈尔层数」卫戍特质换成自定义阿戈尔特质**：「<阿戈尔>每 3 层（精锐形态每 2 层），克莱门莎攻击力+1%，其攻击范围内敌人受到的元素伤害+1%」。她的棋池记录原先照抄模板干员锏（`chess_char_6_19_a`），带着两条**与锏共用**的加层卫戍 —— `garrison_155`（<获得时>+8 / <部署时>已激活+8，至多24层）与 `garrison_65`（<获得时>+8，无需激活盟约），面板「特质」区块显示的就是这两条。现在为她新建两条**专属**的展示型卫戍 `garrison_155_clem_a/_b`（克隆官方同型记录、替换文案、清空 `blackboard`、`effectType` 改为引擎不认识的 `NONE_DISPLAY_ONLY`），并把 `garrisonIds` 换成它们，加层效果因此彻底失效；**与锏共用的四条原记录逐字未改**。效果本身写在她的 kit 的 `[CUSTOM]` 段：每 0.5 s 按**实时**层数（`battle.getPlayer(ownerId).bonds.egirShip.layers`，吞噬加层也会跟上）给她自己挂 `atkPct`，并给攻击范围内敌人挂元素脆弱（`elemFragile` → `elementalTakenMul`，只作用于「元素伤害」，对任何来源都生效）。验收测试 10/10 通过（含「不漏给队友」「加层设计不得复活且不得改到锏的记录」「普通每3层/精锐每2层的步长」三条断言）。 |

| 2026-10-11 | `tools/apply-makoto-buildhook.mjs`（新增）、`tools/deploy-makoto.mjs`（新增）、`tools/apply-makoto-patch.mjs`（新增）、`tools/apply-makoto-assets.mjs`（新增）、`tools/apply-makoto-spine.mjs`（新增）、`tools/build-data.mjs`、`data/backups.json`、`data/assets.json` | **把联动干员「结城理」(char_4217_makoto) 收录进「自选干员」池，阵营按其隐藏势力定为「拉特兰」**。他是官方 6★ 特种/傀儡师（P3 联动，`teamId=sees`），数据与素材齐全，但上游因**版权**把他连同其他联动 6★ 一起排除在自选池外（`buildBackups` 的 `DIY_EXCLUDED_TEAMS`，原作者 2026-10-05 的决定）。本 fork 按需求放开他一个人：给 build-data 加了两个**默认关闭**的环境变量开关 —— `DSH_DIY_FORCE_PICKS`（无视联动排除进池）与 `DSH_DIY_FORCE_BONDS`（覆盖自选干员的盟约，把他指定到 `emptyShip` 协防干员，而不是其隐藏势力拉特兰对应的拉特兰盟约）、导出 `buildBackups`/`buildChess`/`loadContext` 供工具复用同一套口径、`main()` 加直接执行守卫。并新增素材工具（头像/精英头像/两张立绘/三张技能图标/spine 三件套，含 `data/assets.json` 的 chars+skills+spine 登记）。不设这两个环境变量时构建结果与上游**逐字节一致**。技能与天赋的实现见后续提交。 |

| 2026-10-11 | `server/match/dev.js`（新增）、`server/net.js`、`server/lobby.js`、`shared/protocol.js`、`public/js/dev.js`（新增）、`public/js/main.js`、`tools/apply-dev-backdoor.mjs`、`tools/apply-dev-client.mjs`（均新增） | **新增测试后门（免抽卡调试通道）**：服务端接受 `{ t:'dev', op }`，用于不刷就验证干员 kit（尤其自选干员结城理）。op：`state`（读自己的资金/商店/盟约层数/自选槽）、`funds n`、`level n`（走游戏自己的升级价与上限，照常发每级奖励）、`refresh`、`layers bondId n`、`layersAll n`。**三重门禁**：①来源必须是本机/内网（`net.js` 的 `clientAddress` → `isLocalIp`，随消息以 `ctx.isLocal` 传入，缺省按非本机处理）②房间必须是 solo 单人房 ③只能作用于调用者自己的座位；任一不满足回 `BAD_TARGET` 且不回显内部信息。前端在 `public/js/dev.js`（控制台 `__dev.ensure()` 打开面板，或 `__SP__.dev`），协议已登记 `dev`。测试：`test/match/dev-backdoor.test.js` 10/10（门禁全部覆盖）、`test/client/dev-panel.test.js` 4/4。撤销：`revert-dev-backdoor.mjs` / `revert-dev-client.mjs`。 |
| 2026-10-12 | `server/sim/professions.js`、`server/sim/content/kits/ops/op-makoto.js`、`test/content/makoto-kit.test.js` | **把傀儡师形态切换动画里的「无敌」从整段动画拆出来，改为 0.25 秒**（贴合官方观测的 0.2~0.3 s）。引擎原先在切换动画期间（`DOLL_SWITCH` = 1 s，上游按骨骼 Start_B / Start_2 剪辑长度取的 `[ASSUMED]` 值）挂一条 `trait:dollSwitching`，其中**同时**包含 `invulnerable` —— 探针实测无敌覆盖了整整 1 秒，比官方长。现在把无敌拆成单独一条 `trait:dollInvuln`（`DOLL_INVULN = 0.25` s），其余效果（不死、阻回、禁疗、孤立、强制缴械、眩晕/冻结/睡眠免疫）仍覆盖整段 1 s 动画。因为这是 **trait 层（引擎）**改动，**所有傀儡师**（归溟幽灵鲨、风丸等）一并生效 —— 与官方对傀儡师的处理一致。测试：`test/content/makoto-kit.test.js` 增加一条断言（切换后无敌为真、无敌期间 5000 点物理伤害一滴不掉、0.3 s 后无敌消失但切换窗口仍在、动画结束后窗口才关闭），该套 18/18；傀儡师相关测试（professions / fidelity / feedback2-doll / loadout-summons 等）全绿。**注意**：`test/golden.test.js` 由 3 pass/6 fail 变为 2 pass/7 fail（既有 6 条过期摘要之外多出 1 条），要把它当基线需跑 `npm run golden:update`。 |
| 2026-10-12 | `server/sim/content/kits/ops/op-thumpy.js`、`test/content/op_thumpy.test.js` | **修珊比 S3「不准走！」的传送带：忽略「免疫传送」单位**。PRTS S3 备注末句写明「传送带效果不会影响 免疫传送(黍)/免疫传送(余) 的单位，最终传送处理对传送免疫的单位无效」，而 `carry()` 原先只判了 存活/隐藏/飞行/被阻挡/自缚/重量 ≤ mass_level，**没有免疫传送这一项** —— 于是传送带会把免疫传送的单位也拖着走。现在补上三层判定（与 `chess_char_6_21-clemnt.js` 的 `cannotCarry` 同口径）：① 归一化免疫集 `def.immune` 含 `teleport`/`exile`；② 原始 `stats.otherImmunities` 正则匹配 `/teleport|transmit|exile/i`。**只否掉传送带效果**：伤害效果照旧（备注把两者分开判定），测试里一并锁住。其余 S3 要素经与 PRTS 原文逐条比对**本已正确**：阻挡+2 并同时攻击所有阻挡者、攻击力+80%/防御力+105%、前方 4 格传送带（不含自身格、中心判定）、重量≤4、未被阻挡、可影响隐匿、不能推入非坑洞类不可通行地块（左右留 0.2 格）、伤害覆盖自身格+正前方 4 格+所有被阻挡者、每秒 33% 攻击力、侵蚀爆发时防御力额外 −30。**传送带速度按技能描述的字面值取 0.8 格/秒**（业主决定，2026-10-12：描述写「以每秒 0.8 格的速度移向珊比」，优先于 PRTS 备注的帧率折算 —— 那条按「每帧 0.8/30 格 × 卫戍协议 20 帧」会得到 0.533 格/秒；想切回去把 op-thumpy.js 的 CONVEYOR_FPS 由 30 改回 20 即可）。 |

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
