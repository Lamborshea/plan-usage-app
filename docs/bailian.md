> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取订阅席位与额度统计

> 查询订阅席位与额度统计，包含订阅周期、各类型席位数量、已分配席位数与剩余 Credits。

## 前提条件 <span id="tpf546fc0f4e" />

已获取阿里云账号或 RAM 用户的 AccessKey，并已为其授予调用本接口所需的 RAM 权限。建议将 AccessKey 配置为环境变量 `ALIBABA_CLOUD_ACCESS_KEY_ID` 和 `ALIBABA_CLOUD_ACCESS_KEY_SECRET`，避免明文写入代码。

## 请求说明 <span id="tp1bb47deadc" />

- <strong>HTTP 方法</strong>：GET

- <strong>请求地址</strong>

  <table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "30%" }} /><col style={{ width: "70%" }} /></colgroup><thead><tr><th><p><strong>地域</strong></p></th><th><p><strong>Endpoint</strong></p></th></tr></thead><tbody><tr><td><p>华北2（北京）</p></td><td><p><code>GET [https://modelstudio.cn-beijing.aliyuncs.com/tokenplan/subscription/stats](https://modelstudio.cn-beijing.aliyuncs.com/tokenplan/subscription/stats)</code></p></td></tr></tbody></table>

- <strong>认证方式</strong>

  本接口是阿里云 OpenAPI，采用 AccessKey 签名（签名算法 `ACS3-HMAC-SHA256`），不支持 `Authorization: Bearer {API_KEY}` 方式。请求需携带公共请求头 `x-acs-action: GetSubscriptionStats`、`x-acs-version: 2026-02-10`、`x-acs-date`、`x-acs-content-sha256`、`x-acs-signature-nonce` 以及 `Authorization`。

  推荐使用阿里云 SDK 或 [OpenAPI Explorer](https://api.aliyun.com/api/ModelStudio/2026-02-10/GetSubscriptionStats) 发起调用，可免去自行计算签名。

## 请求参数 <span id="tp7448744f47" />

<p>该接口无请求参数。</p>

## 返回参数 <span id="tp83612d1380" />

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "25%" }} /><col style={{ width: "12%" }} /><col style={{ width: "63%" }} /></colgroup><thead><tr><th><p><strong>参数</strong></p></th><th><p><strong>类型</strong></p></th><th><p><strong>描述</strong></p></th></tr></thead><tbody><tr><td><p>Success</p></td><td><p>boolean</p></td><td><p>调用接口是否成功：<br />true：成功<br />false：失败</p></td></tr><tr><td><p>Code</p></td><td><p>string</p></td><td><p>响应状态码。</p></td></tr><tr><td><p>Message</p></td><td><p>string</p></td><td><p>响应信息。</p></td></tr><tr><td><p>Data</p></td><td><p>object</p></td><td><p>业务数据</p></td></tr><tr><td><p>SubscriptionStartTime</p></td><td><p>integer</p></td><td><p>订阅开始时间,毫秒</p></td></tr><tr><td><p>SubscriptionEndTime</p></td><td><p>integer</p></td><td><p>订阅结束时间，毫秒</p></td></tr><tr><td><p>Items</p></td><td><p>Array\[Object]</p></td><td><p>席位信息列表（按 specType 分组）</p></td></tr><tr><td><p /></td><td><p>object</p></td><td><p>列表数据</p></td></tr><tr><td><p>SeatType</p></td><td><p>string</p></td><td><p>席位类型（specType）<br />standard - 标准席位<br />pro - 高级席位<br />max - 尊享席位</p></td></tr><tr><td><p>SeatRefreshTime</p></td><td><p>integer</p></td><td><p>本周期刷新时间，毫秒</p></td></tr><tr><td><p>TotalSeats</p></td><td><p>integer</p></td><td><p>总席位数</p></td></tr><tr><td><p>AssignedSeats</p></td><td><p>integer</p></td><td><p>已分配席位数</p></td></tr><tr><td><p>SeatCredits</p></td><td><p>number</p></td><td><p>席位总 Credits 额度</p></td></tr><tr><td><p>SeatRemainingCredits</p></td><td><p>number</p></td><td><p>本周期剩余 Credits</p></td></tr></tbody></table>

## 请求示例 <span id="tp96c97993b3" />

本接口使用阿里云 OpenAPI 签名，下例中 `${SIGNATURE}` 需按 `ACS3-HMAC-SHA256` 算法计算得出，`x-acs-date`、`x-acs-signature-nonce` 需替换为实际值。

```bash
curl -X GET "https://modelstudio.cn-beijing.aliyuncs.com/tokenplan/subscription/stats" \
    --header "x-acs-action: GetSubscriptionStats" \
    --header "x-acs-version: 2026-02-10" \
    --header "x-acs-date: 2026-01-01T12:00:00Z" \
    --header "x-acs-content-sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" \
    --header "x-acs-signature-nonce: 3e3b2a9f0c7d4f8e9a1b2c3d4e5f6a7b" \
    --header "Authorization: ACS3-HMAC-SHA256 Credential=${ALIBABA_CLOUD_ACCESS_KEY_ID},SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=${SIGNATURE}"
```

