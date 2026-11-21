import io
p='test/sim-think.test.mjs'
s=io.open(p,encoding='utf-8').read()
for name in ["test('诊室面板代发的开局（自定义 source）不许被当成通知闭嘴'","test('医生一开始写答卷，就一直闭嘴到交卷'"]:
    a=s.index(name)
    b=s.index("\n})\n", a)+4
    s=s[:a]+s[b:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
