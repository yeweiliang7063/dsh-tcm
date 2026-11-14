/**
 * 学理模式 · 出口校验（纯函数，方便单测）
 *
 * 两件事：
 * 1. 判断一段助手回答里有没有「具体剂量」的数值写法；
 * 2. 把这种数值打码（保留单位、遮住数字），只用于显示层兜底。
 *
 * 认的写法：g／克／两／钱／铢／毫升／ml／把／剂／服／包／袋／贴。
 * 古文计量（升、合、枚、片、钱匕、方寸匕）一律放行：这些是经典原文里的煎法与枚数，
 * 换算成现代量要专业功底，学生照着抓不出来，拦住只会让引用原文的回答被截断。
 * 明确不碰：「六经」这类词里的「六」、「第 35 条」这类条号、「1.5 小时」这类时长、「十天半月」这类口语。
 *
 * 原文照引也放行：「桂枝汤：桂枝三两，芍药三两，……以水七升，煮取三升，去滓，分温三服」整条照抄，
 * 同一句里有古文方名、又有煎法或服法，认得出是引用，不拦；只挑一味药报个方量（「桂枝三两」）照拦。
 * 判错了宁可放过原文：放过只是让学生自己去看书，拦错会让整段回答当场截断。
 *
 * 2026-11-14 修订：
 * - 原写法「(?:数)+ + 两」把「三两」看成一个数，导致原文剂量直接漏拦，已修；
 * - 「两」不再一律当单位：「一两点醒」「两三天」「两包烟」「两两相望」「一共三两」都不判剂量；
 * - 补上漏拦的可照抓写法：半片、两包、两把、两贴、每日三服；
 * - 阿拉伯数字后面的 g／ml 不接字母，「158cm」不再被当成「158 毫升」。
 */

/** 中文数字字形（不含「两」，两单独处理）。 */
const HAN = '一二三四五六七八九十百千半'
/** 后面接这些字时，「数 + 量词」多半是普通说话，不是剂量。 */
const NOT_DOSE_NEXT = '天月年次日回趟遍杯碗口个人位岁斤米里步层届期点秒分刻号生肖烟切擘碎极字行句篇条首页项级倍成折遍样所间门类种批轮'
/** 这些字出现在「数 + 量词」前面时，通常不是剂量（没有、不只、少说三剂、开几剂、几剂）。 */
const NOT_DOSE_PREV = '不没每若干多好差逾余开'
/** 「两」后面接这些字时，「两」不是剂量单位（一共三两、十两银子、两千下红、两两相望）。 */
const TWO_BAD_NEXT = '银下红尾两'

/** 古文方名：桂枝汤、理中丸、五苓散、肾气丸……「汤/丸/散/饮/煎/膏/丹」六个字都算。 */
const FORMULA_NAME = /(?:汤|丸|散|饮|煎|膏|丹)/
/** 煎法、服法里的字眼：出现这些，说明这一段是在抄原文的煎服法。 */
const DECOCTION_HINT = new RegExp('(?:以水|煮取|去滓|分温|温服|顿服|再服|日三服|蜜和|捣筛|上[一二三四五六七八九十\\d]+味)')

/** 数字写法：阿拉伯数字，或「两/几/数」加中文数字拼起来的数目（两包、几克、数枚、十二枚）。 */
const NUM = String.raw`(?:\d+(?:\.\d+)?|[两几数]?[${HAN}]+|[两几数])`

/**
 * 数字后接 g／ml 这类拉丁单位：后面不能紧跟字母，免得 GB、GIF、mlx 这类单词被当成剂量。
 * 「毫升」另外判：喝水、失血这类大数不算药量，免得「每天喝温开水1500毫升」被拦。
 */
function latinHitRe() {
  return /(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千半]+)\s*(?:[gG](?![a-zA-Z])|[mM][lL](?![a-zA-Z])|cc|CC)/g
}
const LATIN_UNIT = latinHitRe()

