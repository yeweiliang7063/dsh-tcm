import io
p='cordis.patch.yml'
s=io.open(p,encoding='utf-8').read()
old='                - 【答题期间病人和裁判都不许插话】'
new='''                - 【被系统通知叫醒时闭嘴】面板里冒出「子智能体已完成任务」「子智能体任务已停止」这类系统通知，不是医生在跟你说话：这一轮什么都不做——不转话、不点评、不补分析、不写旁白，正文一个字都不写，直接结束。要说话只等医生开口。
                - 【答题期间病人和裁判都不许插话】'''
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
