import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { PreviewProps } from '@/lib/preview-factory';
import { TauriAPI } from '@/lib/tauri-api';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import {
  User,
  Phone,
  Mail,
  Building2,
  MapPin,
  Link2,
  StickyNote,
  CalendarDays,
  Clock,
} from 'lucide-react';

// ─── Minimal vCard / iCalendar parsing (no dependency) ──────────────────────

interface CardRow {
  icon: 'user' | 'phone' | 'mail' | 'org' | 'addr' | 'link' | 'note';
  label: string;
  value: string;
}

interface VcardCard {
  kind: 'vcard';
  title: string;
  rows: CardRow[];
}

interface IcalEvent {
  kind: 'event';
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  rows: CardRow[];
}

type ContactCard = VcardCard | IcalEvent;

/** Unfold continuation lines (leading space/tab) per RFC 5545 §3.1. */
const unfold = (text: string): string[] => {
  const lines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if ((rawLine.startsWith(' ') || rawLine.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += rawLine.slice(1);
    } else {
      lines.push(rawLine);
    }
  }
  return lines;
};

const field = (line: string): { key: string; value: string } => {
  const colon = line.indexOf(':');
  if (colon === -1) return { key: '', value: '' };
  return { key: line.slice(0, colon).split(';')[0].toUpperCase(), value: line.slice(colon + 1) };
};

/** vCard ADR/N values are semicolon-joined; show the non-empty parts. */
const semiParts = (value: string): string =>
  value
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ');

/** iCal dates: [YYYYMMDD] or YYYYMMDDTHHMMSS[Z]; date-only means all-day. */
const parseIcalDate = (raw: string): { text: string; allDay: boolean } | null => {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return raw ? { text: raw, allDay: false } : null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return { text: `${y}-${mo}-${d}`, allDay: true };
  return {
    text: `${y}-${mo}-${d} ${h}:${mi}${s && s !== '00' ? `:${s}` : ''}${z ? ' UTC' : ''}`,
    allDay: false,
  };
};

const parseContacts = (text: string, fileName: string): ContactCard[] => {
  const lines = unfold(text);
  const cards: ContactCard[] = [];
  const isIcs = fileName.toLowerCase().endsWith('.ics') || /BEGIN:VCALENDAR/i.test(text);

  if (isIcs) {
    let current: { start?: string; end?: string; props: [string, string][] } | null = null;
    for (const line of lines) {
      const { key, value } = field(line);
      if (key === 'BEGIN' && value.trim().toUpperCase() === 'VEVENT') {
        current = { props: [] };
      } else if (key === 'END' && value.trim().toUpperCase() === 'VEVENT' && current) {
        const get = (k: string) => current!.props.find(([key]) => key === k)?.[1] ?? '';
        const start = parseIcalDate(get('DTSTART'));
        const end = parseIcalDate(get('DTEND'));
        const rows: CardRow[] = [];
        const location = get('LOCATION');
        const description = get('DESCRIPTION');
        if (location) rows.push({ icon: 'addr', label: 'LOCATION', value: location });
        if (description) rows.push({ icon: 'note', label: 'DESCRIPTION', value: description });
        cards.push({
          kind: 'event',
          title: get('SUMMARY') || '(no title)',
          allDay: start?.allDay ?? false,
          start: start?.text ?? '',
          end: end?.text ?? '',
          rows,
        });
        current = null;
      } else if (current && key) {
        current.props.push([key, value]);
      }
    }
    return cards;
  }

  let current: { props: [string, string][] } | null = null;
  for (const line of lines) {
    const { key, value } = field(line);
    if (key === 'BEGIN' && value.trim().toUpperCase() === 'VCARD') {
      current = { props: [] };
    } else if (key === 'END' && value.trim().toUpperCase() === 'VCARD' && current) {
      const get = (k: string) => current!.props.filter(([key]) => key === k).map(([, v]) => v);
      const first = (k: string) => get(k)[0] ?? '';
      const rows: CardRow[] = [];
      for (const tel of get('TEL')) rows.push({ icon: 'phone', label: 'TEL', value: tel });
      for (const mail of get('EMAIL')) rows.push({ icon: 'mail', label: 'EMAIL', value: mail });
      const org = first('ORG');
      const title = first('TITLE');
      if (org || title)
        {rows.push({
          icon: 'org',
          label: 'ORG',
          value: [semiParts(org), title].filter(Boolean).join(' · '),
        });}
      for (const adr of get('ADR')) {
        const addr = semiParts(adr);
        if (addr) rows.push({ icon: 'addr', label: 'ADR', value: addr });
      }
      for (const url of get('URL')) rows.push({ icon: 'link', label: 'URL', value: url });
      const note = first('NOTE');
      if (note) rows.push({ icon: 'note', label: 'NOTE', value: note });
      cards.push({
        kind: 'vcard',
        title: first('FN') || semiParts(first('N')) || '(no name)',
        rows,
      });
      current = null;
    } else if (current && key) {
      current.props.push([key, value]);
    }
  }
  return cards;
};

