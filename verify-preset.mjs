// 学理模式 · 静态自检（只读，不启动 DSH 主体）
// 检查：插件本体、预设声明、口径锁文案、出口校验接线、profile 注册、副本一致性。
// profile 自动探测，也可显式指定：TCM_PROFILE=/path/to/profile
// 用法: node verify-preset.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const PLUGIN = path.dirname(fileURLToPath(import.meta.url));
const PKG = 'dsh-tcm-xueli';        // 行 id、预设 id、插件导出名
const MOD = 'dsh-tcm-xueli';  // npm 包名＝node_modules 里的目录名＝模块说明符

function findProfile() {
  const given = process.env.TCM_PROFILE;
  if (given) return path.resolve(given);
  const base = path.join(os.homedir(), '.dsh', 'profiles');
  let dirs = [];
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(base, d.name))
      .filter((p) => fs.existsSync(path.join(p, 'package.json')));
  } catch {
    return '';
  }
  return dirs.find((p) => path.basename(p) === 'desktop') || dirs[0] || '';
}

const PROFILE = findProfile();
if (!PROFILE) {
  console.error('✖ 找不到 DSH profile。先启动一次 DSH，或用环境变量 TCM_PROFILE 指定 profile 目录。');
  process.exit(1);
}
const INSTALLED = path.join(PROFILE, 'node_modules', MOD);

const require_ = createRequire(path.join(PROFILE, 'package.json'));
const requirePlugin = createRequire(path.join(PLUGIN, 'package.json'));
let YAML;
try {
  YAML = require_('yaml');
} catch {
  try {
    YAML = requirePlugin('yaml');
  } catch (e) {
    console.error('✖ 找不到自检依赖（yaml）：' + e.message);
    console.error('  先跑一次安装脚本或 npm install，再重试自检。');
    process.exit(1);
  }
}

