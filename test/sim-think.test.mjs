import test from 'node:test'
import assert from 'node:assert/strict'

import { createSimThinker, simQuiet } from '../lib/sim-think.js'

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
function fakeCtx(agent, accepts, resolveOf) {
  const resolve = typeof resolveOf === 'function' ? resolveOf : (id) => {
    agent.session = { id }
    return agent
  }
  return {
    get(name) {
      if (name === 'sessionController') return { resolveAgent: async (id) => resolve(id) }
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

  // 开局那一轮派病人，医生问一句之后才开始正常转话
  thinker(session, open('请问您头胀多久了？'))

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

  thinker(session, { type: 'user/message', data: { content: [{ type: 'text', text: '请问大便怎么样？' }] } })
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

  // 开了一局，且开局后医生真问了话：这一局才归它管
  thinker({ id: 'sim-1' }, open('【模拟问诊 · 开局】简单｜方药｜20260101-30'))
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'off')
  thinker({ id: 'sim-1' }, open('请问口干吗？'))
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'off', '这一局还在问诊中，思考要继续关着')

  // 交完卷这一局就结束了，之后再聊不再动它
  thinker({ id: 'sim-1' }, open('交卷'))
  assert.equal(agent.model.current().reasoningEffort, 'high')
  settled({ id: 'sim-1' }, { type: 'assistant/message' })
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'high', '交完卷就不再管')
})

test('闭嘴只认「答卷」两个字：开局与问话都不闭嘴，写了「答卷」才闭', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-q' }
  const say = (text, kind) => thinker(session, { type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } })

  say('【模拟问诊 · 开局】普通｜方药｜20261121-1', 'user')
  assert.equal(simQuiet('sim-q'), true, '开局这一轮也不许说话，只许派病人')
  say('请问您头晕多久了？', 'user')
  assert.equal(simQuiet('sim-q'), false, '问话不闭嘴')
  say('口干口苦，脉弦，治法和解少阳，主方小柴胡汤。', 'user')
  assert.equal(simQuiet('sim-q'), false, '没写「答卷」两个字，不算开始答卷')
  say('子智能体已完成任务', 'subagent-settled')
  assert.equal(simQuiet('sim-q'), false, '通知也不闭嘴')
})

test('医生打「答卷」才开始闭嘴，一直到「交卷」', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-ask' }
  const say = (text) => thinker(session, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })

  say('【模拟问诊 · 开局】普通｜方药｜20261121-1')
  assert.equal(simQuiet('sim-ask'), true, '开局这一轮只许派病人，正文闭嘴')
  say('请问口苦吗？')
  assert.equal(simQuiet('sim-ask'), false, '医生第一次开口，病人要能被叫来')
  say('答卷：口干口苦，脉弦，少阳证，治法和解少阳，主方小柴胡汤。')
  assert.equal(simQuiet('sim-ask'), true, '看到「答卷」两个字就闭嘴')
  say('那要是只和解不换方呢？')
  assert.equal(simQuiet('sim-ask'), true, '交卷之前一直闭嘴，问话也闭嘴')
  say('交卷')
  assert.equal(simQuiet('sim-ask'), false, '交卷放开')
})

test('诊室面板代发的开局：只许派病人，正文闭嘴', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-source' }
  thinker(session, { type: 'user/message', data: { source: { kind: 'tcmXueliSim' }, content: [{ type: 'text', text: '【模拟问诊 · 开局】普通｜针药｜20261121-182549' }] } })
  assert.equal(simQuiet('sim-source'), true, '开局这一轮正文闭嘴，免得自己念病例卡')
  thinker(session, { type: 'user/message', data: { source: { kind: 'tcmXueliSim' }, content: [{ type: 'text', text: '请问您怕冷还是怕热？' }] } })
  assert.equal(simQuiet('sim-source'), false, '医生真问了，就放开')
})

test('开局那句话不看预设也认，只要有「交卷」两个字就算交卷', async () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => '' })
  const session = { id: 'sim-no-preset' }

  thinker(session, open('【模拟问诊 · 开局】困难｜针药｜20261121-1'))
  thinker(session, open('请问您头晕吗？'))
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'off', '预设还没挂上也要关思考')
  thinker(session, open('这一局我看完了，交卷吧。'))
  assert.equal(agent.model.current().reasoningEffort, 'medium', '只要带着交卷两个字就还原')
})

test('开局之后第一句就是「交卷」也认：当场开到 High，这一局收尾', async () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium', 'high'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-first-handin' }

  thinker(session, open('【模拟问诊 · 开局】普通｜方药｜20261121-77'))
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'off')

  thinker(session, open('交卷'))
  assert.equal(agent.model.current().reasoningEffort, 'high', '第一句就是交卷，也要开 High')
  assert.equal(simQuiet('sim-first-handin'), false, '交卷这一轮要放开')
})

test('开局之后第一句就是「答卷」：直接闭嘴，不白放一轮', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-first-daanjuan' }

  thinker(session, open('【模拟问诊 · 开局】普通｜方药｜20261121-78'))
  thinker(session, open('答卷：口干口苦，少阳证，小柴胡汤。'))
  assert.equal(simQuiet('sim-first-daanjuan'), true, '第一句答卷就要闭嘴，不能白放过去')
})

test('普通会话里问一句「模拟问诊怎么开始」不算开局', async () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'plain-mention' }

  thinker(session, open('模拟问诊怎么开始？'))
  thinker(session, open('【模拟问诊】这功能有点意思'))
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'medium', '只是提到这几个字，不许当开局')
  assert.equal(simQuiet('plain-mention'), false, '也不许把这一轮正文清空')
})

test('点评打完再把档位交回去：下一句闲聊不再跑 High', async () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium', 'high'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-after' }

  thinker(session, open('【模拟问诊 · 开局】简单｜方药｜20261121-79'))
  await tick()
  thinker(session, open('请问怕冷吗？'))
  thinker(session, open('交卷'))
  assert.equal(agent.model.current().reasoningEffort, 'high', '点评这一轮要 High')

  // 点评打完了，医生换话题：档位交回原来的 medium
  thinker(session, open('谢谢，今天就到这儿'))
  await tick()
  assert.equal(agent.model.current().reasoningEffort, 'medium', '点评完要把档位交回去，别一直 High')
})

test('拿到的 agent 不属于这一局（全量版/普通聊天的）就不碰', async () => {
  const other = fakeAgent('deepseek', 'deepseek-v4', 'high')
  other.session = { id: 'full-version-chat' }
  const ctx = fakeCtx(other, ['off', 'high'], () => other)
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-scope' }

  thinker(session, open('【模拟问诊 · 开局】简单｜方药｜20261121-9'))
  await tick()
  assert.equal(other.model.current().reasoningEffort, 'high', '别的会话的思考一个字都不许动')
  assert.equal(simQuiet('sim-scope'), true, '闭嘴只认这一局，照旧')
})
