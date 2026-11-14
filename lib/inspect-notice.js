/**
 * 学理模式 · 出口提醒（纯函数，方便单测）
 *
 * 与 dosage-guard 的分工：
 * - dosage-guard 管「不能说」的东西（克数），命中就截断；
 * - 本文件管「该说却没说的话」，只在回答末尾追加一句提醒，不截断、不改正文。
 *
 * 2026-11-14 新增，起因是实测发现模型虽然知道规矩，仍会：
 * ①把「立刻上医院」的信号埋进正文里；
 * ②一边说附子不能打头阵，一边直接摆出附子打头阵的成方；
 * ③用了附子却不说清第二步往上加的条件和什么情况必须停。
 */

/** 急救信号：出现这些词，说明这一答复涉及需要立刻就医的情况。 */
const RED_FLAGS = [
  '大便带血',
  '呕血',
  '吐血',
  '剧烈腹痛',
  '抽搐',
  '意识不清',
  '神志不清',
  '呼吸困难',
  '冷汗不止',
  '血压骤升',
  '昏迷',
  '晕厥',
  '胸痛',
  '咯血',
]

/** 用户在问自己的病、又在要方子：这类要拦一手，只给思路不给方。 */
const FIRST_VISIT_ASK = /(我该吃|我吃点什么|吃什么药|吃啥药|抓几|抓[一二三四五六七八九十两几\d]+副|开个方|开个药方|开一方|给我开|配副药|配几副|照着喝|喝几副|拿几副|吃几副|直接喝)/
/** 免责与就医提示的标准句式，回答里已有就不追加。 */
const DISCLAIMER = /(不构成诊疗建议|不能替代医生|请及时就医|及时就医)/

/** 出现任意一条，就要求回答里有独立的「立刻上医院」小标题。 */
const ER_HEADING = /(?:⚠️|🚨)?\s*立刻(?:上医院|就医)/

/** 附子、乌头、麻黄、细辛、肉桂、鹿茸这些温燥升提之品（含炮制写法）。 */
const WARM_TOXIC = /(附子|乌头|川乌|草乌|天雄|炮附片|黑顺片|白附片|肉桂|鹿茸|麻黄|细辛)/

/** 「方名后面紧跟一句交底」认的特征字眼：位次、用量次序、先煎与观察、停药条件。 */
const POSITION_HINT = /(佐使|君药|打头|先煎|久煎|炮透|由小|渐增|逐步加|逐步用|从少|少量试|先试|观察一刻钟|观察半|唇舌麻|不麻再|停用|立刻停|马上停|减量|退路)/
/** 交底要交代的范围：本方里它排第几、什么条件才往上加、出现什么就停。 */
const POSITION_PARTS = [/(佐使|君药|打头|由小|渐增|逐步加)/, /(条件|不[见耐]|无头胀|无面红|血压|平稳|服后)/, /(停|麻|心慌|减量|退路)/]

/** 分句用的标点。 */
const SPLIT = /[。；\n]/g

/**
 * 检查一段回答有没有「该说没说」的地方。
 * @param {string} text 整段回答；用户问的话能不能传进来另说，问方子这一项主要看回答自己有没有交代
 * @returns {{redFlag: boolean, erHeading: boolean, warmToxic: string|null, positionHint: boolean}}
 */
export function inspectAnswer(text) {
  const body = typeof text === 'string' ? text : ''
  const redFlag = RED_FLAGS.some((word) => body.includes(word))
  const erHeading = ER_HEADING.test(body)
  // 只认「药名」本身，不认「不用附子」这类否定：命中后再看前后有没有否定词
  let warmToxic = null
  for (const m of body.matchAll(new RegExp(WARM_TOXIC.source, 'g'))) {
    const before = body.slice(Math.max(0, m.index - 4), m.index)
    if (/(不用|不用|不取|忌|禁用|慎用|不宜|暂不|先不)/.test(before)) continue
    warmToxic = m[1]
    break
  }
  const positionHint = POSITION_PARTS.every((re) => re.test(body)) && POSITION_HINT.test(body)
  const askFormula = FIRST_VISIT_ASK.test(body)
  const disclaimer = DISCLAIMER.test(body)
  return { redFlag, erHeading, warmToxic, positionHint, askFormula, disclaimer }
}

/**
 * 把「该说没说」的地方换成一句提醒；没发现问题就返回空串。
 * @param {string} text
 * @returns {string}
 */
export function inspectNotice(text) {
  const r = inspectAnswer(text)
  const lines = []
  if (r.redFlag && !r.erHeading) {
    lines.push('⚠️ 上面这条回复里提到了需要立刻就医的信号，但没有单独立出「⚠️ 立刻上医院」这一条。请按这条自己把住：出现大便带血、呕血、剧烈腹痛、抽搐、意识不清、呼吸困难、冷汗不止、血压骤升、胸痛任一情况，立刻上医院或拨打 120，不要在家观察。')
  }
  if (r.warmToxic && !r.positionHint) {
    lines.push('⚠️ 上面这条回复用了' + r.warmToxic + '这类温燥药，但没交代清楚它在方里排第几、什么条件才往上加、出现什么必须停。请按这条自己把住：血压偏高、高龄体弱、阴虚火旺、汗多体虚的人，先用平补平调打底（党参、白术、干姜、炙甘草一类），' + r.warmToxic + '只作佐使、由小渐增；服后不见头胀头痛、面红、鼻衄、心烦失眠、血压升高，再往上加；一旦出现这些，立刻减量或停用，并用牡蛎、龙骨、牛膝、代赭石镇潜引下。必须炮透、先煎久煎，服后观察唇舌麻木、心慌、恶心呕吐，出现即停并就医。')
  }
  if (!r.disclaimer) {
    lines.push('⚠️ 上面这条回复没写免责提示。本内容仅供学习参考，不能替代医生面诊；身体不适请及时去正规医院就医。')
  }
  if (r.askFormula) {
    lines.push('⚠️ 上面这条回复在替人定方、定量。这类要拦一手：药方抓几副、怎么吃，得让中医师当面看过舌脉才敢定；照这个自己抓药喝，出了事没人担得起。请到正规医院或中医馆面诊。')
  }
  if (!lines.length) return ''
  return '\n\n' + lines.join('\n\n')
}

/** 出口追加提醒时给用户看的抬头。 */
export const INSPECT_NOTICE_HEAD = '【学理模式 · 出口检查】'

/** 上面那段提醒前面统一加抬头。 */
export function withHead(notice) {
  if (!notice) return ''
  return notice.replace(/^(\n\n)/, '$1' + INSPECT_NOTICE_HEAD + '\n')
}