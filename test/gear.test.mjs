// 学理模式：出口校验与口径文案的单元测试
// 只测纯函数，不启动 DSH。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hasDosage, maskDosage } from '../lib/dosage-guard.js'
import { GEAR_BLOCK_NOTICE, GEAR_GUARD, GEAR_MARK, PRESET_DESCRIPTION } from '../lib/gear.js'
import { inspectNotice } from '../lib/inspect-notice.js'
const D0 = String.fromCharCode(10) + '【学理模式】本节仅供学习研究，不构成诊疗建议。'

import { currentPath } from '../lib/index.js'
import { corePlugins, minimalPreset } from '../lib/preset.js'
import { defaultKbPath, normalizeRoot } from '../lib/platform.js'

test('hasDosage：认得出各路剂量写法', () => {
  const hits = [
    '桂枝 9 g',
    '麻黄三两',
    '炙甘草 3克',
    '生姜 5 钱',
    '每日服两服',
    '每次 150ml',
    '石膏 40g 先煎',
    // 单味药报方量、拆开来写的方量，照样是能照着抓的量
    '桂枝三两',
    '其方桂枝三两，芍药三两',
  ]
  for (const text of hits) assert.ok(hasDosage(text), `应判为剂量：${text}`)
})

test('hasDosage：不把条号、序数、成语里的数字当剂量', () => {
  const misses = [
    '《伤寒论》宋本第 35 条：太阳病……',
    '第一难、第 12 篇',
    '六经辨证先辨太阳',
    '两目干涩、心烦',
    // 2026-11-14：古文计量（枚、升、合）放行——原文煎法照引，别让回答被截断
    '附子一枚（炮）',
    '大枣十二枚',
    '水三升',
    '以水三升，煮取一升五合，去滓，分温再服',
    // 日常说法：夜里醒、喝水、出血量
    '夜半两三点醒',
    '每天喝温开水1500毫升',
    '出血量约200毫升',
    // 身高体重与化验单
    '身高 158cm，体重 56 公斤',
    '空腹血糖 7.8 mmol/L',
    // 括号里的原文：白话解释后括注原文，括注里带药量是引用，不是给药量
    '这份汤药喝下去微微出汗把邪推出去就好（原文：遍身漐漐微似有汗者益佳，不可令如水流离，病必不除）。',
    '（原文：桂枝三两，芍药三两）',
    // 原方比例：讲轻重对比用比例说法，不给现代克数
    '桂枝与芍药按 1 比 1 配伍，桂枝加倍倍芍药就是 2 比 1，取桂枝汤倍芍药法（桂枝三两、芍药六两，1 比 2）。',
    '桂枝与芍药（1 比 1）的配伍，一走一守。',
    // 原文整条照引：同一句里有方名、有煎服法，算引用不算给药量
    '桂枝汤：桂枝三两，芍药三两，生姜三两，大枣十二枚，甘草二两，以水七升，煮取三升，去滓，分温三服',
    '理中丸：人参、干姜、甘草、白术各三两，捣筛，蜜和为丸',
    '表现为下肢浮肿',
    '本节仅供学习研究，不构成诊疗建议。',
  ]
  for (const text of misses) assert.equal(hasDosage(text), false, `不应判为剂量：${text}`)
})

test('maskDosage：遮数字、留单位', () => {
  assert.equal(maskDosage('桂枝 9 g'), '桂枝 ＿＿g')
  assert.equal(maskDosage('麻黄三两'), '麻黄＿＿两')
  assert.match(maskDosage('每次 150ml'), /每次 ＿＿ml/)
  // 古文计量放行：原样保留
  assert.equal(maskDosage('水三升'), '水三升')
})

test('口径文案：四类约束都写到了', () => {
  for (const keyword of ['仅供学习研究', '不给具体剂量', '不出处方笺', '针灸只给推荐穴位', '不写进针深浅']) {
    assert.ok(GEAR_GUARD.includes(keyword), `口径锁缺「${keyword}」`)
  }
  assert.ok(GEAR_GUARD.includes(GEAR_MARK))
  assert.ok(GEAR_BLOCK_NOTICE.includes('仅供学习研究'))
  assert.ok(PRESET_DESCRIPTION.startsWith('仅供学习研究使用'))
  // 口径文案本身不能出现「照抓就能用」的现代剂量示例（古文计量如「三两」「三升」是允许出现的）
  const MODERN = /(\d+(?:\.\d+)?|[一二三四五六七八九十百千半两几数]+)\s*(?:克|克重|钱|毫升|ml|mL|[gG](?![a-zA-Z]))/
  const m = GEAR_GUARD.match(MODERN)
  assert.equal(m, null, `口径锁里出现了现代剂量写法：${m && m[0]}`)
})

