import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()

old='''/** 开局指令的固定开头，与客户端 openRound 里的一致。 */
const OPEN_PREFIX = '【模拟问诊 · 开局】'
/** 交卷指令：客户端「交卷」按钮发出去的就是这两个字。 */
const HAND_IN = '交卷'
/** 医生只有明确说「交卷」（或点客户端那个按钮）才算交完卷，别的都不动。 */
const HAND_IN_TAIL = /(交卷|交卷了|交卷吧|交答卷|交上答卷)/u

function wantsHandIn(said) {
  const bare = String(said || '').replace(/[\s。．.！!～~，,、？?]+$/u, '')
  if (!bare) return false
  if (bare === HAND_IN) return true
  return bare.length <= 10 && HAND_IN_TAIL.test(bare)
}'''
new='''/** 交卷指令：医生说的这句话里出现「交卷」两个字就算交卷。 */
const HAND_IN = '交卷'
/** 开局指令的固定开头，与客户端 openRound 里的一致。 */
const OPEN_PREFIX = '【模拟问诊 · 开局】'
/** 开头带「模拟问诊」四个字的会话，才算模拟问诊那一局。 */
const OPEN_MARK = /^\s*【?\s*模拟问诊/u

function wantsHandIn(said) {
  return String(said || '').includes(HAND_IN)
}'''
assert old in s
s=s.replace(old,new,1)

old2="""      if (said.startsWith(OPEN_PREFIX)) {"""
new2="""      // 开局认的是「开头带『模拟问诊』」这句话本身，不看这一局的预设认没认出来：
      // 会话刚建好时预设常常还没挂上，靠它认这一局会漏掉。
      if (OPEN_MARK.test(said) || said.startsWith(OPEN_PREFIX)) {"""
assert old2 in s
s=s.replace(old2,new2,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
