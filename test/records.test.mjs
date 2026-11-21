// 会话归档测试：整段会话一份 Markdown、文件名用标题、标题变化改名、只记录本预设。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  answerText,
  conversationFromEvents,
  createSessionRecorder,
  dropGearEntry,
  readGearState,
  recordSession,
  safeTitle,
  saveGearEntry,
  GEAR_FILE,
  RECORD_DIR,
} from '../lib/records.js'

const at = new Date('2026-11-12T15:30:22+08:00')

function userEvent(text, seq = 1) {
  return {
    type: 'user/message',
    seq,
    time: at.getTime() + seq,
    data: {
      source: { kind: 'user' },
      content: [{ type: 'text', text }],
    },
  }
}

function assistantEvent(text, seq = 2) {
  return {
    type: 'assistant/message',
    seq,
    time: at.getTime() + seq,
    data: {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'text', text }] },
    },
  }
}

test('answerText：只取 text 块，跳过 reasoning 与工具块', () => {
  assert.equal(
    answerText([
      { type: 'reasoning', text: '内部推理，不该出现' },
      { type: 'text', text: '第一段' },
      { type: 'tool-call', id: 'call-1' },
      { type: 'text', text: '第二段' },
    ]),
    '第一段\n\n第二段',
  )
  assert.equal(answerText(undefined), '')
  assert.equal(answerText([{ type: 'reasoning', text: '只有推理' }]), '')
})

test('safeTitle：去掉 Windows 非法字符，空标题退回会话号', () => {
  assert.equal(safeTitle('61岁/高血压:患者?', 'session-abcdef123456'), '61岁 高血压 患者')
  assert.equal(safeTitle('   ', 'session-abcdef123456'), '中医会话-abcdef12')
  assert.equal(safeTitle('x'.repeat(120), 'session-abcdef123456').length, 80)
})

test('safeTitle：撞上 Windows 设备名的标题要加前缀，不然文件根本写不进去', () => {
  assert.equal(safeTitle('CON', 'session-abcdef123456'), '中医会话-CON')
  assert.equal(safeTitle('com3', 'session-abcdef123456'), '中医会话-com3')
  assert.equal(safeTitle('TCM病案', 'session-abcdef123456'), 'TCM病案')
});
test('conversationFromEvents：只收真人发言与助手正文，保持顺序', () => {
  const events = [
    userEvent('后脑勺疼。', 1),
    { type: 'user/message', seq: 2, data: { source: { kind: 'system' }, content: [{ type: 'text', text: '系统提示' }] } },
    assistantEvent('请补脉证。', 3),
    { type: 'assistant/message', seq: 4, data: { message: { content: [{ type: 'reasoning', text: '推理' }] } } },
    assistantEvent('柴胡桂枝汤。', 5),
  ]
  assert.deepEqual(conversationFromEvents(events), [
    { role: 'user', text: '后脑勺疼。' },
    { role: 'assistant', text: '请补脉证。' },
    { role: 'assistant', text: '柴胡桂枝汤。' },
  ])
})

test('conversationFromEvents：带图片的提问不能整条丢掉', () => {
  const events = [
    {
      type: 'user/message',
      seq: 1,
      data: {
        source: { kind: 'user' },
        content: [
          { type: 'image', attachment: { name: '处方.jpg' } },
          { type: 'text', text: '点评这张方' },
        ],
      },
    },
    {
      type: 'user/message',
      seq: 2,
      data: { source: { kind: 'user' }, content: [{ type: 'image', attachment: { name: '方.jpg' } }] },
    },
    assistantEvent('先看症状。', 3),
  ]
  assert.deepEqual(conversationFromEvents(events), [
    { role: 'user', text: '[图片]\n点评这张方' },
    { role: 'user', text: '[图片]' },
    { role: 'assistant', text: '先看症状。' },
  ])
})

