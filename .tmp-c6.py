import io
p='CHANGELOG.md'
s=io.open(p,encoding='utf-8').read()
anchor='- 拦截条件改成看「医生这句话有没有问的意思」'
add='''- 补一处：开局那句「【模拟问诊 · 开局】…」本身不是问句，按新口径会被当成答题闭嘴，结果开局这一轮一个字都出不来（面板上只剩「已完成、用时 17 秒」）。现在开局那一轮单列，必须开口派病人、报第一句，不闭嘴。
'''
i=s.index(anchor)
s=s[:i]+add+s[i:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
