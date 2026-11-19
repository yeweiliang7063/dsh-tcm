/**
 * 学习版 · 资料查询
 *
 * 面板里输入一句话或一个词，这边回两样东西：
 *   1. 原文：从资料库的经典原文里按关键词找出来的段落，附出处；
 *   2. 白话：把这批原文交给当前默认模型，逐段译成大白话。
 *
 * 检索是纯本地的（不联网、不花钱）；白话翻译要调一次模型，调不动就只回原文，
 * 由面板提示「白话没译出来」，绝不假装译过。
 *
 * 整段都包在 try/catch 里：这一路失败只等于查询页不好用，不影响主体启动。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** 查原文只扫这几个子目录里的 .txt / .md。 */
export const CORPUS_DIRS = ['text', '名著', '经典注解']

/** 一段话短于这个长度就不算一段（多半是标题目录）；长于这个长度就切。 */
const MIN_LEN = 24
const MAX_LEN = 900

/** 把文本压成「无空白、无标点」的形式，方便按字找。 */
export function squash(text) {
  return String(text || '').replace(/[\s　]/g, '')
}

/** 目录名去掉编号前缀和扩展名，留书名。 */
export function bookName(file) {
  return String(file)
    .replace(/\.(txt|md)$/i, '')
    .replace(/^\d+[-_．.]?\s*/, '')
    .trim()
}

/** 篇名：短行、以「篇／论／法／脉证并治／病脉证治」收尾的那一行。 */
function isHeading(line) {
  const t = line.trim()
  if (!t || t.length > 28) return false
  return /(篇|论|法|脉证并治|病脉证治|证并治)(第[一二三四五六七八九十百]+)?$/.test(t)
}

/**
 * 把一个文件切成一段一段的原文，顺手记住它属于哪一篇。
 * @param {string} file 文件名
 * @param {string} raw 文件内容
 * @returns {{source: string, text: string}[]}
 */
export function splitPassages(file, raw) {
  const book = bookName(file)
  const lines = String(raw || '').split(/\r?\n/)
  const out = []
  let heading = ''
  let buf = []
  const flush = () => {
    const text = buf.join('').trim()
    buf = []
    if (text.length < MIN_LEN) return
    // 超长段（一整篇没断行）按句号切，免得一段几千字塞爆面板。
    if (text.length <= MAX_LEN) {
      out.push({ source: heading ? book + ' · ' + heading : book, text })
      return
    }
    const parts = text.split(/(?<=[。！？；])/)
    let piece = ''
    for (const part of parts) {
      if (piece.length + part.length > MAX_LEN && piece) {
        out.push({ source: heading ? book + ' · ' + heading : book, text: piece })
        piece = ''
      }
      piece += part
    }
    if (piece.trim().length >= MIN_LEN) {
      out.push({ source: heading ? book + ' · ' + heading : book, text: piece.trim() })
    }
  }
  for (const line of lines) {
    if (!line.trim()) { flush(); continue }
    if (isHeading(line)) { flush(); heading = line.trim(); continue }
    buf.push(line.trim())
  }
  flush()
  return out
}

/** 从句子里挑出搜索用的两字词组；中文按两字滑窗，够用又不容易漏。 */
export function grams(query) {
  const clean = squash(query).replace(/[，。！？、；：「」『』（）()《》〈〉·,.;:!?"'“”‘’\-—…]/g, '')
  if (!clean) return []
  const out = []
  if (clean.length <= 2) {
    out.push(clean)
    return out
  }
  for (let i = 0; i < clean.length - 1; i += 1) {
    const g = clean.slice(i, i + 2)
    if (!out.includes(g)) out.push(g)
  }
  // 整句也当一个长词组，命中整句的段落排最前。
  out.unshift(clean)
  return out
}

/** 一段原文命中多少个词组：整句命中给大分，两字词组各给一分。 */
export function scoreText(text, list) {
  if (!list.length) return 0
  let score = 0
  const phrase = list[0]
  if (phrase && text.indexOf(phrase) >= 0) score += 20 + phrase.length * 2
  for (let i = 0; i < list.length; i += 1) {
    const g = list[i]
    if (!g || g === phrase) continue
    let from = 0
    let hits = 0
    while (hits < 8) {
      const at = text.indexOf(g, from)
      if (at < 0) break
      hits += 1
      from = at + g.length
    }
    score += hits * 2
  }
  return score
}

/** 按句号、问号、感叹号切句，给「挑最贴题的一句」用。 */
function sentences(text) {
  return String(text || '').split(/(?<=[。！？；])/).filter((x) => x.trim() !== '')
}

/**
 * 在一段里挑出最贴题的一句，带上前一句做上下文，别把整段 900 字甩出去。
 * @returns {{text: string, score: number}}
 */
export function bestWindow(text, list) {
  const parts = sentences(text)
  if (parts.length <= 1) return { text: String(text || '').trim(), score: scoreText(text, list) }
  let bestAt = 0
  let bestScore = -1
  for (let i = 0; i < parts.length; i += 1) {
    const sc = scoreText(parts[i], list)
    if (sc > bestScore) { bestScore = sc; bestAt = i }
  }
  let out = parts[bestAt]
  if (out.length < 80 && parts[bestAt + 1]) out += parts[bestAt + 1]
  if (out.length < 40 && parts[bestAt - 1]) out = parts[bestAt - 1] + out
  return { text: out.trim(), score: bestScore }
}

/** 读到内存里的一套原文；资料库大时也只读一次。 */
export async function loadCorpus(rootDir) {
  const all = []
  for (const dirName of CORPUS_DIRS) {
    const dir = path.join(rootDir, dirName)
    let names = []
    try { names = await fs.readdir(dir) } catch { continue }
    for (const name of names) {
      if (!/\.(txt|md)$/i.test(name)) continue
      if (name === '索引.md') continue
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8')
        all.push(...splitPassages(name, raw))
      } catch { /* 单个坏文件跳过 */ }
    }
  }
  return all
}

/** 一顿乱输（空、纯符号）就别搜了。 */
export function usableQuery(query) {
  return squash(query).replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '').length >= 2
}

