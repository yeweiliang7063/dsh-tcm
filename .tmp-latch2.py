import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()

old="const quietly = new Set()"
new="const quietly = new Set()\n/** 医生已经开始写答卷的会话：从那一刻起一直闭嘴，直到「交卷」。 */\nconst answering = new Set()"
if '\nconst answering = new Set()' not in s:
    assert old in s
    s=s.replace(old,new,1)

old2='''/** 这一句要不要闭嘴：没有提问的意思就闭嘴；开局指令与交卷不是「答题」，照常说话。 */
export function shouldMute(said) {
  const text = String(said || '').trim()
  if (!text) return false
  if (wantsHandIn(text)) return false
  if (OPEN_MARK.test(text) || text.startsWith(OPEN_PREFIX)) return false
  return !looksQuestion(text)
}'''
new2=old2+'''

/**
 * 医生开始写答卷：一旦这一句没有提问的意思，就当答卷开了头，从这一轮到「交卷」为止一律闭嘴。
 * 中间再补一句问话也不放出——答卷是连贯的一整段，中间冒出半句就把后面怎么答剧透了。
 */
export function nextLatch(said, latched) {
  const text = String(said || '').trim()
  if (!text) return latched
  if (wantsHandIn(text) || OPEN_MARK.test(text) || text.startsWith(OPEN_PREFIX)) return false
  if (latched) return true
  return !looksQuestion(text)
}'''
if 'export function nextLatch' not in s:
    assert old2 in s
    s=s.replace(old2,new2,1)

old3="""      if (shouldMute(said)) quietly.add(sessionId)
      else quietly.delete(sessionId)"""
new3="""      // 答卷一旦开头就一直闭嘴，直到「交卷」或下一局开局。
      const latched = nextLatch(said, answering.has(sessionId))
      if (latched) {
        answering.add(sessionId)
        quietly.add(sessionId)
      } else {
        answering.delete(sessionId)
        quietly.delete(sessionId)
      }"""
if 'nextLatch(said, answering.has' not in s:
    assert old3 in s
    s=s.replace(old3,new3,1)

old4="  const handIn = (sessionId) => {"
if old4+"\n    answering.delete(sessionId)" not in s:
    s=s.replace(old4, old4+"\n    answering.delete(sessionId)",1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
