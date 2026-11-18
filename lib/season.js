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

// 天干、地支、中运、司天、在泉：查表即可，不靠推算口诀。
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const ZHONGYUN = ['土运', '金运', '水运', '木运', '火运'] // 甲己土、乙庚金、丙辛水、丁壬木、戊癸火
const SITIAN = ['少阴君火', '太阴湿土', '少阳相火', '阳明燥金', '太阳寒水', '厥阴风木'] // 子午、丑未、寅申、卯酉、辰戌、巳亥
const ZAIQUAN = ['阳明燥金', '太阳寒水', '厥阴风木', '少阴君火', '太阴湿土', '少阳相火'] // 司天对宫

/**
 * 按干支纪年算出今年（以立春为界）的干支与运气底盘。
 * 只做查表，不下任何医学结论。
 * @param {Date} now 现在的时间
 * @returns {{year: number, stem: string, branch: string, zhongyun: string, sitian: string, zaiquan: string}}
 */
export function ganzhiYear(now = new Date()) {
  // 立春在公历 2 月 4 日前后，早于这一天按上一年算
  const monthDay = (now.getMonth() + 1) * 100 + now.getDate()
  const year = monthDay < 204 ? now.getFullYear() - 1 : now.getFullYear()
  const s = (((year - 4) % 10) + 10) % 10
  const b = (((year - 4) % 12) + 12) % 12
  const yang = s % 2 === 0 // 甲丙戊庚壬为阳干，主太过
  return {
    year,
    stem: STEMS[s],
    branch: BRANCHES[b],
    zhongyun: ZHONGYUN[s % 5] + (yang ? '太过' : '不及'),
    sitian: SITIAN[b % 6],
    zaiquan: ZAIQUAN[b % 6],
  }
}

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
/**
 * 五运六气的「六步分气」：把一年切成六段，每段约四个节气。
 * 用节气表里的交节日做边界，所以和《素问》运气七篇的分步口径一致：
 * 初之气 大寒→春分，二之气 春分→小满，三之气 小满→大暑，
 * 四之气 大暑→秋分，五之气 秋分→小雪，终之气 小雪→次年大寒。
 */
const QI_STEPS = [
  ['初之气', '大寒', '春分'],
  ['二之气', '春分', '小满'],
  ['三之气', '小满', '大暑'],
  ['四之气', '大暑', '秋分'],
  ['五之气', '秋分', '小雪'],
  ['终之气', '小雪', '大寒'],
]

const TERM_MD = (name) => {
  const t = TERMS.find((x) => x[0] === name)
  if (t) return t[1] * 100 + t[2]
  throw new Error(`未知节气：${name}`)
}

/** 按日期推出现在处在运气的第几气，返回 { name, from, to, days }。 */
export function qiOf(now = new Date()) {
  const md = (now.getMonth() + 1) * 100 + now.getDate()
  for (const [name, from, to] of QI_STEPS) {
    const a = TERM_MD(from)
    const b = TERM_MD(to)
    const inRange = a < b ? md >= a && md < b : md >= a || md < b
    if (!inRange) continue
    // 终之气跨年：一月份落在「小雪→大寒」这一段时，起点在去年。
    const startYear = a < b || md >= a ? now.getFullYear() : now.getFullYear() - 1
    const start = new Date(startYear, Math.floor(a / 100) - 1, a % 100)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const days = Math.round((today - start) / 86400000)
    return { name, from, to, days }
  }
  throw new Error('六气定位失败')
}

