import { useState, useCallback, useEffect } from 'react';
import { TauriAPI, type FileEntry, type FileAssociation } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import type { ContextMenuItem } from '@/components/ui/ContextMenu';
import { ContextMenuFactory, contextMenuRegistry } from '@/lib/context-menu-factory';
import i18n from '@/i18n';

// ── Open-With submenu (Finder parity) ────────────────────────────────────────
// The association list is fetched per extension and cached for the session;
// Finder shows 默认应用 + 推荐应用 + 其他… in the 打开方式 submenu.

const openWithCache = new Map<string, Promise<FileAssociation | null>>();

const fetchAssociations = (file: FileEntry): Promise<FileAssociation | null> => {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const key = ext || '_noext';
  let entry = openWithCache.get(key);
  if (!entry) {
    entry = TauriAPI.getFileAssociations(file.path).catch(() => null);
    openWithCache.set(key, entry);
  }
  return entry;
};

const appMenuItem = (
  file: FileEntry,
  appName: string,
  appPath: string,
  isDefault: boolean,
): ContextMenuItem => ({
  id: `open-with-app-${appPath}`,
  label: isDefault ? i18n.t('contextMenu.defaultApp', { name: appName }) : appName,
  // 应用图标（Finder 同款：菜单里每个 app 画自己的 icon）
  icon: <AppMenuIcon appName={appName} appPath={appPath} />,
  action: () => {
    TauriAPI.openFileWithApplication(file.path, appPath).catch((err: unknown) => {
      console.error('openFileWithApplication failed:', err);
    });
  },
});

/**
 * 打开方式菜单里的应用图标：桌面版走系统真图标（NSWorkspace，同文件列表），
 * 演示环境用与 .app 列表图标同语义的圆角方块+首字母（按名稳定取色）。
 */