const out = [];
let ok = true;
let warn = 0;
const chk = (name, pass, detail = '') => {
  if (!pass) ok = false;
  out.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`);
};
const note = (name, pass, detail = '') => {
  if (!pass) warn++;
  out.push(`${pass ? 'PASS' : 'WARN'}  ${name}${detail ? ' | ' + detail : ''}`);
};
// 只做说明、不计入 WARN 的一行（比如「资料库还没配，跳过检查」）
const info = (name, detail = '') => {
  out.push(`INFO  ${name}${detail ? ' | ' + detail : ''}`);
};

// ---------- 1. 插件本体 ----------
const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'));
const isLocalOnly = pkg.private === true;
// 插件 id、行 id、npm 包名统一叫 dsh-tcm-xueli；旧名（tcm / dsh-tcm）只作兼容样本
const NPM_NAMES = new Set([PKG, 'tcm', 'dsh-tcm']);
chk(`包名 ${pkg.name}`, NPM_NAMES.has(pkg.name), [...NPM_NAMES].join(' / '));
chk('bundle.patch 指向 cordis.patch.yml', pkg?.dsh?.bundle?.patch === './cordis.patch.yml');
chk('main 为 lib/index.js', pkg.main === 'lib/index.js');
chk('client.platform = web', pkg?.dsh?.client?.platform === 'web');
chk('client.inject 含四项（含 ui-primitives）', ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-primitives'].every((x) => Array.isArray(pkg?.dsh?.client?.inject) && pkg.dsh.client.inject.includes(x)));
chk('description 写明仅供学习研究', String(pkg.description).includes('仅供学习研究'));
if (!isLocalOnly) chk('有发布信息（private 未设时才有 publishConfig）', !!pkg.publishConfig);

// ---------- 2. 口径文案 ----------
const gear = fs.readFileSync(path.join(PLUGIN, 'lib', 'gear.js'), 'utf8');
for (const m of ['GEAR_GUARD', 'MINIMAL_PREFIX', 'PRESET_DESCRIPTION', 'GEAR_GUARD_VAR', 'GEAR_MARK', 'KB_PATH_VAR'])
  chk(`lib/gear.js 含「${m}」`, gear.includes(m));
for (const m of ['仅供学习研究', '剂量：不自己给量', '不出处方笺', '针灸只给推荐穴位', '不写进针深浅', '按经方学理模式七段作答', '配伍禁忌必说', '药典用量警示必说', '复杂病症分主次必说'])
  chk(`口径锁含「${m}」`, gear.includes(m));
chk('口径锁本身不含剂量示例', gear.includes("'2. 剂量：不自己给量") && !/一两折多少克/.test(gear));
chk('口径锁含「18.1 讲药性不抄产地」', gear.includes('18.1 讲药性不抄产地'));
chk('口径锁含「18.2 注本的增补卷必须标明不是原书原文」', gear.includes('18.2 注本的增补卷必须标明不是原书原文'));
chk('18.2 含增补卷标注口径「原书未收，此书增补」', gear.includes('原书未收，此书增补'));
chk('口径锁含「18.3 本草新编要用户自己放进来」', gear.includes('18.3 本草新编要用户自己放进来'));
chk('口径锁含「21.3 分析病症必须带上当下的季节与天气」', gear.includes('21.3 分析病症必须带上当下的季节与天气'));
chk('口径锁里 15 条已改名为资料库目录与检索范围', gear.includes('15. 资料库目录与检索范围'));
chk('gear.js 导出时令变量', gear.includes("SEASON_VAR = 'tcm_xueli_season'"));

// ---------- 3. 宿主半接线 ----------
const host = fs.readFileSync(path.join(PLUGIN, 'lib', 'index.js'), 'utf8');
for (const m of ['hasDosage', "ctx.on('llm/stream'", 'GEAR_GUARD', 'GEAR_GUARD_VAR', 'defineVar(KB_PATH_VAR', 'defineVar(SEASON_VAR', 'seasonText', 'ctx.effect', 'ensureCorpus', 'createSessionRecorder', 'autoFileBooks', 'registerClinicTools'])
  chk(`lib/index.js 含「${m}」`, host.includes(m));
chk('lib/index.js 的 inject 以 systemPrompt 打头', /export const inject = \['systemPrompt'/.test(host));
chk('lib/index.js 同一目录只挂一份监视', host.includes('WATCHERS') && host.includes('shared.holders'));
chk('lib/index.js 不再有挡位开关', !host.includes('currentLevel') && !host.includes("'level'"));

// ---------- 4. 出口校验 ----------
const guard = fs.readFileSync(path.join(PLUGIN, 'lib', 'dosage-guard.js'), 'utf8');
// 2026-11-18：只遮「克」前面的数字，毫升与两钱不再遮；引文整句放行
for (const m of ['hasDosage', 'maskDosage', 'NUM', 'DOSE_UNITS', 'QUOTE_MAX', 'quotedRanges', 'ARTICLE_MARK'])
  chk(`lib/dosage-guard.js 含「${m}」`, guard.includes(m));

// ---------- 5. 客户端半语法 ----------
try {
  new vm.Script(fs.readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8'), { filename: 'lib/client.js' });
  chk('lib/client.js 语法可解析', true);
} catch (e) {
  chk('lib/client.js 语法可解析', false, e.message);
}
const clientJs = fs.readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8');
for (const m of [`id: '${pkg.name}'`, "var NS = 'dsh-tcm-xueli'", "form.set('kbPath'", '学理模式', "var SIM_PANEL = 'xueli-sim'", "label: function () { return '模拟问诊'; }", "var SIM_CHAT_SLOT = 'xueli.sim.chat'"])
  chk(`lib/client.js 含「${m}」`, clientJs.includes(m));
chk('lib/client.js 不再有挡位按钮', !clientJs.includes("form.set('level'"));
chk('问诊记录列表带题面与方名，好避开重复', (() => { const clinic = fs.readFileSync(path.join(PLUGIN, 'lib', 'clinic.js'), 'utf8'); return clinic.includes("'题面 '") && clinic.includes("'方 '"); })());
chk('记录列表里的方名先过遮罩，不吐克数', (() => { const clinic = fs.readFileSync(path.join(PLUGIN, 'lib', 'clinic.js'), 'utf8'); return clinic.includes('blotDosage(String(r.prescribe))'); })());
chk('模拟问诊有自己的干净面板（只画文字）', clientJs.includes('function QuietChat(') && clientJs.includes('function quietText('), '缺干净面板');
chk('干净面板只给模拟问诊用，会话页仍走官方面板', clientJs.includes('E(QuietChat, {') && clientJs.includes('E(WbChatPane, {'), '干净面板没挂对地方');
chk('干净面板认得宿主聊天快照', clientJs.includes("target('chat')") && clientJs.includes("svcOf('uiConversation').binding"));
chk('干净面板自己持有会话（不再问一次 binding 就放弃）', clientJs.includes("svcOf('sessions').using(sessionId") && clientJs.includes('tcmXueliSimChat') && !clientJs.includes('var binding = Ctx.sessions.binding(sessionId);'), '必须用 using 持有到卸载，否则快照永远是空的');
chk('干净面板轮询兑底（订阅不回调也不卡）', clientJs.includes('setInterval(sync, 1200)') && clientJs.includes('clearInterval(timer)'));
chk('开局气泡在诊室里只留局号行、锈点不露给医生', clientJs.includes('【模拟问诊 · 开局】') && clientJs.includes('said.slice(0, nl)'));
chk('诊室面板把打赏块裁掉，不露裸网址', clientJs.includes('function withoutGift(') && clientJs.includes("indexOf('请作者喝杯茶'"));
chk('诊室样式只有一套（没有重复的 quiet 规则）', clientJs.split('.sim-quiet{').length === 2, 'sim-quiet 样式重复');
chk('诊室从 node.data 取正文（宿主正文不在 node 顶层）', clientJs.includes('node.data || node'));
chk('简版读不到内容时就地摊开现场（不再偷偷切官方面板）', clientJs.includes('function quietRowsOf(') && clientJs.includes('sim-quiet-diag') && !clientJs.includes('先用官方面板'));
chk('等病人时挂一行提示，不留空白', clientJs.includes('正在叫病人开口') && clientJs.includes('病人正在回应'));
const clinicJs = fs.readFileSync(path.join(PLUGIN, 'lib', 'clinic.js'), 'utf8');
chk('锚点改由工具返回、不再拼进开局消息', clinicJs.includes('xueli_draw_anchor') && clinicJs.includes('ANCHOR_LIUJING') && !clientJs.includes('simAnchorLine') && !clientJs.includes('【不许重复】') && !clientJs.includes('本局随机锚点'), '锚点进开局消息就是剧透');
chk('开局指令只留中性两句', clientJs.includes("'【模拟问诊 · 开局】' + lv + '｜' + td + '｜' + rid") && clientJs.includes('按预设【模拟问诊】规矩开局'));
chk('锚点最近八局不重复', clinicJs.includes('ANCHOR_MEMORY = 8') && clinicJs.includes('anchorHistory'));
chk('锚点两个病机不重复', clinicJs.includes('one !== a') && clinicJs.includes('pickBingjiPair'));
chk('诊室认得出定稿正文（finalNode 兜底）', clientJs.includes('data.finalNode') && clientJs.includes('finalNode.blocks'));

// ---------- 6. 预设声明 ----------
const raw = fs.readFileSync(path.join(PLUGIN, 'cordis.patch.yml'), 'utf8');
const doc = YAML.parseDocument(raw.replace(/!!js\s+/g, ''), { prettyErrors: true, uniqueKeys: true });
const errs = [...doc.errors.map((e) => e.message), ...doc.warnings.map((w) => 'warn: ' + w.message)];
chk('YAML 可解析、无错误/告警', errs.length === 0, errs.join(' ;; '));
const tree = doc.toJS();
const rows = Array.isArray(tree) && tree[0] ? tree[0].insert || [] : [];
const pluginRow = rows.find((x) => x && x.id === PKG);
const presetRow = rows.find((x) => x && x.id === 'preset-tcm');
chk(`insert 含 ${PKG} 行`, !!pluginRow && pluginRow.name === pkg.name, pluginRow && pluginRow.name);
chk('insert 含 preset-tcm 行且为 agent-preset', !!presetRow && presetRow.name === '@deepseek-ai/dsh-agent-preset');
const cfg = presetRow ? presetRow.config : {};
chk('预设 id=dsh-tcm-xueli、order=5', cfg.id === 'dsh-tcm-xueli' && cfg.order === 5, `id=${cfg.id} order=${cfg.order}`);
chk('预设名注明学习版', String(cfg.name).includes('学习版'), cfg.name);
const presetPrefix = String((((cfg.plugins || []).find((x) => x && x.id === 'persona') || {}).config || {}).prefix || '');
chk('预设提示词含【模拟问诊】段落', presetPrefix.includes('【模拟问诊】'));
chk('预设提示词写明开局指令格式', presetPrefix.includes('【模拟问诊 · 开局】'));
chk('预设提示词让裁判记局（xueli_begin_round / xueli_finish_round）', presetPrefix.includes('xueli_begin_round') && presetPrefix.includes('xueli_finish_round'));
chk('提示词：锚点只从工具结果拿、不对医生露', presetPrefix.includes('本局锚点只从 xueli_draw_anchor 的工具结果里拿') && presetPrefix.includes('一个字都不许出现在给医生看的任何文字里'));
chk('提示词：查书白名单含抽锚工具', presetPrefix.includes('subagent、xueli_draw_anchor、xueli_begin_round、send_message、wait_agent'));
chk('模拟问诊仍守住「不给剂量」', presetPrefix.includes('不给剂量'));
chk('造病例不许查书（硬规在预设里）', presetPrefix.includes('【造病例不许查书】') && presetPrefix.includes('检索类工具一个都不许调'), '缺造病例不查书的硬规');
chk('病人第一句只讲难受，不许提方名药名', presetPrefix.includes('不许提方名、药名、条文号、证型名'));
chk('每局现抽病机、不许和最近几局撞车', presetPrefix.includes('【每局现抽，不许撞车】') && presetPrefix.includes('xueli_list_rounds'));
chk('转话时心里的方名条文不许写进面板', presetPrefix.includes('一个字都不许写进面板'));
chk('预设说明写明仅供学习研究', String(cfg.description).includes('仅供学习研究'));
const rawPrefix = ((cfg.plugins || []).find((x) => x.id === 'persona') || {}).config?.prefix || '';
chk('persona 提示词以常驻口径变量开头', rawPrefix.trimStart().startsWith('{{tcm_gear_guard}}'));
// 规矩正文只在 lib/gear.js 里维护，预设用 {{tcm_gear_guard}} 展开：
// 下面各条检查都跑在「展开之后」的完整提示词上，跟模型真看到的一致。
const { GEAR_GUARD: GUARD_TEXT } = await import(pathToFileURL(path.join(PLUGIN, 'lib', 'gear.js')).href);
const prefix = rawPrefix.replace('{{tcm_gear_guard}}', GUARD_TEXT);
chk('预设里不再内联整份口径（只留变量，避免两处各改一半）', !rawPrefix.includes('剂量：不自己给量'));
for (const m of ['剂量：不自己给量', '不出处方笺', '针灸只给推荐穴位', '不写进针深浅', '固定七段'])
  chk(`persona 提示词含「${m}」`, prefix.includes(m));
chk('persona 仍带资料库变量', prefix.includes('{{tcm_xueli_kb_path}}'));
chk('persona 带时令变量', prefix.includes('{{tcm_xueli_season}}'));
chk('persona 时令段写明天气取不到要问', prefix.includes('按节气常理') && prefix.includes('ask_user_question'));
chk('问诊参考结构无第 11 项', !prefix.includes('"11. '));
chk('问诊既用家常说法、又六部逐部问脉', prefix.includes('身上哪儿难受') && prefix.includes('直接六部逐部分开问'));
chk('五段与七段不许两套并存（9.5 与 16 同一结构）',
  prefix.includes('固定七段') && prefix.includes('按经方学理模式七段作答') &&
  !prefix.includes('固定五段') && !prefix.includes('作答结构固定五段'));
chk('出方格式为学理模式七段，不再分详略档', prefix.includes('按经方学理模式七段作答') && !prefix.includes('详略只调'));
chk('第一段硬格式：手上的线索 + 三行固定句式',
  prefix.includes('## 手上的线索') && prefix.includes('够定的是：') && prefix.includes('不够定的是：') && prefix.includes('所以要问的是：'));
chk('线索清点含性别年龄体重脉象小便', ['性别未说', '体重未说', '脉象未问', '小便未问'].every((k) => prefix.includes(k)));
chk('线索底数含体重与脉象', prefix.includes('这十项是定病定证的底数') && prefix.includes('体重与胖瘦、脉象（六部是必问项'));
chk('六部脉必问，每部问出速缓沉浮', prefix.includes('六部是必问项、缺一部就不算问完、不许下结论') && prefix.includes('每部都要问出「速缓沉浮」'));
chk('脉问的选项必须含「不急不慢」与「中」', prefix.includes('「不急不慢」和「中」这两个按钮必须真出现'));
chk('ask_user_question 选项写成 label 对象，不许纯字符串', prefix.includes('{"label": "选项文字"}') && !prefix.includes('"options": ["'));
chk('问不齐不许写结论行，只许接着问', prefix.includes('不许写「**结论**」那一行') && prefix.includes('「这只是方向，不是结论」「下面只说方向」不是免问的通行证'));
chk('没问齐只许再问不许动笔（判例在）', prefix.includes('典型的违规长这样') && prefix.includes('3 项「没问」的必须当场用 ask_user_question 问出去'));
chk('方证主依据：五运六气（代码算好照抄）+ 八纲为基石六经为框架', prefix.includes('五运六气') && prefix.includes('以八纲为基石') && prefix.includes('以六经为框架') && prefix.includes('照抄，不许自己推干支') && prefix.includes('至真要大论'));
chk('五种方法齐：整体/审因/四诊/辨病辨证/阴性症状', ['整体观念', '审证求因', '四诊合参', '辨病与辨证结合', '阴性症状'].every((k) => prefix.includes(k)));
chk('阴性症状要举例并说明排除哪一路', prefix.includes('不恶寒') && prefix.includes('排除') );
chk('AI 幻觉提示写在末尾声明里', prefix.includes('AI 有幻觉：以上内容由人工智能生成') && prefix.includes('请自行核对原书后再用'));
chk('五运六气必须引运气七篇原文', prefix.includes('不许含糊说一句「今年运气偏某某」'));
chk('动态问诊：十项不许缺，略过要逐项注明', prefix.includes('⑬问诊要动态') && prefix.includes('您选择略过'));
chk('略过项不算缺项', prefix.includes('只数「既没答、也没被对方明确略过」的项'));
chk('六经归属必须讲（不许只讲脏腑）', prefix.includes('先说这个证归哪一经') && prefix.includes('六经归属不典型，以脏腑辨证为主'));
chk('教材题不许豁免问诊', prefix.includes('只豁免「不接首诊、不开药」这一条') && prefix.includes('不许自称「这是教材题'));
chk('时令必须落到治法方向', prefix.includes('只写一句「时令这段只作说明、不改上面的辨证」等于没写'));
chk('讲第几气只许用当期六气，不许把下一气提前引', prefix.includes('第几气」只许用提示词') && prefix.includes('不许把下一气提前拿来用'));
chk('报数要对一遍数，三类之和等于总数，漏项点名', prefix.includes('列完还要自己对一遍数') && prefix.includes('体重未说'));
chk('复述原文必须加引号，没引号按自己复述处理', prefix.includes('一律原样放进「」里') && prefix.includes('没加引号的一律按自己复述处理'));
chk('报数只数十项，基础项单列不计入 X', prefix.includes('不计入 X') && prefix.includes('基础项：'));
chk('七段第四段名两处一致（9.5 与 16 同一写法）', (prefix.split('四、推荐穴位（主穴、配穴与取穴依据，不写用法）').length - 1) === 2);
chk('参考文档不再残留固定五段', !prefix.includes('固定五段'));
chk('五格齐全：证法方穴服后核对', prefix.includes('21.4 问诊问齐了（21.0 的十项与左右手六部脉都有交代') && prefix.includes('五格齐全，缺一格判不合格'));
chk('方名核不到也必须给穴位', prefix.includes('方可以不报，穴必须给'));
chk('不许摆两条路让人自己选', prefix.includes('「两条路，你选一条」判不合格'));
chk('跳过不许撤掉证法穴', prefix.includes('⑸跳过项不许拖垮五格') && prefix.includes('把「等寒热定了再谈方穴」当收尾'));
chk('六经与时令必须排在最前', prefix.includes('21.5 问诊齐了之后，开头的次序是固定的') && prefix.includes('「## 六经与时令」这一节'));

// ---------- 6.5 打赏码与六部脉计数 ----------
const dashangSrc = fs.readFileSync(path.join(PLUGIN, 'lib', 'dashang.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(PLUGIN, 'lib', 'index.js'), 'utf8');
chk('打赏区由插件代码追加', dashangSrc.includes('export function dashangBlock') && indexSrc.includes('dashangGiftText') && indexSrc.includes("chunk.type === 'finish'"));
chk('打赏补在任何给了分析的回答上', dashangSrc.includes('export function needsGift') && dashangSrc.includes('结论|方向|辨证|治法|病机') && indexSrc.includes('needsGift(head)'));
chk('打赏网址带实时端口', dashangSrc.includes('listenedPort') && dashangSrc.includes('config?.port') && !/127\.0\.0\.1:\d{4,5}\/dsh-tcm-xueli/.test(dashangSrc));
chk('打赏块含两张码与自愿说明', dashangSrc.includes('![支付宝打赏码]') && dashangSrc.includes('![微信打赏码]') && dashangSrc.includes('打赏全凭自愿'));
chk('提示词里不含打赏与收款码', !prefix.includes('打赏') && !prefix.includes('alipay.jpg') && !prefix.includes('![支付宝打赏码]') && !prefix.includes('请作者喝杯茶'));
chk('打赏去重同时看开头和结尾', indexSrc.includes('tailText') && indexSrc.includes("tailText.includes('请作者喝杯茶')"));
chk('两张打赏图随包发布', fs.existsSync(path.join(PLUGIN, 'assets', 'dashang', 'alipay.jpg')) && fs.existsSync(path.join(PLUGIN, 'assets', 'dashang', 'wechat.jpg')));
chk('打赏通道代码随包发布', fs.existsSync(path.join(PLUGIN, 'lib', 'dashang.js')));
chk('打赏通道接进宿主', indexSrc.includes('mountDashangRoute'));
chk('六部脉合起来只算一项', prefix.includes('「脉象」就是这十项里的一项') && prefix.includes('不拆成六项去报数'));
chk('六部怎么问都不许超过八问', prefix.includes('一轮六题，不会超过八问'));
chk('两版工具不许串（学习版侧）', fs.readFileSync(path.join(PLUGIN, 'lib', 'clinic.js'), 'utf8').includes("versionOf(ctx, context?.agent) !== 'full'"));
chk('全量版会话里学习版规则不生效', fs.readFileSync(path.join(PLUGIN, 'lib', 'index.js'), 'utf8').includes("versionOf(ctx, options?.sessionId) === 'full'"));
chk('识版导出 versionOf', fs.readFileSync(path.join(PLUGIN, 'lib', 'preset-scope.js'), 'utf8').includes('export function versionOf'));
chk('资料库根目录由代码锁定', fs.existsSync(path.join(PLUGIN, 'lib', 'kb-root.js')) && fs.readFileSync(path.join(PLUGIN, 'lib', 'kb-index.js'), 'utf8').includes('childOf(root, INDEX_FILE)') && fs.readFileSync(path.join(PLUGIN, 'lib', 'records.js'), 'utf8').includes('insideRoot(kb, dir)'));
chk('开局关掉思考、交卷再给回裁判', (() => { const think = fs.readFileSync(path.join(PLUGIN, 'lib', 'sim-think.js'), 'utf8'); const index = fs.readFileSync(path.join(PLUGIN, 'lib', 'index.js'), 'utf8'); return think.includes("'【模拟问诊 · 开局】'") && think.includes("['off', 'minimal', 'low']") && think.includes('createSimThinker') && index.includes('createSimThinker(ctx, { versionOf })'); })());
chk('这一局的病人子会话也关思考', (() => { const think = fs.readFileSync(path.join(PLUGIN, 'lib', 'sim-think.js'), 'utf8'); return think.includes('simSessions.has(parent)') && think.includes('subagent'); })());
chk('不再按文件夹名字认库', !fs.readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8').includes('KB_DIR_NAME'));
chk('各处提醒使用新的设置项名称', prefix.includes('设置 → 中医 · 经方（学习版）｜资料库目录') && !prefix.includes('中医 · 经方｜'));
chk('首次使用提醒写清「第一次用」与「点保存」', indexSrc.includes('这是第一次用') && indexSrc.includes('再点保存'));
chk('设置页保留首次使用的黄条提示', fs.readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8').includes('第一次用还没有设定资料库'));
chk('六部脉正常选项固定出现', prefix.includes('「数（跳得快）」「缓（跳得慢）」「不急不慢」') && prefix.includes('「浮（一按就摸到）」「沉（按到筋骨才摸到）」「中（不浮不沉）」'));
chk('六部脉默认分两轮问快慢与深浅', prefix.includes('第一轮六部一部一问') && prefix.includes('第二轮再一部一问'));

// ---------- 6.6 结构整理与三处医学补充 ----------
chk('口渴要问喜温喜冷', prefix.includes('想喝热的还是凉的') && prefix.includes('口渴喜温喜冷是分寒热虚实的一枚砝码'));
chk('口渴那一问给了四个按钮', prefix.includes('想喝热水') && prefix.includes('想喝凉水') && prefix.includes('口渴但不想咽'));
chk('基础项补宿疾用药与月经妊娠', prefix.includes('宿疾与长期用药（含血压') && prefix.includes('月经与妊娠（只问女性'));
chk('基础项仍不计入十项', prefix.includes('不计入 X（见 ⑫）'));
chk('16.1 三组圈号各自顺号', (() => {
  const i = prefix.indexOf('**写作纪律**：');
  if (i < 0) return false;
  const j = prefix.indexOf('17. ', i);
  const got = (prefix.slice(i, j).match(/[①-⑳]/g) || []).join('');
  return got === '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭';
})(), '写作纪律一组须 ①–⑭ 顺号无重号');
chk('模拟问诊暂停句已去掉打赏字样', presetPrefix.includes('末尾两行声明一律暂停') && !presetPrefix.includes('打赏'));
chk('第 21 条里 ⑤ 的后半归成 ⑤之三', prefix.includes('⑤之三，第三、四步的说法要能落地') && !prefix.includes('⑤第三、四步的说法要能落地'));
chk('问诊轮不许写正文那句摘出末尾声明', prefix.includes('末尾两行声明照常写）'));

chk('前说后说只留一条', (prefix.split('前说后说必须对得上').length - 1) === 1);
chk('24.1 紧跟第 24 条', (() => {
  const a = prefix.indexOf('24. 未核先报一律禁止');
  const b = prefix.indexOf('24.1 引述方子本身的事实');
  const c = prefix.indexOf('21.1 四步法的第二步');
  return a > 0 && b > a && c > b;
})());

chk('21.5 排在 21.6 前面', (() => {
  const a = prefix.indexOf('21.5 问诊齐了之后');
  const b = prefix.indexOf('21.6 君臣佐使是后世的钥匙');
  return a > 0 && b > a;
})());

// ---------- 7. profile 注册 ----------
const prof = JSON.parse(fs.readFileSync(path.join(PROFILE, 'package.json'), 'utf8'));
const bundles = prof?.dsh?.profile?.bundles || [];
chk(`profile bundles 含 ${MOD}`, bundles.includes(MOD));
chk('profile bundles 没有重复登记', bundles.filter((x) => x === MOD).length <= 1, bundles.join(','));
const depSpec = String(prof?.dependencies?.[MOD] || '');
chk(`profile dependencies 含 ${MOD}`, depSpec !== '', depSpec || '缺失');
let sameTarget = false;
try {
  sameTarget = fs.realpathSync(INSTALLED) === fs.realpathSync(PLUGIN);
} catch {
  sameTarget = false;
}
note(`node_modules/${MOD} 指向当前插件目录`, sameTarget, INSTALLED);

// ---------- 8. 副本一致性 ----------
const files = ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/gear.js', 'lib/dosage-guard.js', 'lib/preset.js', 'lib/client.js', 'lib/kb-index.js', 'lib/platform.js', 'lib/corpus.js', 'lib/records.js', 'lib/book-text.js', 'lib/book-classify.js', 'lib/auto-file.js', 'lib/clinic.js', 'lib/search.js', 'lib/preset-scope.js', 'lib/season.js', 'lib/dashang.js', 'lib/kb-root.js', 'lib/sim-think.js', 'lib/build-index.mjs'];
// 从 npm/git 装的副本会被 git 换成 CRLF，源目录是 LF；比内容不比行尾
const md5 = (p) => createHash('md5').update(fs.readFileSync(p, 'utf8').replaceAll(String.fromCharCode(13) + String.fromCharCode(10), String.fromCharCode(10))).digest('hex');
let diff = 0;
for (const f of files) {
  const s = path.join(PLUGIN, f);
  const d = path.join(INSTALLED, f);
  if (!fs.existsSync(s) || !fs.existsSync(d) || md5(s) !== md5(d)) {
    diff++;
    chk(`副本一致 ${f}`, false, '源或副本缺失/内容不同');
  }
}
if (diff === 0) chk(`node_modules 副本与源 ${files.length} 个文件一致`, true);

// ---------- 9. 真实加载（副本 lib/index.js import） ----------
{
  const mod = path.join(INSTALLED, 'lib', 'index.js');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(new URL('file:///' + mod.replace(/\\/g, '/')).href)});` +
    `console.log(JSON.stringify({name: m.name, inject: m.inject, hasConfig: !!m.Config, hasApply: typeof m.apply}))`,
  ], { encoding: 'utf8', timeout: 20000 });
  const pass = r.status === 0;
  chk('lib/index.js 可加载（含依赖解析）', pass, (r.stderr || r.stdout || '').trim().slice(0, 200));
  if (pass) {
    const info = JSON.parse(r.stdout.trim().split('\n').pop());
    chk('导出 name/inject/Config/apply 齐全', info.name === PKG && Array.isArray(info.inject) && info.hasConfig && info.hasApply, r.stdout.trim());
  }
}

