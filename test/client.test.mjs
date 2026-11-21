import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** 在 Node 里模拟浏览器：接住 ModuleLoader 的登记，给一个最小的 react。 */
function loadClient() {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  let definition = null
  const win = { __ModuleLoader__: { load(def) { definition = def } } }
  const fakeReact = {
    createElement() { return {} },
    useState(value) { return [typeof value === 'function' ? value() : value, () => {}] },
    useEffect() {},
    useRef(value) { return { current: value } },
  }
  const sandbox = { window: win, document: undefined, console }
  const run = new Function('window', 'document', 'console', code)
  run(sandbox.window, sandbox.document, sandbox.console)
  assert.ok(definition, 'client.js 没有调用 window.__ModuleLoader__.load')
  return { definition, fakeReact }
}

test('浏览器半：登记名等于包名，能注册左侧图标与对应主面板', () => {
  const { definition, fakeReact } = loadClient()
  assert.equal(definition.id, 'dsh-tcm-xueli')
  const stub = {}
  const exports = definition.factory((name) => {
    if (name === 'react') return fakeReact
    // 学习版还要官方的基础组件库；这里只要它能被引到，具体组件不参与断言。
    return stub
  })
  assert.equal(exports.name, 'dsh-tcm-xueli/client')
  assert.ok(Array.isArray(exports.inject) && exports.inject.includes('slots'))

  const registered = []
  const ctx = {
    slots: {
      inject(name, fn) { registered.push({ kind: 'inject', name, out: fn() }) },
      register(spec, component) { return { spec, component } },
    },
  }
  exports.apply(ctx)
  const names = registered.map((r) => r.out && r.out.spec && r.out.spec.name)
  assert.ok(names.includes('sidebar.panellist'), '没有注册左侧导航入口')
  assert.ok(names.includes('main'), '没有注册对应主面板')
  const sidebar = registered.find((r) => r.name === 'sidebar.panellist').out.spec
  const main = registered.find((r) => r.name === 'main').out.spec
  assert.equal(sidebar.id, 'xueli-wb')
  assert.equal(main.key, 'xueli-wb', '左侧图标 id 与主面板 key 必须同名，点了才跳得过去')
  assert.equal(typeof sidebar.label, 'function')
  assert.equal(sidebar.label(), '经方学习版')
  assert.ok(names.includes('settings.section'), '设置页的资料库卡片不能因为加工作台而丢掉')
})

