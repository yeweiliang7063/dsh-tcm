import io
p='CHANGELOG.md'
s=io.open(p,encoding='utf-8').read()
anchor='- 修「Error: unknown tool ""」'
add='''- 修「开局后一片安静、病人不开口」：判断「这一轮是不是医生在说话」用了白名单，只认 source 为 user；诊室面板代发开局与交卷时带的是自定义 source（`tcmXueliSim`），被当成系统通知闭嘴了。现在改成黑名单：只有「子智能体结束」这一种通知才闭嘴，其余一律当医生本人。
'''
i=s.index(anchor)
s=s[:i]+add+s[i:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
