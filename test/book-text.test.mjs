import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractBookText } from '../lib/book-text.js'

function crc32() {
  return 0 // 读取端不校验 CRC，测试夹具用 0 即可。
}

/** 造一个最小的 store 模式 ZIP，够 docx/epub 测试用。 */
function makeZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const raw = Buffer.from(file.data, 'utf8')
    // file.deflate 为真时按 deflate 压缩存进去：大条目走的是解压上限那条分支。
    const data = file.deflate ? deflateRawSync(raw) : raw
    const method = file.deflate ? 8 : 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc32(raw), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const localFull = Buffer.concat([local, name, data])
    locals.push(localFull)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc32(raw), 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, name]))
    offset += localFull.length
  }
  const directory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, directory, eocd])
}

test('extractBookText：UTF-8 文本与 Markdown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qh-text-'))
  try {
    const file = join(dir, '伤寒论.txt')
    writeFileSync(file, '太阳之为病，脉浮，头项强痛而恶寒。', 'utf8')
    assert.match(extractBookText(file), /太阳之为病/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('extractBookText：docx 解包 word/document.xml', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qh-text-'))
  try {
    const file = join(dir, '讲义.docx')
    const xml = '<w:document><w:body><w:p><w:r><w:t>这一条讲的是太阳病</w:t></w:r></w:p></w:body></w:document>'
    writeFileSync(file, makeZip([{ name: 'word/document.xml', data: xml }]))
    assert.match(extractBookText(file), /这一条讲的是太阳病/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('extractBookText：epub 读 XHTML 正文', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qh-text-'))
  try {
    const file = join(dir, '医案.epub')
    const html = '<html><body><p>初诊：某男，发热恶寒。</p></body></html>'
    writeFileSync(file, makeZip([{ name: 'OEBPS/ch1.xhtml', data: html }]))
    assert.match(extractBookText(file), /初诊：某男/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('extractBookText：PDF 读 Title 元数据', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qh-text-'))
  try {
    const file = join(dir, 'book.pdf')
    writeFileSync(file, Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title ('),
      Buffer.from('伤寒论', 'utf8'),
      Buffer.from(') >>\nendobj\n%%EOF\n'),
    ]))
    assert.match(extractBookText(file), /伤寒论/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('extractBookText：读不到的格式返回空字符串', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qh-text-'))
  try {
    const file = join(dir, '旧书.doc')
    writeFileSync(file, 'not really a doc')
    assert.equal(extractBookText(file), '')
    assert.equal(extractBookText(join(dir, '不存在.pdf')), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('extractBookText：正文超过 4MB 的 docx 不能变成空', () => {
  // 回归用例：解压上限原来是 4MB，word/document.xml 一超标就抛
  // ERR_BUFFER_TOO_LARGE，被 catch 吞成空字符串，整本书只能靠书名归类。
  const dir = mkdtempSync(join(tmpdir(), 'qh-text-'))
  try {
    const file = join(dir, '长讲义.docx')
    const body = '太阳病脉证并治'.repeat(400000) // 约 5MB
    const xml = '<w:document><w:body><w:p><w:r><w:t>这一条讲的是太阳病</w:t></w:r></w:p></w:body></w:document>'
    writeFileSync(file, makeZip([{ name: 'word/document.xml', data: xml + body, deflate: true }]))
    assert.match(extractBookText(file), /这一条讲的是太阳病/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
});
