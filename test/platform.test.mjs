// 跨平台路径工具测试：用 node:test + 注入 path 实现，在任意平台模拟 Windows / POSIX。
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { defaultKbPath, expandHome, normalizeRoot, toDisplayPath } from '../lib/platform.js'

const win = {
  path: path.win32,
  platform: 'win32',
  home: 'C:\\Users\\张三',
  exists: () => false,
}
const winLegacy = { ...win, exists: () => true }
const mac = {
  path: path.posix,
  platform: 'darwin',
  home: '/Users/zhangsan',
  exists: () => false,
}
const linux = {
  path: path.posix,
  platform: 'linux',
  home: '/home/zhangsan',
  exists: () => false,
}

test('defaultKbPath：Windows 上有 D:\\中医知识库 就沿用', () => {
  assert.equal(defaultKbPath(winLegacy), 'D:\\中医知识库')
})

test('defaultKbPath：Windows 上没有 D 盘老目录时用主目录', () => {
  assert.equal(defaultKbPath(win), path.win32.join('C:\\Users\\张三', '中医知识库'))
})

test('defaultKbPath：macOS / Linux 用主目录下的 中医知识库', () => {
  assert.equal(defaultKbPath(mac), '/Users/zhangsan/中医知识库')
  assert.equal(defaultKbPath(linux), '/home/zhangsan/中医知识库')
})

test('expandHome：~、~/、~\\ 按平台展开', () => {
  assert.equal(expandHome('~', mac), '/Users/zhangsan')
  assert.equal(expandHome('~/书', mac), '/Users/zhangsan/书')
  assert.equal(expandHome('~\\书', win), 'C:\\Users\\张三\\书')
  // POSIX 上反斜杠是合法文件名字符，不能当分隔符
  assert.equal(expandHome('~\\书', mac), '~\\书')
  assert.equal(expandHome('  ', mac), '')
  assert.equal(expandHome('/absolute/书', mac), '/absolute/书')
})

test('normalizeRoot：去掉末尾分隔符，根目录保留', () => {
  assert.equal(normalizeRoot('C:\\中医知识库\\', win), 'C:\\中医知识库')
  assert.equal(normalizeRoot('C:\\中医知识库\\\\', win), 'C:\\中医知识库')
  assert.equal(normalizeRoot('C:\\', win), 'C:\\')
  assert.equal(normalizeRoot('/home/zhangsan/中医知识库/', linux), '/home/zhangsan/中医知识库')
  assert.equal(normalizeRoot('/', linux), '/')
})

test('normalizeRoot：展开 ~ 并转绝对路径', () => {
  assert.equal(normalizeRoot('~/中医知识库', linux), '/home/zhangsan/中医知识库')
  assert.equal(normalizeRoot('~/中医知识库/', mac), '/Users/zhangsan/中医知识库')
  assert.equal(normalizeRoot('', mac), '')
})

test('toDisplayPath：Windows 反斜杠转正斜杠，POSIX 原样', () => {
  assert.equal(toDisplayPath('C:\\中医知识库\\text\\伤寒论.md', win), 'C:/中医知识库/text/伤寒论.md')
  assert.equal(toDisplayPath('/home/zhangsan/中医知识库/text/伤寒论.md', linux), '/home/zhangsan/中医知识库/text/伤寒论.md')
})
