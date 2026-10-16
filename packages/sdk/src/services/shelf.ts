import { isTauri, listenToEvent, transport } from '../transport';

export interface ShelfItem {
  id: string;
  name: string;
  path: string;
  kind: 'file' | 'text' | 'link' | 'image';
  managed: boolean;
  available: boolean;
  isDirectory?: boolean;
  size?: number;
  addedAt: number;
}

export interface ShelfRecord {
  id: string;
  name: string;
  pinned: boolean;
  color: string;
  createdAt: number;
  items: ShelfItem[];
  /** ✕ = 收起：架子保留在清单里，只是窗口/把手收起来了（旧快照缺省视为显示）。 */
  visible?: boolean;
  docked: boolean;
  /** 停靠边（left/right/top/bottom）；null/undefined = 悬浮窗。 */
  dockEdge?: string | null;
  busy: boolean;
}

export interface ShelfShortcut {
  id: string;
  title: string;
  keyCode: number;
  modifiers: number;
  enabled: boolean;
}

export interface ShelfActionPreset {
  id: string;
  name: string;
  kind: string;
  destination: string;
  nameTemplate: string;
  width: number;
  quality: number;
  format: string;
  application: string;
  password?: string;
  findText?: string;
  replaceText?: string;
  renameMode?: string;
  caseSensitive?: boolean;
  toClipboard?: boolean;
  /** #41：{n} 序号起始值（默认 1）。 */
  counterStart?: number;
  /** #45：缩放模式 edge=最长边（默认）/ fit=适配最大宽高 / percent=百分比。 */
  resizeMode?: string;
  maxWidth?: number;
  maxHeight?: number;
  scalePercent?: number;
  /** #48：输出后动作 keep（默认）/ replace / newShelf / reveal。 */
  afterOutput?: string;
}

export interface ShelfWatchedFolder {
  id: string;
  path: string;
  enabled: boolean;
  fileType: 'all' | 'images' | 'documents' | 'text' | 'audio' | 'video' | 'archives';
  extensions: string[];
  collectionDelay: number;
  /** #30：名称运算符 any（默认）/ contains / startsWith；关键字为空时等同 any。 */
  nameCondition?: 'any' | 'contains' | 'startsWith' | string;
  nameText?: string;
  /** #32：规则命中的每个新文件各开一个新架。 */
  perFileNewShelf?: boolean;
}

export interface ShelfCloudAccount {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  bucket: string;
  region: string;
  publicBaseURL: string;
  credentialKey: string;
  /** #63：上传对象键模板（默认 {filename}；可用 {filename}/{date}）。 */
  pathTemplate?: string;
  /** #64：S3 上传后本地生成 SigV4 预签名链接，替代匿名公开基址。 */
  presignEnabled?: boolean;
  /** #64：预签名到期档位 1h/1d/7d/30d（默认 7 天）。 */
  presignExpiry?: string;
}

export interface ShelfCloudShare {
  id: string;
  createdAt: number;
  accountName: string;
  links: string[];
  message: string;
  /** #64：链接来源标注——presigned（S3 预签名）/publicBase（匿名公开基址）；其他提供商为空。 */
  linkSource?: string | null;
  /** #67：记录的到期时间（毫秒）；null/undefined = 不过期。 */
  expiresAt?: number | null;
  /** #67：删除并撤销需要按记录找回账户与提供商。 */
  accountID?: string | null;
  /** #67：与 links 平行排列的撤销句柄（S3=对象键/imgur=图片编号/custom=分享地址）；null = 不可撤销。 */
  deleteHandles?: (string | null)[];
}

export interface ShelfSettings {
  shakeEnabled: boolean;
  shakeSensitivity: number;
  modifierEnabled: boolean;
  activationModifier: string;
  notchEnabled: boolean;
  defaultPosition: string;
  additionBehavior: string;
  ignoredApps: string[];
  doubleClickBehavior: string;
  /** 双击窗口边缘三态：dock（默认）/ hide / none。 */
  edgeDoubleClick: string;
  closeAfterDrag: string;
  autoPlace: boolean;
  retractAfterDrop: boolean;
  colorShelves: boolean;
  closeDetailsOutside: boolean;
  plainText: boolean;
  ownSpace: boolean;
  copyOnDrag: boolean;
  focusOnShow: boolean;
  intelligentShelfName: boolean;
  showMenuBar: boolean;
  startAtLogin: boolean;
  showDock: boolean;
  onlineDisabled: boolean;
  instantActionsEnabled: boolean;
  instantActionIDs: string[];
  screenshotMonitoringEnabled: boolean;
  screenshotDirectory: string;
  screenshotAdditionBehavior: string;
  scriptPaths: string[];
  scriptCopyOutput: boolean;
  scriptCloseOnSuccess: boolean;
  /** #51：脚本描述（路径 → 描述），菜单 tooltip 用。 */
  scriptDescriptions: Record<string, string>;
  /** #76：最爱动作（≤5），架子动作菜单置顶分组。 */
  favoriteActionIDs: string[];
  /** #84：快速上手是否已看完（「不再显示」的持久位）。 */
  onboardingCompleted?: boolean;
  customActions: ShelfActionPreset[];
  watchedFolders: ShelfWatchedFolder[];
  cloudAccounts: ShelfCloudAccount[];
  shortcutBindings: ShelfShortcut[];
  localShortcutBindings: ShelfShortcut[];
}