/**
 * 在一套原文里按词找段落：先按整句命中挑出最贴题的那一句，
 * 再按「命中分 ÷ 长度」排，短的、密的排前面。
 * @param {{source: string, text: string}[]} corpus
 * @param {string} query
 * @param {number} limit
 */
export function findPassages(corpus, query, limit = 6) {
  if (!usableQuery(query)) return []
  const list = grams(query)
  const scored = []
  for (const item of corpus) {
    const win = bestWindow(item.text, list)
    if (win.score <= 0) continue
    const density = win.score / Math.sqrt(Math.max(12, win.text.length))
    scored.push({ source: item.source, text: win.text, rank: density })
  }
  scored.sort((a, b) => b.rank - a.rank)
  const out = []
  const seen = new Set()
  for (const hit of scored) {
    const key = squash(hit.text).slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ source: hit.source, text: hit.text })
    if (out.length >= limit) break
  }
  return out
}

/** 本草类书名：查单味药时，只从这些书里找条目。 */
const HERB_BOOK = /本草/

/** 把一段本草原文拆成「原文／性味／功效／产地」。 */
export function parseHerbText(text) {
  const t = String(text || '').trim()
  const head = t.split(/[：:]\s*/)[0] || ''
  const flavor = /味\s*([^，。；]{1,12})[，、]\s*(微温|微寒|温|热|寒|凉|平)/.exec(t)
  const effect = /(主|治)\s*([^。]{2,120})。/.exec(t)
  const origin = /生\s*([^。；，]{1,24})/.exec(t)
  const aliases = [...t.matchAll(/一名\s*([^。；，]{1,10})/g)].map((m) => m[1].trim())
  return {
    head: head.trim(),
    nature: flavor ? ('味' + flavor[1] + '，' + flavor[2]) : '',
    effect: effect ? (effect[2] + '。') : '',
    origin: origin ? origin[1].trim() : '',
    aliases,
    original: (flavor || effect ? t : ''),
  }
}

/**
 * 查单味药：在本草类书里找以这味药开头的条目（也认「一名某某」的别名）。
 * @param {{source: string, text: string}[]} corpus
 * @param {string} query
 * @param {number} limit
 */
export function findHerbEntries(corpus, query, limit = 4) {
  const name = squash(query)
  if (!/^[一-龥]{1,6}$/.test(name)) return []
  const out = []
  for (const item of corpus) {
    if (!HERB_BOOK.test(item.source)) continue
    const parsed = parseHerbText(item.text)
    if (!parsed.original) continue
    const names = [parsed.head].concat(parsed.aliases)
    if (!names.some((one) => one === name)) continue
    out.push({
      source: item.source,
      original: parsed.original,
      meta: {
        nature: parsed.nature,
        effect: parsed.effect,
        origin: parsed.origin,
        alias: parsed.aliases.filter((one) => one !== name).join('、'),
      },
    })
    if (out.length >= limit) break
  }
  return out
}

const PLAIN_SYSTEM = [
  '你是中医古籍的白话翻译。用户会给你若干段带编号的原文，',
  '请逐段译成现代汉语大白话：一句原文对一句白话，尽量照着原文说，不添加原文没有的内容。',
  '每段只用一行，格式是「【编号】白话」，编号与原文一致；不要译成文言，不要加解释、不要加标题。',
].join('')

