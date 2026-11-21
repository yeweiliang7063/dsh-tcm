import io
p='test/sim-think.test.mjs'
s=io.open(p,encoding='utf-8').read()
old_start=s.index("test('医生在答题（没问的意思）就闭嘴，一问就恢复'")
old_end=s.index("test('闭嘴只按一条：没有提问的意思才闭嘴（通知也一样）'")
new_test='''test('医生一开始写答卷，就一直闭嘴到交卷', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-ask' }
  const say = (text) => thinker(session, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })

  say('【模拟问诊 · 开局】普通｜方药｜20261121-1')
  assert.equal(simQuiet('sim-ask'), false, '开局这一轮要开口派病人')
  say('请问您哪里不舒服？')
  assert.equal(simQuiet('sim-ask'), false, '问句要照常转病人')
  say('口干口苦，脉弦，这是少阳证，治法和胃降逆，主方小柴胡汤加减，取穴太冲、阳陵泉。')
  assert.equal(simQuiet('sim-ask'), true, '开始答题就闭嘴')
  say('请把舌头伸出来我看看')
  assert.equal(simQuiet('sim-ask'), true, '答卷中间插一句问话，也照样闭嘴，不许放出半句')
  say('交卷。')
  assert.equal(simQuiet('sim-ask'), false, '交卷要说话')
  say('那如果只用和解少阳，不用小柴胡汤，行不行？')
  assert.equal(simQuiet('sim-ask'), false, '交完卷重新开问，问句照常转病人')
})

'''
s=s[:old_start]+new_test+s[old_end:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
