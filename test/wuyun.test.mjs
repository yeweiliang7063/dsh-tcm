// 五运六气全部由代码算：干支、中运太少、司天在泉、主气客气、客主加临。
// 模型只许照抄，所以这组数必须准——差一年、差一气，整段运气话就错。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ganzhiYear, qiOf, wuyunOf, wuyunText } from '../lib/season.js'

test('干支以立春为界：二月三日仍算上一年，二月四日换新一年', () => {
  assert.equal(ganzhiYear(new Date(2026, 1, 3)).stem + ganzhiYear(new Date(2026, 1, 3)).branch, '乙巳')
  assert.equal(ganzhiYear(new Date(2026, 1, 4)).stem + ganzhiYear(new Date(2026, 1, 4)).branch, '丙午')
  const old = ganzhiYear(new Date(2024, 0, 10))
  assert.equal(old.stem + old.branch, '癸卯')
  assert.equal(old.zhongyun, '火运不及')
  assert.equal(old.sitian, '阳明燥金')
  assert.equal(old.zaiquan, '少阴君火')
})

test('中运按天干太少相生：甲丙戊庚壬太过，乙丁己辛癸不及', () => {
  const expected = {
    甲: '土运太过', 乙: '金运不及', 丙: '水运太过', 丁: '木运不及', 戊: '火运太过',
    己: '土运不及', 庚: '金运太过', 辛: '水运不及', 壬: '木运太过', 癸: '火运不及',
  }
  for (let year = 1984; year < 1994; year += 1) {
    const gz = ganzhiYear(new Date(year, 6, 1))
    assert.equal(gz.zhongyun, expected[gz.stem], `${year} 年 ${gz.stem}${gz.branch}`)
  }
})

test('司天在泉按地支：三之气必是司天，终之气必是在泉', () => {
  const seen = new Set()
  for (let year = 2020; year < 2026; year += 1) {
    const gz = ganzhiYear(new Date(year, 6, 1))
    seen.add(gz.sitian)
    for (const [month, day] of [[7, 1], [1, 10]]) {
      const w = wuyunOf(new Date(year, month - 1, day))
      if (w.step === '三之气') assert.equal(w.keqi, w.gz.sitian, '三之气应等于司天')
      if (w.step === '终之气') assert.equal(w.keqi, w.gz.zaiquan, '终之气应等于在泉')
    }
  }
  assert.ok(seen.size >= 3, '六年里司天至少轮过三种')
})

test('主气固定、客气轮转：二〇二五年七月属三之气，主气少阳相火、客气厥阴风木', () => {
  const w = wuyunOf(new Date(2025, 6, 1))
  assert.equal(w.step, '三之气')
  assert.equal(w.zhuqi, '少阳相火')
  assert.equal(w.keqi, '厥阴风木')
  assert.equal(w.jialin, '客生主，相得')
})

test('客主加临四种关系都判得出来', () => {
  const seen = new Set()
  for (let year = 2020; year < 2032; year += 1) {
    for (let month = 1; month <= 12; month += 1) seen.add(wuyunOf(new Date(year, month - 1, 15)).jialin)
  }
  for (const rel of ['同气，相得', '客生主，相得', '主生客，相得', '客克主，不相得', '主克客，不相得']) {
    assert.ok(seen.has(rel), `十二年的六气里应出现过「${rel}」`)
  }
})

test('给模型的那段话把三项写全，并明确要求照抄', () => {
  const text = wuyunText(new Date(2026, 10, 18))
  for (const keyword of ['丙午年', '水运太过', '少阴君火', '阳明燥金', '照抄', '不许自己另推干支']) {
    assert.ok(text.includes(keyword), `五运六气说明缺「${keyword}」`)
  }
  assert.ok(!/d{4}s*年/.test(text), '不许把公历年号混进运气口径')
})

test('六气分步与节气对得上：初之气从大寒起', () => {
  assert.equal(qiOf(new Date(2026, 0, 21)).name, '初之气')
  assert.equal(qiOf(new Date(2026, 2, 22)).name, '二之气')
  assert.equal(qiOf(new Date(2026, 5, 1)).name, '三之气')
  assert.equal(qiOf(new Date(2026, 9, 1)).name, '五之气')
  assert.equal(qiOf(new Date(2026, 0, 1)).name, '终之气')
})
