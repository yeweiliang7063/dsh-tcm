/**
 * 学理模式 · 默认预设骨架
 *
 * 预设定义在 cordis.patch.yml 里；本文件提供两条兜底：
 * 1. corePlugins()：本插件 cordis.patch.yml 读不到时，按平台给出预设里要挂的插件行；
 * 2. minimalPreset()：同上情况下退回「学理模式」最简预设。
 *
 * 不依赖任何外部文件，也不抛异常：任何情况都要保证预设列表里有一条能用的条目。
 */
import { MINIMAL_PREFIX, PRESET_DESCRIPTION, PRESET_ID, PRESET_NAME } from './gear.js'

/**
 * 预设里挂的插件行（按平台决定 shell 工具）。
 * @param {string} [platform] 默认 process.platform
 * @returns {any[]}
 */
export function corePlugins(platform = process.platform) {
  const win = platform === 'win32'
  return [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: MINIMAL_PREFIX } },
    { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
    { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
    { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: win },
    { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: !win },
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs', config: { applyPatch: false } },
    { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
    { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
    { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60000 } },
    { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem', config: { customSkillDirs: [] } },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
  ]
}

/**
 * 最简预设：只用 systemPrompt + 文件、搜索、提问、联网几样工具，不读资料库也能答。
 * @param {string} [platform]
 * @returns {{id: string, name: string, description: string, order: number, plugins: any[]}}
 */
export function minimalPreset(platform = process.platform) {
  return {
    id: PRESET_ID,
    name: PRESET_NAME,
    description: PRESET_DESCRIPTION,
    order: 5,
    plugins: corePlugins(platform),
  }
}