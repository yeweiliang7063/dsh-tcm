/**
 * 中医知识库索引生成器
 *
 * 按资料库根目录的实际文件，生成 `索引.md`：先分「经典 / 经典注解 / 名著 /
 * 医案 / 方药 / 其他」，每类一张「文件 | 体积」表，末尾给目录结构。
 * 归类先看目录名（放进这五个同名文件夹即按文件夹归类），再看书名关键词。
 * 纯 Node 实现，只读目录、只写 索引.md，不碰其它文件；异常交给调用方兜底。
 */
import { readdirSync, statSync, fstatSync, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs'
import { join, extname, dirname, basename } from 'node:path'
import { normalizeRoot } from './platform.js'

export { normalizeRoot }

export const INDEX_FILE = '索引.md'
export const MARKER = '本文件由「中医 · 岐黄经方（学习版）」插件按目录自动生成'

/** 参与索引的扩展名；其它（图片、压缩包等）忽略。 */
const TEXT_EXTS = new Set(['.md', '.txt', '.doc', '.docx', '.pdf', '.epub'])

/** 五个大类，也是「按文件夹归类」时认的文件夹名；顺序即索引里的展示顺序。 */
export const CATEGORY_TITLES = ['经典', '经典注解', '名著', '医案', '方药']

/**
 * 在资料库根目录建好五个分类文件夹。
 *
 * 只建空文件夹，不移动、不改名任何书；某个文件夹建失败就跳过，
 * 下次启动或轮询时还会再试，不影响其它文件夹和主体启动。
 * @param {string} rootDir 资料库根目录（已确认存在）
 * @returns {number} 本次新建的文件夹数
 */
export function ensureCategoryDirs(rootDir) {
  if (!rootDir || !existsSync(rootDir)) return 0
  let created = 0
  for (const title of CATEGORY_TITLES) {
    const dir = join(rootDir, title)
    if (existsSync(dir)) continue
    try {
      mkdirSync(dir, { recursive: true })
      created += 1
    } catch (error) {
      // 单个文件夹失败不影响其它；下次启动或轮询再试。
    }
  }
  return created
}

/**
 * 归类规则：先看目录名（放进这五个同名文件夹即按文件夹归类），再看书名。
 * 这里的顺序即优先级，谁先命中归谁：
 * 医案 → 经典注解 → 名著 → 方药 → 经典。
 * 「讲经典的书」归经典注解，「经典原文」归经典，「后世专著」归名著，
 * 「本草、方书、方论」归方药；都认不出的归「其他」。
 */
const ANNOTATION = /讲义|讲稿|讲记|讲座|文字版|浅释|白话|今释|校注|注解|注疏|集注|译注|解读|串讲|浅注|补正|倪海厦|倪海夏|胡希恕|刘渡舟|郝万山|成无己|柯韵伯|柯琴|尤在泾|尤怡|张志聪|张隐庵/

const CATEGORIES = [
  { title: '医案', test: /医案|病案|治验|验案|临证录|医话|经验集/ },
  { title: '经典注解', test: ANNOTATION },
  { title: '名著', test: /医书|全书|秘录|外经|大成|血证|血證|医宗|景岳|脾胃论|温病|医论|衷中参西|儒门事亲|丹溪|东垣|傅青主|医林改错/ },
  { title: '方药', test: /本草|配方|良方|方书|方论|类方|汤头|药典|药物|方剂|方解|济世/ },
  { title: '经典', test: /黄帝内经|素问|灵枢|伤寒|金匮|难经|针灸甲乙经|脉经|濒湖脉学|桂林/ },
]
const OTHER_TITLE = '其他'

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB'
  return (bytes / 1048576).toFixed(2) + ' MB'
}

function formatTotal(bytes) {
  return (bytes / 1048576).toFixed(2) + ' MB'
}

function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

function stamp(date) {
  return (
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  )
}

/**
 * 取样判断一本书是简体还是繁体：按 UTF-8 解码读前 256 KB，
 * 数「爲為經識鬱證脈」等常见繁体字与「为经识郁证脉」等简体字。
 * 二者都有（简繁混排）记「简繁混排」，样本里一个都没有就空着不标。
 * 只读文件头，整本几 MB 的书也不拖慢索引。
 */