/** 把检索到的原文逐段译成白话；模型不可用就返回 null。 */
export async function translate(ctx, passages, timeoutMs = 20000) {
  if (!passages.length) return null
  const pick = typeof ctx.get === 'function' ? ctx.get.bind(ctx) : () => undefined
  const llm = pick('llm')
  const models = pick('agentDefaultModel')
  const select = models && typeof models.currentSelection === 'function' ? models.currentSelection() : null
  if (!llm || typeof llm.stream !== 'function' || !select || !select.provider || !select.model) return null
  const body = passages.map((p, i) => '【' + (i + 1) + '】' + p.text).join('\n\n')
  const message = {
    role: 'user',
    id: randomUUID(),
    source: { kind: 'user' },
    content: [{ type: 'text', text: body }],
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(3000, Number(timeoutMs) || 20000))
  let text = ''
  try {
    const stream = llm.stream({
      provider: select.provider,
      model: select.model,
      system: PLAIN_SYSTEM,
      messages: [message],
      maxTokens: 1600,
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
  const out = new Map()
  for (const line of text.split(/\r?\n/)) {
    const hit = /^\s*【\s*(\d+)\s*】\s*(.+)$/.exec(line)
    if (hit) out.set(Number(hit[1]), hit[2].trim())
  }
  if (out.size === 0) return null
  return passages.map((p, i) => out.get(i + 1) || '')
}

/**
 * 开一条只读查询通道给面板用：挂在 DSH 本机 Web 服务的固定路径上，浏览器直接 fetch。
 * @param {object} ctx 插件 context
 * @param {{rootDir: () => string, path?: string, log?: string}} options
 */
export async function mountSearchRoute(ctx, options) {
  const log = options.log || '[资料查询]'
  const routePath = options.path || '/dsh-tcm-xueli/search'
  let corpus = null
  let corpusAt = 0
  let corpusKey = ''

  const ensureCorpus = async () => {
    const root = options.rootDir ? options.rootDir() : ''
    if (!root) return []
    if (corpus && corpusKey === root && Date.now() - corpusAt < 60000) return corpus
    corpus = await loadCorpus(root)
    corpusAt = Date.now()
    corpusKey = root
    return corpus
  }

  /** 查一次：先回原文，能译就带上白话。 */
  const runQuery = async (raw, rawLimit) => {
    const n = Math.max(1, Math.min(12, Number(rawLimit) || 6))
    const text = String(raw === undefined || raw === null ? '' : raw)
    if (!usableQuery(text)) {
      return { ok: false, reason: '请至少输入两个字，比如「便秘」「少阴病」「肝主疏泄」。', results: [] }
    }
    const all = await ensureCorpus()
    if (!all.length) {
      return { ok: false, reason: '资料库里没读到原文，先到设置页确认资料库路径。', results: [] }
    }
    /* 单味药先查本草条目：原文、性味、功效、产地一次给全。 */
    const herbs = findHerbEntries(all, text, Math.min(n, 4))
    if (herbs.length) {
      return { ok: true, reason: '', results: herbs.map((one) => ({ ...one, plain: '' })) }
    }
    const hits = findPassages(all, text, n)
    if (!hits.length) {
      return { ok: true, reason: '原文里没找到这几个字，换个说法或换一味药、一个证名试试。', results: [] }
    }
    let plains = null
    try { plains = await translate(ctx, hits) } catch { plains = null }
    const results = hits.map((hit, i) => ({
      source: hit.source,
      original: hit.text,
      plain: plains ? plains[i] || '' : '',
    }))
    return {
      ok: true,
      reason: plains ? '' : '白话没译出来（模型这会儿没响应），先看原文。',
      results,
    }
  }

  let webServer = ctx.get ? ctx.get('webServer') : undefined
  /* Web 服务可能比本插件晚就位：最多等十秒，等不到就明说，不硬撑。 */
  for (let i = 0; i < 20 && (!webServer || typeof webServer.register !== 'function'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    webServer = ctx.get ? ctx.get('webServer') : undefined
  }
  if (!webServer || typeof webServer.register !== 'function') {
    throw new Error('这台 DSH 没有 Web 服务，查不了')
  }

  const dispose = webServer.register({
    kind: 'exact',
    path: routePath,
    handler: async (req, res) => {
      const send = (code, payload) => {
        const body = JSON.stringify(payload)
        res.writeHead(code, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(body),
        })
        res.end(body)
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      // 只认真正的本机连接：Host 头是客户端随便写的，光看它挡不住远程伪造。
      const remote = String((req.socket && req.socket.remoteAddress) || '')
      const host = String(req.headers.host || '')
      const fromThisMachine = /^(127\.|::1$|::ffff:127\.)/.test(remote)
      const hostIsLocal = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)
      if (!fromThisMachine || !hostIsLocal) {
        send(403, { ok: false, reason: '只接受本机页面的查询。', results: [] })
        return
      }
      let url
      try {
        url = new URL(req.url || '/', 'http://127.0.0.1')
      } catch {
        send(400, { ok: false, reason: '查询参数看不懂。', results: [] })
        return
      }
      try {
        const q = String(url.searchParams.get('q') || '').slice(0, 200)
        send(200, await runQuery(q, url.searchParams.get('n')))
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        ctx.logger?.warn?.(log + '查询出错：' + message)
        send(200, { ok: false, reason: '查询没跑通：' + message, results: [] })
      }
    },
  })

  ctx.logger?.info?.(log + '查询通道已开：' + routePath)
  return () => {
    try { dispose?.() } catch (error) {
      ctx.logger?.warn?.(log + '关闭查询通道出错：' + String(error && error.message ? error.message : error))
    }
  }
}