test('浏览器半：预设 id 写死为本插件，开会话不会跑到别家模式', () => {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.ok(code.includes("agentPreset: WB_PRESET"))
  // 点进来右侧就是一局新会话（有空白会话就复用），不自动翻开历史那一局。
  var createAt = code.indexOf('.create(');
  assert.ok(createAt > code.indexOf('function openFresh'), '建会话只许发生在 openFresh 里')
  assert.ok(code.includes('openFresh(first.blankId)'), '进面板应该落在新会话上')
  assert.ok(!code.includes('next[0].id'), '进面板不该自动翻开历史那一局')
  // 左列能操作：改名走会话绑定的 rename，删除走官方归档，搜索与滚动都要有。
  assert.ok(code.includes('bound.session.rename('), '改名要用会话绑定的 rename，别自己发明接口')
  assert.ok(code.includes('uiWorkspace.archiveSession('), '删除要走官方归档')
  assert.ok(code.includes("placeholder: '搜索会话'"), '左列最上方要有搜索框')
  assert.ok(code.includes('.xw-items{flex:1;min-height:0;overflow-y:auto'), '历史列表要能滑动')
  assert.ok(code.includes('.xw-now'), '左列要显示右侧当前这一局的名字')
  // 老写法 startSession 会把面板关掉（内部 selectPanel(null)），只能直接建会话。
  assert.ok(!code.includes('startSession('), '新建会话不能调 uiWorkspace.startSession，它会把面板关掉')
  assert.ok(code.includes('svc.create({ agentPreset: WB_PRESET })'), '新建会话要直接用本模式预设建一局')
  assert.ok(code.includes('svc.list.getSnapshot'), '历史列表直接从客户端会话快照取，不依赖宿主通道')
  // 上一版就栽在这：面板→聊天区没把 SessionProvider 传下去，右边只剩官方空会话页。
  assert.ok(code.includes('SessionProvider: props.SessionProvider'), '聊天区必须拿到面板给的 SessionProvider')
  assert.ok(code.includes('E(props.SessionProvider, { session: ref }'), '得用 SessionProvider 圈定这一局')
  // 线上踩过：Ctx.wbSessions 这种拼错/没注入的服务名，会让整个面板在渲染时抛错、白屏。
  var injected = (code.match(/exports\.inject = \[([^\]]*)\]/) || [])[1] || '';
  var names = (code.match(/Ctx\.[A-Za-z_][A-Za-z0-9_]*/g) || []).filter((hit) => hit !== 'Ctx.get');
  for (const hit of names) {
    const svc = hit.slice(4);
    assert.ok(injected.includes("'" + svc + "'"), '客户端访问的服务 ' + hit + ' 必须在 exports.inject 里声明');
  }
  // svcOf('x') 是运行时按名字取服务，取到的名字同样必须在注入名单里。
  var dynamic = code.match(/svcOf\('([A-Za-z0-9_]+)'\)/g) || [];
  for (const hit of dynamic) {
    const svc = hit.slice(7, -2);
    assert.ok(injected.includes("'" + svc + "'"), '客户端按名字取的服务 ' + svc + ' 必须在 exports.inject 里声明');
  }

  assert.ok(code.includes("var WB_PRESET = 'dsh-tcm-xueli'"))
})
test('取服务的 svcOf 必须真有定义（删模块时别把它带走）', () => {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  if (code.includes('svcOf(')) {
    assert.ok(code.includes('function svcOf('), '用了 svcOf 却没有定义，开局会直接报错')
  }
})

test('资料查询页：左侧有入口，面板回原文和白话', () => {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.ok(code.includes("var SR_PANEL = 'xueli-search'"), '查询页的 id 要写死')
  assert.ok(code.includes("label: function () { return '资料查询'; }"), '左侧入口名字是「资料查询」')
  assert.ok(code.includes("key: SR_PANEL"), '图标 id 与主面板 key 同名')
  assert.ok(code.includes("var SR_PATH = '/dsh-tcm-xueli/search'"), '查询地址要写死，和宿主的路由对上')
  assert.ok(code.includes("fetch(SR_PATH + '?q='") && code.includes('encodeURIComponent(text)'), '面板直接 fetch 本机查询路由')
  assert.ok(code.includes("'原文'") && code.includes("'白话'"), '结果要分原文和白话两段')
  assert.ok(code.includes('白话没译出来'), '译不出白话时要明说，不能冒充')
})

test('模拟问诊页：左侧有入口，能开一局并把开局话发进会话', () => {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.ok(code.includes("var SIM_PANEL = 'xueli-sim'"), '问诊页的 id 要写死')
  assert.ok(code.includes("label: function () { return '模拟问诊'; }"), '左侧入口名字是「模拟问诊」')
  assert.ok(code.includes('key: SIM_PANEL'), '图标 id 与主面板 key 同名')
  assert.ok(code.includes("var SIM_CHAT_SLOT = 'xueli.sim.chat'"), '问诊自己要一个聊天子插槽')
  assert.ok(code.includes("'【模拟问诊 · 开局】' + lv + '｜' + td + '｜' + rid"), '开局话要有难度、方向、局号')
  assert.ok(code.includes("svc.create({ agentPreset: WB_PRESET })"), '开一局要用本插件预设')
  assert.ok(code.includes('xueli_begin_round') === false, '工具是宿主半的，客户端不该提工具名')
})

