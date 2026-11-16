/**
 * 当下时令：把「今天是什么季节、处在哪两个节气之间」算出来，交给模型。
 *
 * 只做一件事：按公历日期推出二十四节气的近似交节日，给出当前节气、所处季节与天数。
 * 交节日期用固定表（常见年份误差一到两天），所以文案里明写「近似」，
 * 并且不假装知道当地天气——天气是取不到的，得靠问答问用户。
 */

/** 二十四节气按公历顺序（近似交节日），用于定位「现在处在哪两个节气之间」。 */
const TERMS = [
  ['小寒', 1, 6],
  ['大寒', 1, 20],
  ['立春', 2, 4],
  ['雨水', 2, 19],
  ['惊蛰', 3, 6],
  ['春分', 3, 21],
  ['清明', 4, 5],
  ['谷雨', 4, 20],
  ['立夏', 5, 6],
  ['小满', 5, 21],
  ['芒种', 6, 6],
  ['夏至', 6, 21],
  ['小暑', 7, 7],
  ['大暑', 7, 23],
  ['立秋', 8, 8],
  ['处暑', 8, 23],
  ['白露', 9, 8],
  ['秋分', 9, 23],
  ['寒露', 10, 8],
  ['霜降', 10, 23],
  ['立冬', 11, 7],
  ['小雪', 11, 22],
  ['大雪', 12, 7],
  ['冬至', 12, 22],
]

/** 每个节气归属的季节：立春起为春，立夏起为夏，立秋起为秋，立冬起为冬。 */
const SEASON_OF = {
  小寒: '冬', 大寒: '冬',
  立春: '春', 雨水: '春', 惊蛰: '春', 春分: '春', 清明: '春', 谷雨: '春',
  立夏: '夏', 小满: '夏', 芒种: '夏', 夏至: '夏', 小暑: '夏', 大暑: '夏',
  立秋: '秋', 处暑: '秋', 白露: '秋', 秋分: '秋', 寒露: '秋', 霜降: '秋',
  立冬: '冬', 小雪: '冬', 大雪: '冬', 冬至: '冬',
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 把某一年的节气换算成可以直接比较的「年内序号」（月 * 100 + 日）。
 * @param {number} month 公历月
 * @param {number} day 公历日
 */
const keyOf = (month, day) => month * 100 + day

/**
 * 算出此刻处在哪两个节气之间。
 * @param {Date} now 现在的时间
 * @returns {{season: string, current: string, next: string, days: number}}
 */
export function seasonOf(now = new Date()) {
  const month = now.getMonth() + 1
  const day = now.getDate()
  const key = keyOf(month, day)

  // 找到最后一个已经交节的节气；一月上旬还没交小寒时，视作上一年的大寒之后。
  let index = -1
  for (let i = 0; i < TERMS.length; i += 1) {
    const [, m, d] = TERMS[i]
    if (keyOf(m, d) <= key) index = i
  }

  const current = index === -1 ? TERMS[TERMS.length - 1] : TERMS[index]
  const next = TERMS[(index + 1) % TERMS.length]

  // 交节天数：当年之内直接相减；一月上旬还没交小寒时，上一节是去年的冬至。
  const startYear = index === -1 ? now.getFullYear() - 1 : now.getFullYear()
  const start = new Date(startYear, current[1] - 1, current[2])
  const span = Math.max(0, Math.floor((now - start) / 86400000))

  return { season: SEASON_OF[current[0]], current: current[0], next: next[0], days: span }
}

/**
 * 给模型看的一段时令说明。只给日期、节气、季节，
 * 天气一律交给问答去问，本地拿不到就不许编。
 * @param {Date} now 现在的时间
 */
export function seasonText(now = new Date()) {
  const { season, current, next, days } = seasonOf(now)
  const date = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日（星期${WEEK[now.getDay()]}）`
  return [
    `今天是 ${date}，按二十四节气算，正处在「${current}」到「${next}」之间（${current}后第 ${days} 天），属${season}季。交节日按常用表取近似，前后可能差一天。`,
    '当地实时的冷暖、干湿、阴雨、有没有寒潮，本机取不到，不许编具体气温和天气现象：要按真实天气讲，先用 ask_user_question 问一句（例如「你那边这几天冷不冷、下不下雨、室内有没有暖气」）；不问就按节气常理推断，并在文里写明「按节气常理」。',
  ].join('\n')
}