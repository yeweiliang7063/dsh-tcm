import io
p='test/sim-think.test.mjs'
s=io.open(p,encoding='utf-8').read()
i=s.index("test('被系统通知叫醒的一轮要闭嘴")
s=s[:i]+'''test('被系统通知叫醒的一轮要闭嘴，医生的下一句再说', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-quiet' }
  const said = (text, kind) => ({ type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } })

  thinker(session, said('【模拟问诊 · 开局】简单｜方药｜20261121-180000', 'user'))
  assert.equal(simQuiet('sim-quiet'), false)
  thinker(session, said('子智能体已完成任务', 'subagent-settled'))
  assert.equal(simQuiet('sim-quiet'), true, '被通知叫醒的一轮要闭嘴')
  thinker(session, said('请问口渴不渴？', 'user'))
  assert.equal(simQuiet('sim-quiet'), false, '医生说话就恢复')
  thinker(session, said('子智能体已完成任务', 'subagent-settled'))
  thinker(session, said('交卷', 'user'))
  assert.equal(simQuiet('sim-quiet'), false, '交卷之后不再管这一局')
})

test('开局那句话不看预设也认，只要有「交卷」两个字就算交卷', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => '' })
  const session = { id: 'sim-no-preset' }

  thinker(session, open('【模拟问诊 · 开局】困难｜针药｜20261121-1'))
  assert.equal(agent.model.current().reasoningEffort, 'off', '预设还没挂上也要关思考')
  thinker(session, open('这一局我看完了，交卷吧。'))
  assert.equal(agent.model.current().reasoningEffort, 'medium', '只要带着交卷两个字就还原')
})
'''
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
