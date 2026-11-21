import io
p='CHANGELOG.md'
s=io.open(p,encoding='utf-8').read()
anchor='- 修「开局后一片安静、病人不开口」'
add='''- 拦截条件改成看「医生这句话有没有问的意思」：带问号、带「吗／呢／是不是／要不要／有没有／怎么／多少」这类收尾、「请问」开头，或「把舌头伸出来」「我摸一下脉」这种要病人配合的话，都算在问，模型照常说话；除此之外（陈述、写病机、给治法方药穴位、整段分析）就是答题，模型闭嘴，正文一个字都不往外放。子智能体结束通知照样闭嘴。提示词同步说明这条口径。
'''
i=s.index(anchor)
s=s[:i]+add+s[i:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