test('recordSession：一个会话一份文件，文件名用标题，整段对话都写入', () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-session-'))
  const sessionId = 'session-abcdef123456'
  const events = [userEvent('后脑勺疼。'), assistantEvent('请补脉证。')]

  const first = recordSession({ kb, sessionId, title: '61岁/高血压患者', events, now: at })
  assert.ok(first)
  assert.ok(first.startsWith(path.join(kb, RECORD_DIR)))
  assert.equal(path.basename(first), '61岁 高血压患者.md')

  const body = fs.readFileSync(first, 'utf8')
  assert.match(body, /^---\n/)
  assert.match(body, /标题: "61岁\/高血压患者"/)
  assert.match(body, /会话: "session-abcdef123456"/)
  assert.match(body, /# 61岁\/高血压患者/)
  assert.match(body, /### 用户\n\n后脑勺疼。/)
  assert.match(body, /### 中医 · 经方\n\n请补脉证。/)

  const second = recordSession({ kb, sessionId, title: '61岁/高血压患者', events, now: new Date(at.getTime() + 1000), previousFile: first })
  assert.equal(second, first, '同一会话、同一标题应覆盖原文件')
  assert.equal(fs.readdirSync(path.join(kb, RECORD_DIR)).length, 1)

  const renamed = recordSession({ kb, sessionId, title: '后脑勺疼（复诊）', events, now: at, previousFile: first })
  assert.notEqual(renamed, first)
  assert.equal(path.basename(renamed), '后脑勺疼（复诊）.md')
  assert.equal(fs.existsSync(first), false, '标题变化后旧文件应删除')
  assert.equal(fs.readdirSync(path.join(kb, RECORD_DIR)).length, 1)
})

test('recordSession：不同会话同名时加序号，不覆盖别人', () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-session-'))
  const events = [userEvent('头疼。'), assistantEvent('请补脉证。')]
  const a = recordSession({ kb, sessionId: 'session-aaaa1111', title: '同一个标题', events, now: at })
  const b = recordSession({ kb, sessionId: 'session-bbbb2222', title: '同一个标题', events, now: at })
  assert.equal(path.basename(a), '同一个标题.md')
  assert.equal(path.basename(b), '同一个标题 (2).md')
  assert.equal(fs.readdirSync(path.join(kb, RECORD_DIR)).length, 2)
})

test('recordSession：重启后没记住上一份路径，也能清掉同会话的兜底旧文件', () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-session-'))
  const sessionId = 'session-abcdef123456'
  const events = [userEvent('头疼。'), assistantEvent('请补脉证。')]
  const fallback = recordSession({ kb, sessionId, events, now: at })
  assert.equal(path.basename(fallback), '中医会话-abcdef12.md')
  const titled = recordSession({ kb, sessionId, title: '正式标题', events, now: at })
  assert.equal(path.basename(titled), '正式标题.md')
  assert.equal(fs.existsSync(fallback), false)
  assert.deepEqual(fs.readdirSync(path.join(kb, RECORD_DIR)), ['正式标题.md'])
})

test('recordSession：资料库不存在时返回 null，不抛异常', () => {
  const kb = path.join(os.tmpdir(), `qh-missing-${Date.now()}`)
  assert.equal(recordSession({ kb, sessionId: 'x', title: '标题', events: [userEvent('正文')] }), null)
})