test('currentPath：默认取平台资料库目录，自定义路径原样用', () => {
  const expected = normalizeRoot(defaultKbPath())
  assert.equal(currentPath({}), expected)
  assert.equal(currentPath(undefined), expected)
  // 配成同一路径时算出来必须一样（不会自动套一层子目录）
  assert.equal(currentPath({ kbPath: expected }), expected)
  // 用户自定义的目录原样用
  const custom = process.platform === 'win32' ? 'E:\\我的书' : '/tmp/我的书'
  assert.equal(currentPath({ kbPath: custom }), normalizeRoot(custom))
})

test('配置：只剩资料库路径与自动索引两项，没有挡位', async () => {
  const mod = await import('../lib/index.js')
  const dict = mod.Config.dict
  const keys = Object.keys(dict)
  assert.deepEqual(keys.sort(), ['autoIndex', 'kbPath'])
  // 不能出现 level/挡位残留
  const refs = Object.values(dict).map((id) => {
    const node = mod.Config.refs ? mod.Config.refs[id] : undefined
    return node ? JSON.stringify(node) : ''
  })
  assert.ok(!refs.join('').includes('level'), '不应残留挡位配置')
})

test('minimalPreset：结构完整，persona 带学理模式口径', () => {
  const preset = minimalPreset('win32')
  assert.equal(preset.id, 'dsh-tcm')
  assert.ok(String(preset.description).startsWith('仅供学习研究使用'))
  const persona = preset.plugins.find((item) => item.id === 'persona')
  assert.ok(persona, '应有 persona 行')
  assert.ok(String(persona.config.prefix).includes('学理模式'))
  const bash = preset.plugins.find((item) => item.id === 'tool-bash')
  const pwsh = preset.plugins.find((item) => item.id === 'tool-pwsh')
  assert.equal(bash.disabled, true, 'Windows 上不开 bash')
  assert.equal(pwsh.disabled, false, 'Windows 上开 pwsh')
  for (const item of corePlugins()) assert.ok(item.name, `${item.id} 缺 name`)
})

test('资料库路径：填了的目录原样用，不自动建子目录', () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'tcm-shared-'))
  try {
    assert.equal(currentPath({ kbPath: kb }), normalizeRoot(kb))
  } finally {
    fs.rmSync(kb, { recursive: true, force: true })
  }
})
test('出口检查：急诊信号没单独立标题要提醒', () => {
  assert.notStrictEqual(inspectNotice('若出现大便带血、剧烈腹痛，立刻处理。'), '')
  assert.strictEqual(inspectNotice('**⚠️ 立刻上医院**——出现大便带血、冷汗不止，立刻上医院。' + D0), '')
})

test('出口检查：用了温燥药没交底要提醒', () => {
  assert.notStrictEqual(inspectNotice('首选附子理中汤一类。'), '')
  assert.strictEqual(
    inspectNotice('首选理中汤加减（本方附子只作佐使、由小渐增；服后不见头胀面红再往上加；出现唇舌麻木立刻停用）。' + D0),
    '',
  )
  // 明说不用附子不算用
  assert.strictEqual(inspectNotice('本案先不用附子，改用党参白术干姜。' + D0), '')
})

test('出口检查：没写免责提示要提醒', () => {
  assert.notStrictEqual(inspectNotice('一、太阴为主。'), '')
  assert.strictEqual(inspectNotice('这条只是讲学理。不构成诊疗建议，身体不适请及时就医。'), '')
})

test('出口检查：替人定方要提醒', () => {
  assert.notStrictEqual(inspectNotice('你可以抓三副党参白术喝。' + D0), '')
  assert.strictEqual(inspectNotice('桂枝汤的组成是桂枝、芍药、生姜、大枣、甘草。' + D0), '')
})
