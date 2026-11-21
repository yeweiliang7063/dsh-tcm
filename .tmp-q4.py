import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()
old='''      // 闭嘴与否只看医生这句话有没有「问」的意思：
      // - 子智能体结束这类通知：不是医生在说话，闭嘴；
      // - 医生在问、在要病人配合、或者打了「交卷」：照常说话；
      // - 医生在答题（陈述、写病机治法方药穴位、整段分析）：闭嘴，正文一个字都不往外放。
      const kind = event.data?.source?.kind
      // 开局那句本身不是问句，但这一轮必须让模型开口（派病人、报第一句），不能闭嘴。
      const opening = OPEN_MARK.test(said) || said.startsWith(OPEN_PREFIX)
      const ask = opening || looksQuestion(said) || wantsHandIn(said)
      if (kind === 'subagent-settled' || !ask) quietly.add(sessionId)
      else quietly.delete(sessionId)'''
new='''      // 闭嘴只按一条：医生这一句没有「问」的意思，就闭嘴。
      // 不再看消息来源、不再看是不是系统通知——通知那种字样本来也没有问的意思，自然闭嘴。
      if (shouldMute(said)) quietly.add(sessionId)
      else quietly.delete(sessionId)'''
assert old in s
s=s.replace(old,new,1)

# 在 wantsHandIn 之后加 shouldMute
anchor="function wantsHandIn(said) {"
add='''/** 这一句要不要闭嘴：没有提问的意思就闭嘴；开局指令与交卷不是「答题」，照常说话。 */
export function shouldMute(said) {
  const text = String(said || '').trim()
  if (!text) return false
  if (wantsHandIn(text)) return false
  if (OPEN_MARK.test(text) || text.startsWith(OPEN_PREFIX)) return false
  return !looksQuestion(text)
}

'''
assert anchor in s
s=s.replace(anchor, add+anchor, 1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
