/**
 * 书籍正文取样器（纯 Node，无第三方依赖）
 *
 * 自动归类只需要判断「这本书大概在讲什么」，不需要完整解析。
 * 这里只取前 160 KB 正文：
 * - .txt / .md / .html：直接读文本（UTF-8 / GB18030 自动识别）
 * - .docx / .epub：按 ZIP 解包，读 document.xml 或 XHTML
 * - .pdf：尽力抽文字层与 /Title、/Author；扫描件抽不到就返回空
 * - .doc：旧二进制格式不解析，交给文件名兜底
 *
 * 任何一步失败都返回空字符串，绝不把异常抛给归类流程。
 */
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { inflateRawSync } from 'node:zlib'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TEXT = 160 * 1024
const MAX_ZIP_ENTRY = 4 * 1024 * 1024
const MAX_PDF_STREAM = 2 * 1024 * 1024

/** 文本解码：优先 UTF-8，失败再试 GB18030，最后退回 latin1。 */
export function decodeBytes(buffer) {
  if (!buffer || buffer.length === 0) return ''
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3))
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2))
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch (error) {
    try {
      return new TextDecoder('gb18030').decode(buffer)
    } catch (error2) {
      return buffer.toString('latin1')
    }
  }
}

/** 解码 XML / HTML 实体。 */
function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)) } catch { return '' }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(Number(dec)) } catch { return '' }
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 去掉 Word / XHTML 标记，保留段落换行。 */
export function stripMarkup(xml) {
  return decodeEntities(
    String(xml)
      .replace(/<w:tab\b[^>]*\/?>/gi, '\t')
      .replace(/<w:br\b[^>]*\/?>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<br\b[^>]*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** 找 ZIP 中央目录结尾（EOCD）。 */
function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 65557)
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

/** 读 ZIP 中央目录；不是 ZIP 或损坏时返回空数组。 */
function readZipEntries(buffer) {
  const eocd = findEocd(buffer)
  if (eocd < 0) return []
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count && i < 20000; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const nameEnd = offset + 46 + nameLength
    if (nameEnd > buffer.length) break
    entries.push({
      name: buffer.toString('utf8', offset + 46, nameEnd),
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    })
    offset = nameEnd + extraLength + commentLength
  }
  return entries
}

/** 解压单个 ZIP 条目；只支持 store / deflate。 */
function readZipEntry(buffer, entry) {
  const local = entry.localOffset
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) return null
  const nameLength = buffer.readUInt16LE(local + 26)
  const extraLength = buffer.readUInt16LE(local + 28)
  const start = local + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (start < 0 || end > buffer.length) return null
  const compressed = buffer.subarray(start, end)
  try {
    if (entry.method === 0) return compressed.subarray(0, MAX_ZIP_ENTRY)
    if (entry.method === 8) {
      return inflateRawSync(compressed, { maxOutputLength: MAX_ZIP_ENTRY })
    }
  } catch (error) {
    return null
  }
  return null
}

function docxText(buffer) {
  const entries = readZipEntries(buffer)
  const entry = entries.find((item) => item.name === 'word/document.xml')
  if (!entry) return ''
  const raw = readZipEntry(buffer, entry)
  return raw ? stripMarkup(raw.toString('utf8')) : ''
}

function epubText(buffer) {
  const entries = readZipEntries(buffer)
  const pages = entries
    .filter((item) => /\.(xhtml|html|htm)$/i.test(item.name) && !/(^|\/)(nav|toc|cover)\./i.test(item.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  let text = ''
  for (const page of pages) {
    const raw = readZipEntry(buffer, page)
    if (!raw) continue
    text += stripMarkup(raw.toString('utf8')) + '\n'
    if (text.length >= MAX_TEXT) break
  }
  return text.slice(0, MAX_TEXT)
}

/** 解析 PDF 字面量字符串里的转义。 */
function parsePdfLiteral(raw) {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    if (code !== 0x5c) {
      out += raw[i]
      continue
    }
    i += 1
    if (i >= raw.length) break
    const next = raw[i]
    if (next === 'n') out += '\n'
    else if (next === 'r') out += '\r'
    else if (next === 't') out += '\t'
    else if (next === 'b') out += '\b'
    else if (next === 'f') out += '\f'
    else if (next === '(' || next === ')' || next === '\\') out += next
    else if (next >= '0' && next <= '7') {
      let octal = next
      for (let k = 0; k < 2 && i + 1 < raw.length; k += 1) {
        const more = raw[i + 1]
        if (more >= '0' && more <= '7') {
          octal += more
          i += 1
        } else break
      }
      out += String.fromCharCode(parseInt(octal, 8))
    } else if (next === '\n' || next === '\r') {
      // 行尾续行
    } else out += next
  }
  return out
}

function decodePdfString(raw) {
  const buffer = Buffer.from(raw, 'latin1')
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2))
    if (swapped.length % 2 === 1) return raw
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch (error) {
    return raw
  }
}

