import test from 'node:test'
import assert from 'node:assert/strict'
import { ganzhiYear, qiOf, seasonOf, seasonText } from '../lib/season.js'

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
test('干支：丙午年（2026）的中运与司天在泉查表正确', () => {
  const g = ganzhiYear(new Date(2026, 10, 16))
  assert.equal(g.year, 2026)
  assert.equal(g.stem + g.branch, '丙午')
  assert.equal(g.zhongyun, '水运太过')
  assert.equal(g.sitian, '少阴君火')
  assert.equal(g.zaiquan, '阳明燥金')
})

test('干支：立春前算上一年，乙巳年金运不及', () => {
  const g = ganzhiYear(new Date(2026, 0, 20))
  assert.equal(g.year, 2025)
  assert.equal(g.stem + g.branch, '乙巳')
  assert.equal(g.zhongyun, '金运不及')
})

test('时令文案要带上干支与运气底盘，并说明只给底盘不许自编', () => {
  const text = seasonText(new Date(2026, 10, 16))
  assert.match(text, /丙午年/)
  assert.match(text, /司天：少阴君火/)
  assert.match(text, /不许自己另编一套运气/)
})

test('六气：11 月 16 日还在五之气，终之气要等小雪之后', () => {
  assert.equal(qiOf(new Date(2026, 10, 16)).name, '五之气')
  assert.equal(qiOf(new Date(2026, 10, 22)).name, '终之气')
  assert.equal(qiOf(new Date(2026, 10, 23)).name, '终之气')
})

test('六气：跨年的一月仍算终之气，且天数从去年小雪起算', () => {
  const q = qiOf(new Date(2027, 0, 5))
  assert.equal(q.name, '终之气')
  assert.equal(q.days, 44)
})

test('六气：初之气从大寒起算', () => {
  const q = qiOf(new Date(2026, 1, 1))
  assert.equal(q.name, '初之气')
  assert.equal(q.days, 12)
})

test('时令文案要写明现在走第几气，并禁止把下一气提前引', () => {
  const text = seasonText(new Date(2026, 10, 16))
  assert.match(text, /现在走的是「五之气」/)
  assert.match(text, /不许把下一气或上一气提前拿来用/)
})
