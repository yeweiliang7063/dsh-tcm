/**
 * 资料库根目录「新书自动归类」。
 *
 * 只处理根目录里的书籍文件，按去掉扩展名的书名分组（例如《伤寒论》的
 * .docx 与 .md 会作为一组一起移动）。先取正文样本判断类别，再物理移动到
 * 五个分类文件夹之一；拿不准的留在根目录，不硬移。
 *
 * 安全边界：
 * - 只移动、不改写、不删除用户内容；跨盘移动用复制后删源文件。
 * - 目标重名不覆盖，自动加 -2、-3……
 * - 正在复制中的文件（mtime 太新）跳过，等下一轮。
 * - 任何失败只记日志并保留源文件，不影响插件和会话。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { CATEGORY_TITLES, normalizeRoot } from './kb-index.js'
import { extractBookText } from './book-text.js'
import { classifyBook } from './book-classify.js'

const BOOK_EXTS = new Set(['.md', '.txt', '.doc', '.docx', '.pdf', '.epub'])
const SKIP_NAME = /^(索引|index|readme|license|skill)(\.|$)/i
const MAX_SAMPLE = 200 * 1024
const DEFAULT_MIN_AGE = 2000

function isBookFile(name) {
  if (!name || name.startsWith('.') || name.startsWith('~$')) return false
  if (/\.(bak|tmp|log)$/i.test(name)) return false
  if (/\.bak-/i.test(name)) return false
  if (SKIP_NAME.test(name)) return false
  return BOOK_EXTS.has(extname(name).toLowerCase())
}

/** 目标重名时找一个不冲突的文件名；找不到返回 null。 */
function uniqueTarget(dir, name) {
  if (!existsSync(join(dir, name))) return join(dir, name)
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 2; i <= 100; i += 1) {
    const candidate = join(dir, `${stem}-${i}${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  return null
}

/** 同一分区用 rename；跨分区退回复制后删源文件。 */
function moveFile(source, target) {
  try {
    renameSync(source, target)
    return true
  } catch (error) {
    if (error && error.code === 'EXDEV') {
      try {
        copyFileSync(source, target)
        unlinkSync(source)
        return true
      } catch (copyError) {
        try {
          if (existsSync(target)) unlinkSync(target)
        } catch (cleanupError) {
          // 清理失败也不掩盖原始错误。
        }
        throw copyError
      }
    }
    throw error
  }
}

function sampleGroup(files) {
  let text = ''
  for (const file of files) {
    if (text.length >= MAX_SAMPLE) break
    try {
      text += extractBookText(file.full) + '\n'
    } catch (error) {
      // 单本读不出来就跳过，不影响同组其它格式。
    }
  }
  return text.slice(0, MAX_SAMPLE)
}

function groupByStem(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const full = entry.full
    let stat
    try {
      stat = statSync(full)
    } catch (error) {
      continue
    }
    if (!stat.isFile()) continue
    const stem = basename(entry.name, extname(entry.name))
    if (!groups.has(stem)) groups.set(stem, [])
    groups.get(stem).push({
      name: entry.name,
      full,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    })
  }
  return groups
}

function signatureOf(files) {
  return files
    .map((file) => `${file.name}:${file.size}:${Math.round(file.mtimeMs)}`)
    .sort()
    .join('|')
}

/**
 * 扫描一次根目录并移动能确定类别的书。
 * @param {string} rootDir
 * @param {{logger?: any, cache?: Map<string, any>, minAgeMs?: number, now?: number|Date}} options
 * @returns {{moved: number, groups: number, unclassified: number}}
 */
export function autoFileBooks(rootDir, options = {}) {
  const result = { moved: 0, groups: 0, unclassified: 0 }
  const logger = options.logger
  const cache = options.cache instanceof Map ? options.cache : null
  const minAgeMs = Number.isFinite(options.minAgeMs) ? Math.max(0, options.minAgeMs) : DEFAULT_MIN_AGE
  const now = options.now instanceof Date ? options.now.getTime() : (Number.isFinite(options.now) ? options.now : Date.now())

  if (!rootDir) return result
  const root = normalizeRoot(rootDir)
  if (!existsSync(root)) return result

  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isBookFile(entry.name))
      .map((entry) => ({ name: entry.name, full: join(root, entry.name) }))
  } catch (error) {
    logger?.warn?.('岐黄经方：扫描资料库根目录失败，跳过自动归类：%o', error)
    return result
  }

  const groups = groupByStem(entries)
  result.groups = groups.size

  for (const [stem, files] of groups) {
    if (!files.length) continue
    // 还在复制（刚写入）的文件先不动，等下一轮。
    if (files.some((file) => now - file.mtimeMs < minAgeMs)) continue

    const key = root + '|' + stem
    const signature = signatureOf(files)
    const cached = cache?.get(key)
    if (cached && cached.signature === signature && cached.category === '其他') {
      result.unclassified += 1
      continue
    }

    const text = sampleGroup(files)
    const verdict = classifyBook({ name: stem, text })
    const category = verdict.category
    if (!CATEGORY_TITLES.includes(category) || verdict.score < 5) {
      if (cache) cache.set(key, { signature, category: '其他' })
      result.unclassified += 1
      continue
    }

    const targetDir = join(root, category)
    try {
      mkdirSync(targetDir, { recursive: true })
    } catch (error) {
      logger?.warn?.('岐黄经方：创建分类文件夹失败，暂不移动《%s》：%o', stem, error)
      if (cache) cache.set(key, { signature, category: '其他' })
      result.unclassified += 1
      continue
    }

    let moved = 0
    for (const file of files) {
      const target = uniqueTarget(targetDir, file.name)
      if (!target) {
        logger?.warn?.('岐黄经方：目标文件夹里同名文件太多，暂不移动《%s》', file.name)
        continue
      }
      try {
        moveFile(file.full, target)
        moved += 1
      } catch (error) {
        logger?.warn?.('岐黄经方：移动《%s》到「%s」失败，源文件保留：%o', file.name, category, error)
      }
    }

    if (moved > 0) {
      result.moved += moved
      logger?.info?.('岐黄经方：已自动归类《%s》→「%s」（%d 个文件）', stem, category, moved)
      if (cache) cache.delete(key)
    } else {
      result.unclassified += 1
    }
  }

  if (cache && cache.size > 2000) cache.clear()
  return result
}