const ICONS = {
  user: User,
  phone: Phone,
  mail: Mail,
  org: Building2,
  addr: MapPin,
  link: Link2,
  note: StickyNote,
} as const;

/**
 * Contact/calendar cards: Finder renders .vcf as a contact card and .ics as
 * an event card; Wisp parses the same RFC 5545 formats and renders them
 * natively (falling back to the raw text when parsing finds nothing).
 */
const ContactPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t: tUi } = useTranslation();
  const [cards, setCards] = useState<ContactCard[] | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const attemptRef = useRef(0);

  useEffect(() => {
    const myAttempt = ++attemptRef.current;
    setCards(null);
    setRaw(null);
    setLoading(true);

    TauriAPI.readTextFile(file.path)
      .then((text) => {
        if (myAttempt !== attemptRef.current) return;
        const parsed = parseContacts(text, file.name);
        if (parsed.length > 0) {
          setCards(parsed);
        } else {
          setRaw(text);
        }
        setLoading(false);
        onLoad?.();
      })
      .catch((err: unknown) => {
        if (myAttempt !== attemptRef.current) return;
        onError?.(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  if (loading) return <PreviewSkeleton />;

  if (raw !== null) {
    return (
      <div className="h-full overflow-auto rounded-md border border-xp-border bg-xp-surface p-4">
        <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-xp-text">
          {raw}
        </pre>
      </div>
    );
  }

  if (!cards || cards.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-xp-text-muted">
        {tUi('previewPanel.contactParseFailed')}
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-auto rounded-md border border-xp-border bg-xp-surface p-4">
      {cards.map((card, i) => (
        <div key={i} className="border-xp-border/60 rounded-md border bg-xp-surface-light/40 p-3">
          {card.kind === 'vcard' ? (
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-xp-surface text-xp-text-secondary">
                <User size={16} aria-hidden />
              </span>
              <h4 className="truncate text-sm font-semibold text-xp-text" title={card.title}>
                {card.title}
              </h4>
            </div>
          ) : (
            <div className="mb-2">
              <div className="mb-1 flex items-center gap-2">
                <CalendarDays size={15} className="text-xp-text-secondary" aria-hidden />
                <h4 className="truncate text-sm font-semibold text-xp-text" title={card.title}>
                  {card.title}
                </h4>
              </div>
              <div className="flex items-center gap-2 text-xs text-xp-text-secondary">
                <Clock size={12} aria-hidden />
                {card.allDay
                  ? `${tUi('previewPanel.allDay')} · ${card.start}`
                  : `${card.start}${card.end ? ` — ${card.end}` : ''}`}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            {card.rows.map((row, j) => {
              const Icon = ICONS[row.icon];
              return (
                <div key={j} className="flex items-start gap-2 text-xs">
                  <Icon size={13} className="mt-0.5 shrink-0 text-xp-text-muted" aria-hidden />
                  <span className="min-w-0 break-words text-xp-text">{row.value}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default React.memo(ContactPreview);
