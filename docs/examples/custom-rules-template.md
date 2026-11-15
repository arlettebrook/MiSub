# MiSub 自定义分流规则模板 (参考指南)

本模板旨在帮助 MiSub 用户理解并编写自定义分流规则。你可以将此内容作为参考，编写自己的 `.ini` 格式模板或在 MiSub 的内置引擎中使用。

---

## 💡 核心概念

MiSub 的内置引擎（Built-in Engine）采用一种**中间格式**，它会自动根据你使用的客户端（Clash, Sing-Box, Surge, Loon, Quantumult X）将规则翻译成对应的语法。

### 1. 策略组 (Policy Groups)

在 MiSub 中，你可以直接使用以下由系统自动生成的策略组名称：

- `🚀 节点选择`: 主要的手动切换入口。
- `♻️ 自动选择`: 延迟最低的节点。
- `🔯 故障转移`: 自动切换到可用节点。
- `👋 手动切换`: 纯手动节点列表。
- `🌍 总出口`: (链式代理模式) 所有流量的总闸。
- `🇺🇸 美国节点`, `🇭🇰 香港节点`, `🇯🇵 日本节点`: 自动按地区分类的组。

---

## 🛠️ 规则编写示例 (带详细注释)

```ini
# [规则语法] 类型, 匹配值, 策略组/动作 [, 额外参数]
# ---------------------------------------------------------

# === 1. 社交与通讯 (Social & Messaging) ===
# 匹配 Telegram 的域名后缀，发送到自动选择组
DOMAIN-SUFFIX,t.me,♻️ 自动选择
DOMAIN-SUFFIX,tdesktop.com,♻️ 自动选择
DOMAIN-KEYWORD,telegram,♻️ 自动选择

# === 2. 智能 AI 服务 (AI Services) ===
# 强制使用美国节点以确保 ChatGPT 可用
DOMAIN-SUFFIX,openai.com,🇺🇸 美国节点
DOMAIN-SUFFIX,anthropic.com,🇺🇸 美国节点
DOMAIN-KEYWORD,chatgpt,🇺🇸 美国节点

# === 3. 视频与流媒体 (Media & Video) ===
# 视频广告：直接拦截 (REJECT)
# 注意：内置引擎会自动识别 REJECT/DIRECT 关键字
DOMAIN-SUFFIX,doubleclick.net,REJECT
DOMAIN-SUFFIX,adservice.google.com,REJECT

# YouTube 流量：发送到香港或日本节点（低延迟）
DOMAIN-KEYWORD,youtube,🇭🇰 香港节点
DOMAIN-SUFFIX,googlevideo.com,🇭🇰 香港节点

# === 4. 苹果与微软服务 (System Services) ===
# 苹果服务通常建议直连 (DIRECT) 以获得最佳速度
DOMAIN-SUFFIX,apple.com,DIRECT
DOMAIN-SUFFIX,icloud.com,DIRECT
DOMAIN-SUFFIX,mzstatic.com,DIRECT

# 微软更新与 Office
DOMAIN-SUFFIX,microsoft.com,DIRECT
DOMAIN-SUFFIX,windows.com,DIRECT

# === 5. 开发者常用 (Dev Tools) ===
# GitHub 建议走代理
DOMAIN-SUFFIX,github.com,🚀 节点选择
DOMAIN-SUFFIX,githubusercontent.com,🚀 节点选择

# === 6. 远程规则集引用 (RULE-SET) ===
# MiSub 支持直接引用内置定义的远程规则集，这可以极大精简你的配置文件。
# 语法: RULE-SET, 标识符, 策略组
RULE-SET,ADS,REJECT         # 引用内置广告规则集并拦截
RULE-SET,AI,🤖 智能 AI        # 引用内置 AI 规则集
RULE-SET,STREAM,🎥 流媒体     # 引用内置流媒体规则集

# === 7. 地区绕过 (GeoIP) ===
# 中国大陆 IP 全部直连
GEOIP,CN,DIRECT

# === 8. 兜底规则 (The Final Match) ===
# 以上规则均未匹配时，使用的默认策略
MATCH,🚀 节点选择
```