const TRAD_PROBE = '爲為經識鬱證脈體氣陽陰虛實熱藥湯溫涼補瀉衛營臟風濕頭頸聲數聽寫讀學'
const SIMP_PROBE = '为经识郁证脉体气阳明虚热药汤温凉补泻卫营脏风湿头颈声数听写读学'

export function scriptTag(full) {
  let text = ''
  try {
    const fd = openSync(full, 'r')
    try {
      const size = fstatSync(fd).size
      // 分散取样：每 128 KB 取开头 16 KB，最多 4 处；避免只看书头或页码、目录把全书判错。
      const step = 128 * 1024
      const span = 16 * 1024
      const count = size <= step * 2 ? 1 : Math.min(4, Math.ceil(size / step))
      const spots = []
      for (let i = 0; i < count; i += 1) spots.push(Math.max(0, Math.min(size - span, Math.floor((size / count) * i))))
      const buf = Buffer.alloc(span)
      for (const at of spots) {
        const n = readSync(fd, buf, 0, buf.length, at)
        if (n > 0) text += buf.subarray(0, n).toString('utf8')
      }
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    return ''
  }
  let trad = 0
  let simp = 0
  let han = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code >= 0x4e00 && code <= 0x9fff) han += 1
    if (TRAD_PROBE.includes(ch)) trad += 1
    else if (SIMP_PROBE.includes(ch)) simp += 1
  }
  // 按全汉字占比算：竖排、一句一行的文本也能判准，不被某一段的字体放大。
  if (han < 300) return ''
  const tradRatio = (trad + 0.5) / (trad + simp + 1)
  if (tradRatio >= 0.85) return '繁体'
  if (tradRatio >= 0.3) return '繁体为主'
  if (tradRatio >= 0.05) return '简繁混排'
  return ''
}

/** 递归时跳过的目录：这些不是书，也不该进索引。 */
const SKIP_DIRS = new Set(['.git', '.svn', 'node_modules', 'skills', 'references', '__pycache__'])

/**
 * 递归列出书文件。
 * 深度上限 6，防止误把整个磁盘挂载点扫穿；展示路径统一用 `/`，
 * Windows 的 read/glob 也认这种写法，换平台不用改索引。
 */
function walkFiles(dir, prefix, depth, found) {
  if (depth > 6) return found
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    return found
  }
  for (const entry of entries) {
    const name = entry.name
    if (name.startsWith('.') || name.startsWith('~$')) continue
    const full = join(dir, name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      const child = prefix === '' ? name : prefix + '/' + name
      walkFiles(full, child, depth + 1, found)
      continue
    }
    if (!entry.isFile()) continue
    if (prefix === '' && name === INDEX_FILE) continue
    // 手工版备份之类的副产物不进索引。
    if (/^(索引|index)[-_.]/.test(name)) continue
    if (!TEXT_EXTS.has(extname(name).toLowerCase())) continue
    let size = 0
    try {
      size = statSync(full).size
    } catch (error) {
      size = 0
    }
    found.push({ rel: prefix === '' ? name : prefix + '/' + name, name, size, tag: scriptTag(full) })
  }
  return found
}

/** 目录里出现五个分类名之一时，直接按该文件夹归类（外层文件夹优先）。 */
function folderCategory(rel) {
  const parts = rel.split('/')
  parts.pop()
  for (const part of parts) {
    if (CATEGORY_TITLES.includes(part)) return part
  }
  return ''
}

function categoryOf(rel) {
  const forced = folderCategory(rel)
  if (forced !== '') return forced
  // 《金匮要略方论》是《金匮要略》的本名，不能被「方论」误分到方药；
  // 带「讲义/浅释」等注解标记的仍归经典注解。
  if (/金匮要略方论/.test(rel) && !ANNOTATION.test(rel)) return '经典'
  for (const group of CATEGORIES) {
    if (group.test.test(rel)) return group.title
  }
  return OTHER_TITLE
}

function table(rows) {
  const lines = ['| 文件 | 体积 | 字形 |', '|---|---:|---|']
  for (const row of rows) lines.push('| `' + row.rel + '` | ' + formatSize(row.size) + ' | ' + (row.tag || '') + ' |')
  return lines.join('\n')
}

/**
 * 扫描资料库，返回 { markdown, files, bytes, groups }。
 * 目录不存在时 markdown 里写明原因，不抛异常。
 */
