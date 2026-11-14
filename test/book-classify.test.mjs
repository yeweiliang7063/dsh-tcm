import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyBook } from '../lib/book-classify.js'

const CASES = [
  ['伤寒论原文', { name: '伤寒论', text: '太阳之为病，脉浮，头项强痛而恶寒。' }, '经典'],
  ['讲义', { name: '胡希恕伤寒论讲座', text: '这一条讲的是太阳病，老师上课时特别强调。' }, '经典注解'],
  ['作者名讲稿', { name: '倪海厦黄帝内经', text: '' }, '经典注解'],
  ['金匮要略方论是原文', { name: '金匮要略方论', text: '' }, '经典'],
  ['类方是方书', { name: '伤寒论类方', text: '' }, '方药'],
  ['后世医书', { name: '世补斋医书', text: '' }, '名著'],
  ['医案', { name: '人纪医案', text: '初诊：某男，发热恶寒，服药后汗出。' }, '医案'],
  ['本草', { name: '神农本草经', text: '本草味苦，主寒热。' }, '方药'],
  ['浅释', { name: '黄帝外经浅释', text: '' }, '经典注解'],
  ['讲本草的讲稿仍归注解', { name: '3.倪海厦神农本草经', text: '本草味苦，主寒热。' }, '经典注解'],
  ['名著讲义仍归注解', { name: '金匮要略方论讲义', text: '' }, '经典注解'],
  ['桂林古本', { name: '桂林古本伤寒杂病论', text: '' }, '经典'],
  ['脉经', { name: '脉经', text: '' }, '经典'],
  ['濒湖脉学', { name: '濒湖脉学', text: '' }, '经典'],
  ['类案', { name: '名医类案', text: '' }, '医案'],
  ['看不出类别', { name: '随手笔记', text: '今天天气不错，出去走走。' }, '其他'],
  ['正文是讲义', { name: '伤寒论', text: '这一条讲的是太阳病，老师上课时特别强调。' }, '经典注解'],
]

for (const [label, book, expected] of CASES) {
  test('classifyBook：' + label + ' → ' + expected, () => {
    const result = classifyBook(book)
    assert.equal(result.category, expected)
    if (expected !== '其他') assert.ok(result.score >= 5)
  })
}

test('classifyBook：空输入不硬归类', () => {
  const result = classifyBook({})
  assert.equal(result.category, '其他')
  assert.equal(result.score, 0)
})
