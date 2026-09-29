/**
 * PiChatPanel wiring tests — quick-action prefill and mode switch UI.
 * Heavy engine behaviour is covered by pi-engine/engine.test.ts; here we
 * only assert the panel reacts to shell events without touching Rust.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/transport', () => ({
  isTauri: () => false,
  transport: vi.fn(async () => {
    throw new Error('no transport in tests');
  }),
  listenToEvent: vi.fn(async () => () => undefined),
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    getAgentSettings: vi.fn(() =>
      Promise.resolve({
        enabled: true,
        model: 'ollama:llama3.2',
        max_turns: 25,
        autoApprove: false,
        thinkingEnabled: false,
        thinkingBudget: 10000,
        hasApiKey: false,
        hasOpenaiApiKey: false,
      }),
    ),
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => undefined),
}));

vi.mock('@/lib/pi-engine/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pi-engine/providers')>()),
  availableModels: vi.fn(async () => []),
}));

import { availableModels } from '@/lib/pi-engine/providers';
import { discoverSkills } from '@/lib/pi-engine/skills';
import PiChatPanel from '@/components/panels/PiChatPanel';

vi.mock('@/lib/pi-engine/skills', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pi-engine/skills')>()),
  discoverSkills: vi.fn(async () => []),
}));

describe('PiChatPanel', () => {
  it('prefills the input when a quick action dispatches wisp-ai-chat-request', async () => {
    render(<PiChatPanel currentPath="/Users/x/Downloads" />);
    // panel settled
    expect(await screen.findByTestId('pi-chat-mode')).toBeInTheDocument();

    window.dispatchEvent(
      new CustomEvent('wisp-ai-chat-request', {
        detail: { prompt: '请总结「report.pdf」的内容，给出要点。' },
      }),
    );

    const textarea = await screen.findByRole('textbox');
    expect((textarea as HTMLTextAreaElement).value).toContain('report.pdf');
  });

  it('switches between folder and quick modes', async () => {
    render(<PiChatPanel currentPath="/Users/x/Downloads" />);
    const modePicker = await screen.findByTestId('pi-chat-mode');

    expect(modePicker).toHaveAccessibleName(/\/Users\/x\/Downloads/);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(modePicker);
    expect(screen.getByTestId('pi-chat-mode-folder')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('pi-chat-mode-quick'));
    await waitFor(() => expect(modePicker).toHaveAccessibleName(/Quick|速聊/i));
    expect(modePicker).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(modePicker);
    expect(screen.getByTestId('pi-chat-mode-quick')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('pi-chat-mode-folder'));
    await waitFor(() => expect(modePicker).toHaveAccessibleName(/\/Users\/x\/Downloads/));
  });

  it('keeps model settings reachable after changing mode from the icon menu', async () => {
    const user = userEvent.setup();
    const openSettings = vi.fn();
    window.addEventListener('wisp-open-settings', openSettings);

    try {
      render(<PiChatPanel currentPath="/Users/x/Downloads" />);
      const modePicker = await screen.findByTestId('pi-chat-mode');
      await user.click(modePicker);
      await user.click(screen.getByRole('menuitemradio', { name: /Quick|速聊/i }));
      expect(modePicker).toHaveAccessibleName(/Quick|速聊/i);

      const settingsButton = await screen.findByTestId('pi-chat-open-settings');
      expect(settingsButton).toHaveAccessibleName();
      await user.click(settingsButton);

      expect(openSettings).toHaveBeenCalledTimes(1);
      expect((openSettings.mock.calls[0][0] as CustomEvent).detail.returnFocus).toBe(
        settingsButton,
      );
    } finally {
      window.removeEventListener('wisp-open-settings', openSettings);
    }
  });

  it('re-derives the mode from navigation: quick does not stick across folders', async () => {
    const view = render(<PiChatPanel currentPath="/Users/x/Downloads" />);
    const modePicker = await view.findByTestId('pi-chat-mode');
    // 手动切到速聊
    fireEvent.click(modePicker);
    fireEvent.click(view.getByTestId('pi-chat-mode-quick'));
    await waitFor(() => expect(modePicker).toHaveAccessibleName(/Quick|速聊/i));

    // 切换到另一个文件夹 → 回到文件夹模式（速聊不跟随）
    view.rerender(<PiChatPanel currentPath="/Users/x/Documents" />);
    await waitFor(() => expect(modePicker).toHaveAccessibleName(/\/Users\/x\/Documents/));

    // 主页等虚拟路径 → 速聊
    view.rerender(<PiChatPanel currentPath="wisp://home" />);
    await waitFor(() => expect(modePicker).toHaveAccessibleName(/Quick|速聊/i));
  });

  it('shows the permission picker, defaults to ask, and full access persists', async () => {
    localStorage.removeItem('wisp:pi-permission');
    const view = render(<PiChatPanel currentPath="/Users/x" />);
    const picker = await view.findByTestId('pi-permission-picker');
    expect(picker).toHaveAccessibleName(/先询问|Ask first/i);

    fireEvent.click(picker);
    const full = await view.findByRole('menuitem', { name: /完全访问|Full access/i });
    fireEvent.click(full);
    expect(localStorage.getItem('wisp:pi-permission')).toBe('ask');
    expect(screen.getByRole('dialog')).toHaveTextContent(/future chats/);
    fireEvent.click(screen.getByRole('button', { name: /Full access/i }));
    await waitFor(() => expect(localStorage.getItem('wisp:pi-permission')).toBe('full'));
    expect(picker).toHaveAccessibleName(/完全访问|Full access/i);
  });

  it('shows the approval bar shape only after a request (none by default)', async () => {
    render(<PiChatPanel currentPath="/Users/x" />);
    await screen.findByTestId('pi-chat-mode');
    expect(screen.queryByTestId('pi-chat-approval')).not.toBeInTheDocument();
  });

  it('cycles the thinking level from the composer toolbar and persists it', async () => {
    localStorage.removeItem('wisp:pi-thinking');
    render(<PiChatPanel currentPath="/Users/x" />);
    const picker = await screen.findByTestId('pi-thinking-picker');
    // 图标入口通过无障碍名称与悬停提示表达当前档位。
    expect(picker).toHaveAccessibleName(/Auto|自动/i);
    expect(picker).toHaveAttribute('title', expect.stringMatching(/Auto|自动/i));

    fireEvent.click(picker);
    const high = await screen.findByRole('menuitem', { name: /High|高/i });
    fireEvent.click(high);

    await waitFor(() => expect(localStorage.getItem('wisp:pi-thinking')).toBe('high'));
    expect(picker).toHaveAccessibleName(/High|高/i);
    expect(picker).toHaveAttribute('title', expect.stringMatching(/High|高/i));
  });

  // ── 画布模式 ────────────────────────────────────────────────────────────────

  it('shows a selection chip and composes the edit-only prompt on send', async () => {
    render(<PiChatPanel currentPath="/Users/x" />);
    await screen.findByTestId('pi-chat-mode');

    window.dispatchEvent(
      new CustomEvent('wisp-ai-chat-request', {
        detail: {
          prompt: '把这段改得简洁一些',
          selection: {
            text: '旧的段落内容',
            filePath: '/Users/x/周报.md',
            fileName: '周报.md',
          },
        },
      }),
    );

    const chip = await screen.findByTestId('pi-selection-chip');
    expect(chip).toHaveTextContent('周报.md');

    const textarea = screen.getByRole('textbox');
    expect((textarea as HTMLTextAreaElement).value).toBe('把这段改得简洁一些');

    fireEvent.click(screen.getByTestId('pi-chat-send'));

    // 用户消息 = 拼装后的模板：指令、文件路径、选区原文都平铺可见
    await waitFor(() => {
      expect(screen.getByText(/旧的段落内容/)).toBeInTheDocument();
      expect(screen.getByText(/\/Users\/x\/周报\.md/)).toBeInTheDocument();
      expect(screen.getByText(/把这段改得简洁一些/)).toBeInTheDocument();
    });
    // 发送后选区 chip 清空
    await waitFor(() => expect(screen.queryByTestId('pi-selection-chip')).not.toBeInTheDocument());
  });

  it('canvas toggle: turning on dispatches wisp-canvas-request, turning off calls onCanvasChange(false)', async () => {
    const onCanvasChange = vi.fn();
    const view = render(<PiChatPanel currentPath="/Users/x" onCanvasChange={onCanvasChange} />);
    await view.findByTestId('pi-chat-mode');

    const spy = vi.fn();
    window.addEventListener('wisp-canvas-request', spy);

    fireEvent.click(view.getByTestId('pi-canvas-toggle'));
    expect(spy).toHaveBeenCalledTimes(1);

    // 点亮状态由外部（MainLayout）回写 props：canvasMode=true 再点 → 关
    view.rerender(
      <PiChatPanel currentPath="/Users/x" canvasMode onCanvasChange={onCanvasChange} />,
    );
    fireEvent.click(view.getByTestId('pi-canvas-toggle'));
    expect(onCanvasChange).toHaveBeenCalledWith(false);
    expect(spy).toHaveBeenCalledTimes(1);

    window.removeEventListener('wisp-canvas-request', spy);
  });

  // ── 建议词条与快捷功能 ──────────────────────────────────────────────────────

  it('shows welcome suggestions only after a model is configured (never as a bottom strip)', async () => {
    // 未配置模型：无建议词条，只有配置引导
    const bare = render(<PiChatPanel currentPath="/Users/x" />);
    await bare.findByTestId('pi-chat-mode');
    expect(bare.queryAllByTestId('pi-suggestion')).toHaveLength(0);
    expect(bare.getByTestId('pi-chat-open-settings')).toBeInTheDocument();
    bare.unmount();

    // 配置好模型：新会话的欢迎区出现 4 条建议
    vi.mocked(availableModels).mockResolvedValueOnce([
      { ref: 'openai:gpt-4o-mini', label: 'GPT-4o mini', providerLabel: 'OpenAI' },
    ]);
    const view = render(<PiChatPanel currentPath="/Users/x" />);
    await view.findByTestId('pi-chat-mode');
    const chips = await view.findAllByTestId('pi-suggestion');
    expect(chips).toHaveLength(4);
    // 点词条 → 填入输入盒
    fireEvent.click(chips[0]);
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).not.toBe('');
  });

  it('quick actions menu fills the input with a ready-made prompt', async () => {
    const view = render(<PiChatPanel currentPath="/Users/x" />);
    await view.findByTestId('pi-chat-mode');

    fireEvent.click(view.getByTestId('pi-quick-actions'));
    const items = await view.findAllByRole('menuitem');
    expect(items.length).toBeGreaterThanOrEqual(4);
    fireEvent.click(items[0]);

    const textarea = view.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).not.toBe('');
    expect(items[0].textContent).toBeTruthy();
    expect(textarea.value).toContain((items[0].textContent ?? '').trim().slice(0, 6));
  });

  // ── 斜杠命令 ────────────────────────────────────────────────────────────────

  it('typing "/" opens the slash menu, filtering works, Enter executes and clears', async () => {
    const view = render(<PiChatPanel currentPath="/Users/x" />);
    await view.findByTestId('pi-chat-mode');

    const textarea = view.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '/' } });
    await view.findByTestId('pi-slash-menu');
    expect(view.getAllByTestId('pi-slash-item').length).toBeGreaterThanOrEqual(5);

    // 过滤：/can 只剩画布命令
    fireEvent.change(textarea, { target: { value: '/can' } });
    const filtered = view.getAllByTestId('pi-slash-item');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].textContent).toContain('/canvas');

    // 回车执行：开关画布 → 派 wisp-canvas-request，输入清空
    const spy = vi.fn();
    window.addEventListener('wisp-canvas-request', spy);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    window.removeEventListener('wisp-canvas-request', spy);
  });

  it('lists user skills from ~/.agents/skills in the slash menu and fills an invocation', async () => {
    vi.mocked(discoverSkills).mockResolvedValueOnce([
      {
        name: 'sleuth',
        description: '调研流水线，所有搜索走此技能',
        content: '# Sleuth …',
        filePath: '/Users/x/.agents/skills/Sleuth/SKILL.md',
      },
    ]);
    const view = render(<PiChatPanel currentPath="/Users/x" />);
    await view.findByTestId('pi-chat-mode');

    const textarea = view.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '/sle' } });
    const items = view.getAllByTestId('pi-slash-item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('/sleuth');

    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() =>
      expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('使用技能 sleuth：'),
    );
  });

  it('Escape dismisses the slash menu until the next "/" session', async () => {
    const view = render(<PiChatPanel currentPath="/Users/x" />);
    await view.findByTestId('pi-chat-mode');

    const textarea = view.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '/new' } });
    expect(view.getByTestId('pi-slash-menu')).toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(view.queryByTestId('pi-slash-menu')).not.toBeInTheDocument();

    // 继续打字不重开；清掉再打 / 才重新出现
    fireEvent.change(textarea, { target: { value: '/neww' } });
    expect(view.queryByTestId('pi-slash-menu')).not.toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.change(textarea, { target: { value: '/' } });
    expect(view.getByTestId('pi-slash-menu')).toBeInTheDocument();
  });

  it('stacks multiple quotes and composes all of them into the prompt', async () => {
    render(<PiChatPanel currentPath="/Users/x" />);
    await screen.findByTestId('pi-chat-mode');

    const dispatch = (text: string, file: string) =>
      window.dispatchEvent(
        new CustomEvent('wisp-ai-chat-request', {
          detail: {
            selection: { text, filePath: `/Users/x/${file}`, fileName: file },
          },
        }),
      );

    dispatch('第一段被引用的内容', 'a.md');
    dispatch('第二段被引用的内容', 'a.md');
    // 同一段重复引用 → 去重
    dispatch('第一段被引用的内容', 'a.md');

    await waitFor(() => expect(screen.getAllByTestId('pi-selection-chip')).toHaveLength(2));

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '把这两段都改得简洁一些' } });
    fireEvent.click(screen.getByTestId('pi-chat-send'));

    await waitFor(() => {
      expect(screen.getByText(/第一段被引用的内容/)).toBeInTheDocument();
      expect(screen.getByText(/第二段被引用的内容/)).toBeInTheDocument();
    });
    // 发送后引用条清空
    await waitFor(() => expect(screen.queryByTestId('pi-selection-chip')).not.toBeInTheDocument());
  });

  it('the + button clears the draft and selection, not just hidden state', async () => {
    const view = render(<PiChatPanel currentPath="/Users/x" />);
    await view.findByTestId('pi-chat-mode');

    window.dispatchEvent(
      new CustomEvent('wisp-ai-chat-request', {
        detail: {
          prompt: '草稿',
          selection: { text: '选区', filePath: '/Users/x/a.md', fileName: 'a.md' },
        },
      }),
    );
    await view.findByTestId('pi-selection-chip');
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('草稿');

    fireEvent.click(view.getByTestId('pi-chat-new'));
    await waitFor(() => {
      expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
      expect(view.queryByTestId('pi-selection-chip')).not.toBeInTheDocument();
    });
  });
});
