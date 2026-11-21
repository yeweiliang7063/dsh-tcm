import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { childOf, insideRoot, normalizeRoot } from '../lib/kb-root.js'

const sep = path.sep

test('库根锁定：根自己与根里的文件都算「在里头」', () => {
  const root = path.join('D:', '中医工作区', '中医经方学习版资料库')
  assert.equal(insideRoot(root, root), true)
  assert.equal(insideRoot(root, path.join(root, '索引.md')), true)
  assert.equal(insideRoot(root, path.join(root, '医案', '一例.md')), true)
  assert.equal(insideRoot(root + sep, path.join(root, 'text')), true)
})

test('库根锁定：名字只差一点、用 .. 往上爬，都算根外', () => {
  const root = path.join('D:', '中医工作区', '中医经方学习版资料库')
  assert.equal(insideRoot(root, root + '-旧'), false)
  assert.equal(insideRoot(root, path.join(root, '..', '别的库')), false)
  assert.equal(insideRoot(root, path.join('D:', '中医工作区')), false)
  assert.equal(insideRoot(root, ''), false)
  assert.equal(insideRoot('', root), false)
})

test('库根锁定：拼子路径时越界就返回空串', () => {
  const root = path.join('D:', '中医工作区', '中医经方学习版资料库')
  assert.equal(childOf(root, '索引.md'), path.join(root, '索引.md'))
  assert.equal(childOf(root, '医案', '一例.md'), path.join(root, '医案', '一例.md'))
  assert.equal(childOf(root, '..', '跑到外面.md'), '')
  assert.equal(childOf('', '索引.md'), '')
})

test('库根锁定：同一路径的斜杠写法归一后相等', () => {
  const a = path.join('D:', '中医工作区', '库')
  const b = 'D:/中医工作区/库/'
  assert.equal(normalizeRoot(a), normalizeRoot(b))
})
