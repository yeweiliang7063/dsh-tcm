/**
 * 中医 · 经方（学习版）· 模拟问诊的「思考开关」
 *
 * 开局造病例、转话、判病人回话，要的是快和稳，不需要长链条推理。所以：
 * - 看到开局指令，就把这一局主模型的推理档位调到最低（尽量关掉）；
 * - 医生点了「交卷」，再把它调回去，让裁判那份回答能好好想；
 * - 这一局的病人子会话（subagent）一露面也调到最低，它只是演病人。
 *
 * 只改这一局会话的运行时选择，不写全局默认；拿不到服务、档位不被模型接受时
 * 原样不动并记日志——问诊是主功能，这个开关是附加的。
 *
 * 两点经验（3.2.14 修）：
 * - 交卷那句和裁判的思考是同一个回合，还原必须当场做完，不能等异步拿 agent，
 *   否则回合已经按最低档开始了。所以开局调低时把 agent 记下来，交卷直接用它。
 * - 用户消息未必带 source.kind，别拿它当门槛，只认文字。
 */
const LOG = '[学理模式·思考开关] '

/** 开局指令的固定开头，与客户端 openRound 里的一致。 */
const OPEN_PREFIX = '【模拟问诊 · 开局】'
/** 交卷指令：客户端「交卷」按钮发出去的就是这两个字。 */
const HAND_IN = '交卷'
/**
 * 医生这一句是不是在问病人。
 * 规则是用户定的：问句就还在问诊，非问句（陈述、方药、治法、取穴、一句「就这样」）
 * 都算答卷，直接进点评。所以只看像不像问句，不看长度、也不认关键词。
 */
const ASK_TAIL = /[？?]\s*$/u
/** 一出现就说明是在交答卷，不再当追问。 */
const ASK_LIKE_WORDS = /(证|治|方|汤|散|丸|药|穴|针|脉|舌)/u
const ASK_WORDS = /(吗|呢|么|不|没|没有|是不是|要不要|有没有|会不会|能不能|怎么|怎样|如何|多少|几天|多久|哪个|哪边|哪些|多长|多重|怕冷还是怕热|喜冷|喜热)\s*$/u

function isQuestion(said) {
  const bare = said.replace(/[\s。．.！!～~，,、]+$/u, '')
  if (!bare) return true
  // 打一句「交卷」当然是在交卷，不是问句
  if (bare === HAND_IN) return false
  if (ASK_TAIL.test(said.trim())) return true
  if (ASK_WORDS.test(bare)) return true
  // 「问一下……」这种开口就问的，也算问句
  if (/^(请问|问一下|问一句|再问|还想问)/u.test(bare)) return true
  // 「咳嗽不」「睡得好不好」这种短问句：带否定词、又没有方药穴字眼，按问句处理
  // （「就这样吧」这类干净短句不算，它是收尾的答卷）
  if (bare.length <= 12 && /(不|没|会不会|要不要|是不是)/u.test(bare) && !ASK_LIKE_WORDS.test(bare)) return true
  return false
}

/** 关掉思考时依次尝试的档位，第一个被模型接受的就用。 */
const OFF_LEVELS = ['off', 'minimal', 'low']

function textOf(input) {
  if (typeof input === 'string') return input
  if (!Array.isArray(input)) return ''
  return input
    .map((part) => (part && part.type === 'text' ? String(part.text || '') : ''))
    .join('')
}

function pickAgent(found) {
  if (!found || typeof found !== 'object') return null
  if (found.model && typeof found.model.select === 'function') return found
  if (found.agent && found.agent.model && typeof found.agent.model.select === 'function') return found.agent
  return null
}

function resolves(ctx, selection) {
  try {
    const llm = ctx.get('llm')
    if (llm && typeof llm.resolveCallConfig === 'function') llm.resolveCallConfig(selection)
    return true
  } catch (error) {
    return false
  }
}

/** 调回原档；原来没设档位就整条去掉，交回模型默认。 */
function restore(agent, previous) {
  const before = agent.model.current()
  if (!before || !before.provider || !before.model) return false
  const selection = { provider: before.provider, model: before.model }
  if (typeof previous === 'string' && previous !== '') {
    selection.reasoningEffort = previous
  }
  agent.model.select(selection)
  return true
}

