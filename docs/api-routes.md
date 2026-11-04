# MiSub API Routes and Access Boundaries

本文档记录当前 `functions/[[path]].js` 与 `functions/modules/api-router.js` 中的真实路由、认证边界与主要读写行为。目标是让公开接口、管理接口、迁移接口和诊断接口的边界可审查、可测试、可回归。

## 全局入口与中间件

- Cloudflare Pages Functions 入口：`functions/[[path]].js`
- `/api/*` 路由入口：`functions/modules/api-router.js`
- 所有请求先经过：
    - `corsMiddleware()`：按 `CORS_ORIGINS` 或当前 origin 设置 CORS。
    - `csrfOriginMiddleware()`：对 `POST` / `PUT` / `PATCH` / `DELETE` 做 Origin/Referer 校验；无 Cookie 的非浏览器/API 客户端或 Bearer 调用允许继续。
    - `securityHeadersMiddleware()`：统一添加安全响应头。
- 管理 API 在统一入口逐请求调用 `authMiddleware()`，校验 HMAC 登录 Cookie 的签名和有效期；通过后才解析或分发业务请求。
- 默认所有 API 都需要管理员会话，只有明确列出的公开接口和使用独立令牌的接口例外。私有数据、登录及退出响应统一禁止浏览器和 CDN 缓存。
- `/cron` 不走 `/api/*` 的 Cookie 登录认证，使用 `settings.cronSecret`，支持 `Authorization: Bearer <secret>` 或 `?secret=<secret>`。

## 顶层非 `/api/*` 路由

- `GET/HEAD /`、静态资源、SPA 路由
    - 入口：`functions/[[path]].js`
    - 认证：公开；受 disguise 设置影响。受保护 SPA 路由在非 localhost 下会先校验登录状态，未登录时返回伪装页。
    - 写入：无。

浏览器中的后台访问使用相同规则：已登录访问正确管理入口进入 `/dashboard`；未登录访问 `/dashboard` 或子页面显示配置的伪装页，不跳到管理入口，也不自动附加 `redirect` 参数。正确入口经服务端确认后才显示登录页，确认失败时保持伪装。退出回到 `/`，根据公开页开关展示公开首页或配置的伪装；恢复旧后台页面时重新验证会话。

已确认过登录的页面在连接异常或重新验证期间保留编辑组件和内存草稿，锁定操作并暂停私有请求；验证成功后继续当前页面，不自动覆盖或提交草稿。确认会话失效或退出后清理私有数据。跨标签页退出通过 `BroadcastChannel` 通知，使用 `storage` 事件兜底；退出开始时先暂停其它标签页，确认后再清理会话，退出未确认则重新验证。消息仅包含事件类型、随机标识、发送者标识和时间，不包含 Cookie、令牌或管理入口路径。

- `GET /sub/*`、`GET /{mytoken}`、`GET /{profileToken}`、其它疑似订阅短链路径
    - Handler：`handleMisubRequest()`，实现位于 `functions/modules/subscription/main-handler.js`，由 `functions/modules/subscription-handler.js` re-export。
    - 认证：公开短链/token 模式；具体访问控制由 token、profile、settings、浏览器伪装和订阅配置决定。
    - 读取：settings、subscriptions、profiles、rule templates、node cache。
    - 写入：可能写下载计数、节点缓存、运行态/错误信息、通知状态。

- `/cron`
    - Handler：`handleCronTrigger()`，`functions/modules/notifications.js`
    - 认证：需要 `settings.cronSecret`，通过 Bearer 或 query secret 校验。
    - 读取：settings、subscriptions。
    - 写入：订阅节点数、用户流量信息、通知状态等 cron 同步结果。

## `/api/*` 公开或条件公开接口

统一入口显式允许下列公开接口；Telegram webhook 使用独立的 secret 和用户权限检查，`/api/data` 仅向未登录者返回会话状态。公开写接口仍经过全局 CSRF Origin/Referer 中间件。

- `POST /api/login`
    - Handler：`handleLogin()`，`functions/modules/auth-middleware.js`
    - 认证：公开登录入口。
    - 读取：管理员密码、Cookie secret。
    - 写入：设置登录 Cookie；必要时初始化/读取密码相关存储。

