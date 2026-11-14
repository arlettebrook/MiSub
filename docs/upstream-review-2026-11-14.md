# 上游提交对照与升级建议（2026-11-14）

## 结论

建议按问题选择性移植上游修复，不直接合并或镜像上游 `main`。本项目已独立改进会话管理、WebDAV 备份、VLESS 参数保留、弹窗加载、移动端交互及 PWA；同时仍存在上游已修复的鉴权、过滤、预览缓存和协议转换问题。

优先顺序：管理员密码读取失败时拒绝登录 → 生产依赖安全更新 → 过滤与缓存一致性 → VMess / IPv6 输出修复 → 浏览器存储容错 → 按使用场景增强协议和模板。

首次对照仅做分析和验证；后续按本报告实施的进度记录在对应条目下。

## 对照基线与验证范围

| 项目         | 基线                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 本项目       | `arlettebrook/MiSub`，当前分支 `dev`，HEAD `538f49e`，2026-11-14                                                             |
| 指定上游     | [imzyb/MiSub main](https://github.com/imzyb/MiSub/commits/main)，HEAD `c6fd30c686b89fcf50c1368f4f36eca3ed622d36`，2026-10-31 |
| 共同祖先     | `9434e5f29cc97ad5ae34ddc00426fd58794d4539`，2026-09-15                                                                       |
| 分叉提交     | 本项目独有 66 个，上游独有 107 个（含合并提交）；上游独有非合并提交 95 个                                                    |
| 全量单元测试 | `npm run test:run -- --reporter=dot`：169 个文件、1486 个用例全部通过                                                        |
| 生产构建     | `npm run build`：通过；主入口约 295.99 kB，gzip 129.40 kB                                                                    |
| 依赖审计     | 使用官方 npm registry；22 个受影响依赖包，2 critical、14 high、5 moderate、1 low                                             |

先用 `git ls-remote` 确认上游实际 HEAD，再 `git fetch --no-tags https://github.com/imzyb/MiSub.git main`，通过共同祖先、提交补丁与最终源码对照。提交数量和提交日期均不能代替实现核查；部分同类修复本项目已有不同实现。

网页浏览工具未能抓取 GitHub 页面，提交分析依据是直接获取的 Git 对象。sing-box 字段另行核对官方仓库稳定版 `v1.14.4` 源码，不只依赖 MiSub 上游的提交说明。

复现均使用 `example.com`、文档用途 IPv6 地址、模拟 fetch 和内存存储，没有访问生产订阅或真实 KV。脚本与结果在本地忽略目录：`tmp/upstream-review-repro.mjs`、`tmp/upstream-review-repro-results.json`；日志在 `tmp/upstream-review-tests.log`、`tmp/upstream-review-build.log`，完整审计结果在 `tmp/upstream-review-audit-official.json`。临时证据不纳入版本管理。

## 建议优先处理

### 1. P0：KV 密码读取失败时回退默认密码，已复现

本地位置：`functions/modules/utils.js:72`、`:167`；登录入口 `functions/modules/auth-middleware.js` 的 `handleLogin`。

触发条件：未配置环境变量 `ADMIN_PASSWORD`，管理员密码来自 KV；KV 报 `KV storage is paused` 等被识别为不可用的错误。`safeKvGet` 吞掉错误并返回 null，`getAdminPassword` 随后返回 `admin`。这把“读不到密码”当成了“尚未设置密码”。

模拟 KV 的 get/put 均抛出暂停错误、提供固定的模拟 `COOKIE_SECRET` 后，使用 `admin` 登录实际返回 **HTTP 200，并包含 Set-Cookie**。配置有效 `ADMIN_PASSWORD` 的部署不走这一密码回退路径；本次没有检查线上部署变量。

参考 [a2f009b7](https://github.com/imzyb/MiSub/commit/a2f009b7633a8125cc643f179242fdb0f07fb96d)。为密码读取使用会向上抛错的独立方法，仅在成功读取且 key 确实不存在时允许初始化默认密码；存储故障返回受控错误，禁止签发会话。另可借鉴该提交对“环境变量控制密码时禁止在应用内修改 KV 密码”的校验。

验收：KV 暂停、读取抛错时默认密码不能登录；环境变量密码仍可正常使用；真实缺 key 的初始化行为有明确测试；成功与失败两种路径都断言 Cookie 行为。

**实施进度（2026-11-14）：P0 代码修复已完成。** `getAdminPassword` 直接读取 KV 密码并保留读取异常，交由现有登录处理返回 HTTP 500，响应不签发会话 Cookie。环境变量 `ADMIN_PASSWORD` 控制密码时，`setAdminPassword` 禁止改写 KV 密码。Cookie 密钥读取与写入额度耗尽时的既有降级逻辑保留。

新增 `tests/unit/admin-password-kv-outage.test.js` 的 13 个回归用例，覆盖暂停、额度错误、超时、仅密码 key 读取失败、环境变量密码、正常 KV 密码、初始化默认密码及密码修改。测试使用 Node 环境的服务端 Request / Response，验证成功 Cookie 的真实签名和失败响应不含 Cookie。修复前出现 5 个预期失败；修复后相关 4 个文件、190 个用例全部通过。全量测试 170 个文件、1499 个用例全部通过，`npm run build` 通过；源码、测试和本文的格式检查及 `git diff --check` 通过。

### 2. P1：更新依赖锁文件中的安全版本，独立于上游

默认镜像源 `registry.npmmirror.com` 的 audit endpoint 返回 404，不能据此判断安全状态。改用 `npm audit --registry=https://registry.npmjs.org --json` 后才得到有效报告；没有修改全局 registry。

| 依赖                             | 锁文件版本                     | 2026-11-14 查询与建议                                                                |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| DOMPurify                        | 3.4.5                          | 官方 npm 当前 3.4.17，优先在 3.x 内更新并验证自定义公开页清洗                        |
| js-yaml                          | 4.1.1                          | 官方 npm 4.x 当前 4.3.2，优先更新并验证订阅 / 模板 YAML 解析；无需直接跳到当前 5.5.0 |
| Vue                              | 3.5.18                         | 官方 npm 当前 3.5.45，保持 Vue 及配套 runtime/compiler 版本一致                      |
| Vitest                           | 4.0.16                         | 官方 npm 4.x 当前 4.1.12，可先留在 4.x；无需直接跳到当前 5.1.0                       |
| Vite                             | 7.3.3                          | 官方 npm 7.x 当前 7.3.8，可先留在 7.x 并验证构建及开发代理                           |
| Wrangler / Miniflare / Happy DOM | 4.93.1 / 4.20260520.0 / 20.9.0 | 按兼容版本成组更新、重新审计和运行测试                                               |

这里列的是锁文件实际版本，不能只看 `package.json` 的最低版本。全部审计项均报告存在可用修复，包括间接依赖。

审计等级是受影响软件包的等级，不代表本项目所有路径均可被利用。例如 DOMPurify 的 critical 公告涉及 `SAFE_FOR_TEMPLATES` 和 DOM 输出模式，而 `CustomPublicRenderer.vue:64` 当前使用字符串清洗、HTML profile，未启用这些模式；本次没有复现该 XSS。Vitest 的 critical 公告涉及开启并监听 UI server，而本次运行的是 CLI 测试。Vue server-renderer 公告也需要结合本项目 SPA 的实际打包 / 使用情况判断。

js-yaml 在本项目直接处理订阅与模板内容，其 CPU 消耗类公告更贴近实际输入路径，值得优先处理。后续应更新依赖、锁文件并验证解析边界，避免把“目前测试全绿”当作版本安全证明。

公告与数据来源：[DOMPurify](https://github.com/advisories/GHSA-cg2g-xh64-v4q7)、[js-yaml](https://github.com/advisories/GHSA-2883-xcg3-v3hh)、[Vitest](https://github.com/advisories/GHSA-5xrq-8626-4rwp)，以及本次官方 npm audit JSON。版本建议只代表本次查询快照。

### 3. P1：过滤导致节点减少，被误判成上游截断，已复现

本地位置：`functions/services/subscription-service.js:543`、`:552`、`:563`。

当前代码先应用过滤 / 算子，再拿过滤后的节点数与历史数量比较。模拟上游正常返回 100 个节点、历史节点数 100、规则 `keep:KEEP` 正常只保留 1 个节点，未开启保护性缓存时最终输出 **0 个节点**；这不是上游抓取失败。

开启缓存时还有另一条风险：用户更改过滤后，减少到少量或 0 个节点，旧缓存可能重新覆盖新过滤结果；当前缓存记录没有过滤配置指纹。

参考 [48bee6a5](https://github.com/imzyb/MiSub/commit/48bee6a51403fc2060df04bbdee198b4c4147389)：用过滤前的真实节点数做上游截断检测，缓存记录过滤配置指纹，配置变化时避免复用旧过滤结果。移植需适配本项目现有请求运行态更新、保护性缓存和手动节点逻辑。

验收：仅包含规则、剔除规则和算子造成的大幅减少正常生效；新配置筛到 0 时输出 0；真正上游截断仍可回退；无指纹的旧缓存具有明确兼容策略。

### 4. P1：VMess 的 sing-box 模板输出包含其他协议字段，已复现

本地位置：`functions/modules/subscription/template-renderers/render-singbox.js:72`、`:73`。

模拟一个普通 VMess 节点，模板输出自动加入 `udp_relay_mode: native` 和 `congestion_control: cubic`。核对 [sing-box v1.14.4 VMess 配置结构](https://github.com/SagerNet/sing-box/blob/v1.14.4/option/vmess.go)，这两个字段均不属于 VMess 专属配置。

参考 [8ad6a32e](https://github.com/imzyb/MiSub/commit/8ad6a32ee8cf9ef0ac47135f20b51547edb6054d)，但该提交只删除 `udp_relay_mode`，不能当作完整修复。应同时处理 `congestion_control`，并审查内置生成和模板生成两条路径。

验收：按协议断言合法字段；最好用用户支持的稳定客户端版本执行配置检查，而不仅验证 JSON 可解析。

### 5. P1：IPv6 节点导出丢失地址边界，已复现

本地位置：`functions/utils/clash-to-url.js:29`、`:136`、`:206`、`:229`。

将 Trojan 节点地址 `2001:db8::1` 导出为 `trojan://synthetic@2001:db8::1:443#IPv6`，再次解析时 server 变成 **`2001`**，连接地址已被破坏。

参考 [bad1d1e6](https://github.com/imzyb/MiSub/commit/bad1d1e6)，统一在 URI authority 中为 IPv6 添加方括号，再核对 SS、Trojan、VLESS、HY2、TUIC 等输出与解析。SSR 的编码结构不同，不能机械套用普通 URI authority 处理。

验收：每种受影响协议都有 IPv4 / 域名 / IPv6 往返样例，地址与端口保持一致。

### 6. P1：浏览器存储异常可能阻断页面或引发重复恢复

本地位置：`src/main.js:29`、`:74`、`:80`、`:104`，`src/router/index.js:88`，`src/composables/useManualNodes.js:33`。

chunk 恢复直接读写 `sessionStorage`；手动节点 composable 初始化直接读取 `localStorage`。存储访问抛错时，这些路径没有统一降级。资源恢复虽然捕获写入异常，但仍继续跳转，重载标记未持久化时可能重复恢复。

参考上游 [84373d6d](https://github.com/imzyb/MiSub/commit/84373d6d)、[629c850c](https://github.com/imzyb/MiSub/commit/629c850c)、[b31cc81b](https://github.com/imzyb/MiSub/commit/b31cc81b)。抽取安全读写工具；需要跨刷新保留的恢复标记应写后回读，失败时停止自动刷新并给出人工恢复提示。普通偏好使用默认值降级。

此项依据源码核查，未在真实浏览器禁用存储后执行端到端复现。保留本项目当前会话同步、断网草稿保护与弹窗预加载设计，不用上游整份 `App.vue` 或 session store 替换。

### 7. P1 / P2：预览与正式输出的保护性缓存行为不一致

本地位置：`functions/modules/subscription/node-fetcher.js:72`、`:99`，调用点 `single-subscription.js:72` 和 `profile-handler.js:193` 附近。

正式订阅生成已有 per-sub 缓存回退；预览的 `fetchSubscriptionNodes` 却没有接收 storage adapter / subscription 来读取缓存。模拟上游返回 HTTP 200 + 过期提示，开启 `enableNodeCache` 后预览仍返回 **success: true、nodes: []**。HTTP 错误也直接返回失败。

参考 [6928fe46](https://github.com/imzyb/MiSub/commit/6928fe46)：为已有订阅预览接入保护性缓存，并返回 `fromCache`、更新时间及原抓取错误。必须与过滤指纹修复一起处理，区分“过期页面无节点”和“用户规则主动筛空”。

保留本项目 2026-11-11 新增的 `forceRefresh` 以及前端失败反馈；缓存回退不能让强制刷新失败被悄悄显示为刷新成功。直接 URL 预览没有保存的 subscription，不应随意复用其他订阅缓存。

## 按需采纳的功能和兼容性增强

| 项目                         | 当前状态 / 收益                                                                                                                                           | 建议                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| XHTTP 高级参数双向映射       | 本项目已有 padding 等 9 个字段映射；复现中的 `headers`、`xmux`、`downloadSettings` 被全部丢弃。上游覆盖下载流 TLS / REALITY、复用参数、头类型及大小写去重 | 使用 XHTTP 时优先；成组参考 `6ecc36cb`、`4ceac9aa`、`b34efa38`、`00f87185`、`47bcc1c7`、`e5e3e2ac`，保留本项目 packet-encoding 和 encryption 修复 |
| HY2 参数兼容                 | 已保留 ports，但复现中的 peer、pinSHA256、hop-interval 丢失                                                                                               | 参考 `510323ec`、`7861be59`、`d3fe8cad`；把 SNI 别名、证书 pin 和跳跃间隔贯通解析 / URI / 客户端输出，不能只改一端                                |
| HTTP / HTTPS 代理            | 当前普通 `http://` 转 Clash 返回 null，且不被 `isRealProxyNode` 识别；HTTPS 当前也需核对 type 与 TLS 表达                                                 | 有此类节点时参考 `7c1aa705`、`103279e1`、`cda96fb9`、`d226fc2f`、`5ceb437f`；必须区分 HTTP 订阅地址与 HTTP 代理节点，避免把节点当订阅抓取         |
| `.mrs` 规则 provider         | 统一模板 renderer 复现输出 classical + `.yaml` path，缺 format；远程 Clash YAML 原样配置已有 mrs 保留测试                                                 | 使用 mrs 的统一模板时参考 `44d39ef5`，输出合法 format / behavior / path；不需重做已支持的远程 YAML 路径                                           |
| Mihomo 自定义链式代理        | 本项目内置链式代理已支持 dialer-proxy，但缺上游自定义 INI / YAML 的 chain-proxy 扩展                                                                      | 有自定义链式模板需求再参考 `4b13ca2f`、`f59ce91c`、`f9342cde`，维持普通 Clash 与 Meta 的能力区分                                                  |
| v2rayN 完整配置链接、Mieru   | 本项目已有普通 vmess / vless URI；上游增加的 v2rayn parser 面向另一类完整配置导入                                                                         | 按实际输入格式增加，不把“支持 v2rayN 客户端”误当作“已支持所有 v2rayn:// 配置链接”                                                                 |
| 机场身份、站点分组和命名记忆 | 上游提供用户指定机场身份、站点聚合、跨分页保持分组及 TG 管理                                                                                              | 订阅数量较多时有价值；小规模部署可暂缓，需要保留本项目布局和导航优化                                                                              |
| 组合订阅嵌套                 | 上游 `0719f5a3` 新增 subProfiles；本项目没有对应 UI / 完整聚合逻辑                                                                                        | 有复用订阅组需求再做。需一起处理 `36d5d056` 的初始化错误修复，并补环检测、重复节点、禁用子组、预览、删除和导入兼容                                |
| SettingsContent 共享         | 本项目 SettingsView 与 SettingsPanel 仍重复维护，后者仍静态导入分区                                                                                       | 可借鉴 `19c9575b` 的共享结构，继续保留本项目按需加载、加载反馈和浮动保存逻辑                                                                      |

## 可以跳过，或不能直接照搬

1. **TUIC 的 `udp_relay_mode` 删除。** 上游 `10053b31` 称该字段不存在，但 [sing-box 稳定版 v1.14.4 TUIC 结构](https://github.com/SagerNet/sing-box/blob/v1.14.4/option/tuic.go) 明确支持 `native` / `quic`。不建议移植该删除；它与 VMess 上错误的同名字段应分别判断。
2. **Surge HY2 Salamander 基础支持。** 本项目 `builtin-surge-generator.js` 和 renderer 已输出 salamander-password，且 `hysteria2-obfs.test.js` 覆盖凭据往返；上游 `f4a5d977`、`915ab265` 无需重复移植，本项目还覆盖 gecko 与特殊字符。
3. **预览包含手动节点。** 本项目 `profile-handler.js` 已合并手动节点结果；`f128caff` 的基础问题已经处理。HTTP 手动代理分类的缺口应单独解决。
4. **确认弹窗、会话复查、退出同步、移动端保存定位、弹窗滚动锁、按需加载、UA 校验、WebDAV 下载与保留清理。** 本项目已有较新的实现和专项测试，不用上游旧版 UI / session / backup 文件覆盖。
5. **待处理事项忽略跨设备同步。** 本项目已有 `dashboard-preferences` store、独立 handler 和失败回退，`82030d83` 的“塞进通用 settings”方案无需重复采用；它也会引入设置更新 / 缓存失效的耦合。
6. **订阅级私有 DNS 提交 `73d77950`。** 当前上游只有 safe-dns 消费参数及 builtin-clash 透传两处使用 `subscriptionDnsPolicies`，没有完整的 UI、持久化和主请求组装链路。它可作为设计参考，不能声称移植这 9 行就完成整个功能。
7. **自动镜像上游 workflow。** 当前 `fork-sync.yml` 指向 arlettebrook，用途是下游 fork 镜像。不要仅将其目标改为 imzyb 后运行 `reset --hard` / `push --force-with-lease`；这会丢掉本项目独立提交。后续借鉴上游应走独立分支、针对性移植、测试和 PR。
8. **仅为追新升级大版本、整体格式化或大规模拆文件。** 当前构建和测试正常；先处理已证实的行为错误和安全更新，重构按模块逐步做。

## 本项目自身的维护补充

仓库当前只有 fork-sync workflow，没有提交 / PR 的测试构建 CI；建议新增 `npm ci`、`npm run test:run`、`npm run build` 检查。`test:coverage` 配置了 v8 provider，但未声明 `@vitest/coverage-v8`，目前不能直接作为覆盖率门禁；若启用，应与 Vitest 同版本安装并先建立实际基线。

`docs/codebase-review.md` 和 `docs/DEVELOPMENT_STANDARDS.md` 中的 374 / 571 测试基线、暂无格式工具等描述已过时；当前有 Prettier / EditorConfig。建议随相关治理同步文档，避免旧建议重复推动已完成的工作。

## 建议实施批次

1. 独立修复 KV 密码故障回退，加登录 Cookie 断言。
2. 更新生产依赖安全版本与开发工具兼容补丁，复跑官方 audit、单测和构建。
3. 成组修复过滤指纹、预览缓存回退与强制刷新反馈。
4. 修复 IPv6 / VMess；按现有客户端需求补 HY2、XHTTP、HTTP 代理和 mrs。
5. 收敛浏览器存储工具，添加 CI；随后再做设置内容共享。
6. 机场聚合、嵌套订阅、Mieru、v2rayN 配置导入和自定义链式模板按明确使用需求推进。

本次验证说明的是当前基线和这些模拟场景。没有运行真实客户端配置检查、生产 KV 故障演练或浏览器端到端回归；这些应成为相关修复的验收项目，而不是把所有上游提交直接合入的理由。
