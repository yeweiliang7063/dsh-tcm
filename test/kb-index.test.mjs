// 索引生成测试：临时目录里搭一棵小资料库，验证递归、跳过规则与「无变化不重写」。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { INDEX_FILE, buildIndexMarkdown, writeIndex } from '../lib/kb-index.js'

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-index-'))
  const put = (rel, text) => {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text, 'utf8')
  }
  put('伤寒论.txt', '太阳之为病，脉浮，头项强痛而恶寒。')
  put('text/金匮要略/妇人杂病.txt', '妇人脏躁，喜悲伤欲哭。')
  put('text/针灸甲乙经.txt', '黄帝问曰：余闻九针于夫子。')
  put('医案/某医案.txt', '某，脉弦。')
  put('skills/tcm-jingfang/SKILL.md', '检索规程')
  put('node_modules/pkg/readme.txt', '不该进索引')
  put('.hidden/secret.txt', '不该进索引')
  put(INDEX_FILE, '旧索引')
  return root
}

function makeCategoryTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-cat-'))
  const put = (rel, text) => {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text, 'utf8')
  }
  put('伤寒论.txt', '太阳之为病，脉浮，头项强痛而恶寒。')
  put('金匮要略方论.txt', '金匮正文。')
  put('金匮要略方论讲义.txt', '金匮讲稿。')
  put('伤寒论类方.txt', '类方。')
  put('神农本草经.txt', '本草正文。')
  put('text/06-脉经.txt', '脉为血府。')
  put('3.倪海厦《伤寒论》.txt', '太阳病讲稿。')
  put('胡希恕金匮要略文字版.txt', '金匮讲稿。')
  put('03世补斋医书.txt', '医论。')
  put('医案/某医案.txt', '某，脉弦。')
  put('米晶子——济世良方.txt', '验方。')
  put('名著/金匮要略.txt', '放进同名文件夹应归名著。')
  put('方药/某书.txt', '放进同名文件夹应归方药。')
  return root
}

test('buildIndexMarkdown：递归扫描，路径统一用 /', () => {
  const root = makeTree()
  const built = buildIndexMarkdown(root, new Date('2026-01-02T03:04:00'))
  assert.match(built.markdown, /`text\/金匮要略\/妇人杂病\.txt`/)
  assert.match(built.markdown, /`text\/针灸甲乙经\.txt`/)
  assert.match(built.markdown, /`医案\/某医案\.txt`/)
  assert.match(built.markdown, /`伤寒论\.txt`/)
  assert.equal(built.files.length, 4)
})

test('buildIndexMarkdown：跳过 skills、node_modules、隐藏目录与索引本身', () => {
  const root = makeTree()
  const built = buildIndexMarkdown(root)
  const rels = built.files.map((f) => f.rel).join('\n')
  assert.doesNotMatch(rels, /skills\//)
  assert.doesNotMatch(rels, /node_modules\//)
  assert.doesNotMatch(rels, /\.hidden\//)
  assert.doesNotMatch(rels, /索引\.md/)
})

test('buildIndexMarkdown：大类按文件名归类', () => {
  const root = makeTree()
  const built = buildIndexMarkdown(root)
  assert.ok(built.groups['经典'].some((f) => f.name === '伤寒论.txt'))
  assert.ok(built.groups['经典'].some((f) => f.name === '针灸甲乙经.txt'))
  assert.ok(built.groups['医案'].some((f) => f.name === '某医案.txt'))
})

test('buildIndexMarkdown：按五类编排，同名文件夹优先', () => {
  const built = buildIndexMarkdown(makeCategoryTree())
  const rels = (title) => (built.groups[title] || []).map((f) => f.rel)
  assert.ok(rels('经典').includes('伤寒论.txt'))
  assert.ok(rels('经典').includes('text/06-脉经.txt'))
  assert.ok(rels('经典').includes('金匮要略方论.txt'))
  assert.ok(rels('经典注解').includes('金匮要略方论讲义.txt'))
  assert.ok(rels('经典注解').includes('3.倪海厦《伤寒论》.txt'))
  assert.ok(rels('经典注解').includes('胡希恕金匮要略文字版.txt'))
  assert.ok(rels('名著').includes('03世补斋医书.txt'))
  assert.ok(rels('名著').includes('名著/金匮要略.txt'))
  assert.ok(rels('医案').includes('医案/某医案.txt'))
  assert.ok(rels('方药').includes('米晶子——济世良方.txt'))
  assert.ok(rels('方药').includes('伤寒论类方.txt'))
  assert.ok(rels('方药').includes('神农本草经.txt'))
  assert.ok(rels('方药').includes('方药/某书.txt'))
})

test('writeIndex：写盘后再跑一次不重写文件', () => {
  const root = makeTree()
  const first = writeIndex(root, new Date('2026-01-02T03:04:00'))
  assert.equal(first.changed, true)
  const file = path.join(root, INDEX_FILE)
  const before = fs.statSync(file).mtimeMs
  const second = writeIndex(root, new Date('2026-01-02T04:05:00'))
  assert.equal(second.changed, false)
  assert.equal(fs.statSync(file).mtimeMs, before)
})

test('writeIndex：根目录不存在时不写盘、返回 root-missing', () => {
  const result = writeIndex(path.join(os.tmpdir(), 'qh-not-exist-' + Date.now()))
  assert.equal(result.changed, false)
  assert.equal(result.reason, 'root-missing')
})
