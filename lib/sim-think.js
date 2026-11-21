/**
 * 中医 · 经方（学习版）· 模拟问诊的「思考开关」
 *
 * 开局造病例、转话、判病人回话，要的是快和稳，不需要长链条推理。所以：
 * - 面板开出来的局（开局指令带「难度｜方向｜局号」），把这一局主模型的推理档位调到最低；
 * - 医生点了「交卷」，再把它调回去，让裁判那份回答能好好想；
 * - 这一局的病人子会话（subagent）一露面也调到最低，它只是演病人。
 *
 * 只管「模拟问诊」面板开出来的会话（3.2.12 起）：在别的会话（含主聊天）里手打开局的话，
 * 问诊协议（闭嘴、交卷认法、打赏计数）照走，但思考档位一个字都不碰。
 * 只改这一局会话的运行时选择，不写全局默认；拿不到服务、档位不被模型接受时
 * 原样不动并记日志——问诊是主功能，这个开关是附加的。
 *
 * 档位一定要还得回去（3.2.12 修）：
 * - 交卷那句和裁判的思考是同一个回合，还原必须当场做完，不能等异步拿 agent，
 *   所以开局调低时把 agent 记下来，交卷直接用它。
 * - 面板换局/返回（弃局）会调 release：当场把这一局连同病人的档位还回去，不留尾巴。
 * - 调低之前把原档写进资料库的小存根（gearSave）；重启/热重载后登记丢了，
 *   再见到这个会话的动静就照存根把档位还回去（只还一次）。
 * - 用户消息未必带 source.kind，别拿它当门槛，只认文字。
 */
import { fromThisMachine } from './dashang.js'

const LOG = '[学理模式·思考开关] '

/** 交卷指令：医生说的这句话里出现「交卷」两个字就算交卷。 */
const HAND_IN = '交卷'
/** 开局指令的固定开头，与客户端 openRound 里的一致。 */
const OPEN_PREFIX = '【模拟问诊 · 开局】'
/** 开头是「（【）模拟问诊 … 开局」，才算模拟问诊那一局；光提「模拟问诊」几个字不算。 */
const OPEN_MARK = /^\s*【?\s*模拟问诊\s*[·・\-—|]?\s*开局/u

function wantsHandIn(said) {
  return String(said || '').includes(HAND_IN)
}
export { wantsHandIn }

/**
 * 面板开出来的局才动思考档位：开局指令必须是
 * 「【模拟问诊 · 开局】难度｜方向｜局号」——开头固定、三段齐全、每段非空。
 * 在别的会话里手打的开局（没有局号）只走问诊协议，不碰档位。
 */
export function panelOpen(said) {
  const text = String(said || '')
  if (!text.startsWith(OPEN_PREFIX)) return false
  const parts = text.slice(OPEN_PREFIX.length).split('｜')
  return parts.length === 3 && parts.every((part) => part.trim() !== '')
}

/** 关掉思考时依次尝试的档位，第一个被模型接受的就用。 */
const OFF_LEVELS = ['off', 'minimal', 'low']

