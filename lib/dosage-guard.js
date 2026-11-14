/**
 * 学理模式 · 出口校验（纯函数，方便单测）
 *
 * 两件事：
 * 1. 判断一段助手回答里有没有「具体剂量」的数值写法；
 * 2. 把这种数值打码（保留单位、遮住数字），只用于显示层兜底。
 *
 * 认的写法：g／克／两／钱／铢／毫升／ml／枚／片／把／剂／服／包／袋，以及数 + 升／合／钱匕／方寸匕。
 * 明确不碰：「六经」这类词里的「六」、「第 35 条」这类条号、「1.5 小时」这类时长。
 * 宁可多认一点，也不让克数漏出去：拦错了只是多一句提醒，漏错了就是一张能照抓的方子。
 */

/** 剂量数值：数字 + 剂量单位（含「三两」「十二枚」这类中文数字）。 */
const UNIT_WORD = /(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千半]+)\s*(?:克重|克|g(?![a-zA-Z])|G(?![a-zA-Z])|两|钱|铢|毫升|ml|mL|ML|cc|CC|枚|片|把|剂|服|包|袋)/g

/** 中式复方量词：数 + 升／合／钱匕／方寸匕。原文「水三升」也拦，宁严勿松。 */
const LITER_WORD = /[一二三四五六七八九十百千半\d]+(?:\.\d+)?\s*(?:升|合|钱匕|方寸匕)/g

/** 条号、章节号、卷次不算剂量：先剥掉再判。 */
const ARTICLE_MARK = /第\s*\d+\s*(?:条|篇|难|章|节|卷|门|集)|宋本\s*第?\s*\d+|卷\s*[一二三四五六七八九十\d]+/g

/**
 * 一段文字里是否出现了具体剂量。
 * @param {string} text
 * @returns {boolean}
 */
export function hasDosage(text) {
  if (typeof text !== 'string' || text === '') return false
  const body = text.replace(ARTICLE_MARK, ' ')
  UNIT_WORD.lastIndex = 0
  if (UNIT_WORD.test(body)) return true
  LITER_WORD.lastIndex = 0
  return LITER_WORD.test(body)
}

/**
 * 把剂量数值打码：数字遮掉、单位留着，让人看得出这里原本是剂量。
 * @param {string} text
 * @returns {string}
 */
export function maskDosage(text) {
  if (typeof text !== 'string' || text === '') return text
  return text
    .replace(UNIT_WORD, (match) => {
      const unit = /(克重|克|g|G|两|钱|铢|毫升|ml|mL|ML|cc|CC|枚|片|把|剂|服|包|袋)$/.exec(match)
      return '＿＿' + (unit ? unit[1] : '')
    })
    .replace(LITER_WORD, (match) => '＿＿' + match.replace(/^[一二三四五六七八九十百千半\d.]+/, ''))
}