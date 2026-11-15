#!/usr/bin/env node
/**
 * 手动重建资料库索引：node lib/build-index.mjs [资料库路径]
 * 必须给路径：插件不再预设资料库目录，没给就报用法退出。
 * 只写 索引.md，不动其它文件。
 */
import { writeIndex, normalizeRoot, INDEX_FILE } from './kb-index.js'
import { defaultKbPath } from './platform.js'

const given = process.argv[2] || process.env.TCM_KB_PATH || defaultKbPath()
if (!given) {
  console.error('用法：node lib/build-index.mjs <资料库目录>')
  console.error('插件不再预设资料库目录，必须把目录写出来。')
  process.exit(1)
}
const root = normalizeRoot(given)

const result = writeIndex(root)
if (result.reason === 'root-missing') {
  console.error('资料库目录不存在：' + root)
  process.exit(1)
}
const mb = (result.bytes / 1048576).toFixed(2)
if (result.changed) {
  console.log('已重建 ' + INDEX_FILE + '：' + result.path)
  console.log('收录 ' + result.files + ' 个文件，合计 ' + mb + ' MB')
} else {
  console.log(INDEX_FILE + ' 已是最新（' + result.files + ' 个文件，合计 ' + mb + ' MB），未改动')
}