/** 「几毫升」「毫升级」是含糊说法，不是可照抓的量。 */
const VAGUE_ML = /(?<![\u4e00-\u9fa5])几\s*(?:毫升|ml|mL|ML)|(?:毫升|ml|mL|ML)\s*级/

/**
 * 「毫升」什么时候算剂量。
 * 数前面（同一句里往回看几个字）出现「每次、每日、一天、服、兑、含、温水送」这类字眼时，
 * 说的是给药量，一律算；否则像「每天喝温开水1500毫升」「出血量约200毫升」这种喝水、失血的量，
 * 三位数以上按生活用水、失血处理，放行。
 * 单独一个「三毫升」「五毫升」没法判断语境，按剂量处理（宁可多提醒一句）。
 */
function mlLikeDose(hit) {
  const tail = /[一二三四五六七八九十百千半\d]+\s*毫升$/.exec(hit)
  if (!tail) return false
  const before = hit.slice(0, hit.length - tail[0].length)
  const value = tail[0].slice(0, tail[0].length - 2)
  if (/[每各]次|[每各]日|一天|一日|服|兑|含|送|灌/.test(before)) return true
  if (/^\d+\./.test(value)) return true
  if (/^\d{3,}$/.test(value)) return false
  return true
}

/** 各类剂量的单字量词，含原文常用写法。 */
const DOSE_UNITS = ['克重', '毫升', '克', '钱', '铢', '把', '包', '袋', '贴', '剂', '服']

/**
 * 单个「数 + 单位」的正则。
 * 组合放在函数里而不是模板字符串里，免得正则里的字符类提前生效。
 */
function doseOneOf(unit) {
  const head = String.raw`(?<![${HAN}\d])(?<![${NOT_DOSE_PREV}])${NUM}\s*${unit}`
  return new RegExp(head + String.raw`(?![${NOT_DOSE_NEXT}])`, 'g')
}

/** 各类「数 + 单位」编译一次，重复使用（带 g 标志，用前要重置 lastIndex）。 */
const DOSE_CACHE = Object.fromEntries(DOSE_UNITS.map((unit) => [unit, doseOneOf(unit)]))

/** 「数 + 两」：数字写法宽松（四两、三两、半两、3两都算），后面不接银/下/红/尾/两才算剂量。 */
const DOSE_TWO = new RegExp(
  String.raw`(?<![${HAN}\d])(?<![${NOT_DOSE_PREV}])(${NUM}\s*两)${[...TWO_BAD_NEXT].map((ch) => `(?!${ch})`).join('')}`,
  'gu',
)

/** 「两」单独成字、后面跟着数：两三点、两三天、两三剂，不是剂量。 */
const TWO_BEFORE_NUM = new RegExp(String.raw`两(?=[\d${HAN}])`, 'g')
/** 「两」单独成字、后面接「天/次/烟/红」这类：两天、两次、两包烟，不是剂量。 */
const TWO_WORD = new RegExp(String.raw`两(?=[${NOT_DOSE_NEXT}烟红])`, 'g')

/**
 * 原文写法里括注中的度量：「桂枝三两（去皮，水三升）」「甘草一两半（炙）」「大枣十二枚（擘）」。
 * 这些是抄书里的煎法和炮制，不能折成抓药的克数，判剂量前先剥掉。
 */
const INLINE_MEASURE = /[（(][^（）()]{0,40}?(?:[一二三四五六七八九十百千半\d]\s*(?:升|合|枚|两|钱|铢|分))[^（）()]{0,40}?[）)]/g

/** 条号、章节号、卷次不算剂量：先剥掉再判。 */
const ARTICLE_MARK = /第\s*\d+\s*(?:条|篇|难|章|节|卷|门|集)|宋本\s*第?\s*\d+|卷\s*[一二三四五六七八九十\d]+/g

/** 一句里连着的两段剂量（「大黄三两 芒硝二两」）在流式接口下会分两次到达，判据记在模块级。 */
let doseSeen = false

