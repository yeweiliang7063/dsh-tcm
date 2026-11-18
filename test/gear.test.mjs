// 学理模式：出口校验与口径文案的单元测试
// 只测纯函数，不启动 DSH。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { blotDosage, hasDosage, maskDosage, sourceDoseKeys } from '../lib/dosage-guard.js'
import { GEAR_BLOCK_NOTICE, GEAR_GUARD, GEAR_MARK, PRESET_DESCRIPTION } from '../lib/gear.js'
const D0 = String.fromCharCode(10) + '【学理模式】本节仅供学习研究，不构成诊疗建议。'

import { currentPath } from '../lib/index.js'
import { corePlugins, minimalPreset } from '../lib/preset.js'
import { defaultKbPath, normalizeRoot } from '../lib/platform.js'

test('hasDosage：认得出各路剂量写法', () => {
  const hits = [
    '桂枝 9 g',
    '麻黄10克',
    '炙甘草 3克',
    '生姜 5 克',
    '石膏 40g 先煎',
    // 2026-11 口径：只遮「克」前面的数字；两、钱、毫升、剂、服不再自动遮
    '桂枝 12 克',
    '其方桂枝 9 克，芍药 9 克',
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
    // 2026-11 口径：经典计量与毫升不再算「要遮的剂量」，原文原话照抄
    '麻黄三两',
    '桂枝 5 钱',
    '每日服两服',
    '每次 150ml',
    '其方桂枝三两，芍药三两',
    '表现为下肢浮肿',
    '本节仅供学习研究，不构成诊疗建议。',
  ]
  for (const text of misses) assert.equal(hasDosage(text), false, `不应判为剂量：${text}`)
})

test('blotDosage：只换数字，药名和句子骨架都留着', () => {
  const out = blotDosage('这是辨证思路，生姜 25g，先煎十分钟。')
  assert.equal(out, '这是辨证思路，生姜 ✳，先煎十分钟。')
  assert.ok(out.includes('生姜'), '药名被挖掉了：' + out)
  assert.ok(!out.includes('25'), '数值没遮干净：' + out)
  assert.ok(out.endsWith('。'), '句子骨架被挖掉了：' + out)
  // 原文照引整条方，一个数都不动
  assert.equal(blotDosage('《伤寒论》原文：「桂枝三两，芍药三两」'), '《伤寒论》原文：「桂枝三两，芍药三两」')
})

test('blotDosage：列表项前缀永不参与打码', () => {
  assert.equal(blotDosage('2. **生姜**：25g，切片。'), '2. **生姜**：✳，切片。')
  assert.equal(blotDosage('- **甘草**：6g，调和诸药。'), '- **甘草**：✳，调和诸药。')
  // 两味药的列表照常遮数值，但序号、加粗药名一个不动
  assert.equal(blotDosage('1. **桂枝**：9g\n2. **白芍**：9g\n'), '1. **桂枝**：✳\n2. **白芍**：✳\n')
})

test('blotDosage：原单上的剂量照念放行，自己新给的量照遮', () => {
  const keep = sourceDoseKeys('我拿到的方：黄芪30g、当归15g、白术10g')
  // 转述原单：这几个数原样留着
  const restated = '原单上黄芪 30g、当归 15g、白术 10g，三味都是补气健脾的路子。'
  assert.equal(blotDosage(restated, '✳', keep), restated)
  // 单位写法不同也照样对得上号（克 ↔ g）
  assert.equal(blotDosage('原单上黄芪 30 克。', '✳', keep), '原单上黄芪 30 克。')
  // 同一句里模型自己加的量照遮
  assert.equal(blotDosage('原单上黄芪 30g，可以再加陈皮 6g。', '✳', keep), '原单上黄芪 30g，可以再加陈皮 ✳。')
  // 有原单可对号时，「整张方 4 味以上就放行」这条不再兜自己拟的方
  assert.equal(
    blotDosage('桂枝9g、白芍9g、生姜9g、甘草6g', '✳', keep),
    '桂枝✳、白芍✳、生姜✳、甘草✳',
  )
})

test('blotDosage：整段转述整张方时整段放行', () => {
  const formula = ['这是转述一张方子：', '', '1. **桂枝** 9g', '2. **白芍** 9g', '3. **生姜** 9g', '4. **甘草** 6g'].join('\n')
  assert.equal(blotDosage(formula), formula)
  assert.equal(hasDosage(formula), false)
  // 同段只有三味时不算整张方，照常遮数值
  assert.equal(blotDosage('桂枝9g、白芍9g、生姜9g'), '桂枝✳、白芍✳、生姜✳')
})

