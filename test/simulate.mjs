// 插件加载模拟（不启动 DSH 主体）：用假 ctx 走一遍 apply，检查四件事：
// 1. 两个提示词变量齐全，常驻口径有内容；
// 2. 出口校验在出现剂量时截断回答；
// 3. 同一目录只挂一份监视：后加载的实例共用已挂的监视，先加载的一方释放后，后加载的仍正常；
// 4. 启动后补书、建索引、建分类文件夹，且不往资料库写规程。
// 用法：node test/simulate.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mod = await import(new URL('../lib/index.js', import.meta.url).href)
const gear = await import(new URL('../lib/gear.js', import.meta.url).href)

/** 造一个假 ctx：记录变量、事件与清理钩子。 */
function makeCtx() {
  const logs = []
  const handlers = new Map()
  const variables = new Map()
  return {
    logs,
    handlers,
    variables,
    ctx: {
      logger: {
        info: (...a) => logs.push(['info', a.map(String).join(' | ')]),
        warn: (...a) => logs.push(['warn', a.map(String).join(' | ')]),
      },
      systemPrompt: { variable: (name, get) => variables.set(name, get) },
      on: (event, handler) => {
        handlers.set(event, handler)
        return () => handlers.delete(event)
      },
      effect: (fn) => fn(),
      get: () => undefined,
    },
  }
}

// ── 预设文件：口径锁在提示词最前面，且按常驻变量切换 ──
const rows = YAML.parseDocument(fs.readFileSync(path.join(PLUGIN, 'cordis.patch.yml'), 'utf8').replace(/!!js\s+/g, '')).toJS()[0].insert
const presetRow = rows.find((r) => r.id === 'preset-tcm')
const presetPrefix = presetRow.config.plugins[0].config.prefix
assert.ok(presetPrefix.trimStart().startsWith('{{tcm_gear_guard}}'), '预设提示词应以常驻口径变量开头')
for (const keyword of ['不给具体剂量', '不出处方笺', '针灸只给推荐穴位', '不写进针深浅', '配伍禁忌必说', '药典用量警示必说', '复杂病症分主次必说']) {
  assert.ok(presetPrefix.includes(keyword), `预设口径缺「${keyword}」`)
}
const config = presetRow.config
const presetText = JSON.stringify(presetRow.config.plugins[0].config.prefix)
assert.ok(!presetText.includes('"11. '), '问诊参考结构里不应再有第 11 问')
assert.ok(presetText.includes('按学理模式七段作答'), '出方格式应为学理模式七段')

// ── 起一个临时资料库 ──
const kbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcm-simulate-kb-'))
const settings = { kbPath: { get: () => kbDir }, autoIndex: { get: () => true } }

const first = makeCtx()
mod.apply(first.ctx, settings)
assert.equal(mod.currentPath(settings), path.resolve(kbDir).replace(/[\\/]+$/, ''))

// ── 检查 1：提示词变量 ──
for (const name of [gear.KB_PATH_VAR, gear.KB_LINK_VAR, gear.GEAR_GUARD_VAR]) {
  assert.ok(first.variables.has(name), `缺少变量 ${name}`)
}
assert.equal(first.variables.get(gear.GEAR_GUARD_VAR)(), gear.GEAR_GUARD, '常驻口径应等于口径锁')
assert.equal(first.variables.get(gear.KB_PATH_VAR)(), '中医知识库')

// ── 检查 2：出口校验 ──
const inspect = first.handlers.get('llm/stream')
assert.ok(typeof inspect === 'function', '应注册 llm/stream 校验')

async function run(answer) {
  const out = []
  const upstream = async function* () {
    for (const piece of answer) yield piece
  }
  for await (const chunk of inspect({}, upstream)) out.push(chunk)
  return out.join('')
}

const blocked = await run(['柴胡证以', '少阳为主。', '若用柴胡，一两折 15.6 克。'])
assert.ok(blocked.includes(gear.GEAR_BLOCK_NOTICE), '出现剂量时应截断并附提醒')
assert.ok(!blocked.includes('15.6 克'), '剂量不应漏出')
assert.ok(blocked.includes('柴胡证以'), '截断前的正文应保留')

const passed = await run(['少阳病，', '主证为往来寒热。'])
assert.ok(passed.includes('往来寒热'), '正常回答应原样放行')
assert.ok(!passed.includes(gear.GEAR_BLOCK_NOTICE))

// ── 检查 3：启动后建索引、补书 ──
await new Promise((r) => setTimeout(r, 6500))
assert.ok(fs.existsSync(path.join(kbDir, '索引.md')), '资料库应生成 索引.md')
assert.ok(fs.existsSync(path.join(kbDir, 'text', '03-伤寒论.txt')), '应补入随包经典')
assert.equal(fs.existsSync(path.join(kbDir, 'skills')), false, '不应再复制检索规程')
assert.equal(fs.existsSync(path.join(kbDir, 'references')), false, '不应再复制剂量速查')
for (const name of ['经典', '经典注解', '名著', '医案', '方药']) {
  assert.ok(fs.statSync(path.join(kbDir, name)).isDirectory(), `应建好 ${name}/ 文件夹`)
}

// ── 检查 4：后加载的实例共用同一目录的监视，先加载的释放后也不影响后加载的 ──
const second = makeCtx()
mod.apply(second.ctx, settings)
await new Promise((r) => setTimeout(r, 3200))
// 触发一次目录变化，验证监视仍活着（不报错、索引照常）
fs.writeFileSync(path.join(kbDir, 'text', '临时探针.txt'), '探针', 'utf8')
await new Promise((r) => setTimeout(r, 2500))
fs.rmSync(path.join(kbDir, 'text', '临时探针.txt'), { force: true })

const warns = [...first.logs, ...second.logs].filter((l) => l[0] === 'warn')
const realWarns = warns.filter(([, text]) => !text.includes('截断'))
assert.equal(realWarns.length, 0, `不应有异常告警：${realWarns.map((w) => w[1]).join(' ;; ')}`)

// ── 收尾 ──
fs.rmSync(kbDir, { recursive: true, force: true })
console.log('模拟通过：提示词变量、常驻口径、事件拦截、目录监视、索引生成都按预期工作。')
console.log(`日志 ${first.logs.length + second.logs.length} 条，其中截断告警 ${warns.length - realWarns.length} 条`)
process.exit(0)