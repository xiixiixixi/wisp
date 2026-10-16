import i18n from '@/i18n';
import type { FileEntry } from '@/lib/tauri-api';
import { formatError } from '@/lib/file-operation-helpers';

type CopyToast = (options: { title: string; description: string; variant?: 'destructive' }) => void;

/** One entry per line. A failed write must never report success. */
export const copyEntryText = async (
  input: FileEntry | FileEntry[],
  field: 'path' | 'name',
  toast: CopyToast,
): Promise<void> => {
  const entries = Array.isArray(input) ? input : [input];
  if (!entries.length) return;
  try {
    await navigator.clipboard.writeText(entries.map((entry) => entry[field]).join('\n'));
    toast({
      title: i18n.t(field === 'path' ? 'toast.pathCopied' : 'toast.nameCopied'),
      description: i18n.t(field === 'path' ? 'toast.pathsCopiedDesc' : 'toast.namesCopiedDesc', {
        count: entries.length,
      }),
    });
  } catch (error) {
    toast({
      title: i18n.t('toast.clipboardWriteFailed'),
      description: formatError(error),
      variant: 'destructive',
    });
  }
};
