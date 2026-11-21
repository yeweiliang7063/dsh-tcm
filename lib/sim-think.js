/**
 * 中医 · 经方（学习版）· 模拟问诊的「思考开关」
 *
 * 开局造病例、转话、判病人回话，要的是快和稳，不需要长链条推理。所以：
 * - 看到开局指令，就把这一局主模型的推理档位调到最低（尽量关掉）；
 * - 医生点了「交卷」，再把它调回去，让裁判那份回答能好好想；
 * - 这一局的病人子会话（subagent）一露面也调到最低，它只是演病人。
 *
 * 只管模拟问诊这一局的会话（开过局的才算），普通聊天一个字都不碰；只改运行时选择，
 * 不写全局默认；拿不到服务、档位不被模型接受时
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
/** 医生只有明确说「交卷」（或点客户端那个按钮）才算交完卷，别的都不动。 */
const HAND_IN_TAIL = /(交卷|交卷了|交卷吧|交答卷|交上答卷)/u

function wantsHandIn(said) {
  const bare = String(said || '').replace(/[\s。．.！!～~，,、？?]+$/u, '')
  if (!bare) return false
  if (bare === HAND_IN) return true
  return bare.length <= 10 && HAND_IN_TAIL.test(bare)
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
export { wantsHandIn }

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
    // 交完卷这一局就结束了，之后的聊天不再归这个开关管。
    simSessions.delete(sessionId)
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
      // 只管这一局：没开过局的会话（普通问答、学习版的其他聊天）一律不碰。
      if (!simSessions.has(sessionId)) return
      // 还没交卷：模型刚才那一回合可能自己把思考打开了，这里补一次压回去。
      if (!wantsHandIn(said)) {
        if (restoreOf.has(sessionId)) lowerSession(sessionId, '还没交卷，思考继续保持关')
        return
      }
      // 医生说了「交卷」：这句和裁判的回答是同一个回合，必须当场把档位还原，点评才有思考。
      handIn(sessionId)
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

  /**
   * 助手这一句说完了：还在问诊阶段，就把档位再压回最低。
   * 用户打断生成时，下一回合会照当时的档位开跑——模型自己打开过思考，
   * 就会一路想下去、把治法方药写出来（3.2.13 实测）。所以每条回话收尾都压一次。
   */
  const settled = function onAssistantEvent(session, event) {
    try {
      const sessionId = session?.id
      if (!sessionId) return
      if (event?.type !== 'assistant/message') return
      if (versionOf(ctx, sessionId) === 'full') return
      if (!simSessions.has(sessionId)) return
      if (!restoreOf.has(sessionId)) return
      lowerSession(sessionId, '问诊还没完，思考压回最低')
    } catch (error) {
      // 压不回去不影响问诊
    }
  }

  return { thinker, child, settled }
}