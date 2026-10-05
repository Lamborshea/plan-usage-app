// 临时调试脚本：用 ~/.bailian 的 console token 重放 bl 的网关请求，打印原始响应
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const cfg = JSON.parse(readFileSync(path.join(homedir(), '.bailian', 'config.json'), 'utf8'))

function buildPayload(api, data, switchAgent) {
  return JSON.stringify({
    Api: api,
    V: '1.0',
    Data: {
      ...data,
      cornerstoneParam: {
        protocol: 'V2',
        console: 'ONE_CONSOLE',
        productCode: 'p_efm',
        switchUserType: 3,
        consoleSite: 'BAILIAN_ALIYUN',
        ...(switchAgent == null ? {} : { switchAgent }),
        ...(typeof data.cornerstoneParam === 'object' && data.cornerstoneParam !== null
          ? data.cornerstoneParam
          : {})
      }
    }
  })
}

async function call(api, data) {
  const region = cfg.console_region || 'cn-beijing'
  const body = new URLSearchParams({ params: buildPayload(api, data, cfg.console_switch_agent), region })
  const res = await fetch(
    `https://bailian-cs.console.aliyun.com/cli/api.json?action=BroadScopeAspnGateway&product=sfm_bailian&api=${encodeURIComponent(api)}`,
    {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${cfg.access_token}`
      },
      body: body.toString()
    }
  )
  const text = await res.text()
  console.log(`=== ${api} -> HTTP ${res.status} ===`)
  console.log(text.slice(0, 4000))
  console.log()
}

await call('zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage', {})
await call('zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2', {
  queryCodingPlanInstanceInfoRequest: { commodityCode: 'sfm_codingplan_public_cn', onlyLatestOne: true }
})
