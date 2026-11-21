import io
p='test/stream.test.mjs'
s=io.open(p,encoding='utf-8').read()
s=s.replace("      const looksTcmPrompt = deps.looksTcmPrompt || (() => false)","      const looksTcmPrompt = deps.looksTcmPrompt || (() => false)\n      const simQuiet = deps.simQuiet || (() => false)",1)
s=s.replace("    looksTcmPrompt: overrides.looksTcmPrompt,","    looksTcmPrompt: overrides.looksTcmPrompt,\n    simQuiet: overrides.simQuiet,",1)
s+='''
test('被系统通知叫醒的一轮：文字清空，工具块照旧转发', async () => {
  const run = makeStream(readFileSync(INDEX, 'utf8'), { simQuiet: () => true })([
    START,
    TEXT('我是旁白，不该出现。'),
    { type: 'tool-call', index: 1, name: 'send_message', input: { text: '你好' } },
    { type: 'block-end', index: 0, block: { type: 'text', text: '我是旁白，不该出现。' } },
    { type: 'usage', tokens: 5 },
    { type: 'finish', reason: 'stop' },
  ])
  const out = await collect(run)
  assertAllBlocksLegal(out, '闭嘴的一轮')
  const texts = out.filter((c) => c.type === 'text-delta').map((c) => c.text)
  assert.deepEqual(texts, [], '闭嘴的一轮不许往外发正文')
  for (const c of out) {
    if (c.block && typeof c.block.text === 'string') assert.equal(c.block.text, '', '正文块末的全文也要清空')
  }
  const call = out.find((c) => c.type === 'tool-call')
  assert.ok(call, '工具块不许丢：丢了宿主会报 unknown tool')
  assert.equal(call.name, 'send_message')
})
'''
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
