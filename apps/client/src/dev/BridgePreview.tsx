import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type {
  ChatgptBridgeConfig,
  ChatgptBridgeState,
  ChatgptBridgeStatus,
} from '@/lib/tauri-api-types';
import i18n from '../i18n';
import '../index.css';
import '../styles/liquid-glass.css';
import '../styles/fluid-glass.css';
import '../styles/design-system.css';

if (!import.meta.env.DEV) throw new Error('The connection preview is development-only.');

// A source-defined native facade for visual checks. No real credentials, files,
// network connection or native commands are used by this separate entry.
Object.defineProperty(window, '__TAURI__', { value: {}, configurable: true });
const [{ TauriAPI }, { default: ChatgptBridgePanel }] = await Promise.all([
  import('@/lib/tauri-api'),
  import('@/components/panels/ChatgptBridgePanel'),
]);
await i18n.changeLanguage('zh');

const previewState: ChatgptBridgeState = {
  config: {
    version: 1,
    enabled: false,
    tunnelId: '',
    tunnelClientPath: null,
    allowedRoots: [],
    maxFileBytes: 524288,
  },
  status: {
    state: 'stopped',
    enabled: false,
    pid: null,
    healthUrl: null,
    ready: null,
    restarts: 0,
    lastError: null,
    startedAt: null,
  },
  detectedClientPath: '/Applications/Wisp.app/Contents/MacOS/tunnel-client',
  hasApiKey: false,
  configPath: '/preview/chatgpt-bridge.json',
  wispExe: '/Applications/Wisp.app/Contents/MacOS/wisp',
};
const listeners = new Set<(status: ChatgptBridgeStatus) => void>();
const updateStatus = (state: 'running' | 'stopped') => {
  previewState.status = {
    ...previewState.status,
    state,
    enabled: previewState.config.enabled,
    ready: state === 'running',
  };
  listeners.forEach((callback) => callback(previewState.status));
  return structuredClone(previewState.status);
};
Object.assign(TauriAPI, {
  chatgptBridgeGetState: async () => structuredClone(previewState),
  chatgptBridgeSaveConfig: async (config: ChatgptBridgeConfig) => {
    previewState.config = structuredClone(config);
    updateStatus(config.enabled ? 'running' : 'stopped');
    return structuredClone(previewState);
  },
  chatgptBridgeSetApiKey: async () => {
    previewState.hasApiKey = true;
  },
  chatgptBridgeDeleteApiKey: async () => {
    previewState.hasApiKey = false;
  },
  chatgptBridgeRestart: async () => updateStatus('running'),
  chatgptBridgeStop: async () => updateStatus('stopped'),
  listenToChatgptBridgeStatus: async (callback: (status: ChatgptBridgeStatus) => void) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  },
  showOpenDialog: async () => ['/Users/demo/Documents/共享资料/项目文档与会议记录'],
  openUrl: async (url: string) => {
    const output = document.getElementById('bridge-preview-link');
    if (output) output.textContent = url;
  },
});

function BridgePreview() {
  const [width, setWidth] = useState(360);
  const [dark, setDark] = useState(false);
  return (
    <main className="h-dvh overflow-auto bg-xp-bg text-xp-text">
      <header className="flex flex-wrap items-center gap-3 border-b border-xp-border px-4 py-3 text-xs">
        <span>界面预览：不连接账号，不读取本机文件</span>
        <label>
          宽度{' '}
          <select value={width} onChange={(event) => setWidth(Number(event.target.value))}>
            <option value={320}>320</option>
            <option value={360}>360</option>
            <option value={420}>420</option>
          </select>
        </label>
        <label>
          语言{' '}
          <select
            defaultValue="zh"
            onChange={(event) => {
              void i18n.changeLanguage(event.target.value);
            }}
          >
            <option value="zh">中文</option>
            <option value="en">English（英语）</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => {
              const checked = event.target.checked;
              setDark(checked);
              document.documentElement.className = checked
                ? 'theme-rolex'
                : 'theme-light theme-fluid';
            }}
          />{' '}
          深色
        </label>
      </header>
      <aside
        aria-label="连接预览"
        className="mx-auto border-x border-xp-border"
        style={{ width, maxWidth: '100%', height: 'calc(100dvh - 90px)' }}
      >
        <ChatgptBridgePanel currentPath="/Users/demo/Documents" />
      </aside>
      <output id="bridge-preview-link" className="block break-all px-4 py-2 text-xs" />
    </main>
  );
}

createRoot(document.getElementById('bridge-preview-root')!).render(<BridgePreview />);
