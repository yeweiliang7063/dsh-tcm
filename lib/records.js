/**
 * 岐黄经方 · 会话归档（学理模式版）
 *
 * 一个中医会话对应一份 Markdown，不再一条回答一个文件：
 * - 文件名用会话标题（例如「61岁高血压患者后脑勺疼.md」）；
 * - 正文保存整段会话里真人说的话和岐黄经方的回答；
 * - 标题变化时自动改名，旧文件随之删除；
 * - 只记本插件预设（dsh-tcm）及旧版 tcm 别名的会话，普通编码会话不写。
 *
 * 任何异常都只返回 null 或记日志，绝不向上抛：归档失败不能影响会话。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 回答归档目录，和五类文件夹里的「医案」是同一个。 */
export const RECORD_DIR = '医案'
/** 本插件预设的 id；只有这个预设（及旧版 tcm 别名）的会话才归档。 */
export const DEFAULT_PRESET = 'dsh-tcm'
/** 旧版预设 id；早先开的中医会话仍可能用它，继续认。 */
const LEGACY_PRESETS = new Set(['tcm'])
/** 文件名最多保留多少字符，避免超长标题把路径顶爆。 */
const MAX_TITLE = 80

/** 从 content 块数组里取可见正文；reasoning / 工具调用块不要。 */
export function answerText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n')
    .trim()
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function readableOf(date) {
  const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  return [
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`,
  ].join(' ')
}

/** 会话 id 取前 8 个字母数字，用作无标题时的兜底名。 */
function shortSession(sessionId) {
  const raw = String(sessionId ?? '')
    .replace(/^session-/, '')
    .replace(/[^a-zA-Z0-9]/g, '')
  return raw.slice(0, 8) || 'anon'
}

/**
 * 把会话标题变成安全的 Windows 文件名。
 * 去掉路径分隔符、冒号、问号等非法字符，空标题退回「中医会话-会话号」。
 */
export function safeTitle(title, sessionId) {
  let value = typeof title === 'string' ? title.trim() : ''
  value = value
    .replace(/[\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .trim()
  if (!value) value = `中医会话-${shortSession(sessionId)}`
  return value.slice(0, MAX_TITLE).trim() || `中医会话-${shortSession(sessionId)}`
}

/**
 * 从会话事件里提取真人发言和助手正文，按发生顺序返回。
 * 只收 `source.kind === 'user'` 的 user/message；系统提示、AGENTS.md、运行时上下文、
 * 审批策略等注入消息都不算用户说的话。
 */
export function conversationFromEvents(events) {
  const list = []
  for (const event of Array.isArray(events) ? events : []) {
    if (!event) continue
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
      const text = answerText(event.data?.content)
      if (text) list.push({ role: 'user', text })
    } else if (event.type === 'assistant/message') {
      const text = answerText(event.data?.message?.content)
      if (text) list.push({ role: 'assistant', text })
    }
  }
  return list
}

function renderSession({ title, sessionId, preset, createdAt, updatedAt, conversation }) {
  const body = conversation
    .map((message) => {
      const who = message.role === 'user' ? '用户' : '岐黄经方'
      return `### ${who}\n\n${message.text}`
    })
    .join('\n\n')

  return [
    '---',
    `标题: ${JSON.stringify(title)}`,
    `会话: ${JSON.stringify(String(sessionId ?? ''))}`,
    `预设: ${JSON.stringify(String(preset ?? DEFAULT_PRESET))}`,
    `创建: "${readableOf(createdAt)}"`,
    `更新: "${readableOf(updatedAt)}"`,
    '来源: "岐黄经方自动记录"',
    '---',
    '',
    `# ${title}`,
    '',
    '## 对话',
    '',
    body,
    '',
  ].join('\n')
}

function fileBelongsToSession(file, sessionId) {
  try {
    return readFileSync(file, 'utf8').includes(`会话: ${JSON.stringify(String(sessionId ?? ''))}`)
  } catch (error) {
    return false
  }
}

/**
 * 把整段会话写进 <kb>/医案/<会话标题>.md。
 *
 * 同名文件如果属于别的会话，自动加「 (2)」「 (3)」；如果是本会话上一版文件，
 * 直接覆盖。标题变化时写新文件并删掉本会话的旧文件，保证一个会话只留一份。
 *
 * @param {object} entry
 * @param {string} entry.kb 资料库根目录
 * @param {string} entry.sessionId 会话 id
 * @param {string} [entry.preset] 预设 id
 * @param {string} [entry.title] 会话标题
 * @param {any[]} entry.events 会话事件（user/message、assistant/message 等）
 * @param {Date} [entry.now] 更新时间
 * @param {string} [entry.previousFile] 本会话上一次写入的文件
 * @returns {string|null} 写入的文件路径；失败返回 null
 */
