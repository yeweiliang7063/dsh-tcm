/**
 * 学理模式 · 宿主半
 *
 * 三件事：
 * 1. 提示词变量：把资料库目录以变量形式提供给会话；
 * 2. 常驻口径：预设提示词最前面挂「学理模式·总纲」，每次请求再以常驻变量压一遍——
 *    只给辨证思路，不给具体剂量，不出处方笺，针灸只给推荐穴位、不给用法；
 * 3. 出口校验：助手回答里一旦出现克数、钱数、两数、枚数、毫升数，只把那一句换成 ✳，
 *    其余照常输出——不靠模型自觉，靠代码兜住。
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
import { blotDosage, hasDosage } from './dosage-guard.js'
import { GEAR_GUARD, GEAR_GUARD_VAR, KB_LINK_VAR, KB_PATH_VAR, SEASON_VAR } from './gear.js'
import { seasonText } from './season.js'
import { isTcmContext, tcmVerdict } from './preset-scope.js'
import { isTcmSession as looksTcmSession } from './preset-scope.js'

export const name = 'dsh-tcm'
/** 变量注册需要 systemPrompt 服务。 */
export const inject = ['systemPrompt']

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
/** 配置重读间隔：设置页改路径后最多等这么久就生效。 */
const POLL_DELAY = 3000
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

/** 当前资料库目录：用户填了就用填的，没填返回空串（调用方见到空串必须什么都别做）。 */
export function currentPath(config) {
  const raw = readValue(config, 'kbPath')
  if (typeof raw === 'string' && raw.trim() !== '') {
    const dir = resolveUserDir(raw)
    // 只认设置里填的那一个目录，而且它得真的在盘上：
    // 目录不在、或者填错了，就当没配置——绝不拿这个路径去外面找替代目录。
    return dir !== '' && existsSync(dir) ? dir : ''
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
        push(head + (head.endsWith('\\') ? '' : '') + rest)
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
  state.shared = false
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
    const holder = shared.holders.add(state)
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
    state.shared = true
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
    return
  }

  const pathChanged = state.dir !== dir
  const autoChanged = state.autoIndex !== true
  state.dir = dir
  state.autoIndex = true

  if (pathChanged || autoChanged || reason === 'startup' || autoMoved > 0) rebuild(state, dir, ctx, reason)
  watchDir(state, dir, ctx, pathChanged || autoChanged)
}

/** 配置核对：路径与开关都没动就直接返回，不每 3 秒扫一遍资料库。 */
function syncIfChanged(state, ctx, config) {
  if (!state.active) return
  const dir = currentPath(config)
  const autoIndex = readValue(config, 'autoIndex') !== false
  if (dir === state.dir && autoIndex === state.autoIndex) return
  sync(state, ctx, config, 'config')
}

/* ────────────────────────── 提示词 ────────────────────────── */

