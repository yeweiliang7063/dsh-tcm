import io
p='CHANGELOG.md'
s=io.open(p,encoding='utf-8').read()
anchor='- 闭嘴改成「答卷锁存」'
add='''- 闭嘴再收一次，只认字面：医生打的字里出现**「答卷」**两个字，才从这一轮开始闭嘴；出现**「交卷」**才放开。开局、问话、答题（没写「答卷」两字）、子智能体通知，一律不闭嘴。原来那套「猜有没有问的意思」的规则（问号、吗/呢收尾、要伸舌头、来源判断、上下文注入来源）全部删除，`looksQuestion`、`shouldMute`、`nextLatch`、`INJECTED_SOURCE`、`NOTICE_SOURCE`、`answering` 都不在了。
'''
i=s.index(anchor)
s=s[:i]+add+s[i:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
