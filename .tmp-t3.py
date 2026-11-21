import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()
old='''function textOf(input) {
  if (typeof input === 'string') return input
  if (!Array.isArray(input)) return ''
  return input
    .map((part) => (part && part.type === 'text' ? String(part.text || '') : ''))
    .join('')
}'''
new='''function textOf(input) {
  if (typeof input === 'string') return input
  if (Array.isArray(input)) {
    return input
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        if (typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }
  if (input && typeof input === 'object') {
    if (typeof input.text === 'string') return input.text
    if (Array.isArray(input.parts)) return input.parts.map((part) => (typeof part === 'string' ? part : String(part?.text || ''))).join('')
  }
  return ''
}'''
assert old in s
s=s.replace(old,new,1)
old2="""      if (!wantsHandIn(said)) {"""
new2="""      // 医生到底发来什么、认成没认成交卷，记一条：真机上认不出时有据可查。
      if (String(said).includes(HAND_IN)) {
        ctx.logger?.info?.(LOG + '这一句像交卷（来源 %s，认出 %s）：%s', String(event.data?.source?.kind || '无'), String(wantsHandIn(said)), said.slice(0, 20))
      }
      if (!wantsHandIn(said)) {"""
assert old2 in s
s=s.replace(old2,new2,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
