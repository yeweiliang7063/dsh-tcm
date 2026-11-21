import test from 'node:test'
import assert from 'node:assert/strict'

import { createSimThinker, wantsHandIn } from '../lib/sim-think.js'

/** 一个假的 agent：记着当前选择，select 时照着改。 */
function fakeAgent(provider, model, effort) {
  const state = { provider, model, ...(effort ? { reasoningEffort: effort } : {}) }
  return {
    model: {
      current: () => ({ ...state }),
      select: (next) => {
        for (const key of Object.keys(state)) delete state[key]
        Object.assign(state, next)
      },
    },
  }
}

/** 假 ctx：sessionController 给 agent，llm 只认指定的档位。 */
function fakeCtx(agent, accepts) {
  return {
    get(name) {
      if (name === 'sessionController') return { resolveAgent: async () => agent }
      if (name === 'llm') {
        return {
          resolveCallConfig(selection) {
            if (selection.reasoningEffort !== undefined && !accepts.includes(selection.reasoningEffort)) {
              throw new Error('unsupported reasoning effort')
            }
            return selection
          },
        }
      }
      return undefined
    },
    logger: { info() {}, warn() {} },
  }
}

const open = (text) => ({ type: 'user/message', data: { content: [{ type: 'text', text }] } })
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

test('开局把这一局的思考关掉，交卷再调回原档', async () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 's-1' }

  thinker(session, open('【模拟问诊 · 开局】普通｜方药｜20260101-1'))
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'off', '开局先关思考')

  // 交卷与裁判的思考是同一个回合：必须当场还原，不能等异步。
  thinker(session, open('交卷'))
  assert.equal(agent.model.current().reasoningEffort, 'medium', '交卷当场就回到原来的档位')
})

test('模型不认 off 就往下降一档，不硬塞', async () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'high')
  const ctx = fakeCtx(agent, ['minimal', 'low', 'high'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })

  thinker({ id: 's-2' }, open('【模拟问诊 · 开局】困难｜针药｜20260101-2'))
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'minimal', 'off 不认就用 minimal')
})

test('全量版会话一律不动', async () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'full' })

  thinker({ id: 's-3' }, open('【模拟问诊 · 开局】简单｜方药｜20260101-3'))
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'medium', '全量版不许被这套开关碰')
})

test('这一局的病人子会话也关思考，别局的子会话不管', async () => {
  const patient = fakeAgent('deepseek', 'deepseek-v4', 'high')
  const other = fakeAgent('deepseek', 'deepseek-v4', 'high')
  const ctx = fakeCtx(patient, ['off', 'high'])
  const { thinker, child } = createSimThinker(ctx, { versionOf: () => 'xueli' })

  // 先有一局开局，才认它下面的子会话
  thinker({ id: 'doctor-1' }, open('【模拟问诊 · 开局】普通｜方药｜20260101-4'))
  await tick()

  child({ id: 'patient-1', origin: 'subagent', header: { parentSession: 'doctor-1' } })
  await tick()
  assert.equal(patient.model.current().reasoningEffort, 'off', '病人不用长链思考')

  // 不是这一局派出来的子会话：原样
  const ctx2 = fakeCtx(other, ['off', 'high'])
  const made = createSimThinker(ctx2, { versionOf: () => 'xueli' })
  made.child({ id: 'patient-2', origin: 'subagent', header: { parentSession: 'normal-chat' } })
  await tick()
  assert.equal(other.model.current().reasoningEffort, 'high', '别局的子会话不许动')
})

test('消息没带 source 也认，交卷带个句号也认', async () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'high')
  const ctx = fakeCtx(agent, ['off', 'high'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 's-9' }

  thinker(session, { type: 'user/message', data: { content: '【模拟问诊 · 开局】简单｜方药｜20260101-9' } })
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'off')

  thinker(session, { type: 'user/message', data: { content: [{ type: 'text', text: '交卷。' }] } })
  assert.equal(agent.model.current().reasoningEffort, 'high', '不能因为多了个标点就不还原')
})

test('只管模拟问诊这一局：普通聊天、没开局的会话一个字都不动', async () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'high')
  const ctx = fakeCtx(agent, ['off', 'high'])
  const { thinker, settled } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const chat = { id: 'plain-chat' }

  // 没开过局的会话：说什么都不动
  thinker(chat, open('交卷'))
  thinker(chat, open('治法当和解少阳'))
  settled(chat, { type: 'assistant/message' })
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'high', '普通聊天不许被碰')

  // 开了一局：照样管
  thinker({ id: 'sim-1' }, open('【模拟问诊 · 开局】简单｜方药｜20260101-30'))
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'off')

  // 交完卷这一局就结束了，之后再聊不再动它
  thinker({ id: 'sim-1' }, open('交卷'))
  assert.equal(agent.model.current().reasoningEffort, 'high')
  settled({ id: 'sim-1' }, { type: 'assistant/message' })
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'high', '交完卷就不再管')
})
