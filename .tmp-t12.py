import io
p='test/sim-think.test.mjs'
s=io.open(p,encoding='utf-8').read()
start=s.index("test('被系统通知叫醒的一轮要闭嘴，医生的下一句再说'")
end=s.index("test('开局那句话不看预设也认，只要有「交卷」两个字就算交卷'")
new='''test('闭嘴只认「答卷」两个字：开局、问话、通知都不闭嘴', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-q' }
  const say = (text, kind) => thinker(session, { type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } })

  say('【模拟问诊 · 开局】普通｜方药｜20261121-1', 'user')
  assert.equal(simQuiet('sim-q'), false, '开局不许闭嘴')
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
  assert.equal(simQuiet('sim-ask'), false, '开局这一轮要开口派病人')
  say('答卷：口干口苦，脉弦，少阳证，治法和解少阳，主方小柴胡汤。')
  assert.equal(simQuiet('sim-ask'), true, '看到「答卷」两个字就闭嘴')
  say('那要是只和解不换方呢？')
  assert.equal(simQuiet('sim-ask'), true, '交卷之前一直闭嘴')
  say('交卷')
  assert.equal(simQuiet('sim-ask'), false, '交卷放开')
})

test('诊室面板代发的开局（自定义 source）不许被闭嘴', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-source' }
  thinker(session, { type: 'user/message', data: { source: { kind: 'tcmXueliSim' }, content: [{ type: 'text', text: '【模拟问诊 · 开局】普通｜针药｜20261121-182549' }] } })
  assert.equal(simQuiet('sim-source'), false, '开局是医生这边发的，不许闭嘴')
})

'''
s=s[:start]+new+s[end:]
# 删掉旧的「先问后答」用例（新规则下不再成立）
if "test('先问后答：问的时候不闭嘴，第一句答卷才上锁'" in s:
    a=s.index("test('先问后答：问的时候不闭嘴，第一句答卷才上锁'")
    b=s.index("\n})\n", a)+4
    s=s[:a]+s[b:]
# 删掉 shouldMute 那条旧用例（函数已不存在）
if "test('闭嘴只按一条：没有提问的意思才闭嘴（通知也一样）'" in s:
    a=s.index("test('闭嘴只按一条：没有提问的意思才闭嘴（通知也一样）'")
    b=s.index("\n})\n", a)+4
    s=s[:a]+s[b:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