- `GET /api/logout` / `POST /api/logout`
    - Handler：`handleLogout()`
    - 认证：公开，允许过期 Cookie 场景正常登出。
    - 写入：清除登录 Cookie。

- `GET /api/public_config`、`GET /api/config`
    - Handler：`handlePublicConfig()`，`functions/modules/api-handler.js`
    - 认证：公开。
    - 读取：settings。
    - 返回：公开页开关、入口是否命中及是否使用自定义路径、公开伪装配置和自定义公开页安全子集；不返回真实的自定义管理入口路径。

- `GET /api/public/profiles`
    - Handler：`handlePublicProfilesRequest()`
    - 认证：公开。
    - 读取：profiles、settings。
    - 返回：仅公开且启用的 profile 摘要，以及公告、hero、guestbook、customPage 等公开配置子集。

- `POST /api/public/preview`
    - Handler：`handlePublicPreviewRequest()`，`functions/modules/subscription/preview-handler.js`
    - 认证：公开，但只允许预览 `enabled && isPublic` 的 profile。
    - 读取：profile、其关联订阅/手动节点。
    - 写入：无直接持久化；可能触发远程订阅拉取。

- `GET /api/public/guestbook`
    - Handler：`handleGuestbookGet()`，`functions/modules/handlers/guestbook-handler.js`
    - 认证：公开。
    - 读取：guestbook messages、settings。
    - 返回：仅 `isVisible` 的公开留言字段。

- `POST /api/public/guestbook`
    - Handler：`handleGuestbookPost()`
    - 认证：公开；受全局 CSRF Origin/Referer 保护。
    - 读取：settings。
    - 写入：guestbook index/item；可能发送 Telegram 通知。
    - 限制：内容不能为空，最长 500 字；昵称最长 20 字。

- `POST /api/telegram/webhook`
    - Handler：`handleTelegramWebhook()`，`functions/modules/handlers/telegram-webhook-handler.js`
    - 认证：公开入口，handler 内部校验 webhook secret / bot 配置 / 用户权限。
    - 读取/写入：Telegram bot 配置、subscriptions、profiles、settings 等，取决于命令。

- `POST /api/system/error_report`
    - Handler：`handleErrorReportRequest()`，`functions/modules/handlers/error-report-handler.js`
    - 认证：公开；无 KV 时静默成功。
    - 写入：`misub_error_reports`，最多保留 100 条。
    - 限制：消息、stack、附加数据长度限制；内存级去重与每分钟持久化预算。

- `GET /api/clients`
    - Handler：`handleClientRequest()`，`functions/modules/handlers/client-handler.js`
    - 认证：公开只读。
    - 读取：`misub_clients_v1`；无 KV 或存储暂停时回退内置默认客户端列表。
    - 写入：读取时如发现旧图标可能尝试迁移写回。

- `GET /api/data`
    - Handler：`handleDataRequest()` 仅在认证通过时调用。
    - 认证：条件公开。未登录返回 HTTP 200 和 `{ authenticated: false, message: 'Not logged in' }`，不会返回业务数据。
    - 读取：登录后读取 subscriptions、profiles、settings、rule templates。
    - 写入：登录后可能异步迁移旧 profile ID。

- `GET /api/session`
    - 用于轻量会话验证，逐请求校验登录 Cookie 的签名和有效期。
    - 返回：HTTP 200 和 `{ authenticated: true/false }`，不返回业务数据或配置。
    - 验证服务不可用时返回 HTTP 503，不伪装成会话过期。
    - 所有响应禁止缓存。重连和页面恢复优先使用此接口；已加载页面不会因此重新注入业务数据。

- `GET /api/github/release?repo=owner/repo`
    - Handler：`handleGithubReleaseRequest()`，`functions/modules/handlers/github-proxy-handler.js`
    - 认证：公开。
    - 读取：GitHub 最新 release API；读 KV 缓存。
    - 写入：`github_release_${repo}` KV 缓存。
    - 限制：`repo` 只允许 `owner/repo` 形态；响应只保留 tag/url/time/name/body。

## `/api/ext/v1/*` External Management API

统一入口将这些接口交给 `handleExternalApiRequest()`，逐请求验证 `settings.externalApi` 中配置的 Bearer Token，不复用后台登录 Cookie。

