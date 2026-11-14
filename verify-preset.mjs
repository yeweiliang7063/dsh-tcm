// 学理模式 · 静态自检（只读，不启动 DSH 主体）
// 检查：插件本体、预设声明、口径锁文案、出口校验接线、profile 注册、副本一致性。
// profile 自动探测，也可显式指定：TCM_PROFILE=/path/to/profile
// 用法: node verify-preset.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const PLUGIN = path.dirname(fileURLToPath(import.meta.url));
const PKG = 'dsh-tcm';

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
const INSTALLED = path.join(PROFILE, 'node_modules', PKG);

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

// ---------- 1. 插件本体 ----------
const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'));
const isLocalOnly = pkg.private === true;
chk(`包名 ${PKG}`, pkg.name === PKG, pkg.name);
chk('bundle.patch 指向 cordis.patch.yml', pkg?.dsh?.bundle?.patch === './cordis.patch.yml');
chk('main 为 lib/index.js', pkg.main === 'lib/index.js');
chk('client.platform = web', pkg?.dsh?.client?.platform === 'web');
chk('client.inject 含四项（含 ui-primitives）', ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-primitives'].every((x) => Array.isArray(pkg?.dsh?.client?.inject) && pkg.dsh.client.inject.includes(x)));
chk('description 写明仅供学习研究', String(pkg.description).includes('仅供学习研究'));
if (!isLocalOnly) chk('有发布信息（private 未设时才有 publishConfig）', !!pkg.publishConfig);

// ---------- 2. 口径文案 ----------
const gear = fs.readFileSync(path.join(PLUGIN, 'lib', 'gear.js'), 'utf8');
for (const m of ['GEAR_GUARD', 'GEAR_BLOCK_NOTICE', 'MINIMAL_PREFIX', 'PRESET_DESCRIPTION', 'GEAR_GUARD_VAR', 'GEAR_MARK', 'KB_PATH_VAR'])
  chk(`lib/gear.js 含「${m}」`, gear.includes(m));
for (const m of ['仅供学习研究', '不给具体剂量', '不出处方笺', '针灸只给推荐穴位', '不写进针深浅', '按学理模式七段作答', '配伍禁忌必说', '药典用量警示必说', '复杂病症分主次必说'])
  chk(`口径锁含「${m}」`, gear.includes(m));
chk('口径锁本身不含剂量示例', gear.includes("'2. 不给具体剂量：不写任何克数") && !/一两折多少克/.test(gear));

// ---------- 3. 宿主半接线 ----------
const host = fs.readFileSync(path.join(PLUGIN, 'lib', 'index.js'), 'utf8');
for (const m of ['hasDosage', "ctx.on('llm/stream'", 'GEAR_GUARD', 'GEAR_GUARD_VAR', "variable(KB_PATH_VAR", 'ctx.effect', 'ensureCorpus', 'createSessionRecorder', 'autoFileBooks', "inject = ['systemPrompt']"])
  chk(`lib/index.js 含「${m}」`, host.includes(m));
chk('lib/index.js 不再补发检索规程', !host.includes('ensureAssets'));
chk('lib/index.js 同一目录只挂一份监视', host.includes('WATCHERS') && host.includes('shared.holders'));
chk('lib/index.js 不再有挡位开关', !host.includes('currentLevel') && !host.includes("'level'"));

// ---------- 4. 出口校验 ----------
const guard = fs.readFileSync(path.join(PLUGIN, 'lib', 'dosage-guard.js'), 'utf8');
// 2026-11-14：剂量守卫重写，UNIT_WORD / LITER_WORD 两个旧常量合并成 NUM / LATIN_UNIT
for (const m of ['hasDosage', 'maskDosage', 'NUM', 'LATIN_UNIT', 'ARTICLE_MARK'])
  chk(`lib/dosage-guard.js 含「${m}」`, guard.includes(m));

// ---------- 5. 客户端半语法 ----------
try {
  new vm.Script(fs.readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8'), { filename: 'lib/client.js' });
  chk('lib/client.js 语法可解析', true);
} catch (e) {
  chk('lib/client.js 语法可解析', false, e.message);
}
const clientJs = fs.readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8');
for (const m of ["id: 'dsh-tcm'", "var NS = 'dsh-tcm'", "form.set('kbPath'", '学理模式'])
  chk(`lib/client.js 含「${m}」`, clientJs.includes(m));
chk('lib/client.js 不再有挡位按钮', !clientJs.includes("form.set('level'"));

// ---------- 6. 预设声明 ----------
const raw = fs.readFileSync(path.join(PLUGIN, 'cordis.patch.yml'), 'utf8');
const doc = YAML.parseDocument(raw.replace(/!!js\s+/g, ''), { prettyErrors: true, uniqueKeys: true });
const errs = [...doc.errors.map((e) => e.message), ...doc.warnings.map((w) => 'warn: ' + w.message)];
chk('YAML 可解析、无错误/告警', errs.length === 0, errs.join(' ;; '));
const tree = doc.toJS();
const rows = Array.isArray(tree) && tree[0] ? tree[0].insert || [] : [];
const pluginRow = rows.find((x) => x && x.id === PKG);
const presetRow = rows.find((x) => x && x.id === 'preset-tcm');
chk(`insert 含 ${PKG} 行`, !!pluginRow && pluginRow.name === PKG);
chk('insert 含 preset-tcm 行且为 agent-preset', !!presetRow && presetRow.name === '@deepseek-ai/dsh-agent-preset');
const cfg = presetRow ? presetRow.config : {};
chk('预设 id=dsh-tcm、order=5', cfg.id === 'dsh-tcm' && cfg.order === 5, `id=${cfg.id} order=${cfg.order}`);
chk('预设名注明学习版', String(cfg.name).includes('学习版'), cfg.name);
chk('预设说明写明仅供学习研究', String(cfg.description).includes('仅供学习研究'));
const prefix = ((cfg.plugins || []).find((x) => x.id === 'persona') || {}).config?.prefix || '';
chk('persona 提示词以常驻口径变量开头', prefix.trimStart().startsWith('{{tcm_gear_guard}}'));
for (const m of ['不给具体剂量', '不出处方笺', '针灸只给推荐穴位', '不写进针深浅', '五段'])
  chk(`persona 提示词含「${m}」`, prefix.includes(m));
chk('persona 仍带资料库变量', prefix.includes('{{tcm_kb_path}}'));
chk('问诊参考结构无第 11 项', !prefix.includes('"11. '));
chk('问诊只问脉证', prefix.includes('问诊只问脉证'));
chk('出方格式为学理模式七段，不再分详略档', prefix.includes('按学理模式七段作答') && !prefix.includes('详略只调'));

// ---------- 7. profile 注册 ----------
const prof = JSON.parse(fs.readFileSync(path.join(PROFILE, 'package.json'), 'utf8'));
const bundles = prof?.dsh?.profile?.bundles || [];
chk(`profile bundles 含 ${PKG}`, bundles.includes(PKG));
chk('profile bundles 没有重复登记', bundles.filter((x) => x === PKG).length <= 1, bundles.join(','));
const depSpec = String(prof?.dependencies?.[PKG] || '');
chk(`profile dependencies 含 ${PKG}`, depSpec !== '', depSpec || '缺失');
let sameTarget = false;
try {
  sameTarget = fs.realpathSync(INSTALLED) === fs.realpathSync(PLUGIN);
} catch {
  sameTarget = false;
}
note(`node_modules/${PKG} 指向当前插件目录`, sameTarget, INSTALLED);

// ---------- 8. 副本一致性 ----------
const files = ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/gear.js', 'lib/dosage-guard.js', 'lib/preset.js', 'lib/client.js', 'lib/kb-index.js', 'lib/platform.js', 'lib/corpus.js', 'lib/records.js', 'lib/book-text.js', 'lib/book-classify.js', 'lib/auto-file.js', 'lib/build-index.mjs'];
const md5 = (p) => createHash('md5').update(fs.readFileSync(p)).digest('hex');
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
note('资料库目录存在', fs.existsSync(base), base);
if (fs.existsSync(base)) {
  note('索引.md 存在', fs.existsSync(path.join(base, '索引.md')));
  note('随包经典已补到 text/', fs.existsSync(path.join(base, 'text', '03-伤寒论.txt')));
}

console.log(`profile：${PROFILE}`);
console.log(`插件：  ${PLUGIN}`);
console.log(`资料库：${base}\n`);
console.log(out.join('\n'));
const fails = out.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n结论: ${fails === 0 ? (warn ? '检查通过（含 WARN 提示）' : '全部通过，改动可安全生效') : `存在 ${fails} 个失败项，需修复`}${warn ? `，WARN ${warn} 项` : ''}`);
process.exit(fails === 0 ? 0 : 1);