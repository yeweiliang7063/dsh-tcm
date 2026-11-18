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

test('defaultKbPath：不预设资料库目录，任何平台都返回空串', () => {
  assert.equal(defaultKbPath(), '')
  assert.equal(defaultKbPath(winLegacy), '')
  assert.equal(defaultKbPath(win), '')
  assert.equal(defaultKbPath(mac), '')
  assert.equal(defaultKbPath(linux), '')
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
test('normalizeRoot：盘符相对写法按没填好处理，不拿整盘当资料库', () => {
  const win = { platform: 'win32', path: path.win32, home: String.raw`C:\Users\zhangsan` }
  assert.equal(normalizeRoot('C:', win), '')
  assert.equal(normalizeRoot('C:中医知识库', win), '')
  assert.equal(normalizeRoot(String.raw`C:\中医知识库`, win), String.raw`C:\中医知识库`)
});