- 入口：`functions/modules/external-api-router.js`
- 认证：`functions/modules/external-api-auth.js`
- 文档：
    - `docs/external-management-api.md`
    - `docs/external-management-api-usage.md`
    - `docs/external-management-api.openapi.yaml`
- 认证要求：
    - `settings.externalApi.enabled === true`
    - `Authorization: Bearer <token>` 必须命中 `settings.externalApi.tokens[*].token`
- 默认失败：
    - External API 未启用：`403 forbidden`
    - Token 缺失或不匹配：`401 unauthorized`
- 响应形态：
    - 成功：`{ success: true, data, meta? }`
    - 失败：`{ success: false, error: { code, message, details? } }`

### 远程订阅源 resources

- `GET /api/ext/v1/subscriptions`
    - 读取：仅返回 `url` 为 `http(s)` 的项目。
    - 筛选：`enabled`、`group`、`keyword`、`page`、`pageSize`。
- `POST /api/ext/v1/subscriptions`
    - 写入：创建远程订阅源。
    - 限制：`url` 必须是 `http://` 或 `https://`。
- `GET /api/ext/v1/subscriptions/:id`
- `PATCH /api/ext/v1/subscriptions/:id`
- `DELETE /api/ext/v1/subscriptions/:id`
    - 删除后会级联清理所有 profile 中的该订阅源 ID。

### 手动节点 resources

- `GET /api/ext/v1/manual-nodes`
    - 读取：仅返回节点协议 URL 项。
    - 筛选：`enabled`、`group`、`protocol`、`keyword`、`page`、`pageSize`。
- `POST /api/ext/v1/manual-nodes`
    - 写入：创建手动节点。
    - 限制：`url` 必须是受支持的节点协议，不允许 `http(s)`。
- `GET /api/ext/v1/manual-nodes/:id`
- `PATCH /api/ext/v1/manual-nodes/:id`
- `DELETE /api/ext/v1/manual-nodes/:id`
    - 删除后会级联清理所有 profile 中的该手动节点 ID。

### 订阅组 resources

- `GET /api/ext/v1/profiles`
    - 筛选：`enabled`、`keyword`、`page`、`pageSize`。
- `POST /api/ext/v1/profiles`
- `GET /api/ext/v1/profiles/:id`
- `PATCH /api/ext/v1/profiles/:id`
- `DELETE /api/ext/v1/profiles/:id`
- `POST /api/ext/v1/profiles/:id/subscriptions`
- `DELETE /api/ext/v1/profiles/:id/subscriptions`
- `POST /api/ext/v1/profiles/:id/manual-nodes`
- `DELETE /api/ext/v1/profiles/:id/manual-nodes`

对外 DTO 固定返回：

- `subscriptionIds`
- `manualNodeIds`

不会暴露内部存储字段 `subscriptions` / `manualNodes`。

### 轻量预览

- `POST /api/ext/v1/profiles/:id/preview`
    - 返回：profile 对外 DTO、远程订阅源数量、手动节点数量、按协议统计和 sources 摘要。
    - 当前不会主动拉取远程订阅内容，只做轻量聚合。

## `/api/*` 登录后管理接口

以下路由在统一入口通过管理员 Cookie 鉴权后才进入业务分发。无凭证、签名无效或凭证过期均返回 `401`，不会执行对应业务处理。handler 仍负责请求方法、参数和业务校验。

- `GET /api/auth_debug`
    - Handler：`getAuthDebugInfo()` + `getAuthSessionDiagnostic()`。
    - 认证：需要有效管理员会话，并且 `ENABLE_AUTH_DIAGNOSTICS=true`；未启用返回 `404`，启用但未登录返回 `401`。
    - 返回：认证与运行态诊断，不返回明文密码或 Cookie secret。

- `POST /api/auth_check`
    - Handler：`getLoginPasswordDiagnostic()`。
    - 认证：与 `/api/auth_debug` 相同，需要管理员会话和显式开启诊断。
    - 返回：登录密码诊断结果，不返回明文密码。

- `POST /api/migrate_to_d1`
    - Handler：`DataMigrator.migrateKVToD1()`
    - 写入：D1 subscriptions/profiles/settings 等迁移数据。

- `GET /api/detect_legacy_d1`
    - Handler：`DataMigrator.detectLegacyD1MainRows()`
    - 读取：D1 legacy `main` 行状态。

