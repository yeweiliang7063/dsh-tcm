import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()
old_set = s[s.index("/** 宿主自己注入的 user/message 来源"):s.index("/** 医生这句话有没有「问」的意思")]
new_set = '''/** 宿主自己注入、只是陪跑上下文的 user/message：不是医生打的字，不拿它们判问不问。 */
const INJECTED_SOURCE = new Set([
  'agent-instructions',
  'runtime-context',
  'retry',
  'goal',
  'compaction',
  'system',
  'developer',
])

/** 子智能体回来叫醒的这一轮：那一轮本来就不该开口，直接闭嘴；但别动医生上一句的判断结果。 */
const NOTICE_SOURCE = new Set(['subagent', 'subagent-settled'])

'''
s=s.replace(old_set,new_set,1)

old="""      if (INJECTED_SOURCE.has(String(event.data?.source?.kind || ''))) return"""
new="""      const kind = String(event.data?.source?.kind || '')
      if (NOTICE_SOURCE.has(kind)) {
        quietly.add(sessionId)
        return
      }
      if (INJECTED_SOURCE.has(kind)) return"""
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
