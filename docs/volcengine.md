```
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
}
'
```

```response
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