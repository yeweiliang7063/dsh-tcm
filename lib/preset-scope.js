/**
 * 会话预设识别：这个插件只管中医会话，别的会话一概不碰。
 *
 * 起因：出口检查原本挂在全局 llm/stream 上，任何对话的回答没写免责句，
 * 它就往末尾补一句「本内容仅供学习参考……」——在聊代码的会话里也冒出来，
 * 看起来像聊天窗口自己在说话。现在先认出是哪类会话，不是中医的直接放行。
 *
 * 认法按可靠程度排：
 * 1. 会话对象上的预设记录（宿主 agentPresets 服务的投影），最准；
 * 2. 预设 id 或显示名里带 tcm；
 * 3. 会话已加载的插件里有本插件（预设把它挂上了），兜底。
 * 哪一步拿不到就往上退一步，全拿到不到才放行——宁可少管，不可乱管。
 */

/** 认中医会话的正则：预设 id、显示名、描述都按这个查。 */
const TCM_MARK = /(tcm|中医|学理|本草|伤寒|方剂|金匮|内经)/i

/** 从会话对象上取一个预设名（可能是字符串，也可能是带 id / title 的对象）。 */
export function presetNameOf(preset) {
  if (typeof preset === 'string') return preset
  if (preset && typeof preset === 'object') {
    for (const key of ['id', 'title', 'name', 'label', 'displayName']) {
      const value = preset[key]
      if (typeof value === 'string' && value.trim() !== '') return value
    }
  }
  return ''
}

/** 预设名（或描述）看起来是不是中医预设。 */
export function looksTcm(preset) {
  const name = presetNameOf(preset)
  if (name !== '' && TCM_MARK.test(name)) return true
  if (preset && typeof preset === 'object') {
    for (const key of ['description', 'desc', 'summary']) {
      if (typeof preset[key] === 'string' && TCM_MARK.test(preset[key])) return true
    }
  }
  return false
}

/**
 * 判断这次请求是不是中医会话。
 * @param {object} ctx Cordis 上下文
 * @param {string|undefined} sessionId 请求包里带的会话 id
 * @param {string} pluginName 本插件名
 * @returns {boolean} 是中医会话才返回 true；拿不准一律 false
 */
export function isTcmSession(ctx, sessionId, pluginName) {
  return isTcmContext(ctx, sessionId, pluginName)
}

/** 三路识别：拿到的会话对象，先看宿主记录的预设。 */
function decideTcm(ctx, session, pluginName) {
  // 1. 宿主记录的预设
  try {
    const registry = typeof ctx.get === 'function' ? ctx.get('agentPresets') : undefined
    const preset = registry?.presetForSession?.(session)
    const name = presetNameOf(preset)
    if (name !== '') return looksTcm(name)
  } catch (error) {
    // 往下退一步
  }
  // 2. 会话头里记的预设
  try {
    const header = session.header ?? {}
    for (const key of ['agentPreset', 'preset', 'presetId']) {
      const name = presetNameOf(header[key])
      if (name !== '') return looksTcm(name)
    }
  } catch (error) {
    // 往下退一步
  }
  // 3. 会话里有没有加载本插件（预设把它挂上，才谈得上管）
  try {
    const root = typeof session.ctx?.get === 'function' ? session.ctx : ctx
    const loader = root.get?.('loader')
    const text = JSON.stringify(loader?.entries?.() ?? loader?.list?.() ?? '')
    if (text.includes(pluginName)) return true
  } catch (error) {
    // 拿不到就当不是
  }
  return false
}

/** 从上下文里取会话对象：提示词组装给的是 agent，llm/stream 给的是 sessionId，两种都认。 */
function pickSession(ctx, source) {
  if (source === undefined || source === null) return undefined
  let root = source
  if (typeof root !== 'string' && typeof root !== 'object') return undefined
  // 提示词组装给的上下文形如 { agent }，会话挂在 agent 上，agent 外面可能还套一层
  for (let depth = 0; depth < 4; depth += 1) {
    if (!root || typeof root !== 'object') break
    if (root.session && typeof root.session === 'object') return root.session
    if (root.agent && typeof root.agent === 'object' && root.agent !== root) {
      root = root.agent
      continue
    }
    break
  }
  const id = typeof root === 'string' ? root : root.sessionId
  if (typeof id !== 'string' || id === '') return undefined
  try {
    const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
    return sessions?.get?.(id)
  } catch (error) {
    return undefined
  }
}

/**
 * 判断一次调用是不是中医会话。传入的可以是会话 id、{ sessionId }，也可以是
 * 提示词组装时的上下文 { agent }（agent 上挂着 session）。
 * @param {object} ctx Cordis 上下文
 * @param {string|object|undefined} source 会话 id 或带会话的上下文
 * @param {string} pluginName 本插件名
 * @returns {boolean} 是中医会话才返回 true；拿不准一律 false
 */
export function isTcmContext(ctx, source, pluginName) {
  const session = pickSession(ctx, source)
  if (!session) return false
  return decideTcm(ctx, session, pluginName)
}

/**
 * 两段式识别，给要「先放行、后补一句」的场合用。
 * @returns {{decided: boolean, tcm: boolean}} decided 表示是否认出了会话类型
 */
export function tcmVerdict(ctx, source, pluginName) {
  try {
    return { decided: true, tcm: isTcmContext(ctx, source, pluginName) }
  } catch (error) {
    return { decided: false, tcm: false }
  }
}
