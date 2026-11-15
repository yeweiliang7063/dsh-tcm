// 出口输出的流块必须是对象，而且 text 必须是字符串。
// 宿主累加器遇到两类毛病都会让整轮回答作废：
//   1. 收到裸字符串 → unreachable variant in AssistantStreamAccumulator.push
//   2. text-delta 的 text 不是字符串 → text-delta text must be a string
//
// 光做静态扫描挡不住第二类：代码里写的是 yield delta(chunk, piece)，看着没问题，
// 但如果 take() 已经返回对象、外面又套一层 delta，text 就变成了对象。
//
// 所以这里把源码里 llm/stream 的生成器体原样抠出来真跑一遍，喂假流块进去，
// 逐个检查发出来的东西。剂量判定用真的 dosage-guard，不造假替身——
// 替身会把要验证的分支整个绕过去，测了也白测。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hasDosage, blotDosage } from '../lib/dosage-guard.js'

const INDEX = join(import.meta.dirname, '..', 'lib', 'index.js')

function streamBlock(src) {
  const start = src.indexOf("ctx.on('llm/stream'")
  const end = src.indexOf('出口校验注册失败', start)
  assert.ok(start > 0 && end > start, '源码里找不到 llm/stream 出口校验段')
  return src.slice(start, end)
}

/** 从源码里抠出 llm/stream 的回调体，做成一个可调用的异步生成器。 */
function makeStream(src) {
  const start = src.indexOf("ctx.on('llm/stream'")
  const head = src.indexOf('async function* inspect(options, next) {', start)
  assert.ok(head > 0, '找不到 inspect 生成器')
  const bodyStart = src.indexOf('{', head) + 1

  let depth = 1
  let i = bodyStart
  while (i < src.length && depth > 0) {
    const c = src[i]
    if (c === '{') depth += 1
    else if (c === '}') depth -= 1
    i += 1
  }
  const body = src.slice(bodyStart, i - 1)

  // 真实代码里 verdict() 调的是模块作用域的 tcmVerdict，不是从 deps 拿的。
  // 这里把它换成「确定是中医会话」，其余一行不动，这样剂量分支才会被执行到。
  const patched = body.replace(
    'const verdict = () => tcmVerdict(ctx, options?.sessionId, name)',
    'const verdict = () => ({ decided: true, tcm: true })',
  )
  assert.notEqual(patched, body, '源码里找不到 verdict 定义，测试需要跟着改')

  const harness = `
    return (async function* (options, next, deps) {
      const { hasDosage, blotDosage, ctx, name, SCAN_WINDOW } = deps
      ${patched}
    })
  `
  const factory = new Function(harness)()
  const deps = {
    hasDosage,
    blotDosage,
    ctx: { logger: { warn() {} }, on() {} },
    name: 'dsh-tcm',
    SCAN_WINDOW: 600,
  }
  return (chunks) => {
    async function* source() {
      for (const c of chunks) yield c
    }
    return factory({ sessionId: 's1' }, source, deps)
  }
}

async function collect(iter) {
  const out = []
  for await (const chunk of iter) out.push(chunk)
  return out
}

function assertAllBlocksLegal(out, label) {
  assert.ok(out.length > 0, label + '：一个块都没发出来')
  for (const chunk of out) {
    assert.equal(typeof chunk, 'object', label + '：发出来的是裸值 ' + JSON.stringify(chunk))
    assert.ok(chunk !== null, label + '：发出来的是 null')
    assert.equal(typeof chunk.type, 'string', label + '：块缺少 type ' + JSON.stringify(chunk))
    if (chunk.type === 'text-delta') {
      assert.equal(
        typeof chunk.text,
        'string',
        label + '：text-delta 的 text 不是字符串（多半是套了两层 delta）→ ' + JSON.stringify(chunk),
      )
    }
  }
}

const TEXT = (t) => ({ type: 'text-delta', index: 0, text: t })
const END = [
  { type: 'block-end', index: 0 },
  { type: 'usage', tokens: 10 },
  { type: 'finish', reason: 'stop' },
]

test('流块类型：llm/stream 里不许 yield 裸字符串字面量', () => {
  const block = streamBlock(readFileSync(INDEX, 'utf8'))
  const bare = [...block.matchAll(/yield\s+('[^']*'|"[^"]*"|`[^`]*`)/g)].map((m) => m[1])
  assert.deepEqual(bare, [], 'llm/stream 里不许 yield 裸字符串：' + bare.join(', '))
})

test('流块类型：普通长回答，每块合法、正文完整', async () => {
  const run = makeStream(readFileSync(INDEX, 'utf8'))([
    { type: 'block-start', index: 0 },
    TEXT('这是第一句。'),
    TEXT('这是第二句，还没写完'),
    TEXT('。'),
    ...END,
  ])
  const out = await collect(run)
  assertAllBlocksLegal(out, '普通回答')

  const joined = out.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')
  assert.equal(joined, '这是第一句。这是第二句，还没写完。')
  assert.ok(out.some((c) => c.type === 'finish'), 'finish 块被吞了')
})

test('流块类型：命中剂量被挖掉，剩下的仍是合法块', async () => {
  // 这条走的是「命中剂量 → blotDosage 挖掉 → 继续发」那条分支，
  // 早期版本正是在这条分支上把对象又包了一层，报 text-delta text must be a string。
  const run = makeStream(readFileSync(INDEX, 'utf8'))([
    { type: 'block-start', index: 0 },
    TEXT('这是辨证思路，正常一句。'),
    TEXT('桂枝三两，芍药三两。'),
    TEXT('后面还有正常的思路。'),
    ...END,
  ])
  const out = await collect(run)
  assertAllBlocksLegal(out, '命中剂量')

  const joined = out.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')
  assert.ok(joined.includes('这是辨证思路'), '正常句被误伤了：' + joined)
  assert.ok(joined.includes('后面还有正常的思路'), '正常句被误伤了：' + joined)
  assert.ok(!joined.includes('三两'), '剂量没挖干净：' + joined)
  assert.ok(joined.includes('✳'), '挖掉的地方应该留个标记：' + joined)
})

test('流块类型：剂量跨段、整段挖掉时也不许把对象又包一层', async () => {
  // 这条是 2.2.2 线上真实崩过的场景，报错原文：
  //   TypeError: text-delta text must be a string
  // 成因：take() 里「整段挖掉」那条分支 yield 的是已经包好的对象，
  // 外层又对它做了一次 delta(base, piece)，text 就成了对象。
  // 触发条件：上一段带着剂量语境（进了 tail），这一段本身没有剂量。
  const run = makeStream(readFileSync(INDEX, 'utf8'))([
    { type: 'block-start', index: 0 },
    TEXT('桂枝三两。'),
    TEXT('这是下一句。'),
    ...END,
  ])
  const out = await collect(run)
  assertAllBlocksLegal(out, '剂量跨段')

  const joined = out.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')
  assert.ok(!joined.includes('三两'), '剂量没挖干净：' + joined)
})

test('流块类型：正文一直没收尾，靠结束块收走也不出问题', async () => {
  const run = makeStream(readFileSync(INDEX, 'utf8'))([
    TEXT('这句话没有句末标点'),
    ...END,
  ])
  const out = await collect(run)
  assertAllBlocksLegal(out, '收尾块')

  const joined = out.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')
  assert.equal(joined, '这句话没有句末标点')
})