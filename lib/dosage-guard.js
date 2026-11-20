/**
 * 学理模式 · 出口校验（纯函数，方便单测）
 *
 * 两件事：
 * 1. 判断一段助手回答里有没有「具体剂量」的数值写法；
 * 2. 把这种数值整截遮成 *，只用于显示层兜底。
 *
 * 2026-11-16 修订：从「挖掉整句」改成「只遮数值」。
 * - 旧版把命中剂量的整个分句换成 *，药名和句子骨架一起没了，读者只看到一个孤零零的 *；
 *   现在只把「数字＋单位」这一截换成 *，药名与前后文原样留着：桂枝 9 克 → 桂枝*。
 * - 列表项前缀（行首「2. **药名**」「- **药名**：」）永不参与打码，列表结构不会被挖断。
 * 只认「数字＋克/g」这一路：桂枝9克、黄芪30g。两、钱、枚、升、合这些经典计量不动，
 * 它们本来就不是抓药的克数，遮了只让原文读不通。
 * 明确不碰：「六经」这类词里的「六」、「第 35 条」这类条号、「1.5 小时」这类时长、「十天半月」这类口语。
 *
 * 唯一放行凭据是引号：整段原文放进「」『』“”里才不遮（见 quotedRanges）；
 * 括号里的「原文：……」、段首的「按图上原文」都不算凭据，没引号的一个数都照遮。
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

/** 数字写法：阿拉伯数字，或「两/几/数」加中文数字拼起来的数目（两包、几克、数枚、十二枚）。 */
const NUM = String.raw`(?:\d+(?:\.\d+)?|[０-９]+(?:．[０-９]+)?|[两几数]?[${HAN}]+|[两几数])`

/**
 * 数字后接 g：后面不能紧跟字母，免得 GB、GIF 这类单词被当成剂量。
 * 现行口径（2026-11）：只遮「克」前面的数字；毫升、两、钱、枚这些经典计量不遮。
 */
function latinHitRe() {
  // 全角数字、全角 Ｇ、毫克／公克／mg／gm／ｍｇ 都要认：漏一个就等于没遮。
  return /(?:\d+(?:\.\d+)?|[０-９]+(?:．[０-９]+)?|[一二三四五六七八九十百千半]+)\s*(?:毫克|公克|mg|gm|[gGＧ]|[ｍＭ][ｇＧ])(?![a-zA-Z])/gi
}

/** 需要遮的量词：只剩「克」这一路（含「克重」与拉丁写法 g）。 */
const DOSE_UNITS = ['克重', '克', '剋', '尅']

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

/** 条号、章节号、卷次不算剂量：先剥掉再判。 */
const ARTICLE_MARK = /第\s*\d+\s*(?:条|篇|难|章|节|卷|门|集)|宋本\s*第?\s*\d+|卷\s*[一二三四五六七八九十\d]+/g

/**
 * 比例说法：「比例一比一」「桂枝加倍、比例 2 比 1」「芍药加倍」。
 * 这是讲原方各味药的轻重对比，不是可照抓的量，整段抹掉再判。
 */
const RATIO_PHRASE = /比例|之比|配比|倍|等分/g
/** 比例说法本身（「1 比 1」「二比一」）：这几个字不是剂量。 */
const RATIO_ITEM = /\d+\s*[:：比]\s*\d+|[一二三四五六七八九十]\s*比\s*[一二三四五六七八九十]/g

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

/**
 * 找出文本里所有真正算剂量的「数字＋单位」位置 [起, 止)。
 * 判定口径：引号里的原文、比例说法、条号先排除，剩下的才是自己给的量。
 * @param {string} text
 */
function doseSpans(text) {
  if (typeof text !== 'string' || text === '') return []
  // 先遮掉「不是自己给量」的整段：引号里的原文、条号。
  let base = stripQuoted(text)
  base = blankRanges(base, regexRanges(base, ARTICLE_MARK))
  const spans = []
  const add = (start, end) => {
    if (end > start) spans.push([start, end])
  }
  // ① 阿拉伯数字带 g
  for (const m of base.matchAll(latinHitRe())) {
    add(m.index, m.index + m[0].length)
  }
  // ② 中文「数＋克」：先把「1 比 1」这种比例本身抹掉，再按单味药逐个判
  const deep = blankRanges(base, regexRanges(base, RATIO_ITEM))
  for (const unit of DOSE_UNITS) {
    const re = DOSE_CACHE[unit]
    re.lastIndex = 0
    for (const m of deep.matchAll(re)) add(m.index, m.index + m[0].length)
  }
  return mergeSpans(spans)
}