## 返回示例 <span id="tp1813294040" />

```json expandable
{
  "Success": true,
  "Data": {
    "SubscriptionStartTime": 1788328800000,
    "SubscriptionEndTime": 1790920800000,
    "Items": [
      {
        "SeatType": "standard",
        "SeatRefreshTime": 1790920800000,
        "TotalSeats": 2,
        "AssignedSeats": 1,
        "SeatCredits": 100,
        "SeatRemainingCredits": 40
      }
    ]
  }
}
```

## 错误码 <span id="tpfe19ee0400" />

如果调用失败，会返回错误信息。更多错误码及解决方法，请参见[错误信息](/zh/model-studio/error-code)。

---

# 百炼 CLI（bl）套餐用量接口

> 本应用当前实际使用的查询通道。通过百炼控制台网关（与官方 `bailian-cli` 完全同款请求）查询 **Token Plan 个人版**与 **Coding Plan** 的实时额度快照，无需阿里云 AccessKey。
>
> 上文《获取订阅席位与额度统计》为 Token Plan **团队版**席位的 AK/SK OpenAPI，仅作参考；本应用未使用。

## 调用方式

- 登录授权：复用内置 `bl` CLI 执行 `bl auth login --console`（OAuth 浏览器授权，凭证写入 `~/.bailian/config.json` 的 `access_token`）。
- 用量查询：应用直连控制台网关（不经过 CLI 输出映射，原因见下"已知缺陷"），携带 `Authorization: Bearer {access_token}`。
- 网关地址（按 `console_region` × `console_site` 选择）：

| region | site | 网关 Host | action |
| --- | --- | --- | --- |
| cn-beijing | domestic | `bailian-cs.console.aliyun.com` | `BroadScopeAspnGateway` |
| cn-beijing | international | `bailian-cs.console.alibabacloud.com` | `BroadScopeAspnGateway` |
| ap-southeast-1 | domestic | `modelstudio-cs.console.aliyun.com` | `IntlBroadScopeAspnGateway` |
| ap-southeast-1 | international | `bailian-singapore-cs.console.alibabacloud.com` | `IntlBroadScopeAspnGateway` |

- 请求形式：`POST https://{Host}/cli/api.json?action={action}&product=sfm_bailian&api={api}`，`Content-Type: application/x-www-form-urlencoded`，表单体为 `params={Api, V:"1.0", Data:{...业务参数, cornerstoneParam:{protocol:"V2", console:"ONE_CONSOLE", productCode:"p_efm", switchUserType:3, consoleSite:"BAILIAN_ALIYUN", switchAgent:{console_switch_agent}}}}&region={region}`。
- 响应解包（与 bl 的 `unwrapResponse` 一致）：取 `response.data`；若存在 `data.DataV2` 则取 `DataV2.data.data ?? DataV2.data ?? DataV2`；否则取 `data.data ?? data`。下文"业务返回字段"均指解包后的对象。
- 网关业务错误：`data.success === false` 或 `data.errorCode` 非空时失败；`errorCode` 含 `NotLogined` 表示登录态过期，需重新登录。

## 原始响应信封（实测）

```json
{
  "code": "200",
  "data": {
    "DataV2": {
      "ret": ["SUCCESS::接口调用成功"],
      "data": { "msg": "Success.", "code": "SUCCESS", "data": { "…业务字段…" }, "requestId": "…", "success": true }
    },
    "success": true,
    "httpStatus": 200,
    "errorCode": "",
    "api": "…",
    "errorMsg": ""
  },
  "httpStatusCode": "200",
  "requestId": "…",
  "successResponse": true
}
```

## usage token-plan（Token Plan 个人版额度）

- 网关 API：`zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage`
- 请求体：`{}`（无业务参数）

### 业务返回字段（解包后）

字段为按需出现（订阅档位不同返回的窗口不同），均为有限数字：

| 参数 | 类型 | 描述 |
| --- | --- | --- |
| per5HourPercentage | number | 5 小时窗口额度**使用比例**，0–1 小数（如 0.32 = 32%） |
| per5HourResetTime | integer | 5 小时窗口重置时间，毫秒时间戳 |
| per1WeekPercentage | number | 1 周窗口使用比例，0–1 小数 |
| per1WeekResetTime | integer | 1 周窗口重置时间，毫秒时间戳 |
| per1MonthPercentage | number | 1 月窗口使用比例，0–1 小数（**实测个人版当前返回的即此窗口**） |
| per1MonthResetTime | integer | 1 月窗口重置时间，毫秒时间戳 |

### 返回示例（本机账号实测，2026-10-05）

```json
{
  "per1MonthPercentage": 0.31474753304347824,
  "per1MonthResetTime": 1793721600000
}
```

### 空态语义

