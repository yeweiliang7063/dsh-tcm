// 学理模式：随包资料的单元测试
// 验证只补书、不补规程，以及五个分类文件夹的建立。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureAssets, ensureCorpus } from '../lib/corpus.js'
import { ensureCategoryDirs } from '../lib/kb-index.js'

test('ensureCorpus：把十部经典补到 text/，第二次不重复复制', () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'tcm-corpus-'))
  const first = ensureCorpus(kb)
  assert.ok(first >= 10, `应至少复制 10 个文件，实际 ${first}`)
  assert.ok(fs.existsSync(path.join(kb, 'text', '03-伤寒论.txt')))
  assert.ok(fs.existsSync(path.join(kb, 'text', '07-濒湖脉学.txt')))
  assert.ok(fs.existsSync(path.join(kb, 'text', '10-神农本草经.txt')))
  assert.equal(ensureCorpus(kb), 0)
})

test('ensureCorpus：资料库里已有同名文件时不覆盖', () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'tcm-corpus-'))
  const target = path.join(kb, 'text', '03-伤寒论.txt')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, '我自己整理的版本', 'utf8')
  ensureCorpus(kb)
  assert.equal(fs.readFileSync(target, 'utf8'), '我自己整理的版本')
})

test('ensureAssets：学理模式不再往资料库补规程与剂量速查', () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'tcm-assets-'))
  assert.equal(ensureAssets(kb), 0)
  assert.equal(fs.existsSync(path.join(kb, 'skills')), false)
  assert.equal(fs.existsSync(path.join(kb, 'references')), false)
})

test('ensureCategoryDirs：建五个分类文件夹，第二次不重复', () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'tcm-category-'))
  assert.equal(ensureCategoryDirs(kb), 5)
  for (const name of ['经典', '经典注解', '名著', '医案', '方药']) {
    assert.ok(fs.statSync(path.join(kb, name)).isDirectory(), `应建立 ${name}/`)
  }
  assert.equal(ensureCategoryDirs(kb), 0)
})

test('ensureCategoryDirs：资料库不存在时返回 0，不擅自建根目录', () => {
  const kb = path.join(os.tmpdir(), `tcm-category-missing-${Date.now()}`)
  assert.equal(ensureCategoryDirs(kb), 0)
  assert.equal(fs.existsSync(kb), false)
})