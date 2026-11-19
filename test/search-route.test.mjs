import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountSearchRoute } from '../lib/search.js'

const CORPUS = [
  '辨阳明病脉证并治',
  '阳明病，胃家实是也。',
  '',
  '大黄苦寒，主下瘀血，荡涤肠胃，推陈致新，通利水谷，调中化食，安和五脏，脾胃虚弱者慎用。',
  '',
].join('\n')

test('查询路由：GET 固定路径回原文；白话取不到、字不够、查无都在话里说清', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tcm-route-'))
  try {
    await mkdir(join(root, 'text'), { recursive: true })
    await writeFile(join(root, 'text', '03-伤寒论.txt'), CORPUS, 'utf8')

    let route = null
    const ctx = {
      get: (key) => (key === 'webServer' ? { register: (r) => { route = r; return () => { route = null } } } : undefined),
      logger: { info() {}, warn() {} },
    }
    const dispose = await mountSearchRoute(ctx, { path: '/dsh-tcm-xueli/search', rootDir: () => root })
    assert.ok(route, '要在 Web 服务上注册一条路由')
    assert.equal(route.kind, 'exact')
    assert.equal(route.path, '/dsh-tcm-xueli/search')

    const once = (url) => new Promise((resolve) => {
      const res = {
        code: 0,
        body: '',
        writeHead(code) { this.code = code },
        end(body) { this.body = body || ''; resolve(this) },
      }
      route.handler({ method: 'GET', url, headers: { host: '127.0.0.1:59174' }, socket: { remoteAddress: '127.0.0.1' } }, res)
    })

    const hit = await once('/dsh-tcm-xueli/search?q=' + encodeURIComponent('大黄') + '&n=3')
    assert.equal(hit.code, 200)
    const payload = JSON.parse(hit.body)
    assert.equal(payload.ok, true)
    assert.ok(payload.results.length >= 1)
    assert.ok(payload.results[0].original.includes('大黄'))
    assert.equal(payload.results[0].plain, '')
    assert.ok(payload.reason.includes('白话没译出来'))

    const short = await once('/dsh-tcm-xueli/search?q=' + encodeURIComponent('一'))
    assert.equal(JSON.parse(short.body).ok, false)

    const none = await once('/dsh-tcm-xueli/search?q=' + encodeURIComponent('没有这几个字'))
    const noneOut = JSON.parse(none.body)
    assert.equal(noneOut.ok, true)
    assert.equal(noneOut.results.length, 0)

    const post = await new Promise((resolve) => {
      const res = { code: 0, body: '', writeHead(code) { this.code = code }, end(b) { this.body = b || ''; resolve(this) } }
      route.handler({ method: 'POST', url: '/dsh-tcm-xueli/search', headers: { host: '127.0.0.1:59174' }, socket: { remoteAddress: '127.0.0.1' } }, res)
    })
    assert.equal(post.code, 405)

    dispose()
    assert.equal(route, null, '卸载时要把路由摘掉')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('查询路由：只认本机连接，Host 头伪造、缺 Host、坏地址都挡住', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tcm-route-'))
  try {
    await mkdir(join(root, 'text'), { recursive: true })
    await writeFile(join(root, 'text', '03-伤寒论.txt'), CORPUS, 'utf8')
    let route = null
    const ctx = {
      get: (key) => (key === 'webServer' ? { register: (r) => { route = r; return () => { route = null } } } : undefined),
      logger: { info() {}, warn() {} },
    }
    const dispose = await mountSearchRoute(ctx, { path: '/dsh-tcm-xueli/search', rootDir: () => root })
    const ask = (req) => new Promise((resolve) => {
      const res = { code: 0, body: '', writeHead(code) { this.code = code }, end(body) { this.body = body || ''; resolve(this) } }
      route.handler(req, res)
    })
    const fakeHost = await ask({ method: 'GET', url: '/dsh-tcm-xueli/search?q=大黄', headers: { host: '127.0.0.1:1' }, socket: { remoteAddress: '8.8.8.8' } })
    assert.equal(fakeHost.code, 403, '远程连接伪造 Host 也要挡住')
    const noHost = await ask({ method: 'GET', url: '/dsh-tcm-xueli/search?q=大黄', headers: {}, socket: { remoteAddress: '127.0.0.1' } })
    assert.equal(noHost.code, 403, '没有 Host 的直接拒绝')
    const bad = await ask({ method: 'GET', url: '//[::1', headers: { host: '127.0.0.1:1' }, socket: { remoteAddress: '127.0.0.1' } })
    assert.equal(bad.code, 400, '地址坏掉回 400')
    const long = await ask({ method: 'GET', url: '/dsh-tcm-xueli/search?q=' + encodeURIComponent('大黄'.repeat(200)), headers: { host: '127.0.0.1:1' }, socket: { remoteAddress: '127.0.0.1' } })
    assert.equal(long.code, 200, '超长查询词截断后照常查，不报 400')
    dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