test('createSessionRecorder：按当前预设归档整段会话，标题来自会话标题服务', () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-recorder-'))
  const infos = []
  const recorder = createSessionRecorder({
    getKb: () => kb,
    currentPreset: (session) => session.projectionPreset,
    getTitle: (session) => session.title,
    logger: { info: (...args) => infos.push(args), warn: () => {} },
  })
  const events = [userEvent('后脑勺疼。'), assistantEvent('请补脉证。')]
  const tcmSession = {
    id: 'session-aaaabbbb',
    header: { agentPreset: 'dsh-tcm-xueli' },
    title: '61岁高血压患者后脑勺疼',
    snapshotEvents: () => events,
  }
  const otherSession = { id: 'session-ccccdddd', header: { agentPreset: 'cordis' } }
  // 先以 cordis 创建、后来在空白会话里切到中医 · 经方：header 仍是 cordis。
  const switchedSession = {
    id: 'session-switched1',
    header: { agentPreset: 'cordis' },
    projectionPreset: 'dsh-tcm-xueli',
    title: '切换预设后的会话',
    snapshotEvents: () => [userEvent('头疼。'), assistantEvent('请补脉证。')],
  }

  recorder(otherSession, assistantEvent('普通编码回答。'))
  assert.equal(fs.existsSync(path.join(kb, RECORD_DIR)), false, '别的预设不能建目录')

  recorder(tcmSession, assistantEvent('柴胡桂枝汤。', 3))
  let files = fs.readdirSync(path.join(kb, RECORD_DIR))
  assert.equal(files.length, 1)
  assert.equal(files[0], '61岁高血压患者后脑勺疼.md')
  const body = fs.readFileSync(path.join(kb, RECORD_DIR, files[0]), 'utf8')
  assert.match(body, /后脑勺疼。/)
  assert.match(body, /请补脉证。/)
  assert.match(body, /柴胡桂枝汤。/)
  assert.ok(infos.length >= 1, '写入成功应记一条日志')

  // 标题服务晚于最后一条回答才生成标题时，session/title 事件要把文件改名。
  events.push(assistantEvent('柴胡桂枝汤。', 3))
  recorder(tcmSession, {
    type: 'session/title',
    seq: 4,
    time: at.getTime() + 4000,
    data: { title: '改后的会话标题' },
  })
  files = fs.readdirSync(path.join(kb, RECORD_DIR))
  assert.deepEqual(files, ['改后的会话标题.md'])
  assert.equal(fs.existsSync(path.join(kb, RECORD_DIR, '61岁高血压患者后脑勺疼.md')), false, '旧标题文件应删除')
  assert.match(fs.readFileSync(path.join(kb, RECORD_DIR, files[0]), 'utf8'), /柴胡桂枝汤。/)

  recorder(switchedSession, assistantEvent('柴胡桂枝汤。', 3))
  files = fs.readdirSync(path.join(kb, RECORD_DIR))
  assert.equal(files.length, 2, 'header 为创建时 cordis 时，应读当前预设投影')
  assert.ok(files.includes('切换预设后的会话.md'))
})

test('思考档位存根：记下、读回、清掉；库没设或文件坏了都不炸', () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-gear-'))
  assert.deepEqual(readGearState(''), {}, '库没设回空')
  assert.deepEqual(readGearState(kb), {}, '文件还没有回空')

  assert.equal(saveGearEntry(kb, 's-1', 'medium'), true)
  assert.equal(saveGearEntry(kb, 's-2', ''), true, '原来没有档位也记（空串）')
  const state = readGearState(kb)
  assert.equal(state['s-1'].restore, 'medium')
  assert.equal(state['s-2'].restore, '')
  assert.ok(state['s-1'].at > 0, '带时间戳')

  assert.equal(dropGearEntry(kb, 's-1'), true)
  assert.equal(dropGearEntry(kb, 's-1'), false, '清过的再清当没事')
  assert.deepEqual(Object.keys(readGearState(kb)), ['s-2'])

  // 文件坏了：读回空，不抛
  fs.writeFileSync(path.join(kb, RECORD_DIR, GEAR_FILE), '{坏的', 'utf8')
  assert.deepEqual(readGearState(kb), {}, '坏文件回空')
  assert.equal(saveGearEntry(kb, 's-3', 'high'), true, '坏了也能重写')
  assert.equal(readGearState(kb)['s-3'].restore, 'high')
})

test('思考档位存根最多留 50 条，新的挤掉旧的', () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-gear-many-'))
  for (let i = 0; i < 60; i += 1) saveGearEntry(kb, 's-' + i, 'low')
  const state = readGearState(kb)
  assert.equal(Object.keys(state).length, 50, '只留 50 条')
  assert.ok(state['s-59'], '最新的在')
  assert.equal(state['s-0'], undefined, '最旧的被挤掉')
})
