import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { autoFileBooks } from '../lib/auto-file.js'

const CATEGORIES = ['经典', '经典注解', '名著', '医案', '方药']

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'qh-auto-'))
  for (const title of CATEGORIES) mkdirSync(join(root, title), { recursive: true })
  return root
}

function writeBook(root, name, text) {
  const path = join(root, name)
  writeFileSync(path, text, 'utf8')
  return path
}

function loggerSpy() {
  const messages = []
  return {
    messages,
    info: (...args) => messages.push(String(args[0])),
    warn: (...args) => messages.push(String(args[0])),
  }
}

test('autoFileBooks：按正文与书名移到对应文件夹', () => {
  const root = makeRoot()
  try {
    writeBook(root, '伤寒论.txt', '太阳之为病，脉浮，头项强痛而恶寒。')
    writeBook(root, '胡希恕伤寒论讲座.txt', '这一条讲的是太阳病，老师上课时特别强调。')
    writeBook(root, '人纪医案.txt', '初诊：某男，发热恶寒，服药后汗出。')
    writeBook(root, '神农本草经.txt', '本草味苦，主寒热，气味平。')
    writeBook(root, '世补斋医书.txt', '卷一 论曰：医者意也。')
    writeBook(root, '随手笔记.txt', '今天天气不错，出去走走。')

    const result = autoFileBooks(root, { logger: loggerSpy(), minAgeMs: 0, now: Date.now() + 1000 })

    assert.equal(result.moved, 5)
    assert.equal(result.unclassified, 1)
    assert.equal(existsSync(join(root, '经典', '伤寒论.txt')), true)
    assert.equal(existsSync(join(root, '经典注解', '胡希恕伤寒论讲座.txt')), true)
    assert.equal(existsSync(join(root, '医案', '人纪医案.txt')), true)
    assert.equal(existsSync(join(root, '方药', '神农本草经.txt')), true)
    assert.equal(existsSync(join(root, '名著', '世补斋医书.txt')), true)
    assert.equal(existsSync(join(root, '随手笔记.txt')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('autoFileBooks：同名不覆盖，自动加序号', () => {
  const root = makeRoot()
  try {
    writeFileSync(join(root, '经典', '伤寒论.txt'), '已有内容', 'utf8')
    writeBook(root, '伤寒论.txt', '太阳之为病，脉浮。')

    const result = autoFileBooks(root, { minAgeMs: 0, now: Date.now() + 1000 })

    assert.equal(result.moved, 1)
    assert.equal(readFileSync(join(root, '经典', '伤寒论.txt'), 'utf8'), '已有内容')
    assert.equal(existsSync(join(root, '经典', '伤寒论-2.txt')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('autoFileBooks：同名的不同格式作为一组移动', () => {
  const root = makeRoot()
  try {
    writeBook(root, '某书.txt', '太阳之为病，脉浮。')
    writeBook(root, '某书.md', '# 太阳之为病\n\n脉浮。')

    const result = autoFileBooks(root, { minAgeMs: 0, now: Date.now() + 1000 })

    assert.equal(result.moved, 2)
    assert.equal(existsSync(join(root, '经典', '某书.txt')), true)
    assert.equal(existsSync(join(root, '经典', '某书.md')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('autoFileBooks：刚写入的文件先不动', () => {
  const root = makeRoot()
  try {
    writeBook(root, '新书.txt', '太阳之为病，脉浮。')
    const result = autoFileBooks(root, { minAgeMs: 60000, now: Date.now() })
    assert.equal(result.moved, 0)
    assert.equal(existsSync(join(root, '新书.txt')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('autoFileBooks：索引、说明与隐藏文件不移动', () => {
  const root = makeRoot()
  try {
    writeBook(root, '索引.md', '太阳之为病')
    writeBook(root, 'README.md', '太阳之为病')
    writeBook(root, 'SKILL.md', '太阳之为病')
    writeBook(root, '.hidden.txt', '太阳之为病')
    writeBook(root, '~$temp.docx', '太阳之为病')

    const result = autoFileBooks(root, { minAgeMs: 0, now: Date.now() + 1000 })

    assert.equal(result.moved, 0)
    for (const name of ['索引.md', 'README.md', 'SKILL.md', '.hidden.txt', '~$temp.docx']) {
      assert.equal(existsSync(join(root, name)), true)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('autoFileBooks：根目录不存在时安全返回', () => {
  const result = autoFileBooks(join(tmpdir(), 'qh-not-exists-' + Date.now()), { minAgeMs: 0 })
  assert.deepEqual(result, { moved: 0, groups: 0, unclassified: 0 })
})
