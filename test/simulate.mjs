// 插件加载模拟（不启动 DSH 主体）：用假 ctx 走一遍 apply，检查四件事：
// 1. 两个提示词变量齐全，常驻口径有内容；
// 2. 出口校验只把剂量数值遮成 ✳，且只对中医会话生效；
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
// 口径正文只在 GEAR_GUARD 里维护一份，预设里用变量展开；这里查的是那份唯一的正文。
for (const keyword of ['剂量：不自己给量', '不出处方笺', '针灸只给推荐穴位', '不写进针深浅', '配伍禁忌必说', '药典用量警示必说', '复杂病症分主次必说', '学理模式七段作答']) {
  assert.ok(gear.GEAR_GUARD.includes(keyword), `常驻口径缺「${keyword}」`)
}

// ── 起一个临时资料库 ──
const kbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcm-simulate-kb-'))
const settings = { kbPath: { get: () => kbDir }, autoIndex: { get: () => true } }

const first = makeCtx()
mod.apply(first.ctx, settings)
assert.equal(mod.currentPath(settings), path.resolve(kbDir).replace(/[\\/]+$/, ''))

// ── 检查 1：提示词变量 ──
for (const name of [gear.KB_PATH_VAR, gear.GEAR_GUARD_VAR]) {
  assert.ok(first.variables.has(name), `缺少变量 ${name}`)
}
assert.equal(first.variables.get(gear.GEAR_GUARD_VAR)(), gear.GEAR_GUARD, '常驻口径应等于口径锁')
assert.equal(first.variables.get(gear.KB_PATH_VAR)(), path.resolve(kbDir), '资料库变量应给出设置里那个目录的绝对路径')

// ── 检查 2：出口校验 ──
const inspect = first.handlers.get('llm/stream')
assert.ok(typeof inspect === 'function', '应注册 llm/stream 校验')

// 中医会话靠提示词识别：system 里带常驻口径的第一行即可。
const TCM_SYSTEM = gear.GEAR_GUARD.slice(0, gear.GEAR_GUARD.indexOf(String.fromCharCode(10)))

// 宿主的流是 chunk 对象（text-delta 之类），不是裸字符串；这里照宿主的样子喂。
async function run(answer, options = {}) {
  const out = []
  const upstream = async function* () {
    for (const piece of answer) yield { type: 'text-delta', index: 0, text: piece }
    yield { type: 'finish' }
  }
  for await (const chunk of inspect(options, upstream)) {
    if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') out.push(chunk.text)
  }
  return out.join('')
}

const masked = await run(['柴胡证以', '少阳为主。', '若用柴胡，一两折 15.6 克。'], { system: TCM_SYSTEM })
assert.ok(!masked.includes('15.6 克'), '剂量不应漏出')
assert.ok(masked.includes('一两折 ✳'), '只把数值遮成 ✳，量词与药名留下')
assert.ok(masked.includes('柴胡证以'), '正文应保留')

const passed = await run(['少阳病，', '主证为往来寒热。'], { system: TCM_SYSTEM })
assert.ok(passed.includes('往来寒热'), '正常回答应原样放行')
assert.ok(!passed.includes('✳'), '没有剂量就不该出现 ✳')

const other = await run(['若用柴胡，一两折 15.6 克。'], { system: '你是通用助手，负责回答技术问题。' })
assert.ok(other.includes('15.6 克'), '非中医会话一个字节都不该动')

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
// 遮数是正常告知（每遮一处记一条），不算异常；其余告警一条都不该有。
const unexpected = warns.filter(([, text]) => !text.includes('已把数值遮成 ✳'))
assert.equal(unexpected.length, 0, `不应有异常告警：${unexpected.map((w) => w[1]).join(' ;; ')}`)

// ── 收尾 ──
fs.rmSync(kbDir, { recursive: true, force: true })
console.log('模拟通过：提示词变量、常驻口径、出口遮数、目录监视、索引生成都按预期工作。')
console.log(`日志 ${first.logs.length + second.logs.length} 条，遮数告警 ${warns.length - unexpected.length} 条，异常告警 ${unexpected.length} 条`)
process.exit(0)