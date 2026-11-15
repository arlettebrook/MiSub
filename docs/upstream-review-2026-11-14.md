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

**实施进度（2026-11-14）：P1 依赖安全更新已完成并验证，官方 npm 审计已清零。** 首次审计为 22 个受影响依赖包；更新后 `npm audit --registry=https://registry.npmjs.org --json` 返回 0 个。通过官方 npm registry 更新版本和重新安装，没有修改全局 npm registry。

| 依赖                                                 | 更新前锁定版本 | 更新后锁定版本 |
| ---------------------------------------------------- | -------------- | -------------- |
| DOMPurify                                            | 3.4.5          | 3.4.17         |
| js-yaml                                              | 4.1.1          | 4.3.2          |
| Vue 及 compiler / runtime / server-renderer / shared | 3.5.18         | 3.5.45         |
| Vite                                                 | 7.3.3          | 7.3.8          |
| Vitest 及配套包                                      | 4.0.16         | 4.1.12         |
| Happy DOM                                            | 20.9.0         | 21.0.4         |
| Vue Test Utils                                       | 2.4.6          | 2.4.11         |
| Wrangler                                             | 4.93.1         | 4.116.0        |
| Miniflare                                            | 4.20260520.0   | 4.20260730.0   |

Happy DOM 20.x 没有覆盖全部公告的修复版本，因此升级到 21.0.4。Wrangler 使用 `~4.116.0`，与 Miniflare 4.x 配套，避免此次修复引入 Miniflare 5 beta；Vue Test Utils 使用兼容的 2.4.x 补丁版本。DOMPurify、js-yaml、Vue、Vite、Vitest 保持原主版本。

对父包尚未放开安全版本的间接依赖，增加限定范围的 npm overrides：`js-beautify → glob ^14.0.6`、`editorconfig → minimatch ^11.0.8`、`miniflare → sharp ^0.35.5 / undici ^7.30.2`。其他间接修复包括 PostCSS、nanoid、source-map-js、ws、esbuild。overrides 只作用于这些依赖路径；后续父包原生支持安全版本时可移除。

`package.json` 明确要求 Node.js `^22.12.0 || >=24.0.0`，中英文 README 同步本地开发和 Cloudflare 构建版本要求。本次使用 Node.js 24.9.0 验证。

