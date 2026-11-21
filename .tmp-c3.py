import io
p='CHANGELOG.md'
s=io.open(p,encoding='utf-8').read()
anchor='- 被系统通知叫醒的一轮闭嘴'
add='''- 修「Error: unknown tool ""」：上一条的闭嘴做法把整段流里的非文字块一起过滤了，工具调用的名字与参数也在那些块里，于是宿主收到一次空名字的工具调用。现在闭嘴只清文字（正文增量与块末全文），工具块、结束块、用量块原样转发；单测补了一条，盯「文字清了、工具块还在」。
'''
i=s.index(anchor)
s=s[:i]+add+s[i:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
