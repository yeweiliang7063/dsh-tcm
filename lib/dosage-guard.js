/**
 * 学理模式 · 出口校验（纯函数，方便单测）
 *
 * 两件事：
 * 1. 判断一段助手回答里有没有「具体剂量」的数值写法；
 * 2. 把这种数值遮成 ✳，只用于显示层兜底。
 *
 * 2026-11-16 修订：从「挖掉整句」改成「只遮数值」。
 * - 旧版把命中剂量的整个分句换成 ✳，药名和句子骨架一起没了，读者只看到一个孤零零的 ✳；
 *   现在只把「数字＋单位」这一截换成 ✳，药名与前后文原样留着：生姜 25g → 生姜 ✳。
 * - 列表项前缀（行首「2. **药名**」「- **药名**：」）永不参与打码，列表结构不会被挖断。
 * - 同一段里出现 4 处以上「药名＋数字＋克/g」，判为转述整张方，整段放行。
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

/**
 * 把「两」字里不该算剂量的那部分先遮起来，剩下的「两」才算单位。
 * 只把「两」换成等长占位字：判完还要按原位遮数字，位置不能挪。
 */
function eraseTwoNoise(text) {
  return text
    .replace(TWO_BEFORE_NUM, '〇')
    .replace(TWO_WORD, '〇')
    .replace(/两\s*两(?=[相三对])/g, '〇两')
    .replace(/一共(\s*)两/g, '一共$1〇')
    .replace(/(共\s*[一二三四五六七八九十百千半]+\s*)两/g, '$1〇')
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

/* ────────── 转述整张方：同一段里 4 处以上「药名＋数字＋克/g」 ────────── */

/** 「药名＋数字＋克/g」：只认克与 g，用来认「整张方照抄」，不认两、钱、枚这些原文计量。
 *  药名和数字之间允许空格与「：」，列表项里「**桂枝** 9g」「甘草：6g」都算。 */
const FORMULA_PAIR = /([\u4e00-\u9fa5]{1,6})[\s:：]*(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千半]+)\s*(?:克重|克|g(?![a-zA-Z])|G(?![a-zA-Z]))/g
/** 一段里凑够这么多处，就判为在转述整张方，整段放行。 */
const WHOLE_FORMULA_PAIRS = 4
/** 这些词不是药名，后面跟的数不算「药名带克数」。 */
const NOT_FORMULA_NAME = /^(?:每[次日]|一天|一日|一次|分次|用量|总量|大约|一般|煎取|煮取|共服|共|总共)$/

/** 按空行切段：返回每段的 [起, 止)。 */
function paragraphRanges(text) {
  const out = []
  let start = 0
  for (const m of text.matchAll(/\n[ \t]*\n/g)) {
    out.push([start, m.index])
    start = m.index + m[0].length
  }
  out.push([start, text.length])
  return out
}

/** 这一段里「药名＋数字＋克/g」出现了几处。markdown 的 ** 加粗先去掉再数。 */
function formulaPairCount(text) {
  let count = 0
  for (const m of text.replace(/\*\*/g, '').matchAll(FORMULA_PAIR)) {
    if (!NOT_FORMULA_NAME.test(m[1])) count += 1
  }
  return count
}

/** 转述整张方的段落：整段放行，一个数都不遮。 */
function wholeFormulaRanges(text) {
  return paragraphRanges(text).filter(([a, b]) => formulaPairCount(text.slice(a, b)) >= WHOLE_FORMULA_PAIRS)
}

/** 在文本里把指定区间换成等长空格：位置不变，遮数字时仍按原文位置走。 */
function blankRanges(text, ranges) {
  if (ranges.length === 0) return text
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  let out = ''
  let cursor = 0
  for (const [a, b] of sorted) {
    if (b <= cursor) continue
    const s = Math.max(a, cursor)
    out += text.slice(cursor, s) + ' '.repeat(b - s)
    cursor = b
  }
  return out + text.slice(cursor)
}

/** 把一个正则命中的区间全收出来。 */
function regexRanges(text, re) {
  const out = []
  for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length])
  return out
}