- `POST /api/migrate_legacy_d1`
    - Handler：`DataMigrator.migrateLegacyD1MainRows()`
    - 写入：将旧 D1 `main` 行迁移为行级结构。

- `POST /api/migrate`
    - Handler：api-router 内联旧 KV 迁移逻辑。
    - 读取：旧 `misub_data_v1` 与新 `misub_subscriptions_v1`。
    - 写入：`misub_subscriptions_v1`、`misub_profiles_v1`、旧数据备份 key，并删除旧 key。

- `POST/DELETE /api/clients*`、`POST /api/clients/init`，以及除 `GET /api/clients` 外的其它客户端管理路径
    - Handler：`handleClientRequest()`
    - 写入：`misub_clients_v1`。

- `POST /api/test_notification`
    - Handler：`handleTestNotificationRequest()`
    - 行为：测试 Telegram 通知配置；不持久化传入 token/chat id。

- `GET /api/kv_test`
    - Handler：api-router 内联 KV 诊断。
    - 读写：写临时 `__kv_test_*` key，读回后删除；读取 subscriptions/settings 是否存在。

- `POST /api/misubs`
    - Handler：`handleMisubsSave()`
    - 写入：subscriptions、profiles；D1 下优先行级 diff/sync，KV 下全量覆盖；清理节点缓存；可能触发通知。

- `GET/POST /api/rule_templates`
    - Handler：`handleRuleTemplatesRequest()`
    - 读取/写入：`misub_rule_templates_v1`。
    - 限制：最多 50 个模板，单模板内容最大 128 KiB，需符合 ini-like 形态。

- `POST /api/node_count`
    - Handler：`handleNodeCountRequest()`
    - 读取：远程订阅 URL、settings、subscriptions。
    - 写入：匹配到本地订阅时更新 `nodeCount`、`userInfo`、`lastError`、`lastUpdate`。

- `POST /api/nodes/health`
    - Handler：`handleHealthCheckRequest()`
    - 行为：只做节点 URL 协议/格式检查，不做真实连通性测试。
    - 写入：无。

- `POST /api/nodes/clean`
    - Handler：`handleCleanNodesRequest()`
    - 行为：当前仅支持指定 `profileId` 的预览去重结果；全局清理返回 501。
    - 写入：无直接持久化。

- `POST /api/fetch_external_url`
    - Handler：`handleExternalFetchRequest()`
    - 行为：安全拉取外部 HTTP/HTTPS URL 并返回原文与 Base64。
    - 安全：使用 `validatePublicFetchUrl()` / `safeFetchPublicUrl()` 防 SSRF，并限制 URL 长度 2048、响应大小 10 MiB。
    - 写入：无。

- `POST /api/batch_update_nodes`
    - Handler：`handleBatchUpdateNodesRequest()`
    - 读取：subscriptions、远程订阅 URL。
    - 写入：当前 handler 返回统计结果，不直接持久化批量结果。

- `POST /api/subscription_nodes`
    - Handler：`handleSubscriptionNodesRequest()`
    - 行为：按 `profileId` / `subscriptionId` / `url` 预览节点。
    - 写入：无直接持久化；可能触发远程订阅拉取。

- `POST /api/debug_subscription`
    - Handler：`handleDebugSubscriptionRequest()`
    - 行为：复用 `subscription_nodes` 并返回脱敏调试信息。
    - 写入：无直接持久化。

- `GET /api/system/info`
    - Handler：`handleSystemInfoRequest()`
    - 读取：storage type、绑定状态、subscriptions/profiles 数量。
    - 返回：绑定是否存在的布尔值，不返回 secret 明文。

- `POST /api/system/storage_test`
    - Handler：`handleStorageTestRequest()`
    - 写入：临时 `misub_test_*` key，读回后删除。

- `POST /api/system/export`
    - Handler：`handleExportDataRequest()`
    - 读取：subscriptions、profiles、可选 settings。
    - 返回：使用 `redactSensitiveObject()` 脱敏后的导出数据。

- `POST /api/preview/content`
    - Handler：`handlePreviewContentRequest()`
    - 行为：安全拉取订阅 URL，返回截断预览与格式判断。
    - 安全：使用公开 fetch URL 校验和安全 fetch。
    - 写入：无。

