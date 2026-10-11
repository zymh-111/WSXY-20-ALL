# DEV-20261011-01 · 在线补齐改为 4 路并发并提高默认预算

## 基本信息

| 字段 | 内容 |
|---|---|
| 开始 / 最后更新 | 2026-10-11 / 2026-10-11，Asia/Shanghai |
| 状态 | 已完成：实现、定向验证与 Edge 检查通过；分支已推送 fork，并向上游提 PR |
| 类型 | 调整 |
| 分支与开始 HEAD | `main`，`f273382`；工作区干净 |
| 上游基线 | 上游 `zymh-111/WSXY-20-ALL` `main` = `f273382`，本地已同步，无领先提交 |
| 提交归属 | 与本文同一提交，按记录路径查询 |
| 关联 | [D016](../DECISIONS.md#d016)、[预缓存实现](2026-10-09-05-asset-precache.md)、[单 IP 上限调整](2026-10-10-02-asset-cache-ip-limit.md) |

## 需求、范围与验收

用户实测在线补齐只有约 200 KB/s，要求客户端改为 **4 路并发**下载、每路 **8 Mbps** 上限；并明确单个服务进程总预算取 **160 Mbps**，按 200 Mbps 标称峰值预留 **40 Mbps** 给对局与普通加载。

验收：客户端对缺项同时开 4 条下载通道；单客户端网络地址共享上限 `4,000,000 B/s`（32 Mbps，对应 4 × 8 Mbps）；全服总预算 `20,000,000 B/s`（160 Mbps）；同客户端网络至多 4 个并发下载。范围限于默认速率、并发数、客户端下载方式、对应测试断言与文档；不修改令牌桶算法、队列公平性、哈希校验、素材清单或游戏逻辑。

## 调查与决定

| 问题 | 证据或来源 | 结论及确定程度 |
|---|---|---|
| 限速在哪里生效 | `server/http/cacheLimiter.js` 的 `CacheDownloadLimiter` | 已确认：`totalBps` 为进程级令牌桶，`clientBps` 为**按客户端（IP）共享**的令牌桶；`pump()` 先按客户端轮转、再在同一客户端的多个任务间轮转，因此同一客户端的多个下载会均分其上限 |
| 客户端下载是否串行 | `public/js/asset-cache-worker.js` 的 `download` 分支 | 已确认：原实现为 `for (const entry of catalog.files) { … await fetch … }`，一次只下一个文件，每个文件都要付一次完整往返延迟 |
| 「每路 8 Mbps」如何落地 | 令牌桶按客户端共享 | 已确认：把单客户端预算设为 4 × 8 Mbps，轮转调度自然让 4 条通道各得约 8 Mbps；不新增「按连接独立限速」的第二套令牌桶，避免绕过客户端上限与总预算 |
| 旧环境变量 | `assetCacheLimitOptions()` | 已确认：显式 `SP_ASSET_CACHE_TOTAL_BPS` / `SP_ASSET_CACHE_CLIENT_BPS` 优先于默认值；已有部署若设置过旧值，更新代码不会覆盖，需同步调整后重启 |
| 全局预算取值 | 用户本次明确 160 Mbps、留 40 Mbps 给游戏 | 用户决定；按 200 Mbps 标称峰值取 80%，不自动探测实际剩余出口 |

## 实现或操作

| 文件 / 函数 / 操作 | 变化或结果 | 为什么这样做 |
|---|---|---|
| `server/http/cacheLimiter.js` · `ASSET_CACHE_LIMIT_DEFAULTS` | `totalBps` 1,000,000 → **20,000,000**；`clientBps` 500,000 → **4,000,000**；`maxDownloads` 24 → **48**；`maxDownloadsPerClient` 2 → **4** | 160 Mbps 总预算预留 40 Mbps 给游戏；单客户端 32 Mbps 正好支撑 4 路各 8 Mbps；全局并发翻倍以维持「12 个客户端同时补齐」的原容量 |
| `public/js/asset-cache-worker.js` · `download` 分支 | 串行 `for…await` 改为 4 条 lane 并发消费清单；新增 `LANES = 4` 常量、`claimed` 去重集合、共享节流函数 `progress()`；任一 lane 失败即 `abort()` 其余通道 | 让客户端真正用满服务端允许的并发；`claimed` 防止同一 `sha256` 被两条 lane 重复拉取（串行版按顺序天然不会发生）；abort 避免失败后遗留悬挂连接 |
| `test/asset-cache-http.test.js` | 默认策略断言更新为 `20_000_000` / `4_000_000` | 与被改默认值保持一致 |
| `test/asset-cache.browser.test.js` | 夹具 `/api/asset-cache/status` 返回的 `policy` 同步为 `20000000` / `4000000` | 同上 |
| `docs/ASSET_CACHE.md` | 「在线补齐限流」表格、说明与环境变量示例更新；补充「客户端 4 路通道、通道再多也不突破单客户端上限」与「按实际可用出口下调总预算」 | 服主配置与排障依据 |
| `docs/development/DECISIONS.md` | D016 结论行与限流条目更新 | 长期决定 |
| `docs/development/README.md` | 「当前素材缓存」与 I004 两行更新 | 进度索引 |

## 验证

| 命令或场景 | 环境 / 数据 / 版本 | 实际结果 |
|---|---|---|
| `node --test test/asset-cache-http.test.js` | 本机 Windows 11，Node 22.22.2，随机端口 HTTP 夹具 | 13/13 通过：默认总/单 IP 策略断言、**默认每客户端 4 并发放行且第 5 个返回 429**、按 IP 公平轮转、总预算、取消、背压与速率配置 |
| `SP_E2E=1 node --test test/asset-cache.browser.test.js` | 本机 Edge，随机端口夹具 | 3/3 通过：全量与增量补齐、音频别名与 Range、刷新持久、旧/部分 ZIP 导入与损坏修复、跨标签对局守卫暂停与释放锁 —— 4 路并发下载在真实浏览器中正常 |
| `node node_modules/eslint/bin/eslint.js .` | 本机 | 0 errors；136 warnings 全部落在未改动文件 |
| `node tools/check-imports.mjs` | 本机 | 退出 0；仅既有 3 条 `sim-node` 允许项 |
| `node node_modules/typescript/bin/tsc --noEmit --checkJs -p jsconfig.json` | 本机 | 通过，无输出 |
| `npm run ci` | 本机 | `setup` 通过；`test` 步骤 6190 项中 218 项失败，全部为本机环境问题（见下） |
| 基线对比：`git stash` 改动后重跑同组文件 | 本机 | `client-static` 144 项与另 4 项失败在**改动前后逐一相同**，确认非本次引入 |

本机 `npm run ci` 失败项的来源已定位，与本次改动无关：`test/client-static.test.js` 用 `spawnSync(process.execPath, …)` 逐个检查 `public/js/**` 的模块语法，本机对可执行文件启动返回 `EBUSY`，导致 144 项（含 `assets.js`、`audio.js` 等未改动文件）一并失败；`windows-bundle` 与 `asset-cache-catalog` 依赖创建符号链接，非管理员权限下断言失败；`ci`、`docs-paths` 同属 `spawnSync` EBUSY。四项在基线工作区上同样失败。

未执行：真实生产链路的端到端下载速度（需要部署，且本机无法复现公网 RTT 与云出口）；`npm run golden`（本次不改玩法，黄金结果不变）；服务器部署。

## 结果、遗留与接手

- 实现结果：服务端默认预算与并发、客户端 4 路并发下载、测试断言与文档已按验收更新。
- 未确定或未完成：真实生产链路上的端到端速度（4 路并发叠加 RTT × 云出口）未实测；部署后应按 `docs/ASSET_CACHE.md` 复核实际吞吐，并确认生产未设置覆盖用的旧环境变量。
- 提交 / 远程 / 素材 / 线上：本地提交后推送至 fork 并向上游提 PR；不部署、不连接生产服务器。
- 接手入口：`server/http/cacheLimiter.js` 的 `ASSET_CACHE_LIMIT_DEFAULTS`、`public/js/asset-cache-worker.js` 的 `LANES` 与 `download` 分支、`docs/ASSET_CACHE.md` 的「在线补齐限流」节。

## 后续补充

无。