/** #33：观察文件夹运行状态（记录 id → active/stopped/error）。 */
export type ShelfWatchedState = 'active' | 'stopped' | 'error';

export interface ShelfState {
  supported: boolean;
  error?: string;
  shelves: ShelfRecord[];
  settings?: ShelfSettings;
  cloudHistory: ShelfCloudShare[];
  credentialAccountIds?: string[];
  /** #33：观察文件夹状态徽标的实时快照。 */
  watchedFolderStates?: Record<string, ShelfWatchedState>;
  revision?: number;
}

export interface ShelfRevealNavigation {
  target: 'reveal';
  directory: string;
  paths: string[];
  omittedCount: number;
}

export type ShelfNavigation = 'settings' | 'shelves' | ShelfRevealNavigation;

export type ShelfRequest =
  | { action: 'snapshot' | 'selectIgnoredApplications' }
  | { action: 'screenshotTest' | 'openScreenshotSettings' | 'showGuide' }
  | { action: 'clipboard'; shelfId?: string; forceNew?: boolean }
  | { action: 'create'; name?: string }
  | { action: 'rename'; shelfId: string; name: string }
  | { action: 'pin'; shelfId: string; pinned: boolean }
  | { action: 'clear' | 'close' | 'remove' | 'show' | 'hide' | 'dock'; shelfId: string }
  | { action: 'removeItems'; shelfId: string; itemIds: string[] }
  | { action: 'addFiles'; paths: string[]; shelfId?: string }
  | { action: 'addContent'; text?: string; url?: string; html?: string; shelfId?: string }
  | { action: 'settings'; settings: Partial<ShelfSettings> }
  | { action: 'context'; shelfId: string; command: string; itemIds: string[] }
  | { action: 'setCredential'; accountId: string; secret: string }
  | { action: 'deleteCredential'; accountId: string }
  | { action: 'removeCloudAccount'; accountId: string }
  | { action: 'testCloudAccount'; accountId: string }
  | { action: 'removeCloudRecord'; recordId: string }
  | { action: 'revokeCloudRecord'; recordId: string }
  | { action: 'showLast' }
  | { action: 'shortcutCapture'; active: boolean };

export const shelfRequest = async (request: ShelfRequest): Promise<ShelfState> => {
  if (!isTauri()) {
    if (request.action !== 'snapshot') throw new Error('shelf.desktopOnly');
    return { supported: false, shelves: [], cloudHistory: [] };
  }
  return transport<ShelfState>('shelf_request', { request });
};

export const listenToShelfState = async (
  handler: (state: ShelfState) => void,
): Promise<() => void> => {
  if (!isTauri()) return () => {};
  return listenToEvent<ShelfState>('shelf-state-changed', handler);
};

/** #66：测试连接的分步结果（上传 → 列出 → 删除）。 */
export interface ShelfCloudTestStep {
  step: 'upload' | 'list' | 'delete';
  status: 'passed' | 'failed' | 'skipped';
}

export interface ShelfCloudTestResult {
  accountId: string;
  succeeded: boolean;
  message: string;
  steps: ShelfCloudTestStep[];
}

export const listenToShelfCloudTest = async (
  handler: (result: ShelfCloudTestResult) => void,
): Promise<() => void> => {
  if (!isTauri()) return () => {};
  return listenToEvent<ShelfCloudTestResult>('shelf-cloud-test-result', handler);
};

/** #67：删除并撤销的结果；succeeded=false 时 message 为失败原因。 */
export interface ShelfCloudRevokeResult {
  recordId: string;
  message: string;
  succeeded: boolean;
}

export const listenToShelfCloudRevoke = async (
  handler: (result: ShelfCloudRevokeResult) => void,
): Promise<() => void> => {
  if (!isTauri()) return () => {};
  return listenToEvent<ShelfCloudRevokeResult>('shelf-cloud-revoke-result', handler);
};
