import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITheme, ITerminalOptions } from '@xterm/xterm';
import type { PtyOutputPayload } from '@/lib/tauri-api/pty';
import XTermPanel from '@/components/panels/XTermPanel';
import { TERMINAL_THEMES } from '@/lib/terminal-theme';

const mocks = vi.hoisted(() => {
  const terminals: TerminalMock[] = [];
  class TerminalMock {
    readonly cols = 80;
    readonly rows = 24;
    readonly options: ITerminalOptions;
    readonly initialOptions: ITerminalOptions;
    readonly themeChanges = vi.fn();
    readonly open = vi.fn();
    readonly focus = vi.fn();
    readonly dispose = vi.fn();
    readonly loadAddon = vi.fn();
    readonly write = vi.fn();
    readonly writeln = vi.fn();
    readonly attachCustomKeyEventHandler = vi.fn();
    readonly getSelection = vi.fn(() => '');
    readonly clearSelection = vi.fn();
    private inputHandler?: (data: string) => void;
    readonly onData = vi.fn((handler: (data: string) => void) => {
      this.inputHandler = handler;
      return { dispose: vi.fn() };
    });

    constructor(options: ITerminalOptions) {
      this.initialOptions = { ...options };
      this.options = { ...options };
      let theme = options.theme;
      Object.defineProperty(this.options, 'theme', {
        get: () => theme,
        set: (value: ITheme) => {
          theme = value;
          this.themeChanges(value);
        },
      });
      terminals.push(this);
    }

    input(data: string) {
      this.inputHandler?.(data);
    }
  }

  return {
    TerminalMock,
    terminals,
    ptySpawn: vi.fn<(sessionId: string, cwd: string, cols: number, rows: number) => Promise<void>>(
      async () => {},
    ),
    ptyWrite: vi.fn<(sessionId: string, data: string) => Promise<void>>(async () => {}),
    ptyResize: vi.fn(async () => {}),
    ptyKill: vi.fn(async () => {}),
    listenToPtyOutput:
      vi.fn<(callback: (payload: PtyOutputPayload) => void) => Promise<() => void>>(),
    listenToPtyExit: vi.fn<(callback: (sessionId: string) => void) => Promise<() => void>>(),
    stopOutput: vi.fn(),
    stopExit: vi.fn(),
  };
});

vi.mock('@xterm/xterm', () => ({ Terminal: mocks.TerminalMock }));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    ptySpawn: mocks.ptySpawn,
    ptyWrite: mocks.ptyWrite,
    ptyResize: mocks.ptyResize,
    ptyKill: mocks.ptyKill,
    listenToPtyOutput: mocks.listenToPtyOutput,
    listenToPtyExit: mocks.listenToPtyExit,
  },
}));
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/components/panels/agent-manager/cli-launch-bus', () => ({
  CLI_AGENT_LAUNCHED_EVENT: 'wisp:cli-agent-launched',
  consumePendingCliLaunches: () => [],
}));
vi.mock('@/components/panels/agent-manager/external-agent-registry', () => ({
  markExternalAgentExited: vi.fn(),
}));

const root = document.documentElement;
const appearanceClass = { light: 'theme-light theme-fluid', dark: 'theme-rolex' };
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
const switchAppearance = async (appearance: keyof typeof appearanceClass) => {
  await act(async () => {
    root.className = appearanceClass[appearance];
  });
};