/** 抽 PDF 的 /Title 与 /Author；抽不到返回空。 */
function pdfMetadata(buffer) {
  const latin = buffer.subarray(0, Math.min(buffer.length, MAX_FILE_BYTES)).toString('latin1')
  const parts = []
  for (const key of ['Title', 'Author']) {
    const re = new RegExp('/' + key + '\\s*\\(((?:\\\\.|[^\\\\()])*)\\)', 'i')
    const match = re.exec(latin)
    if (match) {
      const value = decodePdfString(parsePdfLiteral(match[1]))
      if (value.trim()) parts.push(value.trim())
    }
  }
  return parts.join(' ')
}

/** 尽力抽 PDF 文字层；扫描件、CID 字体乱码时可能返回空。 */
function pdfStreamText(buffer) {
  const latin = buffer.subarray(0, Math.min(buffer.length, MAX_FILE_BYTES)).toString('latin1')
  let text = ''
  let from = 0
  for (let streamCount = 0; streamCount < 32 && from < latin.length; streamCount += 1) {
    const marker = latin.indexOf('stream', from)
    if (marker < 0) break
    const before = latin.slice(Math.max(0, marker - 600), marker)
    const start = marker + 6
    const end = latin.indexOf('endstream', start)
    if (end < 0) break
    from = end + 9
    if (/\bendstream\s*$/.test(before.slice(-20))) continue
    let data = buffer.subarray(start, end)
    if (data.length > MAX_PDF_STREAM) data = data.subarray(0, MAX_PDF_STREAM)
    let decoded = data
    if (/\/FlateDecode\b/.test(before)) {
      try {
        decoded = inflateRawSync(data, { maxOutputLength: MAX_PDF_STREAM })
      } catch (error) {
        continue
      }
    }
    const content = decoded.toString('latin1')
    const literal = /\((?:\\.|[^\\()])*\)/g
    let match
    while ((match = literal.exec(content)) !== null) {
      const piece = parsePdfLiteral(match[0].slice(1, -1))
      if (piece.trim()) text += piece
      if (text.length >= MAX_TEXT) break
    }
    if (text.length >= MAX_TEXT) break
  }
  // 抽出来没有可读汉字/字母时，当作没抽到，避免把二进制噪声当正文。
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  if (cjk < 20 && letters < 80) return ''
  return text
}

function pdfText(buffer) {
  const metadata = pdfMetadata(buffer)
  const body = pdfStreamText(buffer)
  return (metadata + '\n' + body).trim()
}

/**
 * 取一本书的可读正文样本；失败返回空字符串。
 * @param {string} filePath
 * @returns {string}
 */
export function extractBookText(filePath) {
  let buffer
  try {
    buffer = readFileSync(filePath)
  } catch (error) {
    return ''
  }
  if (buffer.length > MAX_FILE_BYTES) buffer = buffer.subarray(0, MAX_FILE_BYTES)
  const ext = extname(filePath).toLowerCase()
  try {
    if (ext === '.txt' || ext === '.md') return decodeBytes(buffer).slice(0, MAX_TEXT)
    if (ext === '.html' || ext === '.htm') return stripMarkup(decodeBytes(buffer)).slice(0, MAX_TEXT)
    if (ext === '.docx') return docxText(buffer).slice(0, MAX_TEXT)
    if (ext === '.epub') return epubText(buffer).slice(0, MAX_TEXT)
    if (ext === '.pdf') return pdfText(buffer).slice(0, MAX_TEXT)
  } catch (error) {
    return ''
  }
  return ''
}
