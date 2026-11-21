/**
 * 中医 · 经方（学习版）· 模拟问诊的「病例卡」
 *
 * 从「中医岐黄」工作台并过来的三件事，现在归学习版自己管：
 * - xueli_begin_round：开局定病例，把题面记进本次运行的记录；
 * - xueli_finish_round：医生交卷、判完之后记结论；
 * - xueli_list_rounds：翻本次运行里的记录。
 *
 * 为什么改名加前缀：岐黄工作台若还装着，它那三个同名工具会撞车。
 * 底牌与记录只留在本次运行的进程里，不落盘、不写进给医生或病人的任何消息。
 *
 * 任何一步失败都只记日志，绝不向上抛：问诊是主功能，记录是附加功能。
 */
import { versionOf } from './preset-scope.js'
import { blotDosage } from './dosage-guard.js'

const LOG = '[学理模式·问诊] '
export const TOOL_NAMES = ['xueli_draw_anchor', 'xueli_begin_round', 'xueli_finish_round', 'xueli_list_rounds']

/** 记录条数上限：只留最近的，避免常驻进程里越攒越多。 */
const MAX_ROUNDS = 200

/* 每局随机锚点：六经＋病机一对＋诱因。只走工具结果，不进任何医生可见的消息。 */
const ANCHOR_LIUJING = ['太阳', '阳明', '少阳', '太阴', '少阴', '厥阴']
const ANCHOR_YOUYIN = ['受凉', '饮食不节', '劳累过度', '情志不遂', '误服过不对症的方', '久病体弱', '熬夜']
const ANCHOR_BINGJI = {
  '简单': ['寒证', '热证', '虚证', '实证'],
  '普通': ['表里同病', '气机不畅', '水饮内停', '湿热内蕴', '痰湿中阻', '食积'],
  '困难': ['寒热错杂', '虚实夹杂', '津液受伤', '血瘀', '上热下寒', '真寒假热'],
}
/** 锚点只记最近八局，抽过的不再抽。 */
const ANCHOR_MEMORY = 8

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)]
}

/** 抽一对病机：第二抽从去掉第一抽的池里拿，不会出「寒证＋寒证」。 */
function pickBingjiPair(pool) {
  const a = pickOne(pool)
  const rest = pool.filter((one) => one !== a)
  return [a, rest.length ? pickOne(rest) : a]
}

function textOf(value) {
  return value === undefined || value === null ? '' : String(value)
}

function linesOf(value) {
  if (!Array.isArray(value)) return []
  return value.map((v) => String(v).trim()).filter(Boolean).slice(0, 40)
}

/**
 * 最简记录库：只在本次运行里记着，不落盘——用户要的是「记录不保留」。
 * 例外是抽过的锚点：它要跨重启记得住，否则重启后第一局就可能撞上天的病；
 * 由外面传读写函数进来（存在资料库「医案」目录下的一个小文件里），
 * 读写失败一律当没有，绝不影响抽题。
 */