/**
 * 资料库路径的呈现：只报目录名，明文路径（带盘符、用户名）不进提示词。
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
    shared: false,
    debounce: null,
    startup: null,
    poll: null,
    autoIndex: undefined,
    autoFileCache: new Map(),
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
  defineVar(KB_LINK_VAR, () => '资料库目录（用 glob 或 read 打开这个目录即可）', '资料库目录变量')
  // 时令：每次请求现算当下季节与节气。天气取不到，规矩里写明靠问答问用户。
  defineVar(SEASON_VAR, () => seasonText(), '时令变量')
  // 常驻口径：每次请求都带上口径锁，比预设原文更靠后，优先级更高。
  // 只给中医会话：别的对话里不说中医的事，不往人家提示词里塞口径。
  defineVar(GEAR_GUARD_VAR, () => GEAR_GUARD, '常驻口径变量')

  /* ── 1.5 只有在中医会话真正开始时，才检查资料库路径 ── */
  // 提醒单开一块，放在最前面（index 用 0，正文依次往后挪一位），不跟正文抢位置。
  const NOTICE_BLOCK = 0
  // 一个会话提醒一次就够，记在这里，别每问一句都念一遍。
  const kbNoticed = new Set()
  // 不填路径不是错误，只是这个会话没法按原文引书：开场先提醒一句，免得他自己犯迷糊。
  // 每个会话只提醒一次；不是中医预设的会话一句都不说，不打扰别人。
  const kbNotice = (sessionId) => {
    try {
      if (!looksTcmSession(ctx, sessionId, name)) return
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

  /* ── 2. 出口校验：只在中医会话里挖掉带剂量的句子 ── */
  // 只做一件事：回答里出现具体剂量的那一句，换成 ✳，其余照常输出。
  // 早先是「命中即截断整条回答」，一句冒了剂量，前面上千字的辨证全废——用户要求改成按句挖掉。
  // 也不再往回答里追加任何提醒句（早先那段提醒会另开一块，界面上看着像把正文顶掉，用户要求去掉）。
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('llm/stream', async function* inspect(options, next) {
        // 先在尾巴上挂一段已判过的文字再判，是为了认出「其方桂枝三两」这类要看前文的剂量。
        let tail = ''
        // 待判队列：攒到句末标点才判，整句判完才能挖得干净。
        let queue = ''
        // 已判过的字数：句子还没结束时不必重复判同一段。
        let scanned = 0
        // 会话是不是中医：第一次判出剂量时才去认，认不出来也按中医处理（宁可多挖一句）。
        let mode = 'unknown'
        const isTcmSession = () => {
          if (mode === 'unknown') {
            const { decided, tcm } = verdict()
            if (decided) mode = tcm ? 'tcm' : 'other'
            else ctx.logger?.warn?.('学理模式：会话识别失败，按中医会话处理')
          }
          return mode !== 'other'
        }
        const verdict = () => tcmVerdict(ctx, options?.sessionId, name)
        // 流里的 chunk 必须始终是对象：宿主累加器 switch(chunk.type) 遇到字符串直接抛
        // unreachable variant in AssistantStreamAccumulator.push，整轮回答作废。
        // 抽出来的每一段文字一律由这里包成 text-delta 对象再发，绝不裸发字符串。
        let lastChunk = null
        const delta = (base, text) => ({ ...(base || null), type: 'text-delta', text })
        // 把队列里判过的那一段吐出去（force 时连尾巴一起吐完），吐的是对象。
        const take = function* (force, base) {
          if (queue === '') return
          let cut = force ? queue.length : -1
          if (!force) {
            for (let i = queue.length - 1; i >= 0; i -= 1) {
              if (/[。！？；\n]/.test(queue[i])) {
                cut = i + 1
                break
              }
            }
            if (cut <= scanned) return
          }
          const piece = queue.slice(0, cut)
          queue = queue.slice(cut)
          scanned = 0
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
          // 命中剂量：只挖掉带剂量的那几句，其余照发
          const cleaned = blotDosage(piece)
          if (cleaned !== piece) {
            ctx.logger?.warn?.('学理模式：回答中出现具体剂量，已挖掉该句')
            tail = (tail + cleaned).slice(-SCAN_WINDOW)
            yield delta(base, cleaned)
            return
          }
          // 剂量跨在上一段尾巴里（前端已经发过了），这一段整段挖掉
          ctx.logger?.warn?.('学理模式：回答中出现具体剂量，已挖掉该段')
          tail = tail.slice(-SCAN_WINDOW)
          yield delta(base, '✳')
        }
        // 会话开头提醒资料库没设定：只在第一块正文前插一句，别的会话不碰。
        let noticeSent = false
        // 一进来就认会话：不是中医会话的话，不进「攒句再判」的流水线，免得把别的对话的回答拖慢、拖断。
        let isTcmNow = false
        try {
          isTcmNow = looksTcmSession(ctx, options?.sessionId, name)
        } catch (error) {
          isTcmNow = false
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
            const notice = kbNotice(options?.sessionId)
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
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
            lastChunk = chunk
            queue += chunk.text
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
          if (chunk.type === 'text-delta') yield shift(chunk)
          else if (noticeSent && typeof chunk.index === 'number') yield shift(chunk)
          else yield chunk
        }
      })
    }
  } catch (error) {
    ctx.logger?.warn?.('学理模式：出口校验注册失败，本次只靠提示词约束：%o', error)
  }

  /* ── 3. 启动后建索引、挂监视 ── */
  try {
    const startup = setTimeout(() => {
      state.startup = null
      sync(state, ctx, config, 'startup')
    }, STARTUP_DELAY)
    if (startup.unref) startup.unref()
    state.poll = setInterval(() => syncIfChanged(state, ctx, config), POLL_DELAY)
    if (state.poll.unref) state.poll.unref()
  } catch (error) {
    ctx.logger?.warn?.('学理模式：索引自动生成初始化失败（不影响会话）：%o', error)
  }
}