---

## 🔗 Mihomo 自定义链式代理

自定义模板通过节点级 `dialer-proxy` 实现“前置代理 → 落地节点”。Mihomo / Meta 输出会生成落地副本，原始节点保留；普通 Clash 输出使用原始节点的选择组。可以通过请求参数 `meta=true` 指定 Meta，或由现有客户端识别逻辑决定。

INI 模板声明如下：

```ini
[custom]
# 格式：custom_chain_proxy=<落地组>`<前置组>[`<副本前缀>]
custom_chain_proxy=链式落地`链式前置`链式 -

[Proxy Group]
链式前置 = select, include-all-proxies=true
链式落地 = select, 链式前置

[Rule]
MATCH,链式落地
```

前缀省略或留空时使用 `<落地组> - `。前置组可以按节点名或 INI 的 `custom_proxy_group` 正则选择原始节点。没有声明策略组时，会自动创建前置组与落地组；落地副本总是来自当前 MiSub 节点列表。

远程 Clash YAML profile 使用顶层扩展字段：

```yaml
proxy-groups:
    - name: 链式前置
      type: select
      include-all-proxies: true
    - name: 链式落地
      type: select
      proxies: []
x-misub-chain-proxy:
    entry-group: 链式前置
    landing-group: 链式落地
    clone-prefix: '链式 - '
rules:
    - MATCH,链式落地
```

YAML 声明也可以写为对象数组，以创建多个独立链。数组项支持统一模型短字段 `entry`、`group`、`prefix`。`x-misub-chain-proxy` 会从最终客户端配置中移除。自定义模板管理器当前保存 INI；YAML profile 继续使用远程模板 URL。

前置组会固定为可安全使用的原始节点；嵌套组会展开，动态 `include-all`、`use` 和过滤字段会被移除，避免再次纳入落地副本。运行时外部 provider 节点不参与这次复制。已有节点的 dialer 保留，但如果其依赖可能回到链式组或形成环，会排除它作为前置选择。没有任何安全入口、过滤不到节点、声明自身为前置或发生名称冲突时，会返回明确的模板错误。

普通 Clash 不生成新的 dialer 副本，原有落地选择可以继续使用。每个 Meta 链会增加一份当前节点列表的副本；多个链可共用前置组，但前置组不能同时是另一个落地组。配置中不要依赖已移除的 `type: relay` 来实现这类链式声明。

## 🚀 如何在 GitHub 上使用

1.  将上述规则保存为 `my-rules.list` 或直接集成到你的 `.ini` 模板文件中。
2.  在 MiSub Web 界面中，选择你的订阅组。
3.  在 **"外部模板" (External Template)** 选项中，填入你 GitHub 文件的 Raw 链接：
    `https://raw.githubusercontent.com/你的用户名/仓库名/main/my-rules.list`

---

## 🔧 常见问题 (FAQ)

**Q: 为什么我写的 `DOMAIN-SUFFIX` 在 Quantumult X 里变成了 `HOST-SUFFIX`？**
A: 这是 MiSub 内置引擎的特性。它会自动处理跨平台转换，你只需要使用标准语法（如 `DOMAIN-SUFFIX`），它会根据客户端 UA 自动翻译。

**Q: 我需要手动写 DNS 设置吗？**
A: **不需要。** 针对 Issue #341 的修复，MiSub 会为所有非内置模板自动注入标准的 DNS 模块（包含 Fake-IP 等设置），确保在路由器上直接可用。

**Q: 策略组名字包含 Emoji 会报错吗？**
A: 不会。MiSub 完全支持 Emoji。但请确保你引用的策略组名称与 MiSub 生成的名称**完全一致**。
