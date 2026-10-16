import { getAppLocale } from '@/lib/locale';

/** FileEntry timestamps are seconds; today/yesterday/this-year follow the user's local calendar. */
export const formatFileListDate = (timestampSeconds: number): string => {
  const date = new Date(timestampSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return '—';

  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOfDay(new Date());
  const dayMs = 86_400_000;
  const locale = getAppLocale();
  const isZh = locale === 'zh-CN';

  if (date.getTime() >= today.getTime() && date.getTime() < today.getTime() + dayMs) {
    return time;
  }
  if (date.getTime() >= today.getTime() - dayMs && date.getTime() < today.getTime()) {
    return isZh ? `昨天 ${time}` : `Yesterday ${time}`;
  }
  // Same local-calendar-year dates drop the year (a leading "2025年" reads as
  // noise for anything the user can still place); earlier years keep it so
  // cross-year folders stay unambiguous: zh "2025年10月2日 19:04" /
  // en "Oct 2, 2025, 14:30".
  const sameYear = date.getFullYear() === today.getFullYear();
  if (isZh) {
    const datePart = `${sameYear ? '' : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`;
    return `${datePart} ${time}`;
  }
  const datePart = date.toLocaleDateString(locale, {
    ...(sameYear ? {} : { year: 'numeric' as const }),
    month: 'short',
    day: 'numeric',
  });
  return `${datePart}, ${time}`;
};
