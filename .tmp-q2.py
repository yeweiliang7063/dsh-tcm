import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()

# 1) 加「有没有提问的意思」判定
anchor="function wantsHandIn(said) {"
add='''/** 医生这句话有没有「问」的意思：有就转病人，模型照着转；没问就是他在答题，模型闭嘴。 */
const ASK_TAIL = /(吗|呢|么|没有|是不是|要不要|有没有|会不会|能不能|怎么|怎样|如何|多少|几天|多久|哪个|哪边|哪些|还是|多长|多重)[\s。！!～~，,、]*$/u
const ASK_HEAD = /^(请问|问一下|问一句|再问|还想问|想问)/u
const ASK_ACTION = /(伸出|伸舌头|张嘴|张口|抬手|把手|伸手|露出|撸起|撩起|按一下|摸一下|搭一下|看看|瞧一眼|让我看|让我摸|让我看看|我来摸|我摸)/u

export function looksQuestion(said) {
  const text = String(said || '').trim()
  if (!text) return false
  if (text.includes('？') || text.includes('?')) return true
  if (ASK_TAIL.test(text)) return true
  if (ASK_HEAD.test(text)) return true
  if (ASK_ACTION.test(text)) return true
  return false
}

'''
assert anchor in s
s=s.replace(anchor, add+anchor, 1)

# 2) 闭嘴改成按「有没有问」判
old='''      // 这一句是不是医生本人发的：只有 kind 为 user（或没写）才算医生；子智能体完成、别的智能体来信都不算。
      // 只有「子智能体结束」这一类通知才算不是医生在说话；其余（医生本人敲的、
      // 诊室面板代发的开局与交卷、带自定义 source 的）一律当医生本人。
      const fromDoctor = (event.data?.source?.kind !== 'subagent-settled')
      if (fromDoctor) quietly.delete(sessionId)
      else quietly.add(sessionId)'''
new='''      // 闭嘴与否只看医生这句话有没有「问」的意思：
      // - 子智能体结束这类通知：不是医生在说话，闭嘴；
      // - 医生在问、在要病人配合、或者打了「交卷」：照常说话；
      // - 医生在答题（陈述、写病机治法方药穴位、整段分析）：闭嘴，正文一个字都不往外放。
      const kind = event.data?.source?.kind
      const ask = looksQuestion(said) || wantsHandIn(said)
      if (kind === 'subagent-settled' || !ask) quietly.add(sessionId)
      else quietly.delete(sessionId)'''
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
