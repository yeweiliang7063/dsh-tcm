import io
p='test/sim-think.test.mjs'
s=io.open(p,encoding='utf-8').read()
s+='''
test('诊室面板代发的开局（自定义 source）不许被当成通知闭嘴', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-source' }
  thinker(session, { type: 'user/message', data: { source: { kind: 'tcmXueliSim' }, content: [{ type: 'text', text: '【模拟问诊 · 开局】普通｜针药｜20261121-182549' }] } })
  assert.equal(simQuiet('sim-source'), false, '开局是医生这边发的，不许闭嘴')
  thinker(session, { type: 'user/message', data: { source: { kind: 'subagent-settled' }, content: [{ type: 'text', text: '子智能体已完成任务' }] } })
  assert.equal(simQuiet('sim-source'), true)
})
'''
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
