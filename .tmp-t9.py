import io
p='test/sim-think.test.mjs'
s=io.open(p,encoding='utf-8').read()
s+='''
test('闭嘴只按一条：没有提问的意思才闭嘴（通知也一样）', async () => {
  const { shouldMute } = await import('../lib/sim-think.js')
  assert.equal(shouldMute('请问口苦吗？'), false, '问句不闭嘴')
  assert.equal(shouldMute('请把舌头伸出来'), false, '要病人配合不闭嘴')
  assert.equal(shouldMute('口干口苦，脉弦，这是少阳证，主方小柴胡汤。'), true, '答题闭嘴')
  assert.equal(shouldMute('子智能体已完成任务'), true, '系统通知本来就没问的意思，闭嘴')
  assert.equal(shouldMute('【模拟问诊 · 开局】普通｜方药｜20261121-1'), false, '开局要开口')
  assert.equal(shouldMute('交卷'), false, '交卷要说话')
})
'''
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
