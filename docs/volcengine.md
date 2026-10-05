# 火山引擎 Agent Plan 用量查询 OpenAPI

个人版 Agent Plan 提供两个核心查询接口（均为 AK 鉴权，POST 请求，Base URL `https://ark.cn-beijing.volcengineapi.com`）。

对应实现：`src/main/providers/volcengine-ark.ts`。

## 鉴权

火山引擎标准 Access Key 签名（HMAC-SHA256，AWS SigV4 风格），详见 <https://www.volcengine.com/docs/82379/1298459>。

请求需携带以下头（本项目 `signing/volc.ts` 已实现）：

```
Content-Type: application/json
X-Date: 20260511T035211Z                       # UTC，精确到秒，带 Z
X-Content-Sha256: <body 的 SHA256>
Authorization: HMAC-SHA256 Credential=<AK>/<日期>/<region>/ark/request,
  SignedHeaders=content-type;host;x-content-sha256;x-date,
  Signature=<签名>
```

## 1. GetAFPUsage — 查询 AFP 额度（配额快照）

查各滚动窗口的 AFP 配额与已用量。

```
POST https://ark.cn-beijing.volcengineapi.com/?Action=GetAFPUsage&Version=2024-01-01
```

- 请求参数：无 Body 参数（发送 `{}` 即可）
- 官方文档：<https://docs.volcengine.com/docs/82379/2479847>

响应字段（`Result`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `PlanType` | string | 当前套餐档位：`Small` / `Medium` / `Large` / `Max` |
| `AFPFiveHour` | Window | 5 小时滚动窗口 |
| `AFPDaily` | Window | 当日滚动窗口 |
| `AFPWeekly` | Window | 本周滚动窗口 |
| `AFPMonthly` | Window | 本月滚动窗口 |

Window 结构（单位 AFP，Agent Frame Point；时间均为 epoch 毫秒）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `Quota` | number | 窗口总配额 |
| `Used` | number | 窗口内已用量 |
| `SubscribeTime` | number | 窗口起始时间 |
| `ResetTime` | number | 下次重置时间 |

> 仅适用于个人版；企业版席位请改用 `GetSeatAFPUsage`。

## 2. GetUsageDetails — 查询模型调用用量明细

按时间粒度聚合的模型 Token/图片用量明细，区分套餐内/外。

```
POST https://ark.cn-beijing.volcengineapi.com/?Action=GetUsageDetails&Version=2024-01-01
```

- 官方文档：<https://docs.volcengine.com/docs/82379/2479849>

Body 参数（JSON）：

| 字段 | 必选 | 说明 |
|---|---|---|
| `QueryInterval` | 是 | 聚合粒度：`Day` 或 `Hour` |
| `Filter.StartTime` | 是 | 起始日期 `YYYY-MM-DD` |
| `Filter.EndTime` | 是 | 结束日期 `YYYY-MM-DD` |
| `Filter.ObjectName` | 否 | 模型名称列表，如 `["doubao-seed-1-6"]` |
| `Filter.PlanType` | 否 | 套餐档位列表：`1=Small`、`2=Medium`、`3=Large`、`4=Max`（实测也可直接传档位名，如 `["Large"]`） |

### 请求示例（实际验证）

```bash
curl 'https://ark.cn-beijing.volcengineapi.com/?Action=GetUsageDetails&Version=2024-01-01' \
  -H 'Content-Type: application/json' \
  -H 'X-Date: <X-Date>' \
  -H 'X-Content-Sha256: <X-Content-Sha256>' \
  -H 'Authorization: HMAC-SHA256 Credential=<AK>/<X-Date>/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=<Signature>' \
  -d '{
  "QueryInterval": "Day",
  "Filter": {
    "ObjectName": [
        "doubao-seed-1.6",
        "GLM-4.7"
    ],
    "PlanType": ["Large"],
    "StartTime": "2026-05-01",
    "EndTime": "2026-05-10"
  }
}'
```

### 响应示例（实际接口返回）

```json
{
  "ResponseMetadata": {
    "RequestId": "20260511035211B7A29C481EFC026D93",
    "Action": "GetUsageDetails",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {
    "Details": [
      {
        "Time": 1778284800000,
        "ObjectName": "doubao-seed-2-1-pro-260628",
        "Usage": 12500,
        "Unit": "Tokens",
        "BillingType": "WithinPlan"
      },
      {
        "Time": 1778284800000,
        "ObjectName": "doubao-seed-2-1-pro-260628",
        "Usage": 8400,
        "Unit": "Tokens",
        "BillingType": "WithinPlan"
      },
      {
        "Time": 1778371200000,
        "ObjectName": "doubao-seed-2-1-pro-260628",
        "Usage": 26800,
        "Unit": "Tokens",
        "BillingType": "WithinPlan"
      },
      {
        "Time": 1778371200000,
        "ObjectName": "doubao-seed-2-1-pro-260628",
        "Usage": 5100,
        "Unit": "Tokens",
        "BillingType": "WithinPlan"
      }
    ]
  }
}
```

`Details[]` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `Time` | number | Unix 毫秒时间戳，按 `QueryInterval` 对齐（`Day` = 当天 0 点） |
| `ObjectName` | string | 模型 / Harness 名称 |
| `Usage` | number | 用量数值 |
| `Unit` | string | 单位，如 `Tokens`、`Images` |
| `BillingType` | string | `WithinPlan`（套餐内）/ `OutsideOfPlan`（套餐外） |

**解析注意**：同一模型同一 `Time` 可能出现多条记录（见上例 1778284800000 两条），调用方必须按 `模型 + 时间` 自行聚合，本实现见 `groupByModel()`。

错误时 `ResponseMetadata.Error` 非空（`Code` / `Message`），`Result` 缺失。

> 仅适用于个人版；企业版席位请改用 `GetSeatUsageDetails`。

## 统计口径说明

- **AFP 用量（`GetAFPUsage`）**：套餐消耗口径，**分钟级延迟**，用于核对套餐额度使用情况。
- **模型调用明细（`GetUsageDetails`）**：真实 Tokens/图片数，**小时级延迟**，不同模型的 AFP 与 Token 折算系数不同，不应直接用来核对 AFP 消耗。
- 短时间内调用量大时，AFP 可能已增长但明细尚未更新，属正常统计延迟。

## 相关接口（企业版席位，未接入）

- `GetSeatAFPUsage` — 席位 AFP 额度
- `GetSeatUsageDetails` — 席位用量明细
