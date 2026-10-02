import { getAppLocale } from '@/lib/locale';

/** FileEntry timestamps are seconds; today follows the user's local calendar. */
export const formatFileListDate = (timestampSeconds: number): string => {
  const date = new Date(timestampSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return '\u2014';

  const today = new Date();
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  return date.toLocaleDateString(getAppLocale(), { month: 'short', day: 'numeric' });
};
