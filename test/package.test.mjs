// 随包契约测试：把「发出去的包里到底有什么」钉死。
// 这几条不测业务，只防回归——漏发目录、引用空文件、依赖声明打架、少一本经典。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const has = (rel) => fs.existsSync(path.join(ROOT, rel))

test('清单：bundle 补丁与 exports 指向的文件真的在盘上', () => {
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.ok(has('cordis.patch.yml'), 'dsh.bundle.patch 指向的补丁不存在')
  for (const [key, target] of Object.entries(pkg.exports || {})) {
    assert.ok(has(target), `exports["${key}"] 指向的 ${target} 不存在`)
  }
})

test('清单：发布白名单覆盖运行时要用的目录', () => {
  for (const dir of ['lib/', 'corpus/', 'assets/']) {
    assert.ok(pkg.files.includes(dir), `files 白名单里少了 ${dir}`)
  }
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'files 里少了 cordis.patch.yml')
  assert.ok(!pkg.files.some((x) => x.startsWith('test')), '测试目录不该随包发')
})

test('清单：schemastery 是运行时校验器，只放 dependencies，别再声明成 peer', () => {
  assert.ok(pkg.dependencies?.['@deepseek-ai/schemastery'], 'schemastery 必须在 dependencies')
  assert.ok(pkg.dependencies?.yaml, 'yaml 必须在 dependencies')
  assert.equal(pkg.peerDependencies?.['@deepseek-ai/schemastery'], undefined, 'schemastery 不该同时写进 peerDependencies')
})

test('随包十部经典齐全：少一本就算回归', () => {
  const want = [
    '01-黄帝内经素问.txt',
    '02-黄帝内经灵枢.txt',
    '03-伤寒论.txt',
    '04-金匮要略.txt',
    '05-针灸甲乙经.txt',
    '06-脉经.txt',
    '07-濒湖脉学.txt',
    '08-八十一难经.txt',
    '09-桂林古本伤寒杂病论.txt',
    '10-神农本草经.txt',
  ]
  const got = fs.readdirSync(path.join(ROOT, 'corpus')).filter((f) => f.endsWith('.txt')).sort()
  assert.deepEqual(got, want, 'corpus/ 里的经典与清单对不上')
})

test('预设提示词：口径锁只有一个来源，也不引用随包里没有的规程', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8').replace(/!!js\s+/g, '')
  const rows = YAML.parseDocument(raw).toJS()[0].insert
  const prefix = rows.find((row) => row.id === 'preset-tcm').config.plugins[0].config.prefix

  assert.ok(prefix.trimStart().startsWith('{{tcm_gear_guard}}'), '口径锁应由 {{tcm_gear_guard}} 展开')
  assert.ok(!prefix.includes('【学理模式·总纲'), '口径锁正文只留在 lib/gear.js，提示词里别再手抄一份')

  // 提示词里点到的手册路径，要么在仓库根，要么在 assets/ 下，不许指向空文件让模型白找。
  assert.ok(prefix.includes('{{tcm_xueli_wuyun}}'), '五运六气应由代码算好后注入')
  for (const book of ['《黄帝内经》《难经》', '《伤寒论》《金匮要略》', '《脉经》《濒湖脉学》', '《针灸甲乙经》', '《神农本草经》', '桂林古本']) {
    assert.ok(prefix.includes(book), `九部书调用表缺「${book}」`)
  }
  assert.ok(!prefix.includes('六层法度'), '旧的六层法度已由四类调用取代')
  const refs = prefix.match(/(?:skills|references)\/[^\s，。；、）)】]+/g) || []
  for (const ref of refs) {
    assert.ok(has(ref) || has(path.join('assets', ref)), `提示词引用了随包里没有的文件：${ref}`)
  }
})