- `POST /api/parse_subscription`
    - Handler：`handleParseSubscription()`
    - 行为：解析提交的订阅内容，返回有效节点列表和总数。
    - 写入：无。

- `POST /api/subconverter/test`
    - Handler：`handleSubconverterTestRequest()`
    - 行为：用固定测试节点探测第三方 subconverter 后端可用性。
    - 安全：规范化 backend；不使用用户订阅链接作为测试输入。
    - 写入：无。

- `GET /api/logs`
    - Handler：`LogService.getLogs()`
    - 读取：日志存储。

- `DELETE /api/logs`
    - Handler：`LogService.clearLogs()`
    - 写入：清空日志存储。

- `GET /api/settings`
    - Handler：`handleSettingsGet()`
    - 读取：settings，存储不可用时返回默认设置和 `storageUnavailable`。

- `POST /api/settings`
    - Handler：`handleSettingsSave()`
    - 写入：settings；双存储同步到 D1/KV；清理节点缓存；发送设置更新通知。
    - 限制：拒绝将自定义登录路径、订阅 token、profile token 设置为系统保留路径。

- `POST /api/settings/password`
    - Handler：`handleUpdatePassword()`
    - 写入：管理员密码。
    - 限制：密码至少 6 位。

- `POST /api/settings/reset`
    - Handler：`handleSettingsReset()`
    - 写入：删除 settings；双存储清理；清理 SettingsCache。

- `GET /api/guestbook/manage`
    - Handler：`handleGuestbookManageGet()`
    - 读取：所有留言，包含管理字段。

- `POST /api/guestbook/manage`
    - Handler：`handleGuestbookManageAction()`
    - 写入：留言回复、删除、可见性/状态更新。

- `GET /api/cron/status`
    - Handler：api-router 内联 `handleCronStatusRequest()`
    - 读取：cron 配置、`cron_last_execution`。

- `POST /api/cron/trigger`
    - Handler：api-router 内联 `handleCronTriggerRequest()`
    - 行为：导入 `functions/_schedule.js` 执行同步。
    - 写入：`cron_last_execution`；同步过程可能写订阅状态。

## 当前值得关注的边界

- `GET /api/clients` 是公开只读接口，但当前可能在图标迁移时写回 KV；如果未来要严格区分只读公开接口，可单独收敛这个副作用。
- `POST /api/public/guestbook` 与 `POST /api/system/error_report` 是公开写接口，已有限制与节流，但仍是滥用风险点，后续可补更明确的速率限制/验证码/Turnstile 方案。
- `/api/auth_debug` 与 `/api/auth_check` 默认关闭；开启后仍需有效管理员会话，不能通过诊断开关绕过鉴权。
- `/api/cron/trigger` 当前复用 `functions/_schedule.js`，而 `docs/codebase-review.md` 已标记 `_cron.js` / `_schedule.js` 为疑似遗留定时实现；后续应继续确认并收敛 cron 主实现。
- `/api/system/export` 可导出脱敏数据；虽然需要登录，后续仍应通过测试固定脱敏字段覆盖。
- 所有会主动拉取外部 URL 的接口应继续依赖 `validatePublicFetchUrl()` / `safeFetchPublicUrl()`，避免私网 SSRF 回归。

## 当前鉴权回归覆盖

- `tests/unit/api-authentication.test.js`：私有读取、写入、迁移、备份及诊断接口均拒绝缺失、伪造和过期 Cookie；检查失败不会修改业务数据。
- 同一 Cookie 的先前请求成功后，后续请求仍重新验证有效期；私有响应包含禁止缓存的响应头。
- `tests/unit/api-route-boundaries.test.js`：公开读取接口仍可使用，未登录的 `/api/data` 只返回会话状态，公开配置不暴露自定义管理入口。
- 前端路由、入口确认与页面恢复由 `router-auth-guard`、`login-entry-confirmation`、`dashboard-first-render` 和 `disguise-view` 测试覆盖。

## 后续测试建议

- 增加公开写接口限制测试：guestbook 长度、error report 节流、外部 URL 私网拒绝。
- 增加导出脱敏测试：确认 `/api/system/export` 不返回 token、password、secret、url credential 等敏感字段。
