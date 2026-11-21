import io
p='CHANGELOG.md'
s=io.open(p,encoding='utf-8').read()
anchor='- 补一处：开局那句「【模拟问诊 · 开局】…」本身不是问句'
add='''- 闭嘴规则清成一条：`shouldMute(said)`——医生这一句没有「问」的意思就闭嘴，有问的意思就放行。原来那些按消息来源、按「子智能体结束通知」分开判的分支全部删掉；系统通知那种字样本来也没有问的意思，自然落进「闭嘴」，不用单列。开局指令与「交卷」不算答题，仍然开口。
'''
i=s.index(anchor)
s=s[:i]+add+s[i:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
