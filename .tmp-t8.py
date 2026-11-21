import io
p='test/sim-think.test.mjs'
s=io.open(p,encoding='utf-8').read()
s=s.replace("  say('【模拟问诊 · 开局】普通｜方药｜20261121-1')\n  say('请问您哪里不舒服？')","  say('【模拟问诊 · 开局】普通｜方药｜20261121-1')\n  assert.equal(simQuiet('sim-ask'), false, '开局这一轮要开口派病人')\n  say('请问您哪里不舒服？')",1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