test('maskDosage：遮数字、留单位', () => {
  assert.equal(maskDosage('桂枝 9 g'), '桂枝 ＿＿g')
  assert.equal(maskDosage('麻黄10克'), '麻黄＿＿克')
  // 两、毫升不再打码：经典计量原样保留
  assert.equal(maskDosage('麻黄三两'), '麻黄三两')
  assert.equal(maskDosage('每次 150ml'), '每次 150ml')
  // 古文计量放行：原样保留
  assert.equal(maskDosage('水三升'), '水三升')
})

test('版式与待定项：结论先行、能表格就表格、不提问也要点明缺项影响', () => {
  // 手机上一屏看不完的排版，等于白写：结论先摆、长段落拆短、对比一律上表格。
  for (const keyword of ['10.1 版式', '结论先行', '表格', '加粗', '1500 字']) {
    assert.ok(GEAR_GUARD.includes(keyword), `版式口径缺「${keyword}」`)
  }
  // 对方说「不用提问」时不许再追问，但也必须把缺什么、影响什么写成一句，并把缺项归入待定。
  for (const keyword of ['21.7 对方说', '不再调 ask_user_question', '略过', '待定']) {
    assert.ok(GEAR_GUARD.includes(keyword), `待定项口径缺「${keyword}」`)
  }
})

test('口径文案：四类约束都写到了', () => {
  for (const keyword of ['仅供学习研究', '剂量：不自己给量', '不出处方笺', '针灸只给推荐穴位', '不写进针深浅', '⑭线索只写一遍', '其余同上一轮所列', '21.11 定主方之前必须先做排他检验', '柴胡不中与之']) {
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

test('currentPath：没配置时返回空串，配置了原样用', () => {
  const expected = normalizeRoot(defaultKbPath())
  assert.equal(expected, '', '插件不该再预设资料库目录')
  assert.equal(currentPath({}), '')
  assert.equal(currentPath(undefined), '')
  // 配成同一路径时算出来必须一样（不会自动套一层子目录）
  // 用户自定义的目录原样用（只认设置里那一个，而且它必须真在盘上）
  const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'tcm-kb-'))
  assert.equal(currentPath({ kbPath: custom }), normalizeRoot(custom))
  // 填了但盘上不存在：当没配置，绝不去别处找替代目录
  const ghost = path.join(custom, '不存在的子目录')
  assert.equal(currentPath({ kbPath: ghost }), '')
  fs.rmSync(custom, { recursive: true, force: true })
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

test('minimalPreset：结构完整，persona 带经方学理口径', () => {
  const preset = minimalPreset('win32')
  assert.equal(preset.id, 'dsh-tcm-xueli')
  assert.ok(String(preset.description).startsWith('仅供学习研究使用'))
  const persona = preset.plugins.find((item) => item.id === 'persona')
  assert.ok(persona, '应有 persona 行')
  assert.ok(String(persona.config.prefix).includes(GEAR_MARK), 'persona 应带末尾固定声明')
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

test('本轮口径：内经饮食、只遮克数、六部脉分开问、红线条、Markdown', () => {
  for (const keyword of ['红线条：一切结论必须有经典原文支撑', '不许拿自己记住的医学知识往外发散', '这一条不下断']) {
    assert.ok(GEAR_GUARD.includes(keyword), `红线口径缺「${keyword}」`)
  }
  for (const keyword of ['饮食调护按《黄帝内经》讲', '五谷为养', '左寸候心', '右尺候命门', '直接六部逐部分开问', '点了它不算这一部问完', 'Markdown 排版', '照抄，不许自己推干支']) {
    assert.ok(GEAR_GUARD.includes(keyword), `本轮口径缺「${keyword}」`)
  }
  // 旧口径必须真的退场：一律不许提吃的、未收可按通行说法讲药性
  assert.ok(!GEAR_GUARD.includes('一律不出任何可吃的东西'), '饮食禁令还在')
  assert.ok(!GEAR_GUARD.includes('照样可以按通行说法讲药性'), '凭记忆讲药性还在')
  // 开头那行只写「**结论**：」，不带表情、不带方括号、不把急救信号塞进去
  assert.ok(GEAR_GUARD.includes('**结论**：'), '开头结论行不见了')
  assert.ok(!GEAR_GUARD.includes('大白话结论'), '旧标签「大白话结论」还在')
  assert.ok(!GEAR_GUARD.includes('👉'), '开头那个表情还在')
  assert.ok(!GEAR_GUARD.includes('立刻去医院'), '急救信号还塞在开头结论行里')
})