export function recordSession({
  kb,
  sessionId,
  preset = DEFAULT_PRESET,
  title,
  events,
  now = new Date(),
  previousFile,
} = {}) {
  try {
    if (!kb || !existsSync(kb)) return null
    const conversation = conversationFromEvents(events)
    if (conversation.length === 0) return null

    const dir = join(kb, RECORD_DIR)
    mkdirSync(dir, { recursive: true })

    const updatedAt = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
    const first = (Array.isArray(events) ? events : []).find((event) => Number.isFinite(event?.time))
    const createdAt = first ? new Date(first.time) : updatedAt
    const displayTitle = typeof title === 'string' && title.trim() ? title.trim() : safeTitle('', sessionId)
    const base = safeTitle(displayTitle, sessionId)

    let target = join(dir, `${base}.md`)
    if (existsSync(target) && target !== previousFile && !fileBelongsToSession(target, sessionId)) {
      for (let index = 2; index <= 100; index += 1) {
        const candidate = join(dir, `${base} (${index}).md`)
        if (!existsSync(candidate) || fileBelongsToSession(candidate, sessionId)) {
          target = candidate
          break
        }
      }
    }

    // 重启后内存里的上一份路径丢了：扫一遍同会话的旧文件，
    // 标题已生成时把旧的兜底名或旧标题文件一并清掉，保证一个会话只留一份。
    const stale = []
    if (!previousFile) {
      try {
        for (const name of readdirSync(dir)) {
          if (!name.endsWith('.md')) continue
          const candidate = join(dir, name)
          if (candidate !== target && fileBelongsToSession(candidate, sessionId)) stale.push(candidate)
        }
      } catch (error) {
        // 目录暂时读不到就不清理，正文仍然照写。
      }
    }

    const content = renderSession({
      title: displayTitle,
      sessionId,
      preset,
      createdAt,
      updatedAt,
      conversation,
    })
    writeFileSync(target, content, 'utf8')

    const oldFiles = new Set(stale)
    if (previousFile && previousFile !== target) oldFiles.add(previousFile)
    for (const file of oldFiles) {
      if (file === target) continue
      try {
        if (existsSync(file)) unlinkSync(file)
      } catch (error) {
        // 旧文件删不掉不影响新文件；下次还会再试。
      }
    }
    return target
  } catch (error) {
    return null
  }
}

/**
 * 生成 `session/event` 监听器。
 *
 * 监听真人发言和助手回答，每次都按会话快照重写同一份 Markdown：
 * 不会漏掉前面的对话，也不会因为一条回答重复写多个文件。
 *
 * DSH 的 `session.header.agentPreset` 只是“创建时的预设”，会话在空白窗口里换过预设后
 * header 不会变；当前预设要去读 `agentPreset` 投影。`currentPreset` 由宿主注入，
 * 读不到时退回 header，兼容旧版 DSH。
 *
 * @param {object} options
 * @param {() => string} options.getKb 返回当前资料库路径
 * @param {string} [options.preset] 预设 id
 * @param {(session: any) => string | null | undefined} [options.currentPreset] 读取当前预设
 * @param {(session: any) => string | null | undefined} [options.getTitle] 读取会话标题
 * @param {{info?: Function, warn?: Function}} [options.logger] 插件日志
 * @returns {(session: any, event: any) => void}
 */
export function createSessionRecorder({ getKb, preset = DEFAULT_PRESET, currentPreset, getTitle, logger } = {}) {
  const files = new Map()

  return function onSessionEvent(session, event) {
    try {
      if (!event || (event.type !== 'user/message' && event.type !== 'assistant/message' && event.type !== 'session/title')) return

      let presetId
      if (typeof currentPreset === 'function') {
        try {
          presetId = currentPreset(session)
        } catch (error) {
          presetId = undefined
        }
      }
      if (presetId === undefined || presetId === null) presetId = session?.header?.agentPreset
      if (presetId !== preset && !LEGACY_PRESETS.has(presetId)) return

      const sessionId = session?.id
      if (!sessionId) return

      const kb = typeof getKb === 'function' ? getKb() : ''
      if (!kb || !existsSync(kb)) return

      let title
      if (typeof getTitle === 'function') {
        try {
          title = getTitle(session)
        } catch (error) {
          title = undefined
        }
      }
      // 标题生成可能晚于最后一条回答；session/title 事件本身带着最终标题，
      // 收到它时直接改名，不依赖标题服务是否已经折叠了当前事件。
      if (event.type === 'session/title' && typeof event.data?.title === 'string') {
        title = event.data.title
      }

      let events = []
      try {
        events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
      } catch (error) {
        events = []
      }
      if (!Array.isArray(events) || events.length === 0) events = [event]
      else if (!events.some((item) => item && item.seq === event.seq && item.type === event.type)) {
        events = [...events, event]
      }

      const saved = recordSession({
        kb,
        sessionId,
        preset,
        title,
        events,
        now: Number.isFinite(event.time) ? new Date(event.time) : new Date(),
        previousFile: files.get(sessionId),
      })

      if (saved) {
        files.set(sessionId, saved)
        logger?.info?.('岐黄经方：会话已存入医案：%s', saved)
      } else {
        logger?.warn?.('岐黄经方：会话归档未写入（资料库可能不可写）：%s', kb)
      }
    } catch (error) {
      logger?.warn?.('岐黄经方：会话归档失败（不影响会话）：%o', error)
    }
  }
}