function textOf(input) {
  if (typeof input === 'string') return input
  if (Array.isArray(input)) {
    return input
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        if (typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }
  if (input && typeof input === 'object') {
    if (typeof input.text === 'string') return input.text
    if (Array.isArray(input.parts)) return input.parts.map((part) => (typeof part === 'string' ? part : String(part?.text || ''))).join('')
  }
  return ''
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

/** 交卷后裁判要用的档位：开着 High 想。模型不认这一档就退回开局前的原档。 */
const HAND_IN_LEVEL = 'high'

/**
 * 交卷到场：把档位开到 High。
 * 先试 High，模型不认就退回开局前记下的那一档，再不行就整条去掉，交回模型默认。
 */
export function raiseHigh(ctx, agent, previous) {
  const before = agent.model.current()
  if (!before || !before.provider || !before.model) return false
  const tries = [HAND_IN_LEVEL]
  if (typeof previous === 'string' && previous !== '') tries.push(previous)
  tries.push(undefined)
  for (const level of tries) {
    const selection = { provider: before.provider, model: before.model }
    if (level !== undefined) {
      selection.reasoningEffort = level
      if (!resolves(ctx, selection)) continue
    }
    try {
      agent.model.select(selection)
      return true
    } catch (error) {
      // 试下一档
    }
  }
  return false
}

/**
 * 把档位交回去：先试开局前记下的那一档，再不行就整条去掉，交回模型默认。
 * 与 raiseHigh 不同，这里没有 High 可试——问诊结束了，思考回到用户原来的样子。
 */
function restoreAgent(ctx, agent, previous) {
  const before = agent.model.current()
  if (!before || !before.provider || !before.model) return false
  const tries = []
  if (typeof previous === 'string' && previous !== '') tries.push(previous)
  tries.push(undefined)
  for (const level of tries) {
    const selection = { provider: before.provider, model: before.model }
    if (level !== undefined) {
      selection.reasoningEffort = level
      if (!resolves(ctx, selection)) continue
    }
    try {
      agent.model.select(selection)
      return true
    } catch (error) {
      // 试下一档
    }
  }
  return false
}

/**
 * 造这个开关。
 *
 * @param {object} ctx 插件上下文
 * @param {object} [options]
 * @param {(ctx: object, sessionId: string) => string} [options.versionOf] 识版：'xueli' / 'full' / ''
 * @param {(sessionId: string) => boolean} [options.giftOf] 判完一局问一次要不要摆打赏
 * @param {() => object} [options.gearLoad] 读重启前留下的档位存根
 * @param {(sessionId: string, restore: string) => void} [options.gearSave] 调低前记下原档
 * @param {(sessionId: string) => void} [options.gearDrop] 档位还回去了就清掉存根
 * @returns {{ thinker: Function, child: Function, settled: Function, giftDue: Function, quietOf: Function, release: Function }}
 *   thinker 管本局主会话，child 管这一局的病人子会话，settled 每条回话收尾补压，
 *   quietOf 告诉出口这一轮要不要闭嘴，release 供面板弃局时把档位还回去。
 */
export function createSimThinker(ctx, options = {}) {
  const versionOf = typeof options.versionOf === 'function' ? options.versionOf : () => ''
  // 判完一局问一次：这一局的点评末尾要不要摆打赏（每满十局一次）。问一次就认领，别处不再摆。
  const giftOf = typeof options.giftOf === 'function' ? options.giftOf : () => null
  // 档位存根：调低前记下原档，重启/热重载后靠它还回去。读不到、写不进都不影响这一局。
  const gearLoad = typeof options.gearLoad === 'function' ? options.gearLoad : () => ({})
  const gearSave = typeof options.gearSave === 'function' ? options.gearSave : () => {}
  const gearDrop = typeof options.gearDrop === 'function' ? options.gearDrop : () => {}

  // 闭嘴登记跟着实例走：热重载后新实例不认旧局，也不许背着旧局的闭嘴包袱。
  /** 这一轮正文一个字都不许往外放的会话（开局那一轮、打过「答卷」之后的每一轮）。 */
  const quietly = new Set()
  /** 开过局、且医生已经发过第二句（开局之后那句）的会话。 */
  const answeredOnce = new Set()

  // 这一局调低之前是多少，交卷时按它还原。
  const restoreOf = new Map()
  // 调低时抓到的 agent，交卷要当场用它还原，不能等异步。
  const agents = new Map()
  // 见过开局的会话：协议（闭嘴、交卷、打赏）归它管。
  const simSessions = new Set()
  // 面板开出来的局：只有它们才动思考档位（手打开局只走协议）。
  const panelSessions = new Set()
  // 这一局派出的病人子会话：局收尾/弃局时把它们的档位也还回去。
  const childrenOf = new Map()
  const childSeen = new Set()
  // 交卷之后、点评还没收尾的会话：等点评打完再把原来的档位交回去。
  const judging = new Map()
  // 点评已经打完、答出的那一刻要摆打赏的会话（每满十局一次）。
  const giftPending = new Set()

  // 重启前压低过、还没还回去的档位（会话 id → {restore}）。
  let pendingRestore = {}
  try {
    const loaded = gearLoad()
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) pendingRestore = loaded
  } catch (error) {
    pendingRestore = {}
  }

  const agentOf = (sessionId) =>
    Promise.resolve()
      .then(() => {
        const controller = ctx.get('sessionController')
        if (!controller || typeof controller.resolveAgent !== 'function') return null
        return controller.resolveAgent(sessionId)
      })
      .then(pickAgent)
      .then((agent) => {
        if (!agent) return null
        // 只认这一局自己的 agent：resolveAgent 有时给的是共享/默认的那个，
        // 拿它调档会把别的会话（全量版、普通聊天）一起带上，这里先核对归属。
        const owner = agent.session && typeof agent.session.id === 'string' ? agent.session.id : ''
        if (owner !== sessionId && agent.id !== sessionId) {
          ctx.logger?.info?.(LOG + '拿到的 agent 不属于这一局（%s ≠ %s），不调档', sessionId, owner)
          return null
        }
        return agent
      })
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
    const alive = simSessions.has(sessionId)
    // 病人子会话不在 simSessions 里，认 childrenOf 的登记：局收尾/弃局会把登记删掉。
    const stillChild = () => {
      for (const kids of childrenOf.values()) if (kids.has(sessionId)) return true
      return false
    }
    void agentOf(sessionId).then((agent) => {
      if (!agent) return
      // 交卷（或这一局还没开）之后晚到的那次调档直接放弃，别把 High 又压回最低。
      if (alive && !simSessions.has(sessionId)) return
      // 病人这一路：局已经收尾/弃局（登记没了）就不再压，免得压下一个没人还的档位。
      if (!alive && !panelSessions.has(sessionId) && !stillChild()) return
      const out = lowerAgent(agent)
      if (!out) {
        ctx.logger?.info?.(LOG + '这一局关不掉思考（模型没有更低的档），照原样（%s）', sessionId)
        return
      }
      agents.set(sessionId, agent)
      if (!restoreOf.has(sessionId)) {
        restoreOf.set(sessionId, out.restore)
        // 原档落一份存根：重启/热重载后登记丢了，靠它把档位还回去。
        try { gearSave(sessionId, typeof out.restore === 'string' ? out.restore : '') } catch (error) {
          // 写不进只影响重启后的还原，不影响这一局
        }
      }
      ctx.logger?.info?.(LOG + note + '（%s）', sessionId)
    })
  }

  /** 把这一局病人们的档位也还回去（局收尾/弃局时）。 */
  const restoreChildren = (parentId) => {
    const kids = childrenOf.get(parentId)
    childrenOf.delete(parentId)
    if (!kids) return
    for (const kid of kids) {
      const lowered = restoreOf.has(kid)
      const previous = restoreOf.get(kid)
      const known = agents.get(kid)
      restoreOf.delete(kid)
      agents.delete(kid)
      childSeen.delete(kid)
      // 从没压低过（或调低还在路上——它会自己收手）：没什么可还，别把原档误清成默认。
      if (!lowered) continue
      const giveBack = (agent) => {
        if (restoreAgent(ctx, agent, previous)) {
          try { gearDrop(kid) } catch (error) { /* 存根清不掉不影响还原 */ }
        }
      }
      if (known) { giveBack(known); continue }
      void agentOf(kid).then((agent) => { if (agent) giveBack(agent) })
    }
  }

  /** 点评打完了，把交卷前记下的档位交回去（点评那一轮要一直保持 High）。 */
  const settleBack = (sessionId, previous) => {
    panelSessions.delete(sessionId)
    restoreChildren(sessionId)
    void agentOf(sessionId).then((agent) => {
      if (!agent) return
      if (restoreAgent(ctx, agent, previous)) {
        try { gearDrop(sessionId) } catch (error) { /* 存根清不掉不影响还原 */ }
        ctx.logger?.info?.(LOG + '点评打完，思考档位交回去（%s）', sessionId)
      }
    })
  }

  const handIn = (sessionId) => {
    const previous = restoreOf.get(sessionId)
    restoreOf.delete(sessionId)
    // 交完卷这一局就结束了，之后的聊天不再归这个开关管。
    simSessions.delete(sessionId)
    answeredOnce.delete(sessionId)
    quietly.delete(sessionId)
    const known = agents.get(sessionId)
    agents.delete(sessionId)
    // 当场还原：交卷那句和裁判的思考是同一个回合。
    judging.set(sessionId, previous)
    // 手打的开局只走协议：档位从没动过，也就没什么可还原。
    if (!panelSessions.has(sessionId)) return
    if (known && raiseHigh(ctx, known, previous)) {
      ctx.logger?.info?.(LOG + '交卷了，思考开到 High（%s）', sessionId)
      return
    }
    void agentOf(sessionId).then((agent) => {
      if (!agent) return
      if (raiseHigh(ctx, agent, previous)) ctx.logger?.info?.(LOG + '交卷了，思考开到 High（%s）', sessionId)
    })
  }

  /**
   * 弃局/换局：面板在归档旧局前调这里。把这一局（连同病人）压低的档位当场还回去，
   * 登记全清。没开过局、没动过档位的会话调它也无害。
   */
  const release = (sessionId) => {
    try {
      const key = typeof sessionId === 'string' ? sessionId.trim() : ''
      if (!key) return false
      simSessions.delete(key)
      answeredOnce.delete(key)
      quietly.delete(key)
      const wasPanel = panelSessions.delete(key)
      // 正在点评时弃局：原档记在 judging 里。
      const previous = restoreOf.has(key) ? restoreOf.get(key) : judging.get(key)
      const known = agents.get(key)
      // 动过档位才有得还：调低还在路上的会自己收手（simSessions 已删），这里不必抢着还。
      const hadGear = restoreOf.has(key) || Boolean(known) || judging.has(key)
      restoreOf.delete(key)
      agents.delete(key)
      judging.delete(key)
      giftPending.delete(key)
      restoreChildren(key)
      if (!wasPanel || !hadGear) return false
      const giveBack = (agent) => {
        if (restoreAgent(ctx, agent, previous)) {
          try { gearDrop(key) } catch (error) { /* 存根清不掉不影响还原 */ }
          ctx.logger?.info?.(LOG + '这一局不做了，思考档位交回去（%s）', key)
        }
      }
      // 调低时抓到的 agent 还在就当场还，不等异步（会话可能马上被归档）。
      if (known) { giveBack(known); return true }
      void agentOf(key).then((agent) => { if (agent) giveBack(agent) })
      return true
    } catch (error) {
      ctx.logger?.warn?.(LOG + '弃局还原没动成（不影响会话）：%o', error)
      return false
    }
  }

  const thinker = function onSessionEvent(session, event) {
    try {
      const sessionId = session?.id
      if (!sessionId || !event) return
      if (versionOf(ctx, sessionId) === 'full') return
      // 重启/热重载后登记丢了，但档位还压在会话记录里：照存根还回去，只还一次。
      if (!simSessions.has(sessionId) && !panelSessions.has(sessionId)
        && Object.prototype.hasOwnProperty.call(pendingRestore, sessionId)) {
        const entry = pendingRestore[sessionId]
        delete pendingRestore[sessionId]
        const previous = typeof entry?.restore === 'string' && entry.restore !== '' ? entry.restore : undefined
        void agentOf(sessionId).then((agent) => {
          if (!agent) return
          if (restoreAgent(ctx, agent, previous)) {
            try { gearDrop(sessionId) } catch (error) { /* 存根清不掉不影响还原 */ }
            ctx.logger?.info?.(LOG + '重启前压低的档位，照存根交回去（%s）', sessionId)
          }
        })
      }
      // 点评这一轮（xueli_finish_round 出了结果）就把档位交回去，别让下一段闲聊还跑 High。
      if (event.type === 'tool/result') {
        if (!judging.has(sessionId)) return
        if (JSON.stringify(event.data || '').includes('xueli_finish_round')) {
          const previous = judging.get(sessionId)
          judging.delete(sessionId)
          if (panelSessions.has(sessionId)) settleBack(sessionId, previous)
          // 打赏按「判完那一刻」算：满十局的那一局，点评这一份回答末尾才摆收款码。
          try {
            if (giftOf(sessionId)) giftPending.add(sessionId)
          } catch (error) {
            // 计数出错就不摆，不影响点评
          }
        }
        return
      }
      if (event.type !== 'user/message') return
      const said = textOf(event.data?.content).trim()
      if (!said) return
      // 开局认的是「开头带『模拟问诊』」这句话本身，不看这一局的预设认没认出来：
      // 会话刚建好时预设常常还没挂上，靠它认这一局会漏掉。
      if (OPEN_MARK.test(said) || said.startsWith(OPEN_PREFIX)) {
        simSessions.add(sessionId)
        answeredOnce.delete(sessionId)
        // 开局这一轮只许派病人，正文一个字都不许往外放（派病人的工具块照常走）。
        quietly.add(sessionId)
        // 只有面板开出来的局（带局号）才动思考档位；手打开局只走协议。
        if (panelOpen(said)) {
          panelSessions.add(sessionId)
          lowerSession(sessionId, '这一局先不开思考')
        }
        return
      }
      // 点评已经打完了：医生再开口就换话题，把档位交回去，这一局到此为止。
      if (judging.has(sessionId) && !wantsHandIn(said) && !String(said).includes('答卷')) {
        const previous = judging.get(sessionId)
        judging.delete(sessionId)
        if (panelSessions.has(sessionId)) settleBack(sessionId, previous)
        return
      }
      // 只管这一局：没开过局的会话（普通问答、学习版的其他聊天）一律不碰。
      if (!simSessions.has(sessionId)) return
      // 交卷优先：开局之后第一句就是「交卷」也要认，否则这一局收不了尾、裁判也没思考。
      if (wantsHandIn(said)) {
        quietly.delete(sessionId)
        handIn(sessionId)
        return
      }
      // 闭嘴只有两条：①医生打的字里出现「答卷」两个字，从这一轮起一直闭嘴；
      // ②开局之后的下一句不管说什么，都当「派病人这一轮」放过去——那一轮的正文在开局那一轮已经挡掉了，
      // 这里非放开不可，否则医生问第一句时病人根本不会被叫来。「答卷」优先于这条放行。
      if (String(said).includes('答卷')) {
        answeredOnce.add(sessionId)
        quietly.add(sessionId)
      } else if (!answeredOnce.has(sessionId)) {
        answeredOnce.add(sessionId)
        quietly.delete(sessionId)
        return
      }
      // 还没交卷：模型刚才那一回合可能自己把思考打开了，这里补一次压回去。
      if (restoreOf.has(sessionId)) lowerSession(sessionId, '还没交卷，思考继续保持关')
    } catch (error) {
      ctx.logger?.warn?.(LOG + '思考开关没动成（不影响问诊）：%o', error)
    }
  }

  const child = function onChildEvent(session) {
    try {
      const sessionId = session?.id
      if (!sessionId) return
      if (childSeen.has(sessionId)) return
      if (session?.origin !== 'subagent') return
      const parent = session?.header?.parentSession || session?.parentSession
      // 只认面板开出来的局派出的病人；手打开局的子会话不动档位。
      if (!parent || !panelSessions.has(parent)) return
      if (versionOf(ctx, sessionId) === 'full') return
      childSeen.add(sessionId)
      if (!childrenOf.has(parent)) childrenOf.set(parent, new Set())
      childrenOf.get(parent).add(sessionId)
      lowerSession(sessionId, '病人这一路子会话不开思考')
    } catch (error) {
      // 病人那边调不动就算了，不影响这一局
    }
  }

  /**
   * 助手这一句说完了：还在问诊阶段，就把档位再压回最低。
   * 用户打断生成时，下一回合会照当时的档位开跑——模型自己打开过思考，
   * 就会一路想下去、把治法方药写出来（实测）。所以每条回话收尾都压一次。
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

  /**
   * 这一份回答答完的那一刻，问一次要不要摆打赏（每满十局在点评末尾摆一次）。
   * 认领了就清标记：一轮里就算被问好几次，也只会摆一次。
   * 只认「评完那一轮」的会话，别的时候一律 false。
   */
  const giftDue = function onGiftDue(sessionId) {
    try {
      const key = typeof sessionId === 'string' ? sessionId : ''
      if (!key || !giftPending.has(key)) return false
      giftPending.delete(key)
      return true
    } catch (error) {
      return false
    }
  }

  /** 这一轮要不要闭嘴：开局那一轮、医生打过「答卷」之后的每一轮，都闭嘴。 */
  const quietOf = (sessionId) => Boolean(sessionId) && quietly.has(sessionId)

  return { thinker, child, settled, giftDue, quietOf, release }
}