export function createStore(options = {}) {
  const memory = new Map()
  const loadSeen = typeof options.loadSeen === 'function' ? options.loadSeen : () => []
  const saveSeen = typeof options.saveSeen === 'function' ? options.saveSeen : null
  const loadRounds = typeof options.loadRounds === 'function' ? options.loadRounds : () => []
  const saveRound = typeof options.saveRound === 'function' ? options.saveRound : null
  /** 上次抽到的锚点，挂在题面上一起存；翻记录时能看出上一局出的什么题。 */
  let lastAnchor = ''
  /** 最近抽过的锚点（八局内不重复）。开局先向外面要一次，保证重启后也认得出。 */
  const anchorHistory = []
  try {
    const saved = loadSeen()
    if (Array.isArray(saved)) anchorHistory.push(...saved.filter((one) => typeof one === 'string').slice(-ANCHOR_MEMORY))
  } catch (error) {
    // 读不到就算了
  }

  // 最近几局从盘上读回来：重启后 xueli_list_rounds 照样翻得到上几局出过什么病。
  try {
    const rows = loadRounds()
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const id = textOf(row.id).trim()
        if (!id) continue
        memory.set(id, {
          id,
          createdAt: Number(row.createdAt) || 0,
          level: textOf(row.level),
          direction: textOf(row.direction),
          caseSummary: textOf(row.caseSummary),
          verdict: textOf(row.verdict),
          failLine: textOf(row.failLine),
          prescribe: textOf(row.prescribe),
          anchor: textOf(row.anchor),
          finishedAt: Number(row.finishedAt) || 0,
        })
      }
      while (memory.size > MAX_ROUNDS) {
        const oldest = memory.keys().next()
        if (oldest.done) break
        memory.delete(oldest.value)
      }
    }
  } catch (error) {
    // 读不到就当没有记录
  }

  function keepRow(row) {
    if (!saveRound || !row) return
    try { saveRound(row) } catch (error) { /* 存不进只影响下次翻记录 */ }
  }

  function rememberAnchor(one) {
    anchorHistory.push(one)
    while (anchorHistory.length > ANCHOR_MEMORY) anchorHistory.shift()
    if (!saveSeen) return
    try {
      saveSeen(anchorHistory.slice())
    } catch (error) {
      // 存不进去只影响下一局，不影响这一局
    }
  }

  /** 现抽一条锚点：难度决定病机池；抽过的八局内不再抽。 */
  function drawAnchor(level) {
    const pool = ANCHOR_BINGJI[String(level || '').trim()] || ANCHOR_BINGJI['普通']
    let picked = ''
    for (let i = 0; i < 60; i += 1) {
      const pair = pickBingjiPair(pool)
      const one = [pickOne(ANCHOR_LIUJING), pair[0], pair[1], pickOne(ANCHOR_YOUYIN)].join('|')
      if (!anchorHistory.includes(one)) { picked = one; break }
    }
    if (picked === '') {
      const pair = pickBingjiPair(pool)
      picked = [pickOne(ANCHOR_LIUJING), pair[0], pair[1], pickOne(ANCHOR_YOUYIN)].join('|')
    }
    rememberAnchor(picked)
    lastAnchor = picked
    const [liujing, bingjiA, bingjiB, youyin] = picked.split('|')
    return {
      anchor: picked,
      line: `起手经络：${liujing}；病机：${bingjiA}＋${bingjiB}；诱因：${youyin}`,
    }
  }

  function snapshot() {
    // 同一毫秒开的两局 createdAt 会一样：用 Map 的插入次序兜底，后开的排前面。
    let order = 0
    const rows = []
    for (const row of memory.values()) rows.push({ row, order: order++ })
    rows.sort((a, b) => (b.row.createdAt || 0) - (a.row.createdAt || 0) || b.order - a.order)
    return rows.map((item) => item.row)
  }

  async function begin(input) {
    const id = textOf(input.id).trim()
    if (!id) return null
    // 同一局号重开：整条换新，绝不把上一局的结论带过来。
    const row = {
      id,
      createdAt: Date.now(),
      level: textOf(input.level),
      direction: textOf(input.direction),
      caseSummary: textOf(input.caseSummary),
      anchor: lastAnchor,
      patientId: textOf(input.patientId),
      doctorId: textOf(input.doctorId),
    }
    memory.set(id, row)
    keepRow(row)
    while (memory.size > MAX_ROUNDS) {
      const oldest = memory.keys().next()
      if (oldest.done) break
      memory.delete(oldest.value)
    }
    return row
  }

  async function end(input) {
    const id = textOf(input.id).trim()
    if (!id) return null
    const row = memory.get(id) || { id, createdAt: Date.now() }
    Object.assign(row, {
      verdict: textOf(input.verdict),
      failLine: textOf(input.failLine),
      failPoints: linesOf(input.failPoints),
      mustAsk: linesOf(input.mustAsk),
      prescribe: textOf(input.prescribe),
      finishedAt: Date.now(),
    })
    memory.set(id, row)
    keepRow(row)
    return row
  }

  async function list(limit) {
    const n = Math.max(1, Math.min(50, Number(limit) || 10))
    return snapshot().slice(0, n)
  }

  /** 从磁盘再读一次（用户可能在别处删了记录文件）：只补，不覆盖现有记忆。 */
  function reloadSeen() {
    try {
      const saved = loadSeen()
      if (!Array.isArray(saved)) return
      for (const one of saved) {
        if (typeof one === 'string' && !anchorHistory.includes(one)) anchorHistory.push(one)
      }
      while (anchorHistory.length > ANCHOR_MEMORY) anchorHistory.shift()
    } catch (error) {
      // 读不到就算了
    }
  }

  /** 开局前先看一眼最近几局用过的锚点，避免撞上天的病。 */
  function noteSeen(list) {
    if (!Array.isArray(list)) return
    for (const one of list) {
      if (typeof one === 'string' && one && !anchorHistory.includes(one)) anchorHistory.push(one)
    }
    while (anchorHistory.length > ANCHOR_MEMORY) anchorHistory.shift()
    if (saveSeen) {
      try { saveSeen(anchorHistory.slice()) } catch (error) { /* 存不进不影响 */ }
    }
  }

  return { begin, end, list, snapshot, drawAnchor, reloadSeen, noteSeen }
}

