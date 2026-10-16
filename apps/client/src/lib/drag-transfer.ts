import { buildDestinationPath, isSamePath } from '@/lib/drag-utils';
import type { ConflictInfo } from '@/lib/tauri-api';

export type ConflictPolicy = 'overwrite' | 'skip' | 'keepBoth' | 'merge';

export interface TransferItem {
  source: string;
  dest: string;
  /** Replace the existing destination before transferring. */
  overwrite?: boolean;
  /** Merge-copy folder contents instead of a plain transfer. */
  merge?: boolean;
}

export interface TransferPlan {
  items: TransferItem[];
  skippedCount: number;
}

/**
 * Build the transfer plan for a drop, applying per-source conflict policies.
 * `renameDest` resolves a non-conflicting destination name (keep-both policy).
 */
export const planTransfer = async (
  sources: string[],
  targetDir: string,
  conflicts: ConflictInfo[],
  policyFor: (source: string) => ConflictPolicy,
  renameDest: (fileName: string) => Promise<string>,
): Promise<TransferPlan> => {
  const conflictIsFolder = new Map(
    conflicts.map((c) => [c.source.path, c.source.is_dir && c.destination.is_dir]),
  );

  const items: TransferItem[] = [];
  let skippedCount = 0;

  for (const source of sources) {
    const dest = buildDestinationPath(source, targetDir);
    // A source already living in the target dir would "conflict" with itself;
    // skipping avoids the overwrite policy deleting the source file.
    if (isSamePath(dest, source)) {
      skippedCount += 1;
      continue;
    }
    const policy = conflictIsFolder.has(source) ? policyFor(source) : null;

    if (policy === 'skip') {
      skippedCount += 1;
    } else if (policy === 'keepBoth') {
      const name = source.split(/[/\\]/).pop() || source;
      items.push({ source, dest: await renameDest(name) });
    } else if (policy === 'merge' && conflictIsFolder.get(source)) {
      items.push({ source, dest, merge: true });
    } else if (policy !== null) {
      // overwrite, or merge applied to a non-folder conflict (replace)
      items.push({ source, dest, overwrite: true });
    } else {
      items.push({ source, dest });
    }
  }

  return { items, skippedCount };
};
