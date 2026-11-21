import test from 'node:test'
import assert from 'node:assert/strict'

import { createStore, TOOL_NAMES } from '../lib/clinic.js'

test('问诊记录：开局记题面、交卷记成绩、列表按时间倒序', async () => {
  const store = createStore()
  const first = await store.begin({
    id: '20261119-1',
    level: '普通',
    direction: '方药',
    caseSummary: '男 45 岁，胃脘痞满',
    patientId: 'patient-aaa',
    doctorId: 'doctor-bbb',
  })
  assert.equal(first.id, '20261119-1')
  assert.equal(first.level, '普通')
  assert.equal(first.patientId, 'patient-aaa')

  const second = await store.begin({ id: '20261119-2', level: '困难', direction: '针药' })
  assert.equal(second.id, '20261119-2')

  const ended = await store.end({
    id: '20261119-1',
    verdict: '边缘',
    failLine: '主方选对了，漏问小便',
    failPoints: ['没问起夜'],
    mustAsk: ['小便颜色', '起夜几次'],
    prescribe: '半夏泻心汤',
  })
  assert.equal(ended.verdict, '边缘')
  assert.deepEqual(ended.mustAsk, ['小便颜色', '起夜几次'])

  const rows = await store.list(10)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].id, '20261119-2', '新的在前')
  const firstRow = rows.find((row) => row.id === '20261119-1')
  assert.equal(firstRow.verdict, '边缘')
  assert.ok(firstRow.finishedAt > 0)
})

test('问诊记录只在内存：新建一个记录库读不到上一份的东西', async () => {
  const one = createStore()
  await one.begin({ id: 'A-1', level: '简单', direction: '针灸' })
  await one.end({ id: 'A-1', verdict: '过关' })
  assert.equal((await one.list(5)).length, 1)

  const another = createStore()
  assert.equal((await another.list(5)).length, 0, '不落盘，换一份就是空的')
})

test('问诊记录不碰磁盘：模块里没有写文件的导入', async () => {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const here = dirname(fileURLToPath(import.meta.url))
  const code = await readFile(join(here, '..', 'lib', 'clinic.js'), 'utf8')
  assert.equal(code.includes('writeFile'), false, '不该再写 rounds.json')
  assert.equal(code.includes('mkdir'), false, '不该再建记录目录')
  assert.equal(code.includes('rounds.json'), false, '不该再提记录文件')
})

test('问诊工具名带 xueli_ 前缀，不会和岐黄工作台的同名工具撞车', () => {
  assert.deepEqual(TOOL_NAMES, ['xueli_begin_round', 'xueli_finish_round', 'xueli_list_rounds'])
})

test('问诊工具真的注册得进：三个名字都交到宿主工具服务手上', async () => {
  const { registerClinicTools } = await import('../lib/clinic.js')
  const seen = []
  const fakeTools = {
    register(definition) {
      seen.push(definition)
      return () => {}
    },
  }
  const ctx = {
    get: (name) => (name === 'tools' ? fakeTools : undefined),
    logger: { warn() {} },
  }
  const release = await registerClinicTools(ctx, createStore())
  assert.deepEqual(seen.map((d) => d.name), TOOL_NAMES)
  for (const definition of seen) {
    assert.equal(typeof definition.execute, 'function', definition.name + ' 要有 execute')
    assert.equal(definition.parameters.type, 'object')
    assert.equal(typeof definition.parameters.additionalProperties, 'boolean',
      definition.name + ' 的参数要显式声明 additionalProperties')
    assert.equal(definition.output.schema.type, 'object')
    assert.equal(typeof definition.output.render, 'function')
  }
  assert.equal(typeof release, 'function')
  release()
})

test('同一局号重开：上一局的结论不会带过来', async () => {
  const store = createStore()
  await store.begin({ id: 'R-1', level: '普通', direction: '方药' })
  await store.end({ id: 'R-1', verdict: '不过关', failLine: '选错方' })
  const again = await store.begin({ id: 'R-1', level: '困难', direction: '针药' })
  assert.equal(again.verdict, undefined)
  assert.equal(again.failLine, undefined)
  assert.equal(again.level, '困难')
})

test('工具参数：难度、方向、结论只能填规定的那几个，不许自由发挥', async () => {
  const { registerClinicTools, TOOL_NAMES } = await import('../lib/clinic.js')
  const seen = {}
  const tools = { register: (definition) => { seen[definition.name] = definition; return () => {} } }
  const ctx = { get: (key) => (key === 'tools' ? tools : undefined), logger: { info() {}, warn() {} } }
  const release = await registerClinicTools(ctx, { begin: async () => ({}), end: async () => ({}), list: async () => [] })
  assert.deepEqual(Object.keys(seen).sort(), TOOL_NAMES.slice().sort())
  const begin = seen.xueli_begin_round.parameters.properties
  assert.deepEqual(begin.level.enum, ['简单', '普通', '困难'])
  assert.deepEqual(begin.direction.enum, ['方药', '针灸', '针药'])
  assert.deepEqual(seen.xueli_finish_round.parameters.properties.verdict.enum, ['过关', '边缘', '不过关'])
  release()
})

test('两版工具不许串：全量版会话里这三件工具不挂上去', async () => {
  const { registerClinicTools } = await import('../lib/clinic.js')
  const opts = []
  const tools = {
    register(definition, options) {
      opts.push({ name: definition.name, options })
      return () => {}
    },
  }
  const registry = (presetId) => ({ presetForSession: () => presetId })
  const make = (presetId) => ({
    get: (key) => (key === 'tools' ? tools : key === 'agentPresets' ? registry(presetId) : undefined),
    logger: { info() {}, warn() {} },
  })
  await registerClinicTools(make('dsh-qihuangjingfang'), { begin: async () => ({}), end: async () => ({}), list: async () => [] })
  const full = opts.at(-1).options.when
  assert.equal(typeof full, 'function', '注册时要带上启停条件')
  assert.equal(full({ agent: { session: {} } }), false, '全量版会话里不该出现学习版工具')

  await registerClinicTools(make('dsh-tcm-xueli'), { begin: async () => ({}), end: async () => ({}), list: async () => [] })
  const xueli = opts.at(-1).options.when
  assert.equal(xueli({ agent: { session: {} } }), true, '学习版会话里要照常出现')

  await registerClinicTools(
    { get: (key) => (key === 'tools' ? tools : undefined), logger: { info() {}, warn() {} } },
    { begin: async () => ({}), end: async () => ({}), list: async () => [] },
  )
  const unknown = opts.at(-1).options.when
  assert.equal(unknown({ agent: { session: {} } }), true, '认不出是哪一版时按原样挂，不乱拦')
})
