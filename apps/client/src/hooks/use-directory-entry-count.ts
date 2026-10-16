import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@/lib/transport';

/**
 * 目录计数并行通道（#31/#21）：Rust 侧 `read_directory` 在 read_dir 返回的
 * 瞬间先 emit 一次原始条目数，再去做逐项 stat 与 Spotlight 富化。大目录
 * 下状态栏的「N 个项目」由此提前到首帧附近，而不是等整份列表落地。
 */

/** 与 Rust 侧 DIRECTORY_ENTRY_COUNT_EVENT 保持同一字面量。 */
export const DIRECTORY_ENTRY_COUNT_EVENT = 'directory-entry-count';

export interface DirectoryEntryCount {
  path: string;
  count: number;
}

/**
 * 显示计数裁决：已落地的列表长度永远优先；事件只在列表尚未到达（长度 0）
 * 且路径匹配时补位。空目录两者一致（事件也是 0），不会互相打架。
 */
export const resolveDisplayItemCount = (
  filesLength: number,
  event: DirectoryEntryCount | null,
  currentPath: string,
): number => {
  if (filesLength > 0) return filesLength;
  if (event && event.path === currentPath) return event.count;
  return filesLength;
};

/**
 * 监听原生目录计数事件，返回与 `currentPath` 匹配的最新计数（不匹配或
 * 非桌面环境返回 null）。计数是 advisory：事件丢失只回退到旧行为。
 */
export const useDirectoryEntryCount = (currentPath: string): DirectoryEntryCount | null => {
  const [latest, setLatest] = useState<DirectoryEntryCount | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<DirectoryEntryCount>(DIRECTORY_ENTRY_COUNT_EVENT, (event) => {
      if (!disposed) setLatest(event.payload);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        /* advisory only — the listing itself remains the source of truth */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return latest && latest.path === currentPath ? latest : null;
};
