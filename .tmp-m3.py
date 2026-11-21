import io
p='lib/index.js'
s=io.open(p,encoding='utf-8').read()
old='''          if (simMute) {
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
          }'''
new='''          if (simMute) {
            // 只清文字，别的块一个都不许丢：工具调用的 name/参数也走在这些块里，
            // 漏掉就会变成宿主那边「Error: unknown tool」的空名字调用。
            if (chunk.type === 'text-delta') {
              lastChunk = chunk
              continue
            }
            if (typeof chunk.index === 'number') {
              const effective = chunk.index + (noticePushed ? 1 : 0)
              if (effective > maxSeen) maxSeen = effective
            }
            if (chunk.block && typeof chunk.block.text === 'string') {
              yield shift({ ...chunk, block: { ...chunk.block, text: '' } })
              continue
            }
            if (typeof chunk.text === 'string') {
              yield shift({ ...chunk, text: '' })
              continue
            }
            yield shift(chunk)
            continue
          }'''
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
