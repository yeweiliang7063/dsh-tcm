import test from 'node:test'
import assert from 'node:assert/strict'
import { seasonOf, seasonText } from '../lib/season.js'

test('时令：夏天在夏至到小暑之间', () => {
  const r = seasonOf(new Date(2026, 5, 25))
  assert.equal(r.season, '夏')
  assert.equal(r.current, '夏至')
  assert.equal(r.next, '小暑')
  assert.equal(r.days, 4)
})

test('时令：十一月在立冬到小雪之间，并写明按节气近似', () => {
  const r = seasonOf(new Date(2026, 10, 16))
  assert.equal(r.season, '冬')
  assert.equal(r.current, '立冬')
  assert.equal(r.next, '小雪')
  assert.equal(r.days, 9)
  const text = seasonText(new Date(2026, 10, 16))
  assert.match(text, /2026 年 11 月 16 日/)
  assert.match(text, /冬季/)
  assert.match(text, /近似/)
})

test('时令：一月初还没交小寒，算去年的冬至之后', () => {
  const r = seasonOf(new Date(2026, 0, 3))
  assert.equal(r.season, '冬')
  assert.equal(r.current, '冬至')
  assert.equal(r.next, '小寒')
  assert.equal(r.days, 12)
})

test('时令：天气不许编，必须走问答或写明按节气常理', () => {
  const text = seasonText(new Date(2026, 3, 6))
  assert.match(text, /ask_user_question/)
  assert.match(text, /按节气常理/)
  assert.match(text, /不许编/)
})