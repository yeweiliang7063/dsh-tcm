// 会话识别：只有中医会话才许插件动手。
// 本插件是全局挂载的，每个会话的插件表里都有它，所以「插件已装载」不能当判据——
// 早先就是这一条把普通对话也认成了中医会话。这里只锁两路：预设名、提示词本身。
import test from 'node:test'
import assert from 'node:assert/strict'
import { looksTcm, looksTcmPrompt } from '../lib/preset-scope.js'
import { GEAR_GUARD, GEAR_MARK } from '../lib/gear.js'

test('预设名带中医字样才算中医会话', () => {
  for (const name of ['dsh-tcm', 'dsh-tcm-xueli', '中医 · 经方（学习版）', '经方学理', 'tcm-xueli'])
    assert.ok(looksTcm(name), `应认成中医会话：${name}`)
  for (const name of ['default', '通用助手', '代码助手', 'native', ''])
    assert.equal(looksTcm(name), false, `不该认成中医会话：${name}`)
})

test('预设说明里写中医的也算', () => {
  assert.ok(looksTcm({ id: 'x', description: '仅供中医学习研究' }))
  assert.equal(looksTcm({ id: 'x', description: '写代码用的' }), false)
})

test('提示词带学理模式总纲就算中医会话', () => {
  const guardLine = GEAR_GUARD.slice(0, GEAR_GUARD.indexOf('\n'))
  assert.ok(guardLine.length > 0)
  assert.ok(looksTcmPrompt(guardLine))
  assert.ok(looksTcmPrompt('前置说明\n' + guardLine + '\n后面还有口径'))
  assert.ok(looksTcmPrompt(GEAR_MARK))
})

test('普通对话的提示词不算中医会话', () => {
  assert.equal(looksTcmPrompt('你是通用助手，负责回答技术问题。'), false)
  assert.equal(looksTcmPrompt(''), false)
  assert.equal(looksTcmPrompt(undefined), false)
  assert.equal(looksTcmPrompt(null), false)
})
test('两版分得清：学习版、全量版各认各的，认不出就回空', async () => {
  const { versionOf } = await import('../lib/preset-scope.js')
  const withPreset = (id) => ({ get: (key) => (key === 'agentPresets' ? { presetForSession: () => id } : undefined) })
  assert.equal(versionOf(withPreset('dsh-tcm-xueli'), { session: {} }), 'xueli')
  assert.equal(versionOf(withPreset('dsh-qihuangjingfang'), { session: {} }), 'full')
  assert.equal(versionOf(withPreset('中医 · 经方（学习版）'), { session: {} }), 'xueli')
  assert.equal(versionOf(withPreset('中医 · 经方'), { session: {} }), '')
  // 老版全量版的预设 id 就叫 qihuang，也要认成全量版，不然它的工具会被张冠李戴。
  assert.equal(versionOf(withPreset('qihuang'), { session: {} }), 'full')
  assert.equal(versionOf(withPreset('qihuang-xueli'), { session: {} }), '')
  const headerOnly = {
    get: (key) => (key === 'agentPresets' ? { presetForSession: () => null } : undefined),
  }
  assert.equal(versionOf(headerOnly, { session: { header: { agentPreset: 'dsh-qihuangjingfang' } } }), 'full')
  assert.equal(versionOf(headerOnly, { session: { header: {} } }), '')
})
