/**
 * 随包资料（学理模式版）
 *
 * 插件包里的 corpus/ 放十部经典的纯文本；启动时只把「资料库里还没有」的文件
 * 复制到 <资料库>/text/，不覆盖用户自己整理过的版本。
 *
 * 学理模式下不再随包发检索规程与出方规程：资料库里只补书，不补规程，
 * 免得预设旧副本把已经改掉的口径又带回来。复制失败只记日志，不影响会话与启动。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS_DIR = join(ROOT_DIR, 'corpus')

/**
 * 把包内 corpus/*.txt 补到 <kb>/text/。
 * @param {string} kb 资料库根目录（已确认存在）
 * @returns {number} 本次新复制的文件数
 */
export function ensureCorpus(kb) {
  if (!kb || !existsSync(kb) || !existsSync(CORPUS_DIR)) return 0
  const target = join(kb, 'text')
  try {
    mkdirSync(target, { recursive: true })
  } catch (error) {
    return 0
  }

  let copied = 0
  let names = []
  try {
    names = readdirSync(CORPUS_DIR)
  } catch (error) {
    return 0
  }
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.txt')) continue
    const src = join(CORPUS_DIR, name)
    const dst = join(target, name)
    if (existsSync(dst)) continue
    try {
      copyFileSync(src, dst)
      copied += 1
    } catch (error) {
      // 单本复制失败不影响其它书；下次启动还会再试。
    }
  }
  return copied
}

/**
 * 学理模式下不再往资料库补检索规程、出方规程与剂量速查。
 * 保留这个函数只为兼容旧调用点，永远返回 0。
 * @returns {number}
 */
export function ensureAssets() {
  return 0
}

export { CORPUS_DIR }