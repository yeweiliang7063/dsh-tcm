#!/usr/bin/env node
// 一键安装「岐黄经方（学习版）」中医预设（dsh-tcm）到本机 DSH
//
// 用法：
//   node install.mjs                     用当前脚本所在目录作为插件来源
//   node install.mjs --dry-run           只看会做什么，不改任何文件
//   node install.mjs --profile <目录>     指定 profile（默认自动找 ~/.dsh/profiles/desktop）
//   node install.mjs --kb <目录>          指定资料库目录（只用于检查提示）
//
// 做的事：
//   1. 把本源目录链接进 profile 的 node_modules/dsh-tcm（已指向别处则改名备份，不删除）；
//   2. 在 profile 的 dependencies 里登记本源，在 dsh.profile.bundles 里登记 dsh-tcm；
//   3. 跑静态自检（verify-preset.mjs）；
//   4. 提示重启 DSH 与选预设。
//
// 只做登记与链接，不改 profile 里其它任何一行。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defaultKbPath, normalizeRoot } from './lib/platform.js'

const PKG = 'dsh-tcm'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DRY = process.argv.includes('--dry-run')

const mark = {
  ok: (s) => console.log('  ✔ ' + s),
  warn: (s) => console.log('  ! ' + s),
  info: (s) => console.log('    ' + s),
  step: (s) => console.log('\n▸ ' + s),
}

function argValue(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i < 0 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}

function die(msg, hint) {
  console.error('\n✖ ' + msg)
  if (hint) console.error('  ' + hint)
  process.exit(1)
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    die(`读不懂 ${file}：${e.message}`, '文件可能被改坏了，用同目录的 .bak 备份还原后再试。')
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

// ── 1. 找 profile ────────────────────────────────────────────────
function findProfile(explicit) {
  if (explicit) {
    const p = path.resolve(explicit)
    if (!fs.existsSync(path.join(p, 'package.json'))) die(`指定的目录不像 profile：${p}`)
    return p
  }
  const base = path.join(os.homedir(), '.dsh', 'profiles')
  if (!fs.existsSync(base)) {
    die(`找不到 DSH 的 profile 目录：${base}`, '先装好 DSH 桌面版并至少启动一次，再运行本脚本。')
  }
  const names = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(base, d.name, 'package.json')))
    .map((d) => d.name)
  if (!names.length) die(`profile 目录里没有可用的 profile：${base}`, '先启动一次 DSH。')
  return path.join(base, names.includes('desktop') ? 'desktop' : names[0])
}

// ── 2. 链接 ──────────────────────────────────────────────────────
function installDir(profile) {
  return path.join(profile, 'node_modules', PKG)
}

function linkSource(profile) {
  const link = installDir(profile)
  let exists = false
  try {
    exists = fs.existsSync(link) || fs.lstatSync(link).isSymbolicLink()
  } catch {
    exists = false
  }

  if (exists) {
    let current = null
    try {
      current = fs.realpathSync(link)
    } catch {
      current = null
    }
    if (current && path.resolve(current) === path.resolve(HERE)) {
      mark.ok(`链接已存在且指向本源：${link}`)
      return
    }
    const bak = `${link}.bak-${stamp()}`
    if (!DRY) fs.renameSync(link, bak)
    mark.warn(`原位置被别的插件占着（多半是 npm 上的同名旧包），已改名备份：${path.basename(bak)}`)
  }

  if (DRY) {
    mark.info(`[演练] 会创建链接 ${link} → ${HERE}`)
    return
  }
  fs.mkdirSync(path.dirname(link), { recursive: true })
  // Windows 用 junction，不需要管理员权限；macOS / Linux 用目录软链接。
  fs.symlinkSync(HERE, link, process.platform === 'win32' ? 'junction' : 'dir')
  mark.ok(`已创建链接 ${link} → ${HERE}`)
}