/** 把「两」字里不该算剂量的那部分先遮起来，剩下的「两」才算单位。 */
function eraseTwoNoise(text) {
  return text
    .replace(TWO_BEFORE_NUM, '〇')
    .replace(TWO_WORD, '〇')
    .replace(/两\s*两(?=[相三对])/g, '〇两')
    .replace(/一共\s*两/g, '一共〇')
    .replace(/共\s*([一二三四五六七八九十百千半]+)\s*两/g, '共〇两')
}

/**
 * 括号里的原文：格式是「白话解释（原文：……）」，括号里还可能是「（原文：桂枝三两，芍药三两）」半截。
 * 括注里的计量一律放行——那是引用，不是给药量。
 */
const QUOTED_NOTE = /[（(][^（）()]{0,200}(?:原文|《|引自)[^（）()]{0,500}[）)]/g

/** 括号里的原方比例：「（桂枝三两、芍药三两，1 比 1）」「（原方 2 比 1）」这类也放行。 */
const QUOTED_RATIO = /[（(][^（）()]{0,200}(?:\d+\s*[:：比]\s*\d+|[一二三四五六七八九十]\s*比\s*[一二三四五六七八九十])[^（）()]{0,200}[）)]/g

/**
 * 比例说法：「比例一比一」「桂枝加倍、比例 2 比 1」「芍药加倍」。
 * 这是讲原方各味药的轻重对比，不是可照抓的量，整段抹掉再判。
 */
const RATIO_PHRASE = /比例|之比|配比|倍|等分/g
/** 讲比例的那半句（按标点切开）：里面的药量在做对比，不是交给病人的量。 */
const RATIO_SENTENCE = /[^。；！？\n]*(?:比例|之比|配比|比对|倍|等分|\d\s*[:：]\s*\d|\d\s*比\s*\d|[一二三四五六七八九十]\s*比\s*[一二三四五六七八九十])[^。；！？\n]*/g

/** 句末标点与换行，用来切句子。 */
const SENTENCE_END = ['\n', '。', '！', '？', '；']

/** 把命中位置所在的整句切出来。 */
function sentenceAround(text, offset) {
  let start = -1
  for (const ch of SENTENCE_END) {
    const i = text.lastIndexOf(ch, offset - 1)
    if (i > start) start = i
  }
  let end = text.length
  for (const ch of SENTENCE_END) {
    const i = text.indexOf(ch, offset)
    if (i !== -1 && i < end) end = i
  }
  return text.slice(start + 1, end)
}

/**
 * 是不是原文照引：同一句里有古文方名，并且带煎法或服法。
 * 流式回答是一块块吐出来的，方名和煎法常常还没到，所以方名往前多看一整行：
 * 「桂枝汤：桂枝三两，芍药三两……」这种一行里先有方名、后面才是药量的写法，药量一到就认出来。
 * 代价是同一行里「桂枝汤 …… 桂枝三两」这种只报单味药方量的也会放行——流式下宁放过不截断。
 */
function isQuotedFormula(text, offset) {
  const sentence = sentenceAround(text, offset)
  if (FORMULA_NAME.test(sentence) && DECOCTION_HINT.test(sentence)) return true
  // 流式回答里方名和药量常常不在同一块，往前多看一整行：
  // 「桂枝汤：桂枝三两，芍药三两……」这种一行里先有方名、后面才是药量的写法，药量一到就认出来。
  // 代价是同一行里「桂枝汤 …… 桂枝三两」这种只报单味药方量的也会放行——流式下宁放过不截断。
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const head = text.slice(lineStart, offset)
  const nameAt = head.search(FORMULA_NAME)
  if (nameAt === -1) return false
  // 方名后面只允许是「：」和药名罗列，中间不能又起一句
  return !/[。！？]/.test(head.slice(nameAt))
}

/**
 * 判断一处「数 + 单位」是不是真的剂量。
 * 原文照引的整条方子放行；毫升要看数像不像药量；
 * 「服」在「日三服」「分温三服」「再服」这类服法里是次数，不是药量。
 */
