/**
 * 跨平台路径工具（宿主半专用，浏览器半不引用）
 *
 * 三件事：
 * 1. 给每个平台一个说得过去的默认资料库目录；
 * 2. 把用户输入的 `~`、相对路径统一成当前平台的绝对路径；
 * 3. 按当前平台的规则去掉末尾分隔符（根目录保留）。
 *
 * 所有函数都允许传入 path 实现和平台名，方便在 Windows 机器上模拟 POSIX 行为做测试。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** Windows 上沿用的历史默认目录；存在就优先用它，避免老用户升级后找不到书。 */
const WIN_LEGACY_KB = 'D:\\中医知识库'
/** 其它平台的默认目录名，放在用户主目录下。 */
const KB_DIR_NAME = '中医知识库'

function optionsWithDefaults(options = {}) {
  return {
    path: options.path ?? path,
    platform: options.platform ?? process.platform,
    home: options.home ?? homedir(),
    exists: options.exists ?? existsSync,
  }
}

/**
 * 当前平台建议的资料库目录。
 * - Windows：`D:\中医知识库` 存在就用它，否则 `<用户主目录>\中医知识库`；
 * - macOS / Linux：`<用户主目录>/中医知识库`。
 */
export function defaultKbPath(options = {}) {
  const { path: p, platform, home, exists } = optionsWithDefaults(options)
  if (platform === 'win32' && exists(WIN_LEGACY_KB)) return WIN_LEGACY_KB
  return p.join(home, KB_DIR_NAME)
}

/**
 * 把 `~` 和 `~/xxx` 展开成用户主目录；其它写法原样返回。
 * Windows 额外接受 `~\xxx`；POSIX 上反斜杠是合法文件名字符，不能当分隔符处理。
 */
export function expandHome(value, options = {}) {
  const { path: p, platform, home } = optionsWithDefaults(options)
  const text = String(value ?? '').trim()
  if (text === '') return ''
  if (text === '~') return home
  const homePrefix = platform === 'win32' ? /^~[\\/]/ : /^~\//
  if (homePrefix.test(text)) return p.join(home, text.slice(2))
  return text
}

/**
 * 统一资料库根目录写法：展开 `~`、转成当前平台的绝对路径、去掉末尾分隔符。
 * 根目录（`/`、`C:\`、`\\server\share`）原样保留，不会变成 `C:` 这种相对路径。
 */
export function normalizeRoot(dir, options = {}) {
  const { path: p } = optionsWithDefaults(options)
  const raw = expandHome(dir, options)
  if (raw === '') return ''
  const resolved = p.resolve(raw)
  const root = p.parse(resolved).root
  if (resolved === root) return root
  const trimmed = resolved.replace(/[\\/]+$/, '')
  return trimmed === '' ? root : trimmed
}

/**
 * 把绝对路径转成适合展示/写进 Markdown 的写法（统一用 `/`）。
 * 只用于显示，不拿它去读写文件。
 */
export function toDisplayPath(value, options = {}) {
  const { path: p } = optionsWithDefaults(options)
  return String(value ?? '').split(p.sep).join('/')
}
