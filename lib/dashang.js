/**
 * 学理模式 · 打赏码通道
 *
 * 回答结尾要摆两张收款码（支付宝、微信）。图片不能从本地路径直接给浏览器看——
 * 那得开 file:// 外链，既不安全也常被拦；所以由插件自己开一条只读通道，
 * 把 assets/dashang/ 下的两张图按固定地址发出去，页面与插件同源，
 * 相对地址 /dsh-tcm-xueli/dashang/alipay.jpg 直接就能显示。
 *
 * 只发这两张图，不认目录遍历、不认其它文件名；只接受本机页面。
 * 整条通道都是可选的：挂不上只等于打赏码显示不出来，不影响问诊与出方。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 图片目录（随包 assets/dashang）。 */
export const DASHANG_DIR = path.join(HERE, '..', 'assets', 'dashang')
/** 对外地址前缀：与 lib/search.js 的查询通道同一套命名。 */
export const DASHANG_PREFIX = '/dsh-tcm-xueli/dashang/'

/** 只认这两张，文件名一律小写比对；不在这里的一律 404。 */
export const DASHANG_FILES = ['alipay.jpg', 'wechat.jpg']
/** 打赏区的标题行：代码按这一句判断「这段加过了」，别再重复加。 */
export const DASHANG_TIP = '**这一节要是帮到你，可以请作者喝杯茶：**'

/** 一张图的响应体：读盘失败返回 null，由调用方回 404。 */
export function readDashangImage(name) {
  const key = String(name || '').toLowerCase()
  if (!DASHANG_FILES.includes(key)) return null
  const file = path.join(DASHANG_DIR, key)
  try {
    return fs.readFileSync(file)
  } catch {
    return null
  }
}

/** 请求是否来自本机页面（与查询通道同一套判断）。 */
export function fromThisMachine(req) {
  const remote = String((req.socket && req.socket.remoteAddress) || '')
  const host = String(req.headers.host || '')
  const localRemote = /^(127\.|::1$|::ffff:127\.)/.test(remote)
  const localHost = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)
  return localRemote && localHost
}

/** 单次请求处理：纯函数式，方便单测直接喂假 req / res。 */
export function dashangHandler(req, res) {
  const method = String(req.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  if (!fromThisMachine(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('只接受本机页面读取。')
    return
  }
  let url
  try {
    url = new URL(req.url || '/', 'http://127.0.0.1')
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  const raw = url.pathname.startsWith(DASHANG_PREFIX) ? url.pathname.slice(DASHANG_PREFIX.length) : ''
  const name = path.basename(decodeURIComponent(raw || ''))
  const body = readDashangImage(name)
  if (!body) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('没有这张图。')
    return
  }
  res.writeHead(200, {
    'content-type': 'image/jpeg',
    'content-length': body.length,
    'cache-control': 'public, max-age=86400',
  })
  res.end(method === 'HEAD' ? undefined : body)
}

/**
 * 把打赏码通道挂到 Web 服务上；返回一个关闭函数。
 * Web 服务比插件晚就位是常态，最多等十秒。
 */
export async function mountDashangRoute(ctx) {
  if (!ctx || typeof ctx.get !== 'function') throw new Error('没有可用的插件上下文')
  let webServer = ctx.get('webServer')
  for (let i = 0; i < 20 && (!webServer || typeof webServer.register !== 'function'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    webServer = ctx.get('webServer')
  }
  if (!webServer || typeof webServer.register !== 'function') {
    throw new Error('这台 DSH 没有 Web 服务，打赏码发不出去')
  }
  const disposes = []
  for (const name of DASHANG_FILES) {
    disposes.push(webServer.register({ kind: 'exact', path: DASHANG_PREFIX + name, handler: dashangHandler }))
  }
  ctx.logger?.info?.('学理模式：打赏码通道已开：' + DASHANG_PREFIX)
  return () => {
    for (const dispose of disposes) {
      try { dispose?.() } catch { /* 进程退出会一起回收 */ }
    }
  }
}
/* ── 由代码追加的打赏区（模型不写，省得它改网址、改措辞） ── */

/**
 * 打赏码的完整网址。宿主只认两种图片写法：绝对 http(s) 网址，或绝对本地路径；
 * 相对路径会被当成「盘符根下的相对路径」去找文件，最后一律显示「图片无法预览」。
 * 端口取当前 Web 服务实际监听的端口：DSH 每次重开端口都会变，写死等于必裂。
 */
export function dashangImageUrl(webServer, file) {
  const name = String(file || '')
  if (!DASHANG_FILES.includes(name)) return ''
  let base = ''
  try {
    const port = Number(webServer?.listenedPort || webServer?.config?.port)
    const rawHost = String(webServer?.config?.host || '127.0.0.1')
    const host = rawHost === '0.0.0.0' || rawHost === '::' || rawHost === '' ? '127.0.0.1' : rawHost
    if (Number.isFinite(port) && port > 0) {
      base = host.includes(':') ? `http://[${host}]:${port}` : `http://${host}:${port}`
    }
  } catch {
    base = ''
  }
  // 拿不到端口就退回相对地址：宁可这一张图裂，也不把假网址写进回答。
  return base + DASHANG_PREFIX + name
}

/**
 * 打赏区的整段 Markdown：分隔线、标题、两张码、一句自愿的话。
 * rounds 给了就在标题下多一句「已满多少局」，让医生知道这一块为什么这会儿才出来。
 */
export function dashangBlock(webServer, rounds) {
  const nth = Number(rounds)
  const lines = [
    '---',
    '',
    DASHANG_TIP,
    ...(Number.isFinite(nth) && nth > 0 ? ['', `（十局一摆：模拟问诊到这里已经判完 ${nth} 局。）`] : []),
    '',
    `![支付宝打赏码](${dashangImageUrl(webServer, 'alipay.jpg')})`,
    '',
    `![微信打赏码](${dashangImageUrl(webServer, 'wechat.jpg')})`,
    '',
    '打赏全凭自愿，跟辨证结论、方子好坏都没关系，不打赏也照常把话讲完。',
  ]
  return lines.join('\n')
}
