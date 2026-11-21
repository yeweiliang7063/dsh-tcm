import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mountDashangRoute, DASHANG_FILES, DASHANG_PREFIX, DASHANG_TIP, dashangBlock, dashangHandler, dashangImageUrl, needsGift } from '../lib/dashang.js'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** 喂一次假请求，回 { code, body, headers }。 */
function call(url, { method = 'GET', remote = '127.0.0.1', host = '127.0.0.1:59174' } = {}) {
  return new Promise((resolve) => {
    const out = { code: 0, body: '', headers: {} }
    const res = {
      writeHead(code, headers) { out.code = code; Object.assign(out.headers, headers || {}) },
      end(body) { out.body = body === undefined ? '' : body; resolve(out) },
    }
    dashangHandler({ method, url, headers: { host }, socket: { remoteAddress: remote } }, res)
  })
}

/** 装一次通道，拿到注册出来的路由。 */
async function mount() {
  const routes = []
  const ctx = {
    get: (key) => (key === 'webServer'
      ? { register: (r) => { routes.push(r); return () => { routes.splice(routes.indexOf(r), 1) } } }
      : undefined),
    logger: { info() {}, warn() {} },
  }
  const dispose = await mountDashangRoute(ctx)
  return { routes, dispose }
}

test('打赏码：两张图在包里，且都是真 JPG', () => {
  assert.deepEqual(DASHANG_FILES, ['alipay.jpg', 'wechat.jpg'])
  for (const name of DASHANG_FILES) {
    const file = path.join(ROOT, 'assets', 'dashang', name)
    assert.ok(fs.existsSync(file), `缺图：${file}`)
    const head = fs.readFileSync(file).subarray(0, 2)
    assert.equal(head[0], 0xff, `${name} 不是 JPG`)
    assert.equal(head[1], 0xd8, `${name} 不是 JPG`)
  }
})

test('打赏码：注册两条固定路由，地址与提示词里的图片地址一致', async () => {
  const { routes, dispose } = await mount()
  assert.equal(routes.length, 2)
  assert.deepEqual(routes.map((r) => r.path).sort(), DASHANG_FILES.map((n) => DASHANG_PREFIX + n).sort())
  for (const route of routes) {
    assert.equal(route.kind, 'exact')
    assert.equal(typeof route.handler, 'function')
  }
  dispose()
  assert.equal(routes.length, 0, '关掉后路由要摘掉')
})

test('打赏码：本机 GET 回图，字节与源文件一致；HEAD 只回头不回身', async () => {
  for (const name of DASHANG_FILES) {
    const got = await call(DASHANG_PREFIX + name)
    assert.equal(got.code, 200)
    assert.equal(got.headers['content-type'], 'image/jpeg')
    const source = fs.readFileSync(path.join(ROOT, 'assets', 'dashang', name))
    assert.equal(Buffer.byteLength(got.body), source.length)
    assert.ok(Buffer.from(got.body).equals(source), `${name} 字节不一致`)

    const head = await call(DASHANG_PREFIX + name, { method: 'HEAD' })
    assert.equal(head.code, 200)
    assert.equal(head.body, '')
  }
})

test('打赏码：陌生文件名、目录穿越都回 404，不泄露目录', async () => {
  for (const url of [
    DASHANG_PREFIX + 'tupian.jpg',
    DASHANG_PREFIX + '..%2F..%2Fpackage.json',
    DASHANG_PREFIX + '',
    DASHANG_PREFIX,
  ]) {
    const got = await call(url)
    assert.equal(got.code, 404, url)
    assert.ok(!String(got.body).includes('alipay'), url)
  }
})

test('打赏码：非本机来源回 403，别的写法回 405', async () => {
  const remote = await call(DASHANG_PREFIX + 'alipay.jpg', { remote: '192.168.1.7' })
  assert.equal(remote.code, 403)
  const foreignHost = await call(DASHANG_PREFIX + 'alipay.jpg', { host: 'evil.example.com' })
  assert.equal(foreignHost.code, 403)
  const post = await call(DASHANG_PREFIX + 'alipay.jpg', { method: 'POST' })
  assert.equal(post.code, 405)
})

test('打赏区：网址带实时端口，拿不到端口退回相对地址', () => {
  const server = { config: { host: '127.0.0.1' }, listenedPort: 59403 }
  assert.equal(dashangImageUrl(server, 'alipay.jpg'), 'http://127.0.0.1:59403' + DASHANG_PREFIX + 'alipay.jpg')
  assert.equal(dashangImageUrl({ config: { host: '127.0.0.1', port: 59123 } }, 'wechat.jpg'), 'http://127.0.0.1:59123' + DASHANG_PREFIX + 'wechat.jpg')
  assert.equal(dashangImageUrl(undefined, 'alipay.jpg'), DASHANG_PREFIX + 'alipay.jpg')
  assert.equal(dashangImageUrl(server, 'tupian.jpg'), '')
})

test('打赏区：整段只有两张码、自愿说明和分隔线', () => {
  const text = dashangBlock({ config: { host: '127.0.0.1', port: 59403 } })
  assert.ok(text.startsWith('---'))
  assert.ok(text.includes(DASHANG_TIP))
  assert.equal((text.match(/!\[/g) || []).length, 2)
  assert.ok(text.includes('http://127.0.0.1:59403' + DASHANG_PREFIX + 'alipay.jpg'))
  assert.ok(text.includes('打赏全凭自愿'))
})

test('打赏区：给了分析就补，问诊轮与转话不补', () => {
  const nl = String.fromCharCode(10)
  assert.equal(needsGift('**结论**：太阳病'), true)
  assert.equal(needsGift('  '+nl+'**结论**：太阳病'), true)
  assert.equal(needsGift('**方向**（脉证不全）：太阳病'), true)
  assert.equal(needsGift('**方向**（脉证不全，按您要求不再追问）：太阳病'), true)
  assert.equal(needsGift('## 手上的线索'+nl+'够定的是：……'), false)
  assert.equal(needsGift('病人说：夜里睡不着'), false)
  assert.equal(needsGift(''), false)
})
