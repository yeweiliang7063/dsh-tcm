import io
p='test/sim-think.test.mjs'
s=io.open(p,encoding='utf-8').read()
s+='''
test('医生在答题（没问的意思）就闭嘴，一问就恢复', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-ask' }
  const say = (text) => thinker(session, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })

  say('【模拟问诊 · 开局】普通｜方药｜20261121-1')
  say('请问您哪里不舒服？')
  assert.equal(simQuiet('sim-ask'), false, '问句要照常转病人')
  say('口干口苦，脉弦，这是少阳证，治法和胃降逆，主方小柴胡汤加减，取穴太冲、阳陵泉。')
  assert.equal(simQuiet('sim-ask'), true, '答题时闭嘴')
  say('请把舌头伸出来我看看')
  assert.equal(simQuiet('sim-ask'), false, '要病人配合也是问')
  say('交卷。')
  assert.equal(simQuiet('sim-ask'), false, '交卷要说话')
})
'''
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
