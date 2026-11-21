import io
p='test/sim-think.test.mjs'
s=io.open(p,encoding='utf-8').read()
s+='''
test('先问后答：问的时候不闭嘴，第一句答卷才上锁', () => {
  const agent = fakeAgent('deepseek', 'deepseek-v4', 'medium')
  const ctx = fakeCtx(agent, ['off', 'minimal', 'low', 'medium'])
  const { thinker } = createSimThinker(ctx, { versionOf: () => 'xueli' })
  const session = { id: 'sim-latch' }
  const say = (text) => thinker(session, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })

  say('【模拟问诊 · 开局】简单｜方药｜20261121-2')
  assert.equal(simQuiet('sim-latch'), false)
  say('您这头晕多久了？')
  assert.equal(simQuiet('sim-latch'), false, '第一句是问话，不上锁')
  say('除了晕还有别的难受吗？')
  assert.equal(simQuiet('sim-latch'), false, '连着问也不上锁')
  say('按脉证看是少阳不和，治当和解少阳，主方小柴胡汤。')
  assert.equal(simQuiet('sim-latch'), true, '第一句答卷才上锁')
  say('那要是只和解不换方呢？')
  assert.equal(simQuiet('sim-latch'), true, '上锁后到交卷前一直闭嘴')
  say('交卷')
  assert.equal(simQuiet('sim-latch'), false, '交卷解锁')
})
'''
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
