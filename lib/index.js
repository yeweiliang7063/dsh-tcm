/**
 * 学理模式 · 宿主半
 *
 * 三件事：
 * 1. 提示词变量：把资料库目录以变量形式提供给会话；
 * 2. 口径锁变量：预设提示词第一行用 {{tcm_gear_guard}} 引用 GEAR_GUARD，全文只维护一份——
 *    只给辨证思路，不给具体剂量，不出处方笺，针灸只给推荐穴位、不给用法；
 * 3. 出口校验：助手回答里一旦出现克数（含 g），只把那一截「数字＋单位」换成 *，
 *    药名和句子骨架原样留着，其余照常输出——不靠模型自觉，靠代码兜住。
 *
 * 另带资料库维护：补随包经典、按目录生成 索引.md、根目录新书归类、会话归档 医案/。
 * 任何一步失败都只记日志、退回只靠提示词约束，绝不影响 DSH 主体启动。
 */
import { existsSync, watch } from 'node:fs'
import { basename, join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { INDEX_FILE, writeIndex, normalizeRoot, ensureCategoryDirs } from './kb-index.js'
import { defaultKbPath } from './platform.js'
import { ensureCorpus } from './corpus.js'
import { createSessionRecorder } from './records.js'
import { autoFileBooks } from './auto-file.js'
import { blotDosage, hasDosage, quoteSafeCut } from './dosage-guard.js'
import { GEAR_GUARD, GEAR_GUARD_VAR, KB_PATH_VAR, SEASON_VAR, WUYUN_VAR } from './gear.js'
import { seasonText, wuyunText } from './season.js'
import { looksTcmPrompt, tcmVerdict, versionOf } from './preset-scope.js'
import { isTcmSession as looksTcmSession } from './preset-scope.js'
import { mountSearchRoute } from './search.js'
import { dashangBlock, looksConclusion, mountDashangRoute } from './dashang.js'
import { createStore, registerClinicTools } from './clinic.js'

export const name = 'dsh-tcm-xueli'
/** 只等提示词服务；Web 服务与模型服务都在用时按需取，缺了不影响会话。 */
export const inject = ['systemPrompt']

/**
 * 打赏区由代码追加：只有「出结论的那一份回答」才补一块，问诊轮、追问、转话都不补。
 * 网址必须带实时端口——宿主只认绝对 http(s) 网址，相对路径一律显示「图片无法预览」。
 */
function dashangGiftText(head, scope) {
  try {
    if (!looksConclusion(head)) return ''
    let server
    try {
      server = scope && typeof scope.get === 'function' ? scope.get('webServer') : undefined
    } catch {
      server = undefined
    }
    return dashangBlock(server)
  } catch {
    return ''
  }
}

/** 不预设资料库目录：用户没在设置页填，就什么都不做，不替对方挑目录。 */
const DEFAULT_KB = ''

/**
 * 设置页「中医 · 经方｜资料库」里只有一项可改：资料库目录。
 * 标 volatile：路径里带用户名、盘符，不必写进会话档案。
 */
export const Config = z.object({
  kbPath: z.string().default(DEFAULT_KB).volatile(),
  autoIndex: z.boolean().default(true).description('按资料库目录自动生成 索引.md'),
})

/** 启动后稍等再建索引：先让主体起来，别和启动抢磁盘。 */
const STARTUP_DELAY = 2500
/** 配置重读间隔：目录监视没挂上时（兜底路径），设置页改路径后最多等这么久就生效。 */
const POLL_DELAY = 3000
/** 目录监视已挂上时，轮询只做兜底，间隔拉长，别每 3 秒扫一遍盘。 */
const POLL_DELAY_WATCHED = 15000
/** 目录变动后的去抖时间，避免复制一本书时反复重写。 */
const REBUILD_DELAY = 1500
/** 出口校验每次只查末尾这么多个字：够抓到刚冒出来的剂量，又不吃内存。 */
const SCAN_WINDOW = 600

/** 正在监视的目录（全局共享）：同一个库只挂一份监视，重复加载本插件时也不重复挂。 */
const WATCHERS = new Map()
/** 同一秒里多次要求重建索引时，排个队，避免互相把临时文件冲掉。 */
let rebuildChain = Promise.resolve()

/* ────────────────────────── 小工具 ────────────────────────── */

/** 读配置项；读不到给 undefined，不抛异常。 */
function readValue(config, key) {
  try {
    const raw = config && config[key]
    const value = raw && typeof raw.get === 'function' ? raw.get() : raw
    return value === undefined || value === null ? undefined : value
  } catch (error) {
    return undefined
  }
}

/**
 * 「目录在不在盘上」的短缓存：提示词变量与轮询一轮里会反复问同一个目录，
 * 成功结果缓存 1 秒就够省掉重复 syscall；失败不缓存，用户刚建好的目录立刻能认出来。
 */
const PATH_TTL = 1000
let pathSeen = { dir: '', at: 0 }
function dirReady(dir) {
  if (dir === '') return false
  const now = Date.now()
  if (dir === pathSeen.dir && now - pathSeen.at < PATH_TTL) return true
  const ok = existsSync(dir)
  if (ok) pathSeen = { dir, at: now }
  return ok
}

/** 当前资料库目录：用户填了就用填的，没填返回空串（调用方见到空串必须什么都别做）。 */
export function currentPath(config) {
  const raw = readValue(config, 'kbPath')
  if (typeof raw === 'string' && raw.trim() !== '') {
    const dir = resolveUserDir(raw)
    // 只认设置里填的那一个目录，而且它得真的在盘上：
    // 目录不在、或者填错了，就当没配置——绝不拿这个路径去外面找替代目录。
    return dir !== '' && dirReady(dir) ? dir : ''
  }
  return DEFAULT_KB
}

/**
 * 设置框里的路径可能被输入法吃掉反斜杠（D:\中医工作区\中医资料库 变成
 * D:中医工作区中医资料库），也可能盘符大小写不对。这里只做还原，不换目录：
 * ①原样能读到就直接用；②Windows 上 D:xxx、D:/xxx、D:\xxx 三种写法都试同一段文字；
 * ③盘符大小写换一遍再试。全都不行就返回 ''，绝不去别的目录找替代。
 */
export function resolveUserDir(raw) {
  const text = String(raw).trim()
  const tries = []
  const push = (value) => {
    const dir = normalizeRoot(value)
    if (dir !== '' && !tries.some((x) => x.toLowerCase() === dir.toLowerCase())) tries.push(dir)
  }
  push(text)
  if (process.platform === 'win32') {
    const drive = /^([A-Za-z]):/.exec(text)
    if (drive) {
      const rest = text.slice(2).replace(/^[\\/]+/, '')
      const letter = drive[1].toUpperCase()
      for (const head of [letter + ':', letter + ':/', letter + ':/' + '\\']) {
        push(head + rest)
      }
    }
    const lowered = text.replace(/^([A-Za-z]):/, (all, d) => d.toLowerCase() + ':')
    push(lowered)
    const raised = text.replace(/^([A-Za-z]):/, (all, d) => d.toUpperCase() + ':')
    push(raised)
  }
  for (const dir of tries) {
    try {
      if (existsSync(dir)) return dir
    } catch (error) {
      // 单个写法检查失败就跳过
    }
  }
  return ''
}

/* ────────────────────────── 索引 ────────────────────────── */

/** 重建一次索引；失败只记日志，不抛给主体。多次触发时排队执行，避免同时写盘。 */
function rebuild(state, dir, ctx, reason) {
  rebuildChain = rebuildChain
    .then(() => {
      const result = writeIndex(dir)
      if (result.reason === 'root-missing') {
        ctx?.logger?.warn?.('学理模式：资料库目录不存在，跳过索引生成：%s', dir)
        return
      }
      if (result.changed) {
        ctx?.logger?.info?.('学理模式：已重建 %s（%s，共 %d 个文件）', INDEX_FILE, join(dir, INDEX_FILE), result.files)
      } else if (reason === 'startup') {
        ctx?.logger?.info?.('学理模式：%s 已是最新，共 %d 个文件', INDEX_FILE, result.files)
      }
    })
    .catch((error) => {
      ctx?.logger?.warn?.('学理模式：索引生成失败（不影响会话）：%o', error)
    })
  return rebuildChain
}

/** 关掉本插件挂的那份监视；别的插件还挂着同一目录时保留不动。 */
function closeWatchers(state) {
  const current = state.watcher
  state.watcher = null
  state.mode = ''
  if (current && typeof current.release === 'function') {
    try {
      current.release()
    } catch (error) {
      // 关不掉也无所谓，下次启动会重新挂。
    }
  }
}

/** 挂一个目录监视；平台不支持这种监视方式时返回 null，交给调用方降级。 */
function watchOne(target, recursive, onChange, ctx) {
  try {
    const handle = watch(target, { recursive, persistent: false }, onChange)
    handle.on?.('error', (error) => {
      ctx?.logger?.warn?.('学理模式：目录监视出错，索引改为启动时生成：%o', error)
    })
    if (handle.unref) handle.unref()
    return handle
  } catch (error) {
    return null
  }
}

/** 不支持递归监视时的退路：单层盯根目录、text/、skills/ 与五个分类文件夹。 */
function watchShallow(dir, onChange, ctx) {
  const handles = []
  for (const sub of ['', 'text', 'skills', 'skills/tcm-jingfang', '经典', '经典注解', '名著', '医案', '方药']) {
    const target = sub === '' ? dir : join(dir, sub)
    if (!existsSync(target)) continue
    const handle = watchOne(target, false, onChange, ctx)
    if (handle) handles.push(handle)
  }
  if (!handles.length) return null
  return {
    name: 'shallow',
    close() {
      for (const handle of handles) {
        try {
          handle.close()
        } catch (error) {
          // 单个关不掉不影响其它的。
        }
      }
    },
  }
}

/** 去抖后重建，避免一次批量复制触发十几次写盘。 */
function scheduleRebuild(state, dir, ctx, reason) {
  if (state.debounce) clearTimeout(state.debounce)
  state.debounce = setTimeout(() => {
    state.debounce = null
    if (!state.active) return
    try {
      autoFileBooks(dir, { logger: ctx?.logger, cache: state.autoFileCache })
    } catch (error) {
      ctx?.logger?.warn?.('学理模式：自动归类失败（不影响索引）：%o', error)
    }
    rebuild(state, dir, ctx, reason)
    if (state.mode === 'shallow') {
      try {
        watchDir(state, dir, ctx, true)
      } catch (error) {
        // 挂不上就等下次轮询时再试。
      }
    }
  }, REBUILD_DELAY)
  if (state.debounce.unref) state.debounce.unref()
}

/** 只关心书目增删改，自己写的 索引.md 不触发重建。 */
function isNoise(filename) {
  if (!filename) return false
  const name = String(filename)
  return name === INDEX_FILE || name.endsWith(INDEX_FILE + '.tmp') || name.startsWith('.~') || name.startsWith('~$')
}

/**
 * 切换监视目录：路径改了就把旧的关掉，换成新的。
 * 同一个库只挂一份监视——已经挂着就登记一下共用，不再重复挂；
 * 谁先挂上，目录变化产生的索引重建就由谁先做，写出来的都是同一份 索引.md，内容一致。
 */
function watchDir(state, dir, ctx, force = false) {
  if (!state.active) return
  if (!force && state.dir === dir && state.watcher) return
  closeWatchers(state)
  state.dir = dir
  if (!existsSync(dir)) return

  const shared = WATCHERS.get(dir)
  if (shared) {
    // Set#add 返回集合本身，不是元素；先加再留引用，否则 release 删错对象，
    // holders 永远清不空，共享监视从此关不掉。
    shared.holders.add(state)
    const holder = state
    shared.release = () => {
      shared.holders.delete(holder)
      if (shared.holders.size === 0) {
        WATCHERS.delete(dir)
        try {
          shared.handle?.close?.()
        } catch (error) {
          // 关不掉不影响其它。
        }
      }
    }
    state.watcher = { release: shared.release }
    state.mode = shared.mode
    return
  }

  const onChange = (event, filename) => {
    if (isNoise(filename)) return
    scheduleRebuild(state, dir, ctx, 'change')
  }
  let handle = watchOne(dir, true, onChange, ctx)
  let mode = 'recursive'
  if (!handle) {
    handle = watchShallow(dir, onChange, ctx)
    mode = handle ? 'shallow' : ''
  }
  if (!handle) {
    ctx?.logger?.warn?.('学理模式：目录监视启动失败，索引只在插件启动时生成：%s', dir)
    return
  }

  const record = { handle, mode, holders: new Set([state]), release: null }
  record.release = () => {
    record.holders.delete(state)
    if (record.holders.size === 0) {
      WATCHERS.delete(dir)
      try {
        handle?.close?.()
      } catch (error) {
        // 关不掉不影响其它。
      }
    }
  }
  WATCHERS.set(dir, record)
  state.watcher = record
  state.mode = mode
}

/** 读取当前路径与开关，必要时切换监视、补书、重建索引。 */
function sync(state, ctx, config, reason) {
  if (!state.active) return
  const dir = currentPath(config)
  const autoIndex = readValue(config, 'autoIndex') !== false
  // 库根锁定：记下这次用的到底是设置里填的那个目录，改了要看得见。
  if (dir !== state.lockedDir) {
    state.lockedDir = dir
    if (dir !== '') ctx?.logger?.info?.('学理模式：资料库锁定在 %s（来自设置里的 kbPath）', dir)
    else ctx?.logger?.info?.('学理模式：设置里还没填资料库路径，索引与归档一律不做')
  }

  // 目录存在才补资料；不存在不擅自建目录，避免把工具路径写错成资料库。
  let autoMoved = 0
  if (existsSync(dir)) {
    try {
      const made = ensureCategoryDirs(dir)
      if (made > 0) ctx?.logger?.info?.('学理模式：已建立 %d 个分类文件夹：%s', made, dir)
      const copied = ensureCorpus(dir)
      if (copied > 0) ctx?.logger?.info?.('学理模式：已补齐 %d 本随包经典到 %s', copied, join(dir, 'text'))
    } catch (error) {
      ctx?.logger?.warn?.('学理模式：资料库初始化失败（不影响会话）：%o', error)
    }

    try {
      const filed = autoFileBooks(dir, { logger: ctx?.logger, cache: state.autoFileCache })
      autoMoved = filed.moved
    } catch (error) {
      ctx?.logger?.warn?.('学理模式：自动归类失败（不影响会话）：%o', error)
    }
  }

  if (!autoIndex) {
    closeWatchers(state)
    if (state.debounce) {
      clearTimeout(state.debounce)
      state.debounce = null
    }
    state.dir = ''
    state.autoIndex = false
    retunePoll(state, ctx, config)
    return
  }

  const pathChanged = state.dir !== dir
  const autoChanged = state.autoIndex !== true
  state.dir = dir
  state.autoIndex = true

  if (pathChanged || autoChanged || reason === 'startup' || autoMoved > 0) rebuild(state, dir, ctx, reason)
  watchDir(state, dir, ctx, pathChanged || autoChanged)
  retunePoll(state, ctx, config)
}

/** 配置核对：路径与开关都没动就直接返回，不每 3 秒扫一遍资料库。 */
function syncIfChanged(state, ctx, config) {
  if (!state.active) return
  const dir = currentPath(config)
  const autoIndex = readValue(config, 'autoIndex') !== false
  if (dir === state.dir && autoIndex === state.autoIndex) return
  sync(state, ctx, config, 'config')
}

/**
 * 轮询节奏跟着监视状态走：目录监视挂上了就放慢到 15 秒（只是兜底，改动由监视即时触发）；
 * 监视没挂上（平台不支持、目录暂不存在）才用 3 秒，保证设置页改路径能及时生效。
 */
function retunePoll(state, ctx, config) {
  if (!state.active) return
  const delay = state.watcher ? POLL_DELAY_WATCHED : POLL_DELAY
  if (state.pollDelay === delay) return
  state.pollDelay = delay
  if (state.poll) clearInterval(state.poll)
  state.poll = setInterval(() => syncIfChanged(state, ctx, config), delay)
  if (state.poll.unref) state.poll.unref()
}

/* ────────────────────────── 提示词 ────────────────────────── */

/**
 * 资料库路径的呈现：给完整的绝对路径，并说明它是什么。
 * 只报目录名是不行的：模型会满盘去找同名文件夹，盘上还有别的「资料库」就会读错库。
 */
function kbText(config) {
  const dir = currentPath(config)
  if (!dir) {
    return '（还没配置资料库：请提醒用户到「设置 → 中医 · 经方｜资料库」里填一个资料库目录，填之前不要引书讲方、不要报方名）'
  }
  // 必须给完整的绝对路径：只给文件夹名，模型会满盘去找同名目录，
  // 一旦盘上还有别的「资料库」，就会读错库。
  try {
    if (!existsSync(dir)) {
      return `（${dir} 当前不可用：请提醒用户到「设置 → 中医 · 经方｜资料库」里改路径）`
    }
  } catch (error) {
    // 检查失败时照常给路径，不阻断会话。
  }
  return dir
}

/* ────────────────────────── 插件本体 ────────────────────────── */

export function apply(ctx, config) {
  const state = {
    active: true,
    watcher: null,
    mode: '',
    dir: '',
    debounce: null,
    startup: null,
    poll: null,
    pollDelay: 0,
    autoIndex: undefined,
    autoFileCache: new Map(),
    // 最近一次锁定的库根：只用于日志，判断路径变了没有。
    lockedDir: undefined,
  }

  const dispose = () => {
    if (!state.active) return
    state.active = false
    if (state.debounce) clearTimeout(state.debounce)
    if (state.startup) clearTimeout(state.startup)
    if (state.poll) clearInterval(state.poll)
    closeWatchers(state)
  }
  // Cordis 卸载插件时调用返回的函数，watcher / timer 不会留在进程里。
  try {
    if (typeof ctx.effect === 'function') ctx.effect(() => dispose)
  } catch (error) {
    ctx.logger?.warn?.('学理模式：清理钩子注册失败：%o', error)
  }

  // 回答自动归档：只旁听 session/event，不把逻辑塞进 agent 请求主链。
  try {
    if (typeof ctx.on === 'function' && typeof ctx.effect === 'function') {
      const recorder = createSessionRecorder({
        getKb: () => currentPath(config),
        currentPreset: (session) => {
          try {
            const registry = typeof ctx.get === 'function' ? ctx.get('agentPresets') : undefined
            return registry?.presetForSession?.(session)
          } catch (error) {
            return undefined
          }
        },
        getTitle: (session) => {
          try {
            const titles = typeof ctx.get === 'function' ? ctx.get('sessionTitle') : undefined
            const snapshot = titles?.get?.(session)
            return typeof snapshot === 'string' ? snapshot : snapshot?.title
          } catch (error) {
            return undefined
          }
        },
        logger: ctx.logger,
      })
      ctx.effect(() => ctx.on('session/event', recorder))
    }
  } catch (error) {
    ctx.logger?.warn?.('学理模式：回答自动归档注册失败（不影响会话）：%o', error)
  }

  /* ── 1. 三个提示词变量（只在中医会话里生效） ── */

  /**
   * 注册一个提示词变量。重载插件时同一个名字会再注册一次，
   * 这种情况属正常，不报错；只有名字没注册过、注册又失败，才记一条明确的告警。
   */
  const defineVar = (key, valueOf, label) => {
    try {
      ctx.systemPrompt.variable(key, valueOf)
    } catch (error) {
      const message = String((error && error.message) || error)
      // 热重载时同一个名字会再注册一次，报「已存在」属正常情况，不当故障。
      if (/exist|duplicate|already|重复|已存在/i.test(message)) {
        ctx.logger?.info?.('学理模式：%s 已存在，沿用现有定义', label)
        return
      }
      ctx.logger?.warn?.('学理模式：%s 注册失败：%s', label, message)
    }
  }

  // 注意：这里不能按「是不是中医会话」判断。组装提示词时上下文里没有 agent/session，
  // isTcmContext 会一律判成「不是」，变量就成空串，模型手里根本没路径，于是满盘去找同名文件夹。
  // 这三个变量只有中医预设的 persona 会引用，别的预设不会碰，直接给值即可。
  defineVar(KB_PATH_VAR, () => kbText(config), '资料库路径变量')
  // 时令：每次请求现算当下季节与节气。天气取不到，规矩里写明靠问答问用户。
  defineVar(SEASON_VAR, () => seasonText(), '时令变量')
  defineVar(WUYUN_VAR, () => wuyunText(), '五运六气变量')
  // 口径锁变量：预设 persona 第一行引用它；不引用就不会进提示词，不存在「第二份」。
  // 不能按「是不是中医会话」判断——组装时上下文里没有 agent/session，判断只会得到「不是」。
  // 这里的变量只有本预设的 persona 会引用，别的预设不会碰。
  defineVar(GEAR_GUARD_VAR, () => GEAR_GUARD, '口径锁变量')

  /* ── 1.5 只有在中医会话真正开始时，才检查资料库路径 ── */
  // 提醒单开一块，放在最前面（index 用 0，正文依次往后挪一位），不跟正文抢位置。
  const NOTICE_BLOCK = 0
  // 一个会话提醒一次就够，记在这里，别每问一句都念一遍。
  const kbNoticed = new Set()
  // 不填路径不是错误，只是这个会话没法按原文引书：开场先提醒一句，免得他自己犯迷糊。
  // 每个会话只提醒一次；不是中医预设的会话一句都不说，不打扰别人。
  const kbNotice = (sessionId, systemText) => {
    try {
      // 全量版会话有它自己的提醒，学习版一个字都不多说。
      if (versionOf(ctx, sessionId) === 'full') return
      if (!looksTcmSession(ctx, sessionId, name) && !looksTcmPrompt(systemText)) return
    } catch (error) {
      return
    }
    const dir = currentPath(config)
    if (dir !== '') return
    if (kbNoticed.has(sessionId)) return
    kbNoticed.add(sessionId)
    // 只记最近 200 个会话，跑久了不占内存。
    if (kbNoticed.size > 200) kbNoticed.delete(kbNoticed.values().next().value)
    const text = '⚠️ 还没设定资料库目录：这次回答不会引书讲方，只会给治法方向。'
      + '去「设置 → 中医 · 经方｜资料库」填一个目录（可以是新建的空文件夹），填好后再问就可以按原文引书了。'
    ctx.logger?.warn?.('学理模式：资料库目录未设定，已在本会话开头提醒')
    return text
  }

  /* ── 2. 出口校验：只在中医会话里遮掉剂量数值 ── */
  // 只做一件事：回答里出现具体剂量的那一截（数字＋单位）换成 *，其余照常输出。
  // 早先是「命中即截断整条回答」，一句冒了剂量，前面上千字的辨证全废；后来改成按句挖掉，
  // 又连药名带治法一起吞了。现在只遮数值：桂枝 9 克 → 桂枝*，句子骨架和药名都留着。
  // 列表项前缀、引号里的原文不碰（判据见 dosage-guard.js 的 doseSpans）。
  // 也不再往回答里追加任何提醒句（早先那段提醒会另开一块，界面上看着像把正文顶掉，用户要求去掉）。
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('llm/stream', async function* inspect(options, next) {
        // 先在尾巴上挂一段已判过的文字再判，是为了认出「其方桂枝三两」这类要看前文的剂量。
        let tail = ''
        // 待判队列：攒到句末标点或空行才判，整段判完才能判出引文有没有闭合。
        let queue = ''
        // 会话是不是中医：第一次判出剂量时才去认；认不出就看这次请求的提示词，
        // 提示词里也没有学理模式总纲的，说明不是中医会话，一律原样放行。
        let mode = 'unknown'
        const isTcmSession = () => {
          if (mode === 'unknown') {
            const { decided, tcm } = verdict()
            // 会话记录说是中医，直接认；说不是、或者认不出，都再看这次请求的提示词——
            // 提示词里带着学理模式总纲，就说明这次组装的确实是中医会话（入口也是这么判的），
            // 不能因为宿主没拿到会话对象就把口径全关掉。
            let version = ''
            try {
              version = versionOf(ctx, options?.sessionId)
            } catch (error) {
              version = ''
            }
            if (version === 'full') mode = 'other'
            else if (decided && tcm) mode = 'tcm'
            else mode = looksTcmPrompt(options?.system) ? 'tcm' : 'other'
          }
          return mode === 'tcm'
        }
        const verdict = () => tcmVerdict(ctx, options?.sessionId, name)
        // 流里的 chunk 必须始终是对象：宿主累加器 switch(chunk.type) 遇到字符串直接抛
        // unreachable variant in AssistantStreamAccumulator.push，整轮回答作废。
        // 抽出来的每一段文字一律由这里包成 text-delta 对象再发，绝不裸发字符串。
        let lastChunk = null
        // 打赏区由代码补：攒回答开头几个字，判它是不是「**结论**」那一份。
        let head = ''
        let giftSent = false
        let maxSeen = -1
        // 打赏块自己开、自己收：出结论的那一份回答末尾补一块，别的时候什么都不发。
        const sendGift = function* () {
          if (giftSent) return
          giftSent = true
          try {
            const gift = head.includes('请作者喝杯茶') ? '' : dashangGiftText(head, ctx)
            if (!gift) return
            const index = maxSeen + 1
            maxSeen = index
            yield { type: 'block-start', index, blockType: 'text' }
            yield { type: 'text-delta', index, text: gift }
            yield { type: 'block-end', index, block: { type: 'text', text: gift } }
          } catch (error) {
            ctx.logger?.warn?.('学理模式：打赏区没加上（不影响回答）：%o', error)
          }
        }
        const delta = (base, text) => ({ ...(base || null), type: 'text-delta', text })
        // 把队列里判过的那一段吐出去（force 时连尾巴一起吐完），吐的是对象。
        const take = function* (force, base) {
          if (queue === '') return
          let cut = force ? queue.length : -1
          if (!force) {
            // 列表块（行首「1. 」「- 」）整块攒到空行再判：一行一句也照样算同一段，
            // 才认得出「这一段整段是列表」；其余正文照旧按句末标点切，逐句吐，不拖。
            if (/^\s*(?:\d+[.、]\s|[-*+]\s)/.test(queue)) {
              const blank = queue.search(/\n[ \t]*\n/)
              if (blank >= 0) cut = blank + 1
            } else {
              for (let i = queue.length - 1; i >= 0; i -= 1) {
                if (/[。！？；\n]/.test(queue[i])) {
                  cut = i + 1
                  break
                }
              }
            }
          }
          // 切点落在引号中间时，这一块会只剩半个引文，被当成「没加引号」而误遮。
          // 把切点前移到开引号处，等引文闭合再判；一直不闭合就由「超长／跨空行」规则兜底。
          cut = quoteSafeCut(queue, cut)
          if (cut <= 0) return
          let piece = queue.slice(0, cut)
          queue = queue.slice(cut)
          // 句尾正好停在数字上（「桂枝 9」）就先压着不发：单位「克」可能下一块才到，
          // 数字单独发出去以后，下一块只剩一个「克」，遮数就再也遮不住了。
          if (!force) {
            const trimmed = piece.replace(/\s+$/, '')
            const dangling = /(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千半]+)$/.exec(trimmed)
            if (dangling) {
              queue = piece.slice(dangling.index) + queue
              piece = trimmed.slice(0, dangling.index)
            }
          }
          if (piece === '') return
          // 只看这一段加上前文尾巴有没有剂量。tail 为空（回答开头）时也必须照判——
          // 早先写成 `tail === '' || !hasDosage(...)`，开头那句一律直接放行，
          // 第一句就是剂量句时永远拦不住。
          if (!hasDosage(tail + piece)) {
            tail = (tail + piece).slice(-SCAN_WINDOW)
            yield delta(base, piece)
            return
          }
          if (!isTcmSession()) {
            tail = (tail + piece).slice(-SCAN_WINDOW)
            yield delta(base, piece)
            return
          }
          // 命中剂量：只把这一段「数字＋单位」遮成 *，药名和句子骨架照发
          const cleaned = blotDosage(piece, '*')
          if (cleaned !== piece) {
            ctx.logger?.warn?.('学理模式：回答中出现具体剂量，已把数值遮成 *')
            tail = (tail + cleaned).slice(-SCAN_WINDOW)
            yield delta(base, cleaned)
            return
          }
          // 判成剂量但这一段本身没有可遮的数（数在前文尾巴里）：原样发，不整段抹掉
          ctx.logger?.warn?.('学理模式：本段剂量在前文，原样放行')
          tail = (tail + piece).slice(-SCAN_WINDOW)
          yield delta(base, piece)
        }
        // 会话开头提醒资料库没设定：只在第一块正文前插一句，别的会话不碰。
        let noticeSent = false
        // 一进来就认会话：不是中医会话的话，不进「攒句再判」的流水线，免得把别的对话的回答拖慢、拖断。
        // 两路分开判、各自兜住异常：会话识别失败不该把「提示词里带总纲」这一路也一起关掉。
        let isTcmNow = false
        try {
          isTcmNow = looksTcmPrompt(options?.system)
        } catch (error) {
          isTcmNow = false
        }
        if (!isTcmNow) {
          try {
            isTcmNow = looksTcmSession(ctx, options?.sessionId, name)
          } catch (error) {
            isTcmNow = false
          }
        }
        // 两版不许串：全量版会话里，学习版不加打赏区、不遮剂量、不念资料库提醒。
        // 认不出是哪一版就不动，宁可不管也不误伤。
        if (isTcmNow) {
          try {
            if (versionOf(ctx, options?.sessionId) === 'full') isTcmNow = false
          } catch (error) {
            // 判不出来就保持原判
          }
        }
        // 提醒真的发出去了，正文才整体往后挪一位（提醒占 0 号块）；没发提醒就一切照旧。
        let noticePushed = false
        const shift = (out) => (noticePushed && typeof out?.index === 'number' ? { ...out, index: out.index + 1 } : out)
        for await (const chunk of next()) {
          if (!chunk || typeof chunk !== 'object' || typeof chunk.type !== 'string') continue
          // 不是中医会话：原样转发，一个字节都不动。
          if (!isTcmNow) {
            yield chunk
            continue
          }
          if (!noticeSent && chunk.type === 'block-start' && typeof chunk.index === 'number' && chunk.index >= 0) {
            noticeSent = true
            const notice = kbNotice(options?.sessionId, options?.system)
            // 提醒要单独占一块：宿主只认 block-start 登记块，直接把提醒塞进正文块会把它顶掉。
            // 所以先把正文那块开出来（挪到 1 号），再在前面补提醒那块（0 号，自己开、自己收）。
            if (typeof notice === 'string' && notice !== '') {
              noticePushed = true
              yield { ...chunk, index: NOTICE_BLOCK + 1 }
              yield { type: 'block-start', index: NOTICE_BLOCK, blockType: 'text' }
              yield { type: 'text-delta', index: NOTICE_BLOCK, text: notice }
              yield { type: 'block-end', index: NOTICE_BLOCK, block: { type: 'text', text: notice } }
              continue
            }
          }
          if (typeof chunk.index === 'number') {
            const effective = chunk.index + (noticePushed ? 1 : 0)
            if (effective > maxSeen) maxSeen = effective
          }
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
            lastChunk = chunk
            queue += chunk.text
            if (head.length < 48) head += chunk.text
            // take 已经返回对象，原样发；不能再套一层，套了 text 就成了对象，宿主报 text-delta text must be a string
            for (const out of take(false, chunk)) yield shift(out)
            continue
          }
          if (chunk.type === 'finish' || chunk.type === 'block-end' || chunk.type === 'usage') {
            // 正文还压着，先把剩下的吐完，再放结束块
            for (const out of take(true, lastChunk || chunk)) {
              yield shift(out)
              // 正文还没发出去的那段，index 要跟着块一起挪；否则收块时找不到自己开的块。
              if (out?.index === lastChunk?.index) lastChunk = shift(out)
            }
          }
          // 出结论的那一份，末尾由代码补打赏区；模型自己写了的不补，免得重复。
          if (chunk.type === 'finish') yield* sendGift()
          // text-delta 上面已经 continue 过，这里只剩收尾类与被挪过块号的块。
          if (noticeSent && typeof chunk.index === 'number') yield shift(chunk)
          else yield chunk
        }
        // 宿主偶尔不给 finish：流结束前再兜一次，免得打赏区整块漏掉。
        if (isTcmNow) yield* sendGift()
      })
    }
  } catch (error) {
    ctx.logger?.warn?.('学理模式：出口校验注册失败，本次只靠提示词约束：%o', error)
  }

  /* ── 2.5 资料查询页：开一条只读通道，回原文＋白话 ── */
  try {
    const mountSearch = (scoped) => {
      Promise.resolve()
        .then(() => mountSearchRoute(scoped, {
          path: '/dsh-tcm-xueli/search',
          log: '学理模式：',
          rootDir: () => currentPath(config),
        }))
        .then((dispose) => {
          if (typeof scoped.effect === 'function') {
            try { scoped.effect(() => () => { if (typeof dispose === 'function') dispose() }) } catch { /* 没有 effect 就靠进程退出回收 */ }
          }
        })
        .catch((error) => {
          ctx.logger?.warn?.('学理模式：资料查询通道没开（不影响会话）：%o', error)
        })
    }
    /* Web 服务可能比本插件晚就位：有 inject 就等它，没有就直接挂。 */
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], mountSearch)
    } else {
      mountSearch(ctx)
    }
  } catch (error) {
    ctx.logger?.warn?.('学理模式：资料查询装载失败（不影响会话）：%o', error)
  }

  /* ── 2.55 打赏码：回答结尾两张收款码，同源发图 ── */
  try {
    const mountDashang = (scoped) => {
      Promise.resolve()
        .then(() => mountDashangRoute(scoped || ctx))
        .then((dispose) => {
          if (typeof scoped?.effect === 'function') {
            try { scoped.effect(() => () => { if (typeof dispose === 'function') dispose() }) } catch { /* 没有 effect 就靠进程退出回收 */ }
          }
        })
        .catch((error) => {
          ctx.logger?.warn?.('学理模式：打赏码通道没开（不影响会话）：%o', error)
        })
    }
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], mountDashang)
    } else {
      mountDashang(ctx)
    }
  } catch (error) {
    ctx.logger?.warn?.('学理模式：打赏码装载失败（不影响会话）：%o', error)
  }

  /* ── 2.6 模拟问诊：病例卡与成绩记录（从岐黄工作台并过来，工具改名防撞） ── */
  try {
    const clinicStore = createStore()
    const mountClinic = (scoped) => {
      const owner = scoped || ctx
      Promise.resolve()
        .then(() => registerClinicTools(owner, clinicStore))
        .then((release) => {
          if (typeof release !== 'function') return
          // 插件可能在注册回来之前就被卸载：这时 effect 已经不能用了，立刻自行释放。
          if (owner.disposed || typeof owner.effect !== 'function') {
            release()
            return
          }
          try { owner.effect(() => () => { release() }) } catch { release() }
        })
        .catch((error) => {
          ctx.logger?.warn?.('学理模式：问诊记录工具没装（不影响聊天）：' + String(error && error.message ? error.message : error))
        })
    }
    if (typeof ctx.inject === 'function') {
      ctx.inject(['tools'], mountClinic)
    } else {
      mountClinic(ctx)
    }
  } catch (error) {
    ctx.logger?.warn?.('学理模式：模拟问诊装载失败（不影响会话）：%o', error)
  }

  /* ── 3. 启动后建索引、挂监视 ── */
  try {
    const startup = setTimeout(() => {
      state.startup = null
      sync(state, ctx, config, 'startup')
    }, STARTUP_DELAY)
    if (startup.unref) startup.unref()
    // 先按「监视未挂上」的短间隔起步，sync 里挂好监视后会自动放慢到 15 秒。
    retunePoll(state, ctx, config)
  } catch (error) {
    ctx.logger?.warn?.('学理模式：索引自动生成初始化失败（不影响会话）：%o', error)
  }
}