/**
 * 造这个开关。
 *
 * @param {object} ctx 插件上下文
 * @param {object} [options]
 * @param {(ctx: object, sessionId: string) => string} [options.versionOf] 识版：'xueli' / 'full' / ''
 * @returns {{ thinker: Function, child: Function }} 两个 session/event 监听器：
 *   thinker 管本局主会话，child 管这一局的病人子会话。
 */
export { isQuestion }

export function createSimThinker(ctx, options = {}) {
  const versionOf = typeof options.versionOf === 'function' ? options.versionOf : () => ''
  // 这一局调低之前是多少，交卷时按它还原。
  const restoreOf = new Map()
  // 调低时抓到的 agent，交卷要当场用它还原，不能等异步。
  const agents = new Map()
  // 见过开局的学习版会话：它们的子会话（病人）也算这一局的一部分。
  const simSessions = new Set()

  const agentOf = (sessionId) =>
    Promise.resolve()
      .then(() => {
        const controller = ctx.get('sessionController')
        if (!controller || typeof controller.resolveAgent !== 'function') return null
        return controller.resolveAgent(sessionId)
      })
      .then(pickAgent)
      .catch(() => null)

  /** 与 lower 相同，但校验用插件自己的 ctx（agent.ctx 未必是宿主 ctx）。 */
  function lowerAgent(agent) {
    const before = agent.model.current()
    if (!before || !before.provider || !before.model) return null
    for (const level of OFF_LEVELS) {
      const selection = { provider: before.provider, model: before.model, reasoningEffort: level }
      if (!resolves(ctx, selection)) continue
      agent.model.select(selection)
      return { restore: before.reasoningEffort }
    }
    return null
  }

  const lowerSession = (sessionId, note) => {
    void agentOf(sessionId).then((agent) => {
      if (!agent) return
      const out = lowerAgent(agent)
      if (!out) {
        ctx.logger?.info?.(LOG + '这一局关不掉思考（模型没有更低的档），照原样（%s）', sessionId)
        return
      }
      agents.set(sessionId, agent)
      if (!restoreOf.has(sessionId)) restoreOf.set(sessionId, out.restore)
      ctx.logger?.info?.(LOG + note + '（%s）', sessionId)
    })
  }

  const handIn = (sessionId) => {
    const previous = restoreOf.get(sessionId)
    restoreOf.delete(sessionId)
    const known = agents.get(sessionId)
    agents.delete(sessionId)
    // 当场还原：交卷那句和裁判的思考是同一个回合。
    if (known && restore(known, previous)) {
      ctx.logger?.info?.(LOG + '交卷了，思考给回裁判（%s）', sessionId)
      return
    }
    void agentOf(sessionId).then((agent) => {
      if (!agent) return
      if (restore(agent, previous)) ctx.logger?.info?.(LOG + '交卷了，思考给回裁判（%s）', sessionId)
    })
  }

  const thinker = function onSessionEvent(session, event) {
    try {
      const sessionId = session?.id
      if (!sessionId || !event) return
      if (versionOf(ctx, sessionId) === 'full') return
      if (event.type !== 'user/message') return
      const said = textOf(event.data?.content).trim()
      if (!said) return
      if (said.startsWith(OPEN_PREFIX)) {
        simSessions.add(sessionId)
        lowerSession(sessionId, '这一局先不开思考')
        return
      }
      // 不是问句就是答卷：问诊轮说陈述句、直接给方给穴，都算答完了。
      if (!isQuestion(said)) handIn(sessionId)
    } catch (error) {
      ctx.logger?.warn?.(LOG + '思考开关没动成（不影响问诊）：%o', error)
    }
  }

  const child = function onChildEvent(session) {
    try {
      const sessionId = session?.id
      if (!sessionId) return
      if (session?.origin !== 'subagent') return
      const parent = session?.header?.parentSession || session?.parentSession
      if (!parent || !simSessions.has(parent)) return
      if (versionOf(ctx, sessionId) === 'full') return
      lowerSession(sessionId, '病人这一路子会话不开思考')
    } catch (error) {
      // 病人那边调不动就算了，不影响这一局
    }
  }

  return { thinker, child }
}