// ---------- 10. 资料库（提示） ----------
const { defaultKbPath, normalizeRoot } = await import(new URL('file:///' + path.join(PLUGIN, 'lib', 'platform.js').replace(/\\/g, '/')).href);
const base = normalizeRoot(process.env.TCM_KB_PATH || defaultKbPath());
// 插件不再预设资料库目录：没给 TCM_KB_PATH 就跳过资料库检查，不算 WARN。
if (!base) {
  info('资料库检查已跳过', '没设 TCM_KB_PATH，插件也不再预设目录');
} else {
  note('资料库目录存在', fs.existsSync(base), base);
  if (fs.existsSync(base)) {
    note('索引.md 存在', fs.existsSync(path.join(base, '索引.md')));
    note('随包经典已补到 text/', fs.existsSync(path.join(base, 'text', '03-伤寒论.txt')));
  }
}

console.log(`profile：${PROFILE}`);
console.log(`插件：  ${PLUGIN}`);
console.log(`资料库：${base}\n`);
console.log(out.join('\n'));
const fails = out.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n结论: ${fails === 0 ? (warn ? '检查通过（含 WARN 提示）' : '全部通过，改动可安全生效') : `存在 ${fails} 个失败项，需修复`}${warn ? `，WARN ${warn} 项` : ''}`);
process.exit(fails === 0 ? 0 : 1);