/** 中文「数＋毫升」：往回看几个字判断是不是给药量。 */
const ML_PHRASE = /[^\n。；！？]{0,10}?(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千半]{1,6})\s*毫升/g
/** 上面那条命中里真正的「数＋毫升」那一段。 */
const ML_PHRASE_TAIL = /(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千半]{1,6})\s*毫升$/

/**
 * 阿拉伯数字带 g／ml 算不算剂量：三位数以上先看前面有没有「每次/每日」这类给药口径，
 * 没有就按喝水、失血的量放行。
 */
function latinIsDose(text, offset, hit) {
  if (VAGUE_ML.test(hit)) return false
  if (!/^\d{3,}/.test(hit)) return true
  const before = text.slice(Math.max(0, offset - 12), offset)
  return /(?:[每各]次|[每各]日|一天|一日)[^，。；]{0,6}$/.test(before)
}

/** 把互相重叠的区间并起来，一处剂量只遮一次。 */
function mergeSpans(spans) {
  if (spans.length < 2) return spans
  const sorted = [...spans].sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const out = [sorted[0].slice()]
  for (const [s, e] of sorted.slice(1)) {
    const last = out[out.length - 1]
    if (s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

/** 剂量指纹：去掉空白、统一单位写法（克重／克 → g、毫升 → ml）、字母转小写，
 *  用来把回答里的数和用户原单上的写法对上号。 */
export function doseKey(raw) {
  return String(raw)
    .replace(/\s+/g, '')
    .replace(/克重|克/g, 'g')
    .replace(/毫升/g, 'ml')
    .toLowerCase()
}

/** 用户原文里的「数＋单位」：点评别人的方时，模型照念原单上的量不算自己出量。 */
const SOURCE_DOSE = /(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千半]+)\s*(?:克重|克|毫升|[mM][lL]|[cC][cC]|[gG](?![a-zA-Z])|两|钱|铢|把|包|袋|贴|剂|服)/g

/**
 * 把用户消息里出现过的剂量收成指纹集。
 * 模型转述原单上的这些数时放行，只有原单上没有、模型自己新给的量才遮。
 * @param {string} text
 * @returns {Set<string>}
 */
export function sourceDoseKeys(text) {
  const keys = new Set()
  if (typeof text !== 'string' || text === '') return keys
  for (const m of text.matchAll(SOURCE_DOSE)) keys.add(doseKey(m[0]))
  return keys
}

/**
 * 找出文本里所有真正算剂量的「数字＋单位」位置 [起, 止)。
 * 判定口径与旧版一致：原文照引、括注原文、比例说法、古文计量、转述整方、条号、
 * 喝水失血这类毫升数都先排除，剩下的才是自己给的量。
 * @param {string} text
 * @param {Set<string>} [keep] 原单上的剂量指纹：命中的不遮（照念别人的方）
 */
function doseSpans(text, keep = null) {
  if (typeof text !== 'string' || text === '') return []
  // 先遮掉「不是自己给量」的整段：引号里的转述、括注里的原文、整张方的照抄、条号。
  let base = stripQuoted(text)
  base = blankRanges(base, regexRanges(base, ARTICLE_MARK))
  // 有原单可对号时只认原单：原单上没有的整段克数，哪怕是整张方，也是模型自己拟的，照遮。
  if (!keep || keep.size === 0) base = blankRanges(base, wholeFormulaRanges(base))
  const spans = []
  const add = (start, end) => {
    if (end > start) spans.push([start, end])
  }
  // ① 阿拉伯数字带 g／ml／cc
  for (const m of base.matchAll(latinHitRe())) {
    if (latinIsDose(base, m.index, m[0])) add(m.index, m.index + m[0].length)
  }
  // ② 中文「毫升」按毫升口径单独判：只遮「数＋毫升」那一截，前面的「每次」留作语境
  for (const m of base.matchAll(ML_PHRASE)) {
    if (!mlLikeDose(m[0])) continue
    const tail = ML_PHRASE_TAIL.exec(m[0])
    if (tail) add(m.index + m[0].length - tail[0].length, m.index + m[0].length)
  }
  // ③ 其余中文剂量单位：先遮掉括注、比例、古文计量，再按单味药逐个判
  const deep = eraseTwoNoise(
    blankRanges(base, [
      ...regexRanges(base, QUOTED_NOTE),
      ...regexRanges(base, QUOTED_RATIO),
      ...regexRanges(base, RATIO_SENTENCE),
      ...regexRanges(base, INLINE_MEASURE),
    ]),
  )
  for (const unit of DOSE_UNITS) {
    const re = DOSE_CACHE[unit]
    re.lastIndex = 0
    for (const m of deep.matchAll(re)) {
      if (isRealDose(unit, m[0], deep, m.index)) add(m.index, m.index + m[0].length)
    }
  }
  // ④ 「数＋两」逐处判：整条原文照引放行，只报单味药方量的照算
  for (const m of deep.matchAll(DOSE_TWO)) {
    if (!isQuotedFormula(deep, m.index)) add(m.index, m.index + m[0].length)
  }
  const merged = mergeSpans(spans)
  // ⑤ 原单上的量放行：点评别人的方时照念原方上的数，不算自己出量
  if (!keep || keep.size === 0) return merged
  return merged.filter(([start, end]) => !keep.has(doseKey(text.slice(start, end))))
}

/** 一段文字里是否出现了具体剂量（给了原单指纹就按原单口径判）。 */
export function hasDosage(text, keep = null) {
  return doseSpans(text, keep).length > 0
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
/**
 * 别人给的方、书上的原文——这些是转述，不是自己出的量。
 * 判断「有没有自己给量」之前，先把转述那几段剔掉，再判剩下的。
 * 认三种：①引号括起来的（「」『』“”""）；②括号里带原文/引自/图上/方上/原方字样的；
 * ③「按图上原文」「照方上写的」这类提示语后面的整句。剔到这一行结束为止——
 * 句号不断，因为「按图上原文：共 7 剂，一天 1 剂，每次 200ml。」是一整条转述，中间全是逗号。
 */
const QUOTED_PASSAGE = /[「『“"][^「」『』“”"]{0,400}(?:[」』”"])/g
const NOTE_PASSAGE = /[（(][^（）()]{0,120}(?:原文|引自|图上|方上|原方|处方|医嘱)[^（）()]{0,400}[）)]/g
const TOLD_AFTER = /(?:按|照|依)(?:图|方|单)[上文方单][^\n]{0,400}/g

/**
 * 把转述段落换成空格（保留长度，位置不变），剩下的才是自己说的话。
 * @param {string} text
 * @returns {string}
 */
export function stripQuoted(text) {
  if (typeof text !== 'string' || text === '') return text
  const blank = (m) => ' '.repeat(m.length)
  return text.replace(QUOTED_PASSAGE, blank).replace(NOTE_PASSAGE, blank).replace(TOLD_AFTER, blank)
}

/**
 * 把文本里所有具体剂量的「数字＋单位」换成占位符，药名和句子骨架原样留着。
 * 列表项前缀、原文照引、转述整张方都不碰（见 doseSpans）。
 * @param {string} text
 * @param {string} [mark] 占位符，默认 ✳
 * @param {Set<string>} [keep] 原单上的剂量指纹：命中的不遮
 * @returns {string}
 */
export function blotDosage(text, mark = '✳', keep = null) {
  if (typeof text !== 'string' || text === '') return text
  const spans = doseSpans(text, keep)
  if (spans.length === 0) return text
  let out = ''
  let cursor = 0
  for (const [start, end] of spans) {
    out += text.slice(cursor, start) + mark
    cursor = end
  }
  out += text.slice(cursor)
  return tidyBlot(out)
}

/**
 * 遮完清掉留下的残缺符号：空括号、连着两个的顿挫、冒号后直接跟逗号。
 * @param {string} text
 * @returns {string}
 */
function tidyBlot(text) {
  return text
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/[，、]{2,}/g, '，')
    .replace(/([：:])\s*[，、]/g, '$1')
}