HTML 清洗测试改用 jsdom 28.1.0，仅对 `custom-public-renderer.test.js` 指定 jsdom 环境，保持原有脚本、事件属性、iframe 和占位符安全断言。DOMPurify 的[官方说明](https://github.com/cure53/DOMPurify#running-dompurify-on-the-server)不推荐与 Happy DOM 组合使用；此次升级后的 Happy DOM 对这组输入的清洗结果与真实浏览器不一致。切换后 7 个用例全部通过，真实 Chromium 浏览器同样正确移除脚本和事件属性。没有修改生产清洗逻辑。

最终锁文件经 `npm ci --prefer-offline --registry=https://registry.npmjs.org --no-audit --no-fund` 干净安装通过，加入 jsdom 后的官方审计仍为 0。依赖树检查及 Node.js 22.12.0 / 24.0.0 / 本机 24.9.0 的依赖版本约束检查通过。

全量测试 170 个文件、1499 个用例全部通过；命令为 `node node_modules/vitest/vitest.mjs run --passWithNoTests --reporter=dot --maxWorkers=2`。本机较高并发运行曾有一条动态导入订阅生成测试超时，单独复查该文件的 25 个用例通过；最终使用两个 worker 完成全量，维持原有的测试断言和 5 秒超时门槛。

YAML 正常合并与异常规模 / 空来源重复合并限制、HTML 格式化、EditorConfig / glob、Sharp 图像编码、Undici HTTP、本地 Miniflare Worker/KV、`npm run build`、Pages Functions 构建，以及桌面 / 手机 / 小屏弹窗和节点预览 / 刷新浏览器回归均已通过。临时验证记录保存在忽略目录 `tmp/p1-*.log` 和 `tmp/p1-*.json`，不纳入版本管理。

### 3. P1：过滤导致节点减少，被误判成上游截断，已复现

本地位置：`functions/services/subscription-service.js:543`、`:552`、`:563`。

当前代码先应用过滤 / 算子，再拿过滤后的节点数与历史数量比较。模拟上游正常返回 100 个节点、历史节点数 100、规则 `keep:KEEP` 正常只保留 1 个节点，未开启保护性缓存时最终输出 **0 个节点**；这不是上游抓取失败。

开启缓存时还有另一条风险：用户更改过滤后，减少到少量或 0 个节点，旧缓存可能重新覆盖新过滤结果；当前缓存记录没有过滤配置指纹。

参考 [48bee6a5](https://github.com/imzyb/MiSub/commit/48bee6a51403fc2060df04bbdee198b4c4147389)：用过滤前的真实节点数做上游截断检测，缓存记录过滤配置指纹，配置变化时避免复用旧过滤结果。移植需适配本项目现有请求运行态更新、保护性缓存和手动节点逻辑。

验收：仅包含规则、剔除规则和算子造成的大幅减少正常生效；新配置筛到 0 时输出 0；真正上游截断仍可回退；无指纹的旧缓存具有明确兼容策略。

**实施进度（2026-11-14）：P1 过滤缩减误判已修复并验证。** 单订阅截断检测改为比较过滤前的真实上游节点数；保护性缓存记录 `upstreamNodeCount` 和 `filterFingerprint`，支持普通算子数组、JSON 算子字符串及旧版算子配置。`lastGoodNodeCount` 使用过滤前的健康数量，前端 `nodeCount` 保持过滤后的实际数量。

上游健康但被规则筛空时，0 个节点是有效结果，会更新缓存和运行态，且不记作订阅源拉取失败。后续上游故障不会复活被筛掉的旧节点；已带指纹的缓存只有配置匹配时才可回退。无指纹旧缓存保留故障保护行为，在健康拉取后补齐新元数据。真正的上游截断仍按原有的最小历史数量 10、缩水比例 30% 阈值保护。

同时修复汇总缓存的同类误判：缓存命中前核对源、订阅组、全局及请求过滤配置；对于全部订阅源真实拉取成功、且原始数量没有异常下降的筛选结果，允许缓存正常缩减。已验证的小缓存以原始数量检查完整性，可以直接命中，不会因为仅剩 1 个节点而每次重新拉取。部分源失败、真实截断、未验证的异常签名仍保留原有保护；缓存写入失败时也不会用不匹配配置的旧节点替换本次正确结果。

新增 `tests/unit/filter-shrink-protection.test.js` 的 21 个回归用例，覆盖 100 → 1、筛空后的故障回退、同规则下上游名称变化、真实截断、旧缓存迁移、汇总缓存命中、流量/UUID 节点签名、部分源失败及缓存写入失败。相关 5 个文件、71 个用例通过；全量 171 个文件、1520 个用例通过，`npm run build` 与 Pages Functions 构建通过。源码、测试、本文的格式检查和 `git diff --check` 通过。验证日志保存在忽略目录 `tmp/filter-shrink-*.log`。

### 4. P1：VMess 的 sing-box 模板输出包含其他协议字段，已复现

本地位置：`functions/modules/subscription/template-renderers/render-singbox.js:72`、`:73`。

模拟一个普通 VMess 节点，模板输出自动加入 `udp_relay_mode: native` 和 `congestion_control: cubic`。核对 [sing-box v1.14.4 VMess 配置结构](https://github.com/SagerNet/sing-box/blob/v1.14.4/option/vmess.go)，这两个字段均不属于 VMess 专属配置。

参考 [8ad6a32e](https://github.com/imzyb/MiSub/commit/8ad6a32ee8cf9ef0ac47135f20b51547edb6054d)，但该提交只删除 `udp_relay_mode`，不能当作完整修复。应同时处理 `congestion_control`，并审查内置生成和模板生成两条路径。

验收：按协议断言合法字段；最好用用户支持的稳定客户端版本执行配置检查，而不仅验证 JSON 可解析。

**实施进度（2026-11-14）：P1 VMess 无效字段问题已修复并验证。** 模板模型和 INI 输出不再为 VMess 添加 `udp_relay_mode`、`congestion_control`；这两个字段继续用于支持它们的 TUIC。内置生成不再输出非法的 `transport.type=tcp`，普通 TCP 省略 transport，WebSocket / gRPC / HTTP 分别使用对应声明，HTTP/2 映射到 sing-box 的 `http` 传输。

VMess 的 UUID、加密方式、alterId、TLS server_name、ALPN、WS path / Host、gRPC service_name、HTTP host / path 保留。跳过证书校验只影响 VMess 已启用的 TLS，不会替普通 TCP 节点启用 TLS；其他协议原有处理保持不变。

新增 `tests/unit/singbox-vmess-fields.test.js`，覆盖内置生成、模板模型和 INI 三条入口，共 27 个回归用例；相关 5 个文件、81 个用例通过。使用官方 sing-box v1.14.4 Windows amd64 二进制，按 GitHub 发布资产 SHA256 校验后执行 `sing-box check`：10 个 VMess 出站配置（两种生成路径 × TCP / WS / gRPC / H2 / HTTP）和 2 个 TUIC 配置均通过；分别加入两个非法 VMess 字段的反例均被客户端拒绝。

客户端检查使用仅包含目标出站的最小配置，不联网下载规则、不建立代理连接；不代表其他完整订阅模板已做全量客户端兼容性验证。全量单测 172 个文件、1547 个用例全部通过，`npm run build` 与 Pages Functions 构建通过，源码 / 测试 / 本文格式检查和 `git diff --check` 通过。临时二进制、JSON 和验证日志位于忽略目录 `tmp/`。

### 5. P1：IPv6 节点导出丢失地址边界，已复现

本地位置：`functions/utils/clash-to-url.js:29`、`:136`、`:206`、`:229`。

将 Trojan 节点地址 `2001:db8::1` 导出为 `trojan://synthetic@2001:db8::1:443#IPv6`，再次解析时 server 变成 **`2001`**，连接地址已被破坏。

参考 [bad1d1e6](https://github.com/imzyb/MiSub/commit/bad1d1e6)，统一在 URI authority 中为 IPv6 添加方括号，再核对 SS、Trojan、VLESS、HY2、TUIC 等输出与解析。SSR 的编码结构不同，不能机械套用普通 URI authority 处理。

验收：每种受影响协议都有 IPv4 / 域名 / IPv6 往返样例，地址与端口保持一致。

**实施进度：P1 IPv6 导出地址边界已修复并验证。** 新增 `shared/proxy-address.js`，前后端 Clash 导出、sing-box 转链接、节点解析和预览元数据共用主机格式化 / 端点拆分规则。URI 中的 IPv6 只包一层方括号，并保持单独的端口；已带括号的地址不会重复包裹，IPv4 和域名保留原有形式。

VMess 的 JSON `add` 字段使用不带 URI 括号的主机值。SSR 继续使用原有编码结构，并从末尾五个固定字段区分端口、协议、加密、混淆和密码，避免把 IPv6 的冒号当成字段边界。WireGuard 保留本地 IPv4 / IPv6 地址和 CIDR 前缀，不对这些本地地址套 URI 括号；sing-box 导入的 TUIC 认证字符使用 URI 编码，避免干扰主机边界。

可兼容本项目旧版带末尾端口的无括号 IPv6 链接：仅在剩余主机是合法 IPv6、后缀是有效十进制端口时恢复解析；规范无端口 IPv6 URI 仍使用方括号。旧版 VMess JSON 中已带括号的地址会规范化。缺失地址及 `false` / `0` 等空值继续按原有约定拒绝。

新增 `tests/unit/ipv6-address-boundaries.test.js` 的 151 个回归用例，覆盖压缩 / 展开 / IPv4 映射的 IPv6、已有括号、IPv4、域名、SS / SS2022、VLESS、Trojan、HY2、TUIC、AnyTLS、SOCKS5、WireGuard、VMess / SSR 编码结构、旧链接、YAML 导入、算子处理及无效地址输入。相关 5 个文件、201 个用例通过；全量 173 个文件、1698 个用例通过，`npm run build` 与 Pages Functions 构建通过，源码 / 测试 / 本文格式检查和 `git diff --check` 通过。通过官方 sing-box v1.14.4 检查的 21 个最小出站配置也验证了三种导出来源的 IPv6 server / port。客户端检查不联网，不代表所有完整规则模板的客户端兼容性。临时验证资料保存在忽略目录 `tmp/ipv6-*.log`、`tmp/ipv6-*.json`。

### 6. P1：浏览器存储异常可能阻断页面或引发重复恢复

本地位置：`src/main.js:29`、`:74`、`:80`、`:104`，`src/router/index.js:88`，`src/composables/useManualNodes.js:33`。

chunk 恢复直接读写 `sessionStorage`；手动节点 composable 初始化直接读取 `localStorage`。存储访问抛错时，这些路径没有统一降级。资源恢复虽然捕获写入异常，但仍继续跳转，重载标记未持久化时可能重复恢复。

参考上游 [84373d6d](https://github.com/imzyb/MiSub/commit/84373d6d)、[629c850c](https://github.com/imzyb/MiSub/commit/629c850c)、[b31cc81b](https://github.com/imzyb/MiSub/commit/b31cc81b)。抽取安全读写工具；需要跨刷新保留的恢复标记应写后回读，失败时停止自动刷新并给出人工恢复提示。普通偏好使用默认值降级。

此项依据源码核查，未在真实浏览器禁用存储后执行端到端复现。保留本项目当前会话同步、断网草稿保护与弹窗预加载设计，不用上游整份 `App.vue` 或 session store 替换。

**实施进度（2026-11-15）：P1 浏览器存储容错已完成并验证。** 新增 `src/utils/browser-storage.js`，在保护范围内获取存储对象并读写，覆盖存储 getter 本身抛 `SecurityError`、读写方法抛错和环境中没有存储对象的情况。手动节点分页、现代 / 传统节点视图、布局、语言和发布说明 / 公告偏好接入安全读写。存储不可用时使用原有默认值，分页、视图和语言切换仍可使用；布局写入失败时只更新当前页面，避免刷新丢失刚切换的布局。

新增 `src/utils/chunk-reload.js`，全局 Promise 错误、路由 chunk 错误和同源资源恢复共用“读取标记 → 写入 → 回读确认”的判定。读取失败、配额耗尽、静默丢弃写入及回读不一致均停止自动刷新，资源恢复也不清理缓存；错误提示明确引导手动刷新，并支持中英文。标记在异步缓存清理前确认，多资源同时失败只触发一次恢复。已有标记继续禁止重复恢复，第三方错误过滤、会话同步、草稿状态和预加载逻辑沿用本项目实现。

新增两份单元测试并扩展全局错误接线测试，共增加 47 个回归用例。全量 175 个文件、1745 个用例通过，`npm run build` 通过，改动文件格式检查和 `git diff --check` 通过。

新增 `tests/browser/browser-storage-resilience.mjs`（先执行 `npm run build`，再运行 `npm run test:browser-storage`），使用真实 Chromium 加载生产构建，并注入存储 getter 抛错、写入配额错误和静默丢弃写入；11 个场景全部通过。手动节点页面正常显示，默认每页 24 个，切换 48 个会返回第一页，列表视图与语言切换正常。持续 chunk / JS 资源 404 时，正常存储只自动刷新一次（共 2 次文档请求），三种故障存储均不自动刷新（1 次文档请求）且显示人工恢复提示，没有新增未捕获异常。接口使用本地模拟数据，外部请求被拦截；这属于浏览器故障注入验证，没有修改浏览器实际站点权限。开发环境另发现 Pinia 调试工具自身直接读取存储，因此端到端验收使用与部署一致的生产构建。验证日志位于忽略目录 `tmp/browser-storage-*.log`。

### 7. P1 / P2：预览与正式输出的保护性缓存行为不一致

本地位置：`functions/modules/subscription/node-fetcher.js:72`、`:99`，调用点 `single-subscription.js:72` 和 `profile-handler.js:193` 附近。

正式订阅生成已有 per-sub 缓存回退；预览的 `fetchSubscriptionNodes` 却没有接收 storage adapter / subscription 来读取缓存。模拟上游返回 HTTP 200 + 过期提示，开启 `enableNodeCache` 后预览仍返回 **success: true、nodes: []**。HTTP 错误也直接返回失败。

参考 [6928fe46](https://github.com/imzyb/MiSub/commit/6928fe46)：为已有订阅预览接入保护性缓存，并返回 `fromCache`、更新时间及原抓取错误。必须与过滤指纹修复一起处理，区分“过期页面无节点”和“用户规则主动筛空”。

保留本项目 2026-11-11 新增的 `forceRefresh` 以及前端失败反馈；缓存回退不能让强制刷新失败被悄悄显示为刷新成功。直接 URL 预览没有保存的 subscription，不应随意复用其他订阅缓存。

**实施进度（2026-11-15）：P1 / P2 预览保护性缓存回退已完成。** 单订阅、私有订阅组及公开订阅组的普通预览接入正式输出使用的单订阅缓存读取工具。已开启保护性缓存的保存订阅遇到 HTTP 错误、网络异常、HTTP 200 过期提示 / 无真实节点，或过滤前数量异常缩水时，可以使用兼容的保护性缓存，并返回 `fromCache`、`cacheUpdatedAt` 和原抓取错误。前端明确显示缓存来源、更新时间与失败原因。

所有故障回退均核对当前过滤 / 算子指纹，已记录来源 URL 的缓存还必须匹配当前订阅 URL；订阅保留 ID 但换了 URL 时不会复用之前来源的节点。无指纹 / 无来源 URL 的旧缓存延续正式输出的兼容策略。判断空结果和异常缩水使用过滤前真实节点数，正常过滤至 1 个或 0 个节点直接生效；已有的正常筛空缓存继续保持为空。缓存 URL 已经过来源过滤 / 算子处理，回退时只重新解析节点元数据，不重复执行这些处理。预览只读取正式输出的保护性缓存，不用未经完整来源处理的预览节点改写它。

`forceRefresh` 继续绕过上游缓存，并禁止本次请求使用保护性缓存替代失败。刷新失败时，前端保留已显示节点并提示失败；订阅组仍可显示其他成功来源及手动节点，同时标明失败来源。直接 URL 模式不读取保存订阅的缓存，无真实节点的上游响应返回明确失败。浏览器弹窗的短期结果复用不把保护性缓存回退当成健康新结果，重新打开时会再次尝试上游，成功后清除缓存提示。

新增 `tests/unit/preview-protective-cache.test.js` 的 37 个回归用例，并扩展预览弹窗测试 5 个用例，覆盖三种预览入口、HTTP / 网络 / 空响应 / 伪节点、指纹变化、D1 JSON 算子、旧缓存、来源变更、筛空、真实截断、强制刷新和新鲜 / 缓存 / 失败 / 手动节点混合订阅组。预览以解析结果的本地端点排除规则识别真实节点，保留原有 Snell / Naive 支持，不将正式缓存的协议清单当成预览协议白名单。相关 3 个文件、62 个用例通过。

新增 `tests/browser/preview-protective-cache.mjs`，使用真实 Chromium、实际预览 handler 和内存 KV，通过本地 HTTP 接口验证 UI 到后端回退的完整链路。单订阅 / 私有组 / 公开组 × 中英文 × 1440 / 390 / 320px 共 18 个场景通过，验证缓存提示、强制刷新失败保留节点、重新打开获取恢复后的新节点、移除提示及无横向溢出 / 未捕获异常。上游抓取使用模拟 HTTP 403 / 正常节点响应，浏览器外部请求被拦截，没有读取线上订阅或 KV。验证日志和截图在忽略目录 `tmp/preview-cache-*`。

最终全量 176 个文件、1787 个用例全部通过，`npm run build` 与 Pages Functions 构建通过，改动文件格式检查和 `git diff --check` 通过。首次全量运行的一份 jsdom 测试进程启动超时，未出现断言失败；该文件的 7 个用例单独复查通过，随后使用两个 worker 完成最终全量验证，无未处理错误。最终全量日志为 `tmp/preview-cache-final-unit.log`。

## 按需采纳的功能和兼容性增强

| 项目                         | 当前状态 / 收益                                                                                                                           | 建议                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| XHTTP 高级参数双向映射       | 初次对照时只有 padding 等 9 个字段，`headers`、`xmux`、`downloadSettings` 会丢失；2026-11-15 已完成前后端高级参数映射及下载流安全继承修复 | 实施及验证详见下文；参考 `6ecc36cb`、`4ceac9aa`、`b34efa38`、`00f87185`、`47bcc1c7`、`e5e3e2ac`，保留本项目 packet-encoding 和 encryption 修复 |
| HY2 参数兼容                 | 2026-11-15 已修复 peer、证书 pin、跳跃间隔和端口范围的解析 / 导出，并接入可等价表达的客户端字段                                           | 实施及客户端边界详见下文；参考 `510323ec`、`7861be59`、`d3fe8cad`                                                                              |
| HTTP / HTTPS 代理            | 2026-11-15 已补齐 HTTP / TLS HTTP 代理的解析、导入导出和来源识别，已保存代理不再作为订阅地址抓取                                          | 实施和歧义地址处理详见下文；参考 `7c1aa705`、`103279e1`、`cda96fb9`、`d226fc2f`、`5ceb437f`                                                    |
| `.mrs` 规则 provider         | 统一模板 renderer 复现输出 classical + `.yaml` path，缺 format；远程 Clash YAML 原样配置已有 mrs 保留测试                                 | 使用 mrs 的统一模板时参考 `44d39ef5`，输出合法 format / behavior / path；不需重做已支持的远程 YAML 路径                                        |
| Mihomo 自定义链式代理        | 本项目内置链式代理已支持 dialer-proxy，但缺上游自定义 INI / YAML 的 chain-proxy 扩展                                                      | 有自定义链式模板需求再参考 `4b13ca2f`、`f59ce91c`、`f9342cde`，维持普通 Clash 与 Meta 的能力区分                                               |
| v2rayN 完整配置链接、Mieru   | 本项目已有普通 vmess / vless URI；上游增加的 v2rayn parser 面向另一类完整配置导入                                                         | 按实际输入格式增加，不把“支持 v2rayN 客户端”误当作“已支持所有 v2rayn:// 配置链接”                                                              |
| 机场身份、站点分组和命名记忆 | 上游提供用户指定机场身份、站点聚合、跨分页保持分组及 TG 管理                                                                              | 订阅数量较多时有价值；小规模部署可暂缓，需要保留本项目布局和导航优化                                                                           |
| 组合订阅嵌套                 | 上游 `0719f5a3` 新增 subProfiles；本项目没有对应 UI / 完整聚合逻辑                                                                        | 有复用订阅组需求再做。需一起处理 `36d5d056` 的初始化错误修复，并补环检测、重复节点、禁用子组、预览、删除和导入兼容                             |
| SettingsContent 共享         | 本项目 SettingsView 与 SettingsPanel 仍重复维护，后者仍静态导入分区                                                                       | 可借鉴 `19c9575b` 的共享结构，继续保留本项目按需加载、加载反馈和浮动保存逻辑                                                                   |

### XHTTP 高级参数双向映射（2026-11-15）

**实施进度：高级参数双向映射已完成。** 新增 `src/utils/protocols/common/xhttp-extra.js`，通过原有 `vless-params.js` 导出接口供前后端共用。VLESS 链接 → Clash / Mihomo，以及前端 / 后端 Clash → VLESS 链接均保留请求头、padding、uplink HTTP method、session / seq / uplink data、分包大小和间隔、XMUX 复用参数，以及独立 `downloadSettings` 的地址、端口、XHTTP path / host / headers / XMUX、TLS / REALITY 设置。session 旧字段名可导入，导出统一使用 `sessionID*`；数值及区间按目标字段类型规范化，已有的 `false` / `0`、packet-encoding、encryption、IPv6 修复继续保留。

HTTP 头只保留字符串值，并按不区分大小写的名称去重。URL 明确指定的 host 优先于 extra 里的 Host；只有请求头提供 Host 时也能还原。导出把 Host 放回独立 host 参数，并从 extra 的上下行 headers 中移除，符合 Xray 的校验规则。未知字段和无可转换字段的 XMUX 不产生空 extra；非法 extra JSON 不会导致整个节点被拒绝。

下载流只按声明的 `security` 读取对应 TLS / REALITY 块，缺省安全模式保持无 TLS。Xray 的下载流配置独立，而 Mihomo 的缺失字段会继承上行；导入时明确默认 TLS、SNI、指纹、ALPN、校验证书选项及 path / host / headers / reuse，必要时用空 REALITY 公钥阻止错误继承。Clash 导出时则物化真实生效的继承值，保留同一下载地址和安全配置，并明确输出 `downloadSettings.network=xhttp`。声明 REALITY 但缺公钥时保留清空标记并记录告警，避免拿上行公钥代替；这类无效输入不作为有效客户端配置验证样例。

另核对并处理 Xray 构建时的 `extra` 覆盖规则：`xhttpSettings.extra` 会替换除 host / path / mode 外的配置，下载头必须与 XMUX 一起写入内层 extra，不能把头放在会被覆盖的外层。该行为由官方 [Xray v26.11.9 transport_method.go](https://github.com/XTLS/Xray-core/blob/v26.11.9/infra/conf/transport_method.go) 与 [Mihomo v1.19.34 vless.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.34/adapter/outbound/vless.go) 的类型及继承逻辑确认。

新增 `tests/unit/xhttp-advanced-mapping.test.js` 的 60 个回归用例和共享样例 `tests/fixtures/xhttp-advanced.js`，验证前后端往返、全套字段、字符串头与大小写去重、数值区间、旧 session 名称、空 / 非法输入、上下行 TLS / REALITY / 明文、继承和显式清除。集成验证经过 Clash YAML 导入、内置 Clash 生成和 INI 模板生成，高级选项及 packet-encoding / encryption 保持一致。相关 4 个文件、114 个用例通过；全量 177 个文件、1847 个用例全部通过，`npm run build` 与 Pages Functions 构建通过，改动文件格式检查和 `git diff --check` 通过。

使用官方 Mihomo v1.19.34 与 Xray v26.11.9 Windows amd64 二进制，经 GitHub 发布资产 SHA256 digest 核验后执行 `mihomo -t` / `xray run -test`。前端 / 后端 × 三种上行安全模式 × 基础、三种独立下行安全模式、继承、缺省下行，共 36 对配置、72 次客户端检查通过。Mihomo 要求 post 间隔大于 0，客户端样例使用有效正区间；Xray 不允许面向公网的无加密 VLESS，明文上行样例使用私有 IPv6。单元测试仍验证显式 0 的保留，不将保留输入值当作所有客户端都接受该值的证明。

客户端检查使用最小出站配置，不下载规则、不建立代理连接；没有声称所有完整订阅模板或其他客户端都支持这些 XHTTP 字段。临时源码、二进制、配置和验证结果位于忽略目录 `tmp/xhttp-*`。

### HY2 参数兼容（2026-11-15）

**实施进度：HY2 参数兼容已完成。** 新增共用 `src/utils/protocols/common/hysteria2-params.js`，HY2 / Hysteria2 链接解析支持 `peer` 作为 SNI 别名，支持 `pinSHA256` / `hpkp` / `fingerprint` 证书 pin，以及 `hop-interval` / `hopInterval` / `hop_interval` 跳跃间隔。明确的 `sni` 和 `pinSHA256` 优先于别名。前后端 Clash → URI 均保留证书 fingerprint、端口列表、间隔、ALPN 和带宽，修正前端把 ClientHello 的 `client-fingerprint=chrome` 当作证书 pin 的错误；密码、混淆、realm 和 IPv6 逻辑继续保留。

本项目导出继续保留单独的主要端口，并用 `ports` 查询参数表达跳跃范围；导入同时兼容 `mport` 和[官方 HY2 URI](https://v2.hysteria.network/docs/developers/URI-Scheme/) 的 authority 多端口格式，例如 `[2001:db8::1]:20000-20010,21000/`。保留合法端口范围，拒绝无效范围。跳跃间隔统一为 Mihomo 的整数秒或范围，兼容 `30s`、`1m` 等整秒 duration 输入；`upmbps` / `downmbps` 与 ALPN、显式 `insecure=0` 也能往返。Hysteria1 的协议和既有导出行为保留。

Clash / Mihomo 的内置和 INI 模板输出保留完整证书 fingerprint 和跳跃配置。sing-box 的内置和模板输出映射为 `server_ports`、`hop_interval` / `hop_interval_max`、`up_mbps` / `down_mbps` 和 TLS SNI / ALPN；端口范围使用冒号，单个端口也写成 `21000:21000`，符合 sing-box v1.14.4 的实际校验。间隔 0 使用 30 秒缺省，小于 5 秒按 Mihomo 语义归一到 5 秒。sing-box JSON 导入保留这些字段，也能导入只有 `server_ports`、未写 `server_port` 的节点。

Surge 输出按[官方 HY2 文档](https://manual.nssurge.com/policies/hysteria2.html)使用分号分隔 `port-hopping`，并输出单值 `port-hopping-interval` 和[证书 pin 字段](https://manual.nssurge.com/policies/tls.html) `server-cert-fingerprint-sha256`。Loon 按[官方节点样例](https://github.com/Loon0x00/LoonExampleConfig/blob/master/Nodes/ExampleNodes.list)输出 `server-ports` 和单值 `hop-interval`。两个客户端的下载带宽提示输出整数 Mbps；前后端 INI 导入同样识别这些字段。范围间隔无法等价写入这两个导出器时明确报错，不取一个端点冒充完整范围。

**证书 pin 的客户端边界：** HY2 的 `pinSHA256` 是整张服务端证书的 SHA256；sing-box v1.14.4 的 `certificate_public_key_sha256` 校验的是 SPKI 公钥哈希，两者不能互换，已核对其[实际 TLS 校验源码](https://github.com/SagerNet/sing-box/blob/v1.14.4/common/tls/std_client.go)。因此需要整张证书 pin 的节点可以输出 URI、Clash / Mihomo 和 Surge，但 sing-box 会明确拒绝转换；Loon、Egern 导出器目前也没有核实等价 pin 字段，不能静默丢失该约束。正式内置订阅请求返回 HTTP 422 和原因，保持用户可识别的失败，不降级为丢了校验的配置或误报成功。未使用公钥 hash、开启 insecure 或其他猜测配置代替证书 pin。

新增 `tests/unit/hysteria2-parameter-compatibility.test.js` 的 67 个回归用例，覆盖别名优先级、前后端 URI / YAML / INI 往返、官方多端口格式、间隔数值和 duration、非法输入、证书字段区别、带宽、混淆 / 密码、sing-box 两种生成入口以及正式订阅 HTTP 422 行为。相关 4 个文件、112 个用例通过；全量 178 个文件、1914 个用例全部通过。客户端校验后补齐单端口范围格式及带宽输出的专项复查也通过；最终 `npm run build`、Pages Functions 构建、改动文件格式检查和 `git diff --check` 通过。

使用已按官方发布资产 SHA256 校验的 Mihomo v1.19.34 与 sing-box v1.14.4 Windows 二进制：前端 / 后端 / sing-box JSON 导入 × 域名 / IPv4 / IPv6 × 单值 / 范围间隔，检验 Mihomo 与 sing-box 内置 / 模板最小出站，再检查两个带 certificate fingerprint 的 Mihomo 配置，共 56 次客户端配置检查通过，另 4 次断言确认 sing-box 无法等价表示的证书 pin 会被拒绝。跳跃节点初始化会解析地址，验证配置使用本地 hosts DNS 解析器，没有向外部 DNS 发请求，也没有建立代理连接；这不代表实际服务端握手或全部模板的联网验证。验证日志、配置和源码位于忽略目录 `tmp/hy2-*`。

### HTTP / HTTPS 代理（2026-11-15）

**实施进度：HTTP / HTTPS 代理兼容已完成。** HTTP 和 HTTPS URI 均可解析为 Clash / Mihomo 的 `type: http`；HTTPS 明确添加 `tls: true`。前后端共用 HTTP 链接导出，按 `type=https` 或显式 `tls=true` 选择 HTTPS，不因单独的 SNI / 指纹字段给普通 HTTP 启用 TLS。认证允许无用户名密码、仅用户名或空用户名密码，特殊字符使用 URI 编码；显式主要端口（包括 80 / 443）、IPv6、SNI / peer、ALPN、ClientHello 指纹、证书校验开关、字符串请求头和 dialer-proxy 保留。

新增 `shared/node-source.js`，统一手动节点与远程订阅来源识别。代理 endpoint 必须为 HTTP(S) 根路径及代理查询字段；根路径的认证信息、带显式端口的节点名 / 代理参数或明确节点标记可识别为代理。带 `/sub` 等路径、token / target 等订阅查询参数的地址继续作为远程订阅，不因自定义端口被当成代理。仅凭 `https://host:8443/` 无法判断是代理还是订阅，所以批量粘贴这类没有认证、节点名和代理参数的裸地址时保留订阅语义；用户在手动节点入口添加，或通过 Clash / sing-box / INI 代理配置导入时，记录 URL 中的 `proxy=1` 标记（仅在确需消除歧义时），保留默认端口。已有根路径命名 / 认证代理无需迁移。

该来源规则用于前端节点 / 订阅列表、批量导入、排序和重排、订阅组选择，后端单节点 / 订阅组预览、正式订阅与缓存计数、保护性缓存、自动 / 批量刷新、外部 API，以及 Telegram 节点列表 / 导入 / 刷新分类。已识别代理不会被 fetch 当作订阅，真正的订阅仍可正常抓取；HTTP 代理也按真实节点写入保护性缓存。只改变 Telegram 分类与转换代码，没有通过 Telegram 发送真实消息。当前订阅组的旧 subscriptions 引用中若混入 HTTP 代理，也会当作节点保留。

Clash YAML 和 sing-box HTTP 出站配置可导入。内置 / INI 模板的 Clash 与 sing-box 输出保留 HTTP 认证、TLS、SNI、ALPN和 HTTP headers；sing-box 使用原生 `type=http` 与 TLS 子配置，普通 HTTP 不启用 TLS。Surge、Loon 和 Quantumult X 使用各自 TLS HTTP 表达，并补齐 HTTP 节点导入：Surge 的 HTTPS 类型，Loon 的 `over-tls=true`，Quantumult X 的 `http=endpoint, ... over-tls=true`。Surge / Loon 的用户名密码和 Quantumult X 字符串值使用 INI 引号规则，后端 INI 解析支持 TLS、认证及 IPv6。Quantumult X 只把明确的 `http=` / `https=` 代理行作为节点，不将远程规则 URL 当成 HTTP 代理。

新增 `tests/unit/http-proxy-compatibility.test.js` 的 53 个回归用例和 `http-proxy-ui-boundaries.test.js` 的 4 个用例，更新原先 HTTPS 类型及“HTTP 导出不能回环”的旧断言。覆盖来源歧义、带路径 / token / 自定义端口的订阅、认证与 IPv6、默认端口、显式节点入口、前后端 URI / YAML / sing-box / INI 往返、混合列表抓取、预览、保护性缓存、正式请求新鲜 / 缓存输出、刷新拒绝代理和外部手动节点创建。专项 3 个文件、64 个用例通过；最后的 Quantumult X / HY2 相关 4 个文件、131 个用例通过。

官方 Mihomo v1.19.34 与 sing-box v1.14.4（沿用此前已按发布资产 SHA256 核验的 Windows 二进制）：前端 / 后端 × 域名 / IPv4 / IPv6 × 普通 HTTP / TLS HTTP × 无认证 / 仅用户名 / 完整认证，检验 Mihomo 与 sing-box 内置 / 模板的最小配置，共 108 次原生配置检查通过。检查不建立代理连接，不代表真实服务端认证或全部模板联网验证。

新增 `tests/browser/http-proxy-boundaries.mjs`，使用真实 Chromium 和生产构建，模拟本地接口加载两个 HTTP / HTTPS 代理及一个带自定义端口的订阅源。中英文 × 1440 / 390 / 320px 共 6 个场景通过：代理出现在手动节点页，订阅出现在机场订阅页，节点内容适配小屏，没有因代理分类新增未捕获异常或把代理提交到订阅数量抓取接口。浏览器外部请求被拦截，没有读取生产订阅。临时配置、日志和截图保存在忽略目录 `tmp/http-*`。

最终全量 180 个文件、1971 个用例全部通过，`npm run build`、Pages Functions 构建、改动文件格式检查及 `git diff --check` 通过。全量验证日志为 `tmp/http-proxy-final-unit.log`。

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
