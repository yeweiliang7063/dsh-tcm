import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()

# 1) 模块级登记表 + 导出
anchor="const LOG = '[学理模式·思考开关] '"
add=anchor+'''

/**
 * 这一轮不是医生本人发的（子智能体的完成通知、别的智能体来信之类）时，主模型会被自动叫醒，
 * 然后接着自言自语、把辨证和方子倒出来。问诊期间这种「被叫醒」的一轮一律闭嘴，
 * 由下面的 simQuiet 告诉出口那一层：这一轮正文一个字都不要往外放。
 */
const quietly = new Set()

/** 这一轮要不要闭嘴：只有开过局、还没交卷、且不是医生本人发的消息才算。 */
export function simQuiet(sessionId) {
  if (!sessionId) return false
  return quietly.has(sessionId)
}'''
assert anchor in s
s=s.replace(anchor, add, 1)

# 2) handIn 里清掉
old="    // 交完卷这一局就结束了，之后的聊天不再归这个开关管。\n    simSessions.delete(sessionId)"
new="    // 交完卷这一局就结束了，之后的聊天不再归这个开关管。\n    simSessions.delete(sessionId)\n    quietly.delete(sessionId)"
assert old in s
s=s.replace(old,new,1)

# 3) thinker 里按来源登记
old2="      if (!simSessions.has(sessionId)) return\n      // 还没交卷"
new2='''      if (!simSessions.has(sessionId)) return
      // 这一句是不是医生本人发的：只有 kind 为 user（或没写）才算医生；子智能体完成、别的智能体来信都不算。
      const fromDoctor = (() => {
        const kind = event.data?.source?.kind
        return kind === undefined || kind === 'user' || kind === 'retry'
      })()
      if (fromDoctor) quietly.delete(sessionId)
      else quietly.add(sessionId)
      // 还没交卷'''
assert old2 in s
s=s.replace(old2,new2,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
