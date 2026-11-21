import io
p='lib/sim-think.js'
lines=io.open(p,encoding='utf-8').read().split('\n')
# 删 42..90 行区间（宿主来源、问句规则、shouldMute、nextLatch），即行索引 41..89
# 先确认内容
seg='\n'.join(lines[41:91])
assert 'INJECTED_SOURCE' in seg and 'nextLatch' in seg and 'export function wantsHandIn' not in seg
lines=lines[:41]+lines[91:]
s='\n'.join(lines)
s=s.replace("/** 医生已经开始写答卷的会话：从那一刻起一直闭嘴，直到「交卷」。 */\nconst answering = new Set()\n","")
old="""      // 宿主每一轮都会往会话里塞自己生成的 user/message（预设指令、运行时上下文、子智能体回话、重试等），
      // 那些不是医生打的字，不能拿它们判「有没有提问」，否则医生明明问了，答案还是会被清空。
      const kind = String(event.data?.source?.kind || '')
      if (NOTICE_SOURCE.has(kind)) {
        quietly.add(sessionId)
        return
      }
      if (INJECTED_SOURCE.has(kind)) return
      const said"""
new="""      const said"""
assert old in s
s=s.replace(old,new,1)

old2="""      if (OPEN_MARK.test(said) || said.startsWith(OPEN_PREFIX)) {
        simSessions.add(sessionId)
        lowerSession(sessionId, '这一局先不开思考')
        return
      }"""
new2="""      if (OPEN_MARK.test(said) || said.startsWith(OPEN_PREFIX)) {
        simSessions.add(sessionId)
        quietly.delete(sessionId)
        lowerSession(sessionId, '这一局先不开思考')
        return
      }"""
assert old2 in s
s=s.replace(old2,new2,1)

old3="""      // 闭嘴只按一条：医生这一句没有「问」的意思，就闭嘴。
      // 不再看消息来源、不再看是不是系统通知——通知那种字样本来也没有问的意思，自然闭嘴。
      // 答卷一旦开头就一直闭嘴，直到「交卷」或下一局开局。
      const latched = nextLatch(said, answering.has(sessionId))
      if (latched) {
        answering.add(sessionId)
        quietly.add(sessionId)
      } else {
        answering.delete(sessionId)
        quietly.delete(sessionId)
      }"""
new3="""      // 闭嘴只有一条：医生打的字里出现「答卷」两个字，才从这一轮开始闭嘴；
      // 出现「交卷」就放开。别的来源、别的情形一概不管。
      if (String(said).includes('答卷')) quietly.add(sessionId)
      if (wantsHandIn(said)) quietly.delete(sessionId)"""
assert old3 in s
s=s.replace(old3,new3,1)

s=s.replace("    answering.delete(sessionId)\n","",1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
