// 学理模式：出口校验与口径文案的单元测试
// 只测纯函数，不启动 DSH。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hasDosage, maskDosage } from '../lib/dosage-guard.js'
import { GEAR_BLOCK_NOTICE, GEAR_GUARD, GEAR_MARK, PRESET_DESCRIPTION } from '../lib/gear.js'
import { currentPath } from '../lib/index.js'
import { corePlugins, minimalPreset } from '../lib/preset.js'
import { defaultKbPath, normalizeRoot } from '../lib/platform.js'

test('hasDosage：认得出各路剂量写法', () => {
  const hits = [
    '桂枝 9 g',
    '麻黄三两',
    '炙甘草 3克',
    '附子一枚（炮）',
    '大枣十二枚',
    '水三升',
    '生姜 5 钱',
    '杏仁五十枚',
    '每次 150ml',
    '石膏 40g 先煎',
  ]
  for (const text of hits) assert.ok(hasDosage(text), `应判为剂量：${text}`)
})

test('hasDosage：不把条号、序数、成语里的数字当剂量', () => {
  const misses = [
    '《伤寒论》宋本第 35 条：太阳病……',
    '第一难、第 12 篇',
    '六经辨证先辨太阳',
    '两目干涩、心烦',
    '表现为下肢浮肿',
    '本节仅供学习研究，不构成诊疗建议。',
  ]
  for (const text of misses) assert.equal(hasDosage(text), false, `不应判为剂量：${text}`)
})

test('maskDosage：遮数字、留单位', () => {
  assert.equal(maskDosage('桂枝 9 g'), '桂枝 ＿＿g')
  assert.equal(maskDosage('麻黄三两'), '麻黄＿＿两')
  assert.match(maskDosage('水三升'), /＿＿升/)
})

test('口径文案：四类约束都写到了', () => {
  for (const keyword of ['仅供学习研究', '不给具体剂量', '不出处方笺', '针灸只给推荐穴位', '不写进针深浅']) {
    assert.ok(GEAR_GUARD.includes(keyword), `口径锁缺「${keyword}」`)
  }
  assert.ok(GEAR_GUARD.includes(GEAR_MARK))
  assert.ok(GEAR_BLOCK_NOTICE.includes('仅供学习研究'))
  assert.ok(PRESET_DESCRIPTION.startsWith('仅供学习研究使用'))
  // 口径文案本身不能自带剂量示例
  assert.equal(hasDosage(GEAR_GUARD), false)
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