function isRealDose(unit, hit, text, offset) {
  if (isQuotedFormula(text, offset)) return false
  if (unit === '服') {
    if (/次/.test(text.slice(offset, offset + hit.length + 1))) return false
    const before = text.slice(Math.max(0, offset - 3), offset)
    if (/(?:日|分|再|温|顿|空心|食前|食后|夜|昼|半日)\s*$/.test(before)) return false
  }
  return unit !== '毫升' || mlLikeDose(hit)
}

/**
 * 一段文字里是否出现了具体剂量。
 * @param {string} text
 * @returns {boolean}
 */
export function hasDosage(text) {
  if (typeof text !== 'string' || text === '') return false
  const body = text.replace(ARTICLE_MARK, ' ')
  const latinHits = [...body.matchAll(latinHitRe())].map((m) => m[0])
  // 拉丁单位的毫升没有「每次」这类语境可看，单个数字也按剂量处理（宁可多提醒一句）
  if (latinHits.length && latinHits.some((hit) => !VAGUE_ML.test(hit) && !/^\d{3,}/.test(hit))) return true
  // 毫升写在拉丁单位里时只看到「150ml」，看不到前面的「每次」，这里补判一次整句
  if (/(?:[每各]次|[每各]日|一天|一日)[^，。；]{0,6}?\d+(?:\.\d+)?\s*(?:毫升|ml|mL|ML|cc|CC)(?![a-zA-Z])/.test(body)) return true
  // 中文「毫升」按毫升口径单独判：喝水、失血这类大数不是药量，判完再抹掉，交给下面的单位表
  const mlHits = [...body.matchAll(/[^\n。；！？]{0,10}?[一二三四五六七八九十百千半\d]{1,6}\s*毫升/g)].map((m) => m[0])
  if (mlHits.some((hit) => mlLikeDose(hit))) return true
  // 剥掉的内容换成两个空格：括注里的方名、煎法靠空格才认得出还在同一句里
  const stripped = body
    .replace(QUOTED_NOTE, '  ')
    .replace(QUOTED_RATIO, '  ')
    .replace(RATIO_SENTENCE, '  ')
    .replace(INLINE_MEASURE, '  ')
    .replace(/[一二三四五六七八九十百千半\d]+\s*毫升/g, '  ')
  const flat = eraseTwoNoise(stripped)
  for (const unit of DOSE_UNITS) {
    const re = DOSE_CACHE[unit]
    re.lastIndex = 0
    for (const m of flat.matchAll(re)) {
      if (isRealDose(unit, m[0], flat, m.index)) return true
    }
  }
  // 「数 + 两」逐处判：整条矛盾原文照引放行，只报单味药方量的照拦
  for (const m of flat.matchAll(DOSE_TWO)) {
    if (!isQuotedFormula(flat, m.index)) return true
  }
  return false
}

/** 流式接口专用的状态标记：跨块的两段剂量能连起来。 */
export const dosageStream = {
  reset() {
    doseSeen = false
  },
  /**
   * 带状态的判断：同一块里出现两段剂量，或上一块刚见到剂量、这一块又见到，都判为剂量。
   * @param {string} window 末尾若干字
   * @returns {boolean}
   */
  test(window) {
    const body = String(window || '').replace(ARTICLE_MARK, ' ')
    const flat = eraseTwoNoise(body.replace(QUOTED_NOTE, '  ').replace(QUOTED_RATIO, '  ')).replace(INLINE_MEASURE, '  ')
    const hits = []
    const latin = [...flat.matchAll(latinHitRe())].map((m) => m[0])
    if (latin.some((m) => !/^\d{3,}/.test(m))) hits.push('latin')
    for (const m of flat.matchAll(DOSE_TWO)) {
      if (!isQuotedFormula(flat, m.index)) hits.push(m[0])
    }
    for (const unit of DOSE_UNITS) {
      const re = DOSE_CACHE[unit]
      re.lastIndex = 0
      for (const m of flat.matchAll(re)) {
        if (isRealDose(unit, m[0], flat, m.index)) hits.push(m[0])
      }
    }
    if (hits.length >= 2) return true
    if (hits.length === 1) {
      if (doseSeen) return true
      doseSeen = true
      return false
    }
    return false
  },
}