export function seasonText(now = new Date()) {
  const { season, current, next, days } = seasonOf(now)
  const date = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日（星期${WEEK[now.getDay()]}）`
  const gz = ganzhiYear(now)
  const qi = qiOf(now)
  return [
    `今天是 ${date}，按二十四节气算，正处在「${current}」到「${next}」之间（${current}后第 ${days} 天），属${season}季。交节日按常用表取近似，前后可能差一天。`,
    `按干支纪年，今年是${gz.stem}${gz.branch}年（中运：${gz.zhongyun}；司天：${gz.sitian}；在泉：${gz.zaiquan}）。干支以立春为界，立春前仍算上一年。讲五运六气就照这组干支往下推，每一步都要引《素问》运气七篇的原文作依据；本机只给干支，不许自己另编一套运气。`,
    `按运气的六步分气，现在走的是「${qi.name}」（${qi.from}到${qi.to}，已过第 ${qi.days} 天）。讲这一年的气，只许引「${qi.name}」这一气的原文，**不许把下一气或上一气提前拿来用**——比如还没到${qi.to}，就不能引后一气那段的「燥令行」；气引错了，整段运气话都不作数。`,
    '当地实时的冷暖、干湿、阴雨、有没有寒潮，本机取不到，不许编具体气温和天气现象：要按真实天气讲，先用 ask_user_question 问一句（例如「你那边这几天冷不冷、下不下雨、室内有没有暖气」）；不问就按节气常理推断，并在文里写明「按节气常理」。',
  ].join('\n')
}
/**
 * 六气的主气与客气，以及客主加临的相得／不相得：全部查表算好，不给模型自己推。
 *
 * 主气固定不变：初之气厥阴风木、二之气少阴君火、三之气少阳相火、
 * 四之气太阴湿土、五之气阳明燥金、终之气太阳寒水。
 * 客气按三阴三阳次序轮转：三之气必是司天，终之气必是在泉。
 */
const ZHUQI = ['厥阴风木', '少阴君火', '少阳相火', '太阴湿土', '阳明燥金', '太阳寒水']
const KEQI_ORDER = ['厥阴风木', '少阴君火', '太阴湿土', '少阳相火', '阳明燥金', '太阳寒水']
const WUXING_OF = {
  厥阴风木: '木',
  少阴君火: '火',
  少阳相火: '火',
  太阴湿土: '土',
  阳明燥金: '金',
  太阳寒水: '水',
}
const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }
const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' }

/** 客主加临：同气为相得，相生为相得，相克为不相得（客克主、主克客分别写明）。 */
function jialin(zhu, ke) {
  const a = WUXING_OF[zhu]
  const b = WUXING_OF[ke]
  if (a === b) return '同气，相得'
  if (SHENG[b] === a) return '客生主，相得'
  if (SHENG[a] === b) return '主生客，相得'
  if (KE[b] === a) return '客克主，不相得'
  return '主克客，不相得'
}

/**
 * 按日期算出五运六气的完整底盘：干支、中运太少、司天在泉、当前步的主气客气与加临。
 * @param {Date} now 现在的时间
 * @returns {{gz: object, step: string, zhuqi: string, keqi: string, jialin: string}}
 */
export function wuyunOf(now = new Date()) {
  const gz = ganzhiYear(now)
  const step = qiOf(now)
  const steps = QI_STEPS.map((x) => x[0])
  const index = Math.max(0, steps.indexOf(step.name))
  const sitianIndex = KEQI_ORDER.indexOf(gz.sitian)
  const keqi = KEQI_ORDER[(sitianIndex - 2 + index + 6) % 6]
  const zhuqi = ZHUQI[index]
  return { gz, step: step.name, zhuqi, keqi, jialin: jialin(zhuqi, keqi) }
}

/**
 * 给模型看的一段五运六气说明：数字与干支全部由代码算好，模型只许照抄。
 * @param {Date} now 现在的时间
 */
export function wuyunText(now = new Date()) {
  const { gz, step, zhuqi, keqi, jialin: rel } = wuyunOf(now)
  return [
    `今年是${gz.stem}${gz.branch}年：中运${gz.zhongyun}，司天${gz.sitian}，在泉${gz.zaiquan}。`,
    `现在处在「${step}」：主气${zhuqi}，客气${keqi}，客主加临${rel}。`,
    '以上干支、太少、司天在泉、主气客气都是插件按日期算好的，**直接照抄这三项，不许自己另推干支、另算运气，也不许把下一气提前拿来用**；讲运气时只把这几行当事实的底子，具体病机仍要引《素问》运气七篇原文。',
  ].join('\n')
}