function pick(description, values) {
  return { type: 'string', description, enum: values.slice() }
}

function str(description) { return { type: 'string', description } }
function arr(description) { return { type: 'array', description, items: { type: 'string' } } }
function num(description) { return { type: 'number', description } }

/** 原生 JSON Schema：工具参数（必须显式 additionalProperties）。 */
function objectSchema(properties, required) {
  return { type: 'object', properties, required: required || [], additionalProperties: false }
}

/** 工具返回值：结构固定，多出来的字段也允许（render 只取用得到的两三样）。 */
const OUT = { type: 'object', additionalProperties: true }

/** 注册三个工具；宿主没有工具服务时安静退场，不拖垮插件。 */
export async function registerClinicTools(ctx, store) {
  const tools = ctx.get ? ctx.get('tools') : undefined
  if (!tools || typeof tools.register !== 'function') {
    ctx.logger?.warn?.(LOG + '宿主没有工具服务，问诊记录工具没装（不影响聊天）')
    return () => {}
  }
  const disposers = []
  // 两版工具不许串：全量版会话里这三个工具一律不出现（挂在注册条件上，不是执行时再拦）。
  const onlyXueli = {
    when: (context) => {
      try {
        return versionOf(ctx, context?.agent) !== 'full'
      } catch (error) {
        // 判不出来就照常挂：拦错会把主功能关掉，这里宁可少管。
        return true
      }
    },
  }
  const ok = (text) => [{ type: 'text', text }]
  const warn = (msg, error) => {
    ctx.logger?.warn?.(LOG + msg + '：' + String(error && error.message ? error.message : error))
  }

  disposers.push(tools.register({
    name: 'xueli_draw_anchor',
    description: '【模拟问诊·抽题】开局第一步先调这个：插件现抽本局锚点（六经＋一对病机＋诱因），病例只围着它编。锚点是出题底牌，不许出现在给医生看的任何文字里。',
    parameters: objectSchema({
      level: pick('难度，只能填这三个之一。', ['简单', '普通', '困难']),
    }, ['level']),
    output: { schema: OUT, render: (_args, value) => ok(textOf(value && value.message)) },
    async execute(args) {
      const drawn = store.drawAnchor(args?.level)
      return {
        ok: true,
        anchor: drawn.anchor,
        message: '【本局锚点】' + drawn.line
          + '。照这个锚点现编病例：主症、舌象脉象、起病经过都围着它转；锚点以外的六经病机一律不用。这一行是出题底牌，不许写进医生可见的任何文字，也不许进病人台词。',
      }
    },
    ...onlyXueli,
  }))

  disposers.push(tools.register({
    name: 'xueli_begin_round',
    description: '【模拟问诊·开局】造好病例、派出病人之后调用一次，把这一局的题面记下（只记一句话题面，不记病例细节）。',
    parameters: objectSchema({
      id: str('本局编号，如 20261119-1。'),
      level: pick('难度，只能填这三个之一。', ['简单', '普通', '困难']),
      direction: pick('方向，只能填这三个之一。', ['方药', '针灸', '针药']),
      case_summary: str('病例一句话（不含底牌细节）：如「男 45 岁，胃脘痞满」。'),
      patient_session_id: str('演病人的子代理名字（派病人时返回的那个名字）。'),
      doctor_session_id: str('医生会话（本局问诊所在会话）的 id，不填就取当前会话。'),
    }, ['id', 'level', 'direction']),
    output: { schema: OUT, render: (_args, value) => ok(textOf(value && value.message)) },
    async execute(args, exec) {
      const doctor = textOf(args.doctor_session_id) || textOf(exec?.agent?.id)
      const row = await store.begin({
        id: textOf(args.id),
        level: textOf(args.level),
        direction: textOf(args.direction),
        caseSummary: textOf(args.case_summary),
        patientId: textOf(args.patient_session_id),
        doctorId: doctor,
      }).catch((error) => {
        warn('开局记录失败', error)
        return null
      })
      return {
        ok: Boolean(row),
        id: textOf(args.id),
        message: row ? '这一局的题面已记下（只在本次运行里，不落盘）。' : '题面没记上；不影响问诊，继续。',
      }
    },
  }, onlyXueli))

  disposers.push(tools.register({
    name: 'xueli_finish_round',
    description: '【模拟问诊·交卷】医生交卷、你判完之后调用一次，把结论记下（只在本次运行里，不落盘）。',
    parameters: objectSchema({
      id: str('本局编号。'),
      verdict: pick('结论，只能填这三个之一。', ['过关', '边缘', '不过关']),
      fail_line: str('一句话说为什么。'),
      fail_points: arr('硬错逐条（每条一句话）。'),
      must_ask: arr('医生漏问的关键问题。'),
      prescribe: str('医生本局给出的方药或取穴（只写药名／穴位名，不写克数）。'),
    }, ['id', 'verdict']),
    output: { schema: OUT, render: (_args, value) => ok(textOf(value && value.message)) },
    async execute(args, exec) {
      const doctor = textOf(exec?.agent?.id)
      const row = await store.end({
        id: textOf(args.id),
        doctorId: doctor,
        verdict: textOf(args.verdict),
        failLine: textOf(args.fail_line),
        failPoints: linesOf(args.fail_points),
        mustAsk: linesOf(args.must_ask),
        prescribe: textOf(args.prescribe),
      }).catch((error) => {
        warn('成绩记录失败', error)
        return null
      })
      return {
        ok: Boolean(row),
        id: textOf(args.id),
        message: row ? '这一局的成绩已记下（只在本次运行里，不落盘）。' : '成绩没记上，只在本次运行里。',
      }
    },
  }, onlyXueli))

  disposers.push(tools.register({
    name: 'xueli_list_rounds',
    description: '【模拟问诊】翻本次运行里最近的问诊记录：题面、方名或穴位名、结论都在，只是不带克数。开局前先看一遍，避免出重复的病。',
    parameters: objectSchema({ limit: num('列几条，默认 10。') }),
    output: { schema: OUT, render: (_args, value) => ok(textOf(value && value.text)) },
    async execute(args) {
      const rows = await store.list(args.limit)
      const text = rows.length
        ? rows.map((r) => [
          new Date(r.createdAt).toLocaleString('zh-CN'),
          (r.level || '') + '·' + (r.direction || ''),
          r.caseSummary ? '题面 ' + r.caseSummary : '',
          r.prescribe ? '方 ' + blotDosage(String(r.prescribe)) : '',
          r.verdict || '（未交卷）',
          r.failLine ? blotDosage(String(r.failLine)) : '',
        ].filter(Boolean).join('　')).join('\n')
        : '还没有记录。'
      return { count: rows.length, text }
    },
  }, onlyXueli))

  return () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch { /* 已经卸载 */ }
    }
  }
}