/**
 * 开一条本机通道给面板用：换局/返回（弃局）时通知这里把档位还回去。
 * 只认本机页面、只认 GET；挂不上只等于弃局时靠重启存根兜底，不影响问诊。
 * @param {object} ctx 插件 context
 * @param {{release: (sessionId: string) => void, path?: string, log?: string}} options
 */
export async function mountSimEndRoute(ctx, options = {}) {
  const log = options.log || LOG
  const routePath = options.path || '/dsh-tcm-xueli/sim-end'
  const release = typeof options.release === 'function' ? options.release : () => {}

  let webServer = ctx.get ? ctx.get('webServer') : undefined
  /* Web 服务可能比本插件晚就位：最多等十秒，等不到就明说，不硬撑。 */
  for (let i = 0; i < 20 && (!webServer || typeof webServer.register !== 'function'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    webServer = ctx.get ? ctx.get('webServer') : undefined
  }
  if (!webServer || typeof webServer.register !== 'function') {
    throw new Error('这台 DSH 没有 Web 服务，弃局通知挂不上')
  }

  const dispose = webServer.register({
    kind: 'exact',
    path: routePath,
    handler: (req, res) => {
      const send = (code, payload) => {
        const body = JSON.stringify(payload)
        res.writeHead(code, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(body),
        })
        res.end(body)
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      // 只认真正的本机连接：Host 头是客户端随便写的，光看它挡不住远程伪造。
      if (!fromThisMachine(req)) {
        send(403, { ok: false, reason: '只接受本机页面。' })
        return
      }
      let url
      try {
        url = new URL(req.url || '/', 'http://127.0.0.1')
      } catch {
        send(400, { ok: false, reason: '参数看不懂。' })
        return
      }
      const sessionId = String(url.searchParams.get('session') || '').slice(0, 120)
      try {
        release(sessionId)
      } catch (error) {
        ctx.logger?.warn?.(log + '弃局还原出错（不影响会话）：' + String(error && error.message ? error.message : error))
      }
      send(200, { ok: true })
    },
  })

  ctx.logger?.info?.(log + '弃局通道已开：' + routePath)
  return () => {
    try { dispose?.() } catch (error) {
      ctx.logger?.warn?.(log + '关闭弃局通道出错：' + String(error && error.message ? error.message : error))
    }
  }
}