test('聊天面板：换局不会把已释放的句柄交给会话组件', () => {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.equal(code.includes('refBox'), false, '不该再用 refBox 这种「渲染时读当前引用」的写法')
  assert.ok(code.includes('hold.id !== sessionId'), '要拿会话 id 对得上才画聊天区')
  assert.ok(code.includes("setHold({ id: sessionId, ref: ref })"), '句柄要连同 id 一起存状态')
  assert.ok(code.includes('setTimeout(function () {'), '释放要延后一拍，避免同一次提交里报 released')
})

test('模拟问诊：发话走 ready 解析出来的 SessionBinding，业务失败要抛', () => {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.ok(code.includes('var session = bound && bound.session'), 'ready 给的就是 binding，别再往下取 .binding')
  assert.equal(code.includes('bound.binding'), false)
  assert.ok(code.includes('result.ok === false'), 'prompt 返回 ok:false 要当失败')
  assert.ok(code.includes('simCss(); wbCss()'), '模拟问诊页也要注入工作台的聊天区样式')
  assert.ok(code.includes('pad(d.getSeconds())'), '局号要带秒，避免同一分钟撞号')
  assert.ok(code.includes('var archiveCurrent = function'), '换局/换难度要把旧局归档')
  assert.ok(code.includes('archiveCurrent();'), '换局时真的调归档')
})

test('左列点历史会话：留在面板里换这一局；归档要能真收起来', () => {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.ok(code.includes('onClick: function () { setSessionId(row.id); }'), '点历史会话就在面板里换到这一局，不跳出工作台')
  assert.ok(code.includes('var openInChat = function (maybeId)'), '「去聊天页」要能带上指定会话')
  assert.ok(code.includes('svc.list.refresh'), '归档后让会话列表重拉一遍')
})

test('归档过的会话不出现在左列，点进去也能恢复继续', () => {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.ok(code.includes('wsnap && wsnap.archivedSessionIds'), '列表要读归档集合')
  assert.ok(code.includes('var isArch = !!archivedSet[ids[i]];'), '归档过的会话不列出来')
  assert.ok(code.includes('ws.list.subscribe'), '归档后列表跟着重排')
  assert.ok(code.includes('uiWorkspace.unarchiveSession(sessionId)'), '归档会话要能恢复继续')
})

test('官方左栏的问诊局按行标记藏掉，React 重画后也还藏着', () => {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.ok(code.includes('[data-row-key="session:'), '按会话行标记找，不靠类名')
  assert.ok(code.includes('for (var sid in simRoundIds)'), '开过的问诊局并进隐藏集合')
  assert.ok(code.includes('if (el.textContent !== css) el.textContent = css'), '只在集合变化时改样式表，不逐帧改 DOM')
  assert.ok(!code.includes("el.style.display = 'none'"), '不许逐行改内联样式，会一闪一闪')
})

test('官方左栏不出现本插件自己的会话（整个预设都收起）', () => {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.ok(code.includes('showArch'), '面板有归档开关')
  assert.ok(code.includes('row.projectionValues && row.projectionValues.agentPreset'), '按预设认会话')
  assert.ok(code.includes('if (preset === WB_PRESET) out[ids[i]] = true;'), '本预设的会话都收起来')
  assert.ok(code.includes('var own = ownPresetIds();'), '左栏按预设藏行')
})

test('左栏隐藏：只认会话行、卸载时停表，不乱藏标题像问诊的普通会话', () => {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.ok(code.includes('function stopHideSimRows'), '要有停表函数')
  assert.ok(code.includes('clearInterval(simHideTimer)'), '卸载时要清掉轮询')
  assert.ok(code.includes('[data-row-key="session:'), '只按会话行认')
  assert.ok(!code.includes('[class*="sessionRow"]'), '不许用模糊类名去藏')
  assert.ok(!code.includes("el.style.display = 'none'"), '不许逐行改内联样式，会闪')
  assert.ok(!code.includes('isSimTitle(el.textContent)'), '不许拿整行文字判断')
  assert.ok(code.includes('stopHideOwnRows(); stopHideSimRows();'), '卸载钩子里两个表都要停')
  assert.ok(!/exports\.inject = \[[^\]]*'remote'/.test(code), '没用的 remote 注入要去掉')
})
