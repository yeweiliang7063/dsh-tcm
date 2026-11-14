// 出口输出的流块必须是对象：宿主累加器 switch(chunk.type) 遇到字符串会抛
// unreachable variant in AssistantStreamAccumulator.push，整轮回答作废。
// 用静态断言盯住：llm/stream 生成器里每一条 yield 都必须是流块对象。
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

test('流块类型：收尾块与挖掉标记都必须是对象', async () => {
  // 直接读源码做静态断言：生成器里的 yield 不许出现裸字符串字面量
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(join(import.meta.dirname, '..', 'lib', 'index.js'), 'utf8')
  const start = src.indexOf("ctx.on('llm/stream'")
  const end = src.indexOf('出口校验注册失败', start)
  const block = src.slice(start, end)
  const bare = [...block.matchAll(/yield\s+('[^']*'|"[^"]*"|`[^`]*`)/g)].map((m) => m[1])
  assert.deepEqual(bare, [], 'llm/stream 里不许 yield 裸字符串：' + bare.join(', '))
})
