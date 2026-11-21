import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()
old="""      // 医生到底发来什么、认成没认成交卷，记一条：真机上认不出时有据可查。
      if (String(said).includes(HAND_IN)) {
        ctx.logger?.info?.(LOG + '这一句像交卷（来源 %s，认出 %s）：%s', String(event.data?.source?.kind || '无'), String(wantsHandIn(said)), said.slice(0, 20))
      }"""
new="""      // 医生发来的话里出现「交卷」，记一条：真机上没认出时有据可查。
      if (String(said).includes(HAND_IN)) {
        ctx.logger?.info?.(LOG + '这一句带交卷（认出 %s）：%s', String(wantsHandIn(said)), said.slice(0, 20))
      }"""
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
