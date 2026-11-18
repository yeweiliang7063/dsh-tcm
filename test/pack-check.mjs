// 打包自检：拿 npm pack 的真实清单核对，防 files 白名单写错、漏发目录、测试目录混进来。
// 与 package.test.mjs 分工：那个查清单字段，这个查 npm 实际打出来的 tarball 内容。
// 用法：node test/pack-check.mjs（CI 里单跑，不进 npm test，免得每次单测都起一次打包）
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [info] = JSON.parse(execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf8' }))
const files = info.files.map((f) => f.path)
const need = [
  'cordis.patch.yml',
  'lib/index.js',
  'lib/gear.js',
  'install.mjs',
  'verify-preset.mjs',
  'assets/references/bianzheng-lu.md',
]

const missing = need.filter((x) => !files.includes(x))
if (missing.length) {
  console.error('✖ 打包缺少：' + missing.join('、'))
  process.exit(1)
}
const books = files.filter((f) => f.startsWith('corpus/') && f.endsWith('.txt'))
if (books.length !== 10) {
  console.error(`✖ corpus 里的经典应为 10 本，实际 ${books.length} 本`)
  process.exit(1)
}
if (files.some((f) => f.startsWith('test/'))) {
  console.error('✖ 测试目录被打进包了')
  process.exit(1)
}
console.log(`✔ 打包内容自检通过：${files.length} 个文件，经典 ${books.length} 本`)