export function buildIndexMarkdown(rootDir, now = new Date()) {
  const root = normalizeRoot(rootDir)
  if (root === '' || !existsSync(root)) {
    const text = [
      '# 中医知识库索引',
      '',
      '> 根目录：`' + (root || '（未设置）') + '`',
      '> ' + MARKER + '。',
      '',
      '资料库目录当前不存在：请到「设置 → 中医资料库」改成正确路径，本文件会在路径可用后自动重建。',
      '',
    ].join('\n')
    return { markdown: text, files: [], bytes: 0, groups: {} }
  }

  const files = walkFiles(root, '', 0, [])

  const groups = {}
  for (const file of files) {
    // 目录名也参与归类：text/金匮要略/妇人杂病.txt 应归「经典」；
    // 放进五类同名文件夹时优先按文件夹归类。
    const title = categoryOf(file.rel)
    if (!groups[title]) groups[title] = []
    groups[title].push(file)
  }

  const order = CATEGORY_TITLES.concat(OTHER_TITLE)
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)

  const lines = ['# 中医知识库索引', '']
  lines.push('> 根目录：`' + root + '`　（' + MARKER + '，列出全部书目与体积）')
  lines.push('> 生成时间：' + stamp(now) + '　·　共 ' + files.length + ' 个文件，合计 ' + formatTotal(totalBytes))
  lines.push('> 分类：经典／经典注解／名著／医案／方药；把书放进这五个同名文件夹可强制归类。')
  lines.push('> 字形列：标「繁体」「繁体为主」或「简繁混排」的书，检索同一词要简繁双写（两个字并列成一组），不能只搜简体；只搜简体会漏掉整本繁体书。')
  const skill = join(root, 'skills', 'tcm-jingfang', 'SKILL.md')
  if (existsSync(skill)) lines.push('> 出方所用检索规程见 `skills/tcm-jingfang/SKILL.md`。')
  lines.push('')

  for (const title of order) {
    const rows = groups[title]
    if (!rows || rows.length === 0) continue
    rows.sort((a, b) => a.rel.localeCompare(b.rel, 'zh-Hans-CN'))
    lines.push('## ' + title, '', table(rows), '')
  }

  if (files.length === 0) {
    lines.push('## 暂无书目', '', '根目录下没有找到 .md / .txt / .doc / .docx / .pdf / .epub 文件。', '')
  }

  lines.push('## 目录结构', '')
  lines.push('```')
  lines.push('<资料库根目录>/')
  lines.push('├─ 索引.md            # 本文件，插件按目录自动生成，可随时覆盖')
  lines.push('├─ text/              # 各书纯文本副本')
  lines.push('└─ skills/tcm-jingfang/SKILL.md  # 可选，检索规程')
  lines.push('```')
  lines.push('')

  return { markdown: lines.join('\n'), files, bytes: totalBytes, groups }
}

/** 比较时忽略「生成时间」那一行，否则每次启动都会因为时间戳不同而重写文件。 */
function stripStamp(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('> 生成时间：'))
    .join('\n')
}

/**
 * 生成并写回 索引.md；书目没变化就不动文件（不刷 mtime，也不改生成时间）。
 * 返回 { changed, path, files, bytes }；目录不存在时 changed=false 且不写盘。
 */
export function writeIndex(rootDir, now = new Date()) {
  const root = normalizeRoot(rootDir)
  if (root === '' || !existsSync(root)) {
    return { changed: false, path: root, files: 0, bytes: 0, reason: 'root-missing' }
  }
  const built = buildIndexMarkdown(root, now)
  const target = join(root, INDEX_FILE)
  let previous = null
  try {
    previous = readFileSync(target, 'utf8')
  } catch (error) {
    previous = null
  }
  if (previous !== null && stripStamp(previous) === stripStamp(built.markdown)) {
    return { changed: false, path: target, files: built.files.length, bytes: built.bytes, reason: 'unchanged' }
  }
  const tmp = join(dirname(target), '.' + basename(target) + '.tmp')
  writeFileSync(tmp, built.markdown, 'utf8')
  renameSync(tmp, target)
  return { changed: true, path: target, files: built.files.length, bytes: built.bytes, reason: 'written' }
}
