import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()

# 1) 加锁存集合
old="const quietly = new Set()"
new="const quietly = new Set()\n/** 医生已经开始写答卷的会话：从那一刻起一直闭嘴，直到「交卷」。 */\nconst answering = new Set()"
assert old in s
s=s.replace(old,new,1)

# 2) shouldMute 改成看锁存状态的入口
old2='''/** 这一句要不要闭嘴：没有提问的意思就闭嘴；开局指令与交卷不是「答题」，照常说话。 */
export function shouldMute(said) {
  const text = String(said || '').trim()
  if (!text) return false
  if (wantsHandIn(text)) return false
  if (OPEN_MARK.test(text) || text.startsWith(OPEN_PREFIX)) return false
  return !looksQuestion(text)
}'''
new2='''/** 这一句要不要闭嘴：没有提问的意思就闭嘴；开局指令与交卷不是「答题」，照常说话。 */
export function shouldMute(said) {
  const text = String(said || '').trim()
  if (!text) return false
  if (wantsHandIn(text)) return false
  if (OPEN_MARK.test(text) || text.startsWith(OPEN_PREFIX)) return false
  return !looksQuestion(text)
}

/**
 * 医生开始写答卷：一旦这一句没有提问的意思，就当答卷开了头，从这一轮到「交卷」为止一律闭嘴。
 * 中间就算再补一句问话也不再放出来——答卷是连贯的一整段，放出一句就把后面的答法剧透了。
 */
export function nextLatch(said, latched) {
  const text = String(said || '').trim()
  if (!text) return latched
  if (wantsHandIn(text) || OPEN_MARK.test(text) || text.startsWith(OPEN_PREFIX)) return false
  if (latched) return true
  return !looksQuestion(text)
}'''
assert old2 in s
s=s.replace(old2,new2,1)

old3="""      if (shouldMute(said)) quietly.add(sessionId)
      else quietly.delete(sessionId)"""
new3="""      // 答卷一旦开头就一直闭嘴，直到「交卷」或下一局开局；不是答卷才按这一句问不问来定。
      const latched = nextLatch(said, answering.has(sessionId))
      if (latched) {
        answering.add(sessionId)
        quietly.add(sessionId)
      } else {
        answering.delete(sessionId)
        quietly.delete(sessionId)
      }"""
assert old3 in s
s=s.replace(old3,new3,1)

# 3) 交卷入 handIn 时要清锁存
old4="""  const handIn = function (sessionId) {"""
i=s.index(old4)
s=s[:i]+old4+"\n    answering.delete(sessionId)"+s[i+len(old4):]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
