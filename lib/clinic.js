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
export const TOOL_NAMES = ['xueli_begin_round', 'xueli_finish_round', 'xueli_list_rounds']

/** 记录条数上限：只留最近的，避免常驻进程里越攒越多。 */
const MAX_ROUNDS = 200

function textOf(value) {
  return value === undefined || value === null ? '' : String(value)
}

function linesOf(value) {
  if (!Array.isArray(value)) return []
  return value.map((v) => String(v).trim()).filter(Boolean).slice(0, 40)
}

/** 最简记录库：只在本次运行里记着，不落盘——用户要的是「记录不保留」。 */
export function createStore() {
  const memory = new Map()

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
      patientId: textOf(input.patientId),
      doctorId: textOf(input.doctorId),
    }
    memory.set(id, row)
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
    return row
  }

  async function list(limit) {
    const n = Math.max(1, Math.min(50, Number(limit) || 10))
    return snapshot().slice(0, n)
  }

  return { begin, end, list, snapshot }
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