describe('XTermPanel appearance and PTY lifetime', () => {
  let originalClass: string;
  let originalStyle: string | null;

  beforeEach(() => {
    originalClass = root.className;
    originalStyle = root.getAttribute('style');
    root.className = appearanceClass.light;
    mocks.terminals.length = 0;
    vi.clearAllMocks();
    mocks.listenToPtyOutput.mockResolvedValue(mocks.stopOutput);
    mocks.listenToPtyExit.mockResolvedValue(mocks.stopExit);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    root.className = originalClass;
    if (originalStyle === null) {
      root.removeAttribute('style');
    } else {
      root.setAttribute('style', originalStyle);
    }
  });

  it.each(['light', 'dark'] as const)(
    'creates the first PTY with the active %s theme',
    async (theme) => {
      root.className = appearanceClass[theme];
      render(<XTermPanel cwd="/workspace" />);
      await settle();

      expect(mocks.terminals).toHaveLength(1);
      expect(mocks.terminals[0].initialOptions).toMatchObject({
        theme: TERMINAL_THEMES[theme],
        allowTransparency: false,
        minimumContrastRatio: 4.5,
      });
      expect(mocks.ptySpawn).toHaveBeenCalledWith(expect.any(String), '/workspace', 80, 24);
    },
  );

  it('updates both tabs in both directions while the same PTYs keep accepting input and output', async () => {
    render(<XTermPanel cwd="/workspace" />);
    await settle();
    fireEvent.click(screen.getByTitle('xterm.newTerminal'));
    await settle();
    expect(mocks.terminals).toHaveLength(2);
    const terminals = [...mocks.terminals];
    const sessionIds = mocks.ptySpawn.mock.calls.map((call) => call[0]);
    const output = mocks.listenToPtyOutput.mock.calls[0][0];

    await act(async () => {
      terminals[0].input('before\r');
      output({ session_id: sessionIds[0], data: 'before switch' });
    });
    for (const appearance of ['dark', 'light'] as const) {
      await switchAppearance(appearance);
      terminals.forEach((terminal) => {
        expect(terminal.options.theme).toEqual(TERMINAL_THEMES[appearance]);
      });
      await act(async () => {
        terminals.forEach((terminal, index) => {
          terminal.input(`${appearance}-${index}\r`);
          output({ session_id: sessionIds[index], data: `${appearance} output ${index}` });
        });
      });
      terminals.forEach((terminal, index) => {
        expect(mocks.ptyWrite).toHaveBeenCalledWith(sessionIds[index], `${appearance}-${index}\r`);
        expect(terminal.write).toHaveBeenCalledWith(`${appearance} output ${index}`);
      });
    }

    expect(terminals[0].write).toHaveBeenCalledWith('before switch');
    expect(terminals[1].write).not.toHaveBeenCalledWith('before switch');
    expect(mocks.terminals).toEqual(terminals);
    expect(mocks.ptySpawn).toHaveBeenCalledTimes(2);
    expect(mocks.ptyKill).not.toHaveBeenCalled();
    terminals.forEach((terminal) => {
      expect(terminal.open).toHaveBeenCalledOnce();
      expect(terminal.onData).toHaveBeenCalledOnce();
      expect(terminal.dispose).not.toHaveBeenCalled();
    });
    expect(mocks.listenToPtyOutput).toHaveBeenCalledOnce();
    expect(mocks.stopOutput).not.toHaveBeenCalled();
  });

  it('keeps lazy creation and synchronizes a hidden terminal before showing the same session again', async () => {
    const { rerender } = render(<XTermPanel cwd="/workspace" visible={false} />);
    await switchAppearance('dark');
    expect(mocks.terminals).toHaveLength(0);
    expect(mocks.ptySpawn).not.toHaveBeenCalled();

    rerender(<XTermPanel cwd="/workspace" visible />);
    await settle();
    const terminal = mocks.terminals[0];
    expect(terminal.options.theme).toEqual(TERMINAL_THEMES.dark);
    rerender(<XTermPanel cwd="/workspace" visible={false} />);
    await switchAppearance('light');
    expect(terminal.options.theme).toEqual(TERMINAL_THEMES.light);

    rerender(<XTermPanel cwd="/another-folder" visible />);
    await settle();
    expect(mocks.terminals).toEqual([terminal]);
    expect(mocks.ptySpawn).toHaveBeenCalledTimes(1);
    expect(mocks.ptyKill).not.toHaveBeenCalled();
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(terminal.open).toHaveBeenCalledOnce();
  });

  it('does not reassign themes for glass pointer style updates on the root', async () => {
    render(<XTermPanel cwd="/workspace" />);
    await settle();
    const terminal = mocks.terminals[0];
    const themeWrites = terminal.themeChanges.mock.calls.length;

    await act(async () => {
      root.style.setProperty('--wisp-glass-pointer-x', '12%');
      root.style.setProperty('--wisp-glass-pointer-y', '84%');
    });

    expect(terminal.themeChanges).toHaveBeenCalledTimes(themeWrites);
    expect(terminal.options.theme).toEqual(TERMINAL_THEMES.light);
  });

  it('disconnects the root observer and PTY listeners when the panel unmounts', async () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const { unmount } = render(<XTermPanel cwd="/workspace" />);
    await settle();
    const rootObservers = observe.mock.contexts.filter(
      (_, index) => observe.mock.calls[index][0] === root,
    );
    expect(rootObservers).toHaveLength(1);
    const terminal = mocks.terminals[0];
    const themeWrites = terminal.themeChanges.mock.calls.length;

    unmount();
    expect(disconnect.mock.contexts).toContain(rootObservers[0]);
    await switchAppearance('dark');

    expect(terminal.themeChanges).toHaveBeenCalledTimes(themeWrites);
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(mocks.ptyKill).toHaveBeenCalledTimes(1);
    expect(mocks.stopOutput).toHaveBeenCalledOnce();
    expect(mocks.stopExit).toHaveBeenCalledOnce();
  });
});
