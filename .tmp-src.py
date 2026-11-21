import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()
old="""      if (event.type !== 'user/message') return
      const said = textOf(event.data?.content).trim()
      if (!said) return"""
new="""      if (event.type !== 'user/message') return
      // 宿主每一轮都会往会话里塞自己生成的 user/message（预设指令、运行时上下文、子智能体回话、重试等），
      // 那些不是医生打的字，不能拿它们判「有没有提问」，否则医生明明问了，答案还是会被清空。
      if (INJECTED_SOURCE.has(String(event.data?.source?.kind || ''))) return
      const said = textOf(event.data?.content).trim()
      if (!said) return"""
assert old in s
s=s.replace(old,new,1)

anchor="/** 医生这句话有没有「问」的意思"
add='''/** 宿主自己注入的 user/message 来源，不是医生打的字。 */
const INJECTED_SOURCE = new Set([
  'agent-instructions',
  'runtime-context',
  'subagent',
  'subagent-settled',
  'retry',
  'goal',
  'compaction',
  'system',
  'developer',
])

'''
assert anchor in s
s=s.replace(anchor, add+anchor, 1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
