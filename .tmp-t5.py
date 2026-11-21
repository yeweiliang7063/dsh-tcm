import io
p='test/sim-think.test.mjs'
s=io.open(p,encoding='utf-8').read()
s=s.replace("test('开局那句话不看预设也认，只要有「交卷」两个字就算交卷', () => {","test('开局那句话不看预设也认，只要有「交卷」两个字就算交卷', async () => {",1)
s=s.replace("""  thinker(session, open('【模拟问诊 · 开局】困难｜针药｜20261121-1'))
  assert.equal""","""  thinker(session, open('【模拟问诊 · 开局】困难｜针药｜20261121-1'))
  await tick()
  assert.equal""",1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