- 账号未订阅 Token Plan 个人版时业务对象无任何上述字段（等价空对象）。

### ⚠️ 已知缺陷：bl CLI 2.1.0 会丢弃 per1Month 数据

`bl usage token-plan --output json` 的响应映射（bailian-cli-commands 内部）只挑选 `per5HourPercentage / per5HourResetTime / per1WeekPercentage / per1WeekResetTime` 四个键，**不识别 `per1Month*`**，导致有月度额度套餐的账号输出 `{}`。因此本应用直接解析网关原始字段；若改用 CLI 输出需注意此问题。

## usage coding-plan（Coding Plan 额度）

- 网关 API：`zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2`
- 请求体：

```json
{
  "queryCodingPlanInstanceInfoRequest": {
    "commodityCode": "sfm_codingplan_public_cn",
    "onlyLatestOne": true
  }
}
```

| 参数 | 类型 | 描述 |
| --- | --- | --- |
| commodityCode | string | 商品码：国内站 `sfm_codingplan_public_cn`，国际站 `sfm_codingplan_public_intl`（由 `console_site` 配置决定，默认国内） |
| onlyLatestOne | boolean | 只查询最新一个实例 |

### 业务返回字段（解包后）

| 参数 | 类型 | 描述 |
| --- | --- | --- |
| codingPlanInstanceInfos | Array\<Object\> | 套餐实例列表，取其中 `status === 'VALID'` 的第一个 |
| ↳ status | string | 实例状态（`VALID` 等） |
| ↳ instanceType | string | 实例规格（如 pro / max） |
| ↳ codingPlanQuotaInfo | Object | 额度信息，含三组同构窗口字段：`per5Hour` / `perWeek` / `perBillMonth` 前缀 + `UsedQuota`（已用，次数）、`TotalQuota`（总额度，次数）、`QuotaNextRefreshTime`（下次刷新时间，毫秒） |
| userId | string | 当前账号 UID |

### 应用映射（与 bl `--output json` 输出同构）

| 参数 | 类型 | 描述 |
| --- | --- | --- |
| per5Hour / perWeek / perBillMonth | Object | 三个额度窗口，缺失表示无该窗口数据 |
| ↳ usedQuota | number | 本窗口已用额度（次数） |
| ↳ totalQuota | number | 本窗口总额度（次数） |
| ↳ resetTime | integer | 窗口重置时间，毫秒时间戳（来自 `*QuotaNextRefreshTime`） |
| ↳ percentage | number | 使用比例 0–1 小数，计算 `usedQuota / totalQuota`，**仅当两者存在且 totalQuota > 0** |
| instanceType | string | 实例规格，仅当原始值为非空字符串时输出 |

### 返回示例

```json
{
  "per5Hour": { "usedQuota": 120, "totalQuota": 3000, "resetTime": 1762588800000, "percentage": 0.04 },
  "perWeek": { "usedQuota": 640, "totalQuota": 18000, "resetTime": 1762992000000, "percentage": 0.0356 },
  "perBillMonth": { "usedQuota": 2100, "totalQuota": 90000, "resetTime": 1764547200000, "percentage": 0.0233 },
  "instanceType": "pro"
}
```

实测未开通 Coding Plan 的账号返回 `{"codingPlanInstanceInfos": [], "userId": "…"}`（无 VALID 实例 → 视为无套餐）。

## auth status（登录态检测）

应用直接检查 `~/.bailian/config.json` 是否存在非空 `access_token`（等价于 `bl auth status --output json` 中 `console` 节点存在），未登录时在界面展示「登录百炼」按钮。CLI 输出结构：

```json
{
  "authenticated": true,
  "config": "default",
  "config_file": "/Users/<user>/.bailian/config.json",
  "api_key": { "source": "config", "masked": "sk-w...", "base_url": "…" },
  "console": { "source": "config", "masked": "8a6e...6504", "region": "cn-beijing", "site": "domestic" }
}
```

`~/.bailian/config.json` 实际字段（登录命令写入，应用读取）：`api_key`、`access_token`（Console 凭证）、`base_url`、`workspace_id`、`console_site`、`console_region`、`console_switch_agent`。

## 错误输出

CLI 失败时输出 `{ "error": { "code", "message", "hint" } }` 并以对应码退出。`code` 枚举（源自 bailian-cli-core）：

| code | 含义 | 处理建议 |
| --- | --- | --- |
| 0 | SUCCESS | — |
| 1 | GENERAL | 通用/网关错误 |
| 2 | USAGE | 命令用法错误 |
| 3 | AUTH | 未登录或 Console 会话过期（`Console session is not logged in or has expired.`）；应用内引导用户点击「登录百炼」（`bl auth login --console`） |
| 4 | QUOTA | 额度相关错误 |
| 5 | TIMEOUT | 请求超时 |
| 6 | NETWORK | 网络错误 |

网关业务错误：原始响应 `errorCode` 含 `NotLogined` 时归类为 AUTH(3)，其余归 GENERAL(1)。
