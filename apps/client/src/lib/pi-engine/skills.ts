/**
 * Agent skills —— 兼容 ~/.agents/skills/（agentskills.io 规范，ZCode/Claude Code 同款）。
 *
 * 识别机制三步：
 *  1. 扫描技能目录里每个子文件夹的 SKILL.md（含根级带 frontmatter 的 .md）；
 *  2. 解析名片（frontmatter 的 name + description），清单拼进系统提示；
 *  3. 模型按需经 `skill` 工具加载正文照做；用户也可经斜杠菜单点名。
 * pi-agent-core 自带同规范实现（harness/skills），但依赖它的执行环境抽象；
 * Wisp 直读文件系统，保持零额外依赖。
 */
import { TauriAPI } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';

export interface WispSkill {
  /** 名片上的名字（斜杠命令 / 工具查找都靠它）。 */
  name: string;
  /** 一句话说明适用场景（进系统提示，模型靠它对号入座）。 */
  description: string;
  /** SKILL.md 去掉 frontmatter 后的正文（skill 工具返回给模型）。 */
  content: string;
  /** 完整路径。 */
  filePath: string;
}

/** 前者优先：~/.agents 优先于 ~/.pi（用户显式放这里的技能赢）。 */
const SKILL_DIRS = ['.agents/skills', '.pi/agent/skills'];

/** 60s 内复用上次扫描——技能不会秒级变动，目录遍历没必要每次会话都做。 */
const CACHE_TTL_MS = 60_000;
let cache: { at: number; skills: WispSkill[] } | null = null;

/** 解析 SKILL.md：frontmatter 拿 name/description，其余为正文。 */
export const parseSkillMd = (
  raw: string,
  fallbackName: string,
): Omit<WispSkill, 'filePath'> | null => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return null;
  const [, frontmatter, body] = match;
  const field = (key: string): string => {
    const lines = frontmatter.split(/\r?\n/);
    const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (idx === -1) return '';
    let value = lines[idx].slice(key.length + 1).trim();
    // YAML 块标量（>- 折叠成空格 / | 保留换行）——真实技能里很常见
    if (value === '>-' || value === '>' || value === '|-' || value === '|') {
      const block: string[] = [];
      for (let i = idx + 1; i < lines.length; i += 1) {
        if (/^\s/.test(lines[i])) block.push(lines[i].trim());
        else break;
      }
      value = value.startsWith('>') ? block.join(' ') : block.join('\n');
    }
    return value.replace(/^["']|["']$/g, '');
  };
  const name = field('name') || fallbackName;
  if (!name) return null;
  return { name, description: field('description'), content: body.trim() };
};

/** 扫描技能目录。目录缺失/浏览器演示环境 → 空清单（静默降级）。 */
export const discoverSkills = async (force = false): Promise<WispSkill[]> => {
  if (!isTauri()) return [];
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.skills;

  const byName = new Map<string, WispSkill>();
  try {
    const { home } = await TauriAPI.getUserDirectories();
    for (const rel of SKILL_DIRS) {
      const dir = `${home}/${rel}`;
      let entries;
      try {
        entries = await TauriAPI.readDirectory(dir);
      } catch {
        continue; // 目录不存在
      }
      for (const entry of entries) {
        try {
          if (entry.is_dir) {
            const filePath = `${dir}/${entry.name}/SKILL.md`;
            const parsed = parseSkillMd(await TauriAPI.readTextFile(filePath), entry.name);
            if (parsed && !byName.has(parsed.name)) {
              byName.set(parsed.name, { ...parsed, filePath });
            }
          } else if (/\.md$/i.test(entry.name)) {
            const filePath = `${dir}/${entry.name}`;
            const parsed = parseSkillMd(
              await TauriAPI.readTextFile(filePath),
              entry.name.replace(/\.md$/i, ''),
            );
            // 根级散 .md 必须自带 frontmatter 名字才算技能
            if (parsed && parsed.name && parsed.description && !byName.has(parsed.name)) {
              byName.set(parsed.name, { ...parsed, filePath });
            }
          }
        } catch {
          // 单个技能读失败不拖累其余
        }
      }
    }
  } catch {
    // home 都拿不到 → 无技能可用
  }
  cache = { at: Date.now(), skills: [...byName.values()] };
  return cache.skills;
};

/** agentskills.io 式系统提示块：清单 + 用法说明（模型据此自选或响应用户点名）。 */
export const formatSkillsForSystemPrompt = (skills: WispSkill[]): string => {
  if (skills.length === 0) return '';
  const lines = skills.map(
    (s) =>
      `<skill name="${s.name}" description="${s.description.replace(/"/g, "'")}" path="${s.filePath}" />`,
  );
  return [
    'The user has agent skills installed. Available skills:',
    ...lines,
    'To use one, call the `skill` tool with its exact name — it returns the full instructions, which you then follow. The user may also invoke a skill explicitly.',
  ].join('\n');
};

/** skill 工具的查找器：按名字精确或唯一前缀匹配。 */
export const findSkill = async (name: string): Promise<WispSkill | null> => {
  const skills = await discoverSkills();
  const exact = skills.find((s) => s.name === name);
  if (exact) return exact;
  const partial = skills.filter((s) => s.name.startsWith(name));
  return partial.length === 1 ? partial[0] : null;
};
