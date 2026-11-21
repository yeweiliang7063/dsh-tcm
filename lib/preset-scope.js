/**
 * 会话预设识别：这个插件只管中医会话，别的会话一概不碰。
 *
 * 起因：出口检查原本挂在全局 llm/stream 上，任何对话的回答没写免责句，
 * 它就往末尾补一句「本内容仅供学习参考……」——在聊代码的会话里也冒出来，
 * 看起来像聊天窗口自己在说话。现在先认出是哪类会话，不是中医的直接放行。
 *
 * 认法按可靠程度排：
 * 1. 会话对象上的预设记录（宿主 agentPresets 服务的投影），最准；
 * 2. 会话头里记下的预设 id / 显示名；
 * 3. 这次请求的提示词本身（组装好的 system 文本里带学理模式总纲），谁带就算谁。
 * 哪一步拿不到就往上退一步，全拿不到一律按「不是中医会话」放行——宁可少管，不可乱管。
 *
 * 早先还留了一步「会话已加载的插件里有本插件」的兜底。本插件是全局挂载的，
 * 每个会话的插件表里都有它，这一步等于把所有会话都认成中医会话，
 * 别的对话里也会遮剂量、开资料库提醒。删除。
 */

import { GEAR_GUARD, GEAR_MARK, PRESET_NAME } from './gear.js'

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

/** 提示词里出现这些句子，就说明这次组装的是学理模式。 */
const TCM_PROMPT_MARKS = [
  GEAR_GUARD.slice(0, GEAR_GUARD.indexOf('\n')),
  GEAR_MARK,
  PRESET_NAME,
]

/**
 * 从这次请求的提示词本身认中医会话：system 文本带着学理模式总纲或预设名就算。
 * 宿主把预设原文拼进 system，这一路不依赖任何宿主服务，最不容易落空。
 * @param {string} text 本次请求的 system 文本
 * @returns {boolean}
 */
export function looksTcmPrompt(text) {
  if (typeof text !== 'string' || text === '') return false
  return TCM_PROMPT_MARKS.some((mark) => typeof mark === 'string' && text.includes(mark))
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
  // 三路都拿不到：按「不是中医会话」放行，宁可少管
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
 * @returns {{decided: boolean, tcm: boolean}} decided=false 只在判断过程抛错时出现
 *   （拿不到会话信息时算「判断成功、不是中医会话」），调用方据此决定要不要补提示。
 */
export function tcmVerdict(ctx, source, pluginName) {
  try {
    return { decided: true, tcm: isTcmContext(ctx, source, pluginName) }
  } catch (error) {
    return { decided: false, tcm: false }
  }
}

/** 两版各用哪个预设 id：学习版是 dsh-tcm-xueli，全量版是 dsh-qihuangjingfang。 */
export const PRESET_XUELI = 'dsh-tcm-xueli'
export const PRESET_FULL = 'dsh-qihuangjingfang'

/** 名字/描述里能认出是哪一版：返回 'xueli'、'full'，认不出返回 ''。 */
export function versionOfName(text) {
  const value = typeof text === 'string' ? text : ''
  if (value === '') return ''
  if (/dsh-qihuangjingfang|完整版|全量版|^qihuang$/i.test(value)) return 'full'
  if (/dsh-tcm-xueli|学习版/i.test(value)) return 'xueli'
  return ''
}

/**
 * 这个会话属于哪一版：'xueli'（学习版）、'full'（全量版）、''（认不出）。
 * 只认会话上记着的预设，不看提示词——工具挂不挂、规则动不动都靠这个判，
 * 判不出就按「不是另一版」处理，宁可不拦也不乱拦。
 * @param {object} ctx Cordis 上下文
 * @param {string|object|undefined} source 会话 id 或带会话的上下文（如 { agent }）
 * @returns {'xueli'|'full'|''}
 */
export function versionOf(ctx, source) {
  const session = pickSession(ctx, source)
  if (!session) return ''
  try {
    const registry = typeof ctx.get === 'function' ? ctx.get('agentPresets') : undefined
    const preset = registry?.presetForSession?.(session)
    const byPreset = versionOfName(presetNameOf(preset))
    if (byPreset !== '') return byPreset
  } catch (error) {
    // 往下退一步
  }
  try {
    const header = session.header ?? {}
    for (const key of ['agentPreset', 'preset', 'presetId']) {
      const byHeader = versionOfName(presetNameOf(header[key]))
      if (byHeader !== '') return byHeader
    }
  } catch (error) {
    // 认不出就回空
  }
  return ''
}