// ── 3. 写 profile ────────────────────────────────────────────────
function patchProfile(profile) {
  const file = path.join(profile, 'package.json')
  const pkg = readJson(file)
  const before = JSON.stringify(pkg)

  pkg.dependencies = pkg.dependencies || {}
  pkg.dependencies[PKG] = 'link:' + HERE.replace(/\\/g, '/')

  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
  if (!bundles.includes(PKG)) bundles.push(PKG)
  pkg.dsh.profile.bundles = bundles

  if (JSON.stringify(pkg) === before) {
    mark.ok('profile 配置已经是目标状态，无需改动')
    return
  }
  if (DRY) {
    mark.info('[演练] 会更新 profile 的 package.json（依赖 + bundles）')
    return
  }
  const bak = `${file}.bak-tcm-install-${stamp()}`
  fs.copyFileSync(file, bak)
  writeJson(file, pkg)
  mark.ok(`profile 已更新（备份：${path.basename(bak)}）`)
}

// ── 4. 自检 ──────────────────────────────────────────────────────
function verify(profile) {
  const problems = []
  const dir = installDir(profile)
  if (!fs.existsSync(dir)) problems.push(`没找到安装目录 ${dir}`)
  else if (!fs.existsSync(path.join(dir, 'package.json'))) problems.push('安装目录里没有 package.json')
  else if (!fs.existsSync(path.join(dir, 'cordis.patch.yml'))) problems.push('安装目录里没有 cordis.patch.yml（预设定义缺失）')

  const pkg = readJson(path.join(profile, 'package.json'))
  const bundles = pkg?.dsh?.profile?.bundles || []
  if (!bundles.includes(PKG)) problems.push(`profile 的 bundles 里没有 ${PKG}`)
  if (bundles.filter((x) => x === PKG).length > 1) problems.push(`${PKG} 在 bundles 里登记了不止一次`)
  if (!pkg?.dependencies?.[PKG]) problems.push(`profile 的 dependencies 里没有 ${PKG}`)

  if (problems.length) {
    for (const p of problems) mark.warn(p)
    return false
  }
  mark.ok('插件文件、依赖、bundles 三项齐全')
  return true
}

// ── 5. 资料库提示 ────────────────────────────────────────────────
function checkKb(kb) {
  // 中医会话查书、生成索引、归档医案都在这一个目录里。
  if (!fs.existsSync(kb)) {
    mark.warn(`资料库目录还不存在：${kb}`)
    mark.info('插件启动后按需创建，十部经典会自动补到 text/；也可以先执行 node lib/build-index.mjs <目录> 建索引。')
    return
  }
  mark.ok(`资料库目录存在：${kb}`)
  if (fs.existsSync(path.join(kb, '索引.md'))) mark.ok('索引.md 已存在')
  else mark.info('索引.md 还没有，插件启动后自动生成')
}

// ── 主流程 ───────────────────────────────────────────────────────
console.log('══ 中医预设「岐黄经方（学习版）」安装脚本 ══' + (DRY ? '（演练模式，不改任何文件）' : ''))

const profile = findProfile(argValue('--profile', null))
const kb = normalizeRoot(argValue('--kb', defaultKbPath()))

mark.step('目标环境')
mark.info(`平台：${process.platform}（${process.arch}）`)
mark.info(`profile：${profile}`)
mark.info(`插件来源：${HERE}`)
mark.info(`资料库：${kb}`)

mark.step('安装插件')
linkSource(profile)

mark.step('登记到 DSH')
patchProfile(profile)

mark.step('自检')
const ok = DRY ? true : verify(profile)
if (DRY) mark.info('[演练] 跳过实际校验')

mark.step('资料库检查')
checkKb(kb)

if (ok && !DRY) {
  mark.step('静态自检（verify-preset.mjs）')
  const r = spawnSync(process.execPath, [path.join(HERE, 'verify-preset.mjs')], {
    cwd: HERE,
    stdio: 'inherit',
    env: { ...process.env, TCM_PROFILE: profile, TCM_KB_PATH: kb },
  })
  if (r.status !== 0) {
    console.log('\n安装已写入，但静态自检未全过。按上面的 FAIL 项修好后再重启 DSH。')
    process.exit(1)
  }
}

console.log('\n── 接下来 ─────────────────────────────────────')
console.log('  1) 完全退出 DSH（不是关窗口，要从托盘退出），再重新打开')
console.log('  2) 新建会话，在预设列表里选「中医 · 岐黄经方（学习版）」')
console.log('  3) 设置 →「中医资料库 · 学理模式」，确认资料库目录')
console.log('\n✔ 安装完成' + (DRY ? '（演练，未改动）' : ''))