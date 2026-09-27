/**
 * Agent skills（~/.agents/skills 兼容层）——名片解析与系统提示块。
 * discoverSkills 在非 Tauri 环境恒返回空（浏览器演示降级）。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseSkillMd,
  formatSkillsForSystemPrompt,
  discoverSkills,
} from '@/lib/pi-engine/skills';

vi.mock('@/lib/transport', () => ({ isTauri: () => false, transport: vi.fn() }));

describe('parseSkillMd', () => {
  it('extracts name/description from frontmatter and keeps the body', () => {
    const raw = `---
name: design-taste-frontend
description: "Anti-slop taste. Use when a site must NOT look AI-generated."
---

# Core

Ban purple gradients.`;
    const parsed = parseSkillMd(raw, 'fallback');
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('design-taste-frontend');
    expect(parsed!.description).toBe('Anti-slop taste. Use when a site must NOT look AI-generated.');
    expect(parsed!.content).toContain('Ban purple gradients.');
    expect(parsed!.content).not.toContain('---');
  });

  it('falls back to the folder name when frontmatter has no name', () => {
    const raw = `---
description: no name given
---

Body.`;
    const parsed = parseSkillMd(raw, 'folder-name');
    expect(parsed!.name).toBe('folder-name');
  });

  it('folds YAML block scalars (>- / |) into single-line descriptions', () => {
    const raw = `---
name: sleuth
description: >-
  所有搜索、网页读取
  都走此技能
---

Body.`;
    const parsed = parseSkillMd(raw, 'x');
    expect(parsed!.description).toBe('所有搜索、网页读取 都走此技能');
  });

  it('rejects files without frontmatter', () => {
    expect(parseSkillMd('# Just markdown', 'x')).toBeNull();
  });
});

describe('formatSkillsForSystemPrompt', () => {
  it('renders an inventory block with a usage instruction', () => {
    const block = formatSkillsForSystemPrompt([
      {
        name: 'sleuth',
        description: '调研流水线 "all search"',
        content: 'long instructions',
        filePath: '/Users/x/.agents/skills/Sleuth/SKILL.md',
      },
    ]);
    expect(block).toContain('<skill name="sleuth"');
    // 描述里的双引号不能破坏 XML 块
    expect(block).not.toContain('调研流水线 "all search"');
    expect(block).toContain('调研流水线 \'all search\'');
    expect(block).toContain('`skill` tool');
  });

  it('returns an empty string for no skills', () => {
    expect(formatSkillsForSystemPrompt([])).toBe('');
  });
});

describe('discoverSkills', () => {
  it('degrades to an empty list outside Tauri', async () => {
    await expect(discoverSkills()).resolves.toEqual([]);
  });
});