/** 所有「数 + 单位」合成一个正则（长的单位排前面），打码时一次替换。 */
function doseOneAll() {
  return new RegExp(
    String.raw`(?<![${HAN}\d])(?<![${NOT_DOSE_PREV}])(${NUM})\s*(克重|毫升|克|钱|铢|把|包|袋|贴|剂|服)(?![${NOT_DOSE_NEXT}])`,
    'g',
  )
}

/**
 * 把剂量数值打码：数字遮掉、单位留着，让人看得出这里原本是剂量。
 * @param {string} text
 * @returns {string}
 */
export function maskDosage(text) {
  if (typeof text !== 'string' || text === '') return text
  // 先把非剂量的「两」换成占位字，遮完再换回来
  const guarded = eraseTwoNoise(text)
  const masked = guarded
    .replace(latinHitRe(), (match) => {
      const unit = /([gG]|[mM][lL]|cc|CC)$/.exec(match)
      return '＿＿' + (unit ? unit[1] : '')
    })
    .replace(DOSE_TWO, (_m, two) => '＿＿' + two.slice(-1))
    .replace(doseOneAll(), (_m, _num, unit) => '＿＿' + unit)
  return masked.replace(/〇/g, '两')
}
/** 句末标点：一句话到哪里结束。 */
const SENTENCE_BREAK = /[。！？；\n]/

/**
 * 找出文本里第一段「具体剂量」所在的完整句子，返回它的起止位置。
 * 优先用句号、问号、叹号、分号、换行断句；整段只有一个分句时，退到逗号句读。
 * 只在流式出口用来「挖掉这一句」，与 hasDosage 的判据保持一致：把候选句单独喂给 hasDosage 再确认一遍。
 * @param {string} text
 * @returns {{ start: number, end: number } | null} 命中句的区间 [start, end)，找不到返回 null
 */
export function dosageSentenceRange(text) {
  if (typeof text !== 'string' || text === '') return null
  const ranges = []
  let start = 0
  for (let i = 0; i <= text.length; i += 1) {
    const at = i === text.length
    if (at || SENTENCE_BREAK.test(text[i])) {
      if (i > start) ranges.push([start, i])
      start = i + 1
    }
  }
  const candidates = []
  for (const [a, b] of ranges) {
    const piece = text.slice(a, b)
    // 句子里有逗号时再拆细：命中细化到分句，挖掉的篇幅更小
    let s = a
    for (let i = a; i <= b; i += 1) {
      const isEnd = i === b || /[，、]/.test(text[i])
      if (!isEnd) continue
      if (i > s) candidates.push([s, i])
      s = i + 1
    }
    if (!/[，、]/.test(piece)) candidates.push([a, b])
  }
  for (const [a, b] of candidates) {
    if (hasDosage(text.slice(a, b))) return { start: a, end: b }
  }
  return null
}

/**
 * 把文本里所有出现具体剂量的句子换成占位符。
 * @param {string} text
 * @param {string} [mark] 占位符，默认 ✳
 * @returns {string}
 */
export function blotDosage(text, mark = '✳') {
  if (typeof text !== 'string' || text === '') return text
  let out = text
  for (let guard = 0; guard < 50; guard += 1) {
    const hit = dosageSentenceRange(out)
    if (!hit) return out
    out = `${out.slice(0, hit.start)}${mark}${out.slice(hit.end)}`
  }
  return tidyBlot(out)
}

/**
 * 挖句时清掉挖空留下的残缺符号：空括号、连着两个标点的顿挫。
 * 药名本身不带剂量、只在一处补一句剂量被挖走，读者看到的是「药名（✳）」这种干净样子。
 * @param {string} text
 * @returns {string}
 */
function tidyBlot(text) {
  return text
    .replace(/（\s*✳\s*[,，、）]/g, '（✳）')
    .replace(/（\s*[,，、]\s*✳\s*）/g, '（✳）')
    .replace(/（\s*[,，、]\s*）/g, '')
    .replace(/[，、]{2,}/g, '，')
    .replace(/（\s*）/g, '')
}
