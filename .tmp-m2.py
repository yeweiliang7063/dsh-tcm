import io
p='lib/index.js'
s=io.open(p,encoding='utf-8').read()
s=s.replace("import { createSimThinker } from './sim-think.js'","import { createSimThinker, simQuiet } from './sim-think.js'",1)

old="""        // 提醒真的发出去了，正文才整体往后挪一位（提醒占 0 号块）；没发提醒就一切照旧。"""
new="""        // 这一轮是不是被「子智能体已完成」这类通知叫醒的：问诊期间这种回合一律不出声，
        // 正文一个字都不往外放（思考本来就已经压到最低，这里只挡文字）。
        let simMute = false
        try {
          simMute = simQuiet(options?.sessionId)
        } catch (error) {
          simMute = false
        }
        // 提醒真的发出去了，正文才整体往后挪一位（提醒占 0 号块）；没发提醒就一切照旧。"""
assert old in s
s=s.replace(old,new,1)

old2="""          if (typeof chunk.index === 'number') {
            const effective = chunk.index + (noticePushed ? 1 : 0)"""
new2="""          // 闭嘴的一轮：正文块照开照收，但文字全部清空；结束块与正文块末的全文也要清，
          // 免得宿主最后按 block-end 里的全文把这一整段又显示出来。
          if (simMute) {
            if (chunk.type === 'text-delta') {
              lastChunk = chunk
              continue
            }
            if (chunk.type === 'block-end' && chunk.block && typeof chunk.block.text === 'string') {
              yield shift({ ...chunk, block: { ...chunk.block, text: '' } })
              continue
            }
            if (chunk.type === 'block-start' || chunk.type === 'finish' || chunk.type === 'usage') {
              yield shift(chunk)
              continue
            }
            continue
          }
          if (typeof chunk.index === 'number') {
            const effective = chunk.index + (noticePushed ? 1 : 0)"""
assert old2 in s
s=s.replace(old2,new2,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