const AppMenuIcon = ({ appName, appPath }: { appName: string; appPath: string }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    TauriAPI.getFileIconPng(appPath)
      .then((p: string) => {
        if (!cancelled) return import('@/lib/transport').then(({ convertAssetUrl }) => convertAssetUrl(p));
        return null;
      })
      .then((u: string | null) => {
        if (!cancelled && u) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [appPath]);

  if (url) {
    return <img src={url} alt="" width={14} height={14} className="shrink-0" draggable={false} />;
  }
  const initial = appName.charAt(0).toUpperCase() || 'A';
  let hash = 0;
  for (let i = 0; i < appName.length; i += 1) hash = (hash * 31 + appName.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return (
    <svg viewBox="0 0 48 48" width={14} height={14} aria-hidden="true" className="shrink-0">
      <rect x="4" y="4" width="40" height="40" rx="10" fill={`hsl(${hue}, 62%, 52%)`} />
      <text
        x="24"
        y="32"
        textAnchor="middle"
        fontFamily="-apple-system, 'SF Pro Text', sans-serif"
        fontWeight="700"
        fontSize="22"
        fill="#fff"
      >
        {initial}
      </text>
    </svg>
  );
};

/** Replace the open-with submenu placeholder with the real app list. */
const attachOpenWithApps = (
  items: ContextMenuItem[],
  file: FileEntry,
  assoc: FileAssociation | null,
): ContextMenuItem[] =>
  items.map((item) => {
    if (item.id !== 'open-with' || !item.submenu) return item;
    // Preserve the factory-built 其他… entry (label + dialog action).
    const other = item.submenu.find((sub) => sub.id === 'open-with-other');
    if (!assoc || (!assoc.default_app && assoc.available_apps.length === 0)) {
      return { ...item, submenu: item.submenu.filter((sub) => sub.id !== 'open-with-loading') };
    }
    const def = assoc.default_app;
    const recommended = assoc.available_apps.filter((a) => a.path !== def?.path).slice(0, 10);
    const submenu: ContextMenuItem[] = [];
    if (def) {
      submenu.push(appMenuItem(file, def.name, def.path, true));
      submenu.push({ id: 'open-with-sep-default', label: '', separator: true });
    }
    for (const app of recommended) {
      submenu.push(appMenuItem(file, app.name, app.path, false));
    }
    if (recommended.length > 0) {
      submenu.push({ id: 'open-with-sep-other', label: '', separator: true });
    }
    submenu.push({
      id: 'open-with-other',
      label: other?.label ?? '其他…',
      action: other?.action,
    });
    return { ...item, submenu };
  });

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClipboardState {
  files: FileEntry[];
  operation: 'copy' | 'cut';
}

interface UseContextMenuDeps {
  contextMenuFactoryRef: React.MutableRefObject<ContextMenuFactory>;
  selectedFiles: Set<string>;
  clipboard: ClipboardState | null;
  currentPath: string;
  markedFile: FileEntry | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export const useContextMenu = (deps: UseContextMenuDeps) => {
  const { contextMenuFactoryRef, selectedFiles, clipboard, currentPath, markedFile } = deps;

  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[]>([]);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [contextMenuFile, setContextMenuFile] = useState<FileEntry | null>(null);

  // Sync the comparison mark into the factory
  useEffect(() => {
    if (markedFile) {
      contextMenuFactoryRef.current.markFileForComparison(markedFile);
    } else {
      contextMenuFactoryRef.current.clearComparisonMark();
    }
  }, [markedFile, contextMenuFactoryRef]);

  // File right-click
  const handleFileRightClick = useCallback(
    (file: FileEntry, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenuFile(file);

      const baseMenuItems = contextMenuFactoryRef.current.getFileContextMenu(
        file,
        selectedFiles,
        clipboard,
      );
      const extensionItems = contextMenuRegistry.getFileActions(file, selectedFiles);
      const allMenuItems = [...baseMenuItems];
      if (extensionItems.length > 0) {
        allMenuItems.push({ id: 'sep-extensions', label: '', separator: true });
        allMenuItems.push(...extensionItems);
      }

      setContextMenuItems(allMenuItems);
      setContextMenuPosition({ x: event.clientX, y: event.clientY });
      setContextMenuVisible(true);

      // Fill the 打开方式 submenu asynchronously (Finder parity: default app
      // + recommended apps + 其他…). The menu re-renders in place when the
      // association list lands.
      if (!file.is_dir && isTauri()) {
        void fetchAssociations(file).then((assoc) => {
          setContextMenuItems((prev) => attachOpenWithApps(prev, file, assoc));
        });
      } else if (!file.is_dir) {
        // 演示环境拿不到系统应用列表：立即撤掉"正在读取…"占位
        setContextMenuItems((prev) =>
          prev.map((item) =>
            item.id === 'open-with'
              ? { ...item, submenu: (item.submenu ?? []).filter((sub) => sub.id !== 'open-with-loading') }
              : item,
          ),
        );
      }
    },
    [contextMenuFactoryRef, selectedFiles, clipboard],
  );

  // Background right-click (empty space)
  const handleBackgroundRightClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenuFile(null);

      const baseMenuItems = contextMenuFactoryRef.current.getEmptySpaceContextMenu(
        currentPath,
        clipboard,
      );
      const extensionItems = contextMenuRegistry.getEmptySpaceActions(currentPath);
      const allMenuItems = [...baseMenuItems];
      if (extensionItems.length > 0) {
        allMenuItems.push({ id: 'sep-extensions', label: '', separator: true });
        allMenuItems.push(...extensionItems);
      }

      setContextMenuItems(allMenuItems);
      setContextMenuPosition({ x: event.clientX, y: event.clientY });
      setContextMenuVisible(true);
    },
    [contextMenuFactoryRef, currentPath, clipboard],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenuVisible(false);
  }, []);

  return {
    contextMenuVisible,
    contextMenuItems,
    contextMenuPosition,
    contextMenuFile,
    handleFileRightClick,
    handleBackgroundRightClick,
    closeContextMenu,
    // Expose setters for shared pane actions that need to build menus directly
    setContextMenuFile,
    setContextMenuItems,
    setContextMenuPosition,
    setContextMenuVisible,
  };
};