/** 一段文字里是否出现了具体剂量。 */
export function hasDosage(text) {
  return doseSpans(text).length > 0
}

/** 所有「数 + 克」合成一个正则（长的单位排前面），打码时一次替换。 */
function doseOneAll() {
  return new RegExp(
    String.raw`(?<![${HAN}\d])(?<![${NOT_DOSE_PREV}])(${NUM})\s*(克重|克|剋)(?![${NOT_DOSE_NEXT}])`,
    'g',
  )
}

/**
 * 把剂量数值打码：「数字＋单位」整截换成 *，药名和前后文原样留着（桂枝 9 克 → 桂枝*）。
 * 只打「克」这一路；两、钱、枚这些经典计量与原文引文一律不动。
 * @param {string} text
 * @returns {string}
 */
/** 显示层兜底：与出口同一套判据，别留两套口径。 */
export function maskDosage(text) {
  return blotDosage(text, '*')
}
/**
 * 引号配对：只认「」『』“”，逐字扫，配对成功且合规才算「原文照引」。
 * 任何一条不合规，一律按自己复述处理，剂量照遮：
 * ① 开合必须成对——只有开头没结尾的，就当没加引号；
 * ② 一句引文最多 QUOTE_MAX 字——再长就不是引一句，是整段搬；
 * ③ 不跨空行、不跨代码块围栏——跨了就不算「引一句原文」。
 */
const QUOTE_PAIRS = { '「': '」', '『': '』', '“': '”' }
const QUOTE_MAX = 240

/** 合规的引文区间 [起, 止)。 */
export function quotedRanges(text) {
  const out = []
  if (typeof text !== 'string' || text === '') return out
  let i = 0
  while (i < text.length) {
    const open = text[i]
    const close = QUOTE_PAIRS[open]
    if (!close) {
      i += 1
      continue
    }
    let j = i + 1
    let ok = false
    while (j < text.length) {
      const ch = text[j]
      if (ch === close) {
        ok = true
        break
      }
      if (ch === open) break // 同类引号又开了一次：这一段没配对
      if (ch === '\n') {
        const next = text.slice(j + 1, j + 8)
        if (/^\s*\n/.test(next) || /^\s*(```|~~~)/.test(next)) break
      }
      if (j - i - 1 >= QUOTE_MAX) break
      j += 1
    }
    if (ok) {
      out.push([i, j + 1])
      i = j + 1
    } else {
      i += 1
    }
  }
  return out
}

/**
 * 把引文段落换成空格（保留长度，位置不变），剩下的才是自己说的话。
 * 只认「」『』“”这一种凭据：括号里的「原文：……」、段首的「按图上原文」都不算数。
 * @param {string} text
 * @returns {string}
 */
export function stripQuoted(text) {
  if (typeof text !== 'string' || text === '') return text
  return blankRanges(text, quotedRanges(text))
}

/**
 * 流式切句的安全切点：切点落在引号中间（引文还没闭合）时前移到开引号处，
 * 免得一块只剩半个引文、被当成「没加引号」误遮；返回 0 表示这块先别发，等下一块。
 * @param {string} text 当前缓冲
 * @param {number} cut 原定切点
 * @returns {number}
 */
export function quoteSafeCut(text, cut) {
  if (!(cut > 0)) return cut
  // 缓冲太长还没闭合的引号，不是「引一句原文」，别再往后挪，照常发（会被当没加引号遮掉），
  // 否则一个忘写收尾的引号能把整轮回答一直扣在缓冲里。
  if (text.length > QUOTE_MAX * 3) return cut
  let safe = cut
  const pairs = quotedRanges(text)
  for (const [a, b] of pairs) {
    if (a < safe && safe < b) {
      safe = a
      break
    }
  }
  // 还没闭合的开引号（含被「超长／跨空行」判无效的引文）：切点前移到引号处，等它闭合再判
  for (let i = 0; i < safe; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(QUOTE_PAIRS, text[i])) continue
    if (pairs.some(([a, b]) => i >= a && i < b)) continue
    safe = i
    break
  }
  return safe
}

/**
 * 把文本里所有具体剂量的「数字＋单位」换成占位符，药名和句子骨架原样留着。
 * 列表项前缀、引号里的原文不碰（见 doseSpans）。
 * @param {string} text
 * @param {string} [mark] 占位符，默认 *
 * @returns {string}
 */
export function blotDosage(text, mark = '*') {
  if (typeof text !== 'string' || text === '') return text
  const spans = doseSpans(text)
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
