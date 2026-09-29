/**
 * 极简模型选择器 —— 只列当前可用的模型（provider · model），
 * 记住上次选择。没有历史包袱：无自定义输入、无外部链接。
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Sparkles } from 'lucide-react';
import type { AvailableModel } from '@/lib/pi-engine/providers';

const LAST_MODEL_KEY = 'wisp:pi-last-model';

interface PiModelPickerProps {
  models: AvailableModel[];
  value: string;
  onChange: (ref: string) => void;
  /** 输入盒工具条形态：仅图标；菜单和悬停说明保留模型名称。 */
  compact?: boolean;
}

const PiModelPicker = ({ models, value, onChange, compact }: PiModelPickerProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (m: AvailableModel) => {
    onChange(m.ref);
    localStorage.setItem(LAST_MODEL_KEY, m.ref);
    setOpen(false);
  };

  const current = models.find((m) => m.ref === value);

  return (
    <div ref={ref} className={compact ? 'relative shrink-0' : 'relative w-full'}>
      <button
        type="button"
        className={
          compact
            ? `pi-composer-tool ${current ? 'text-xp-accent' : ''}`
            : 'flex w-full items-center gap-1.5 rounded-md border border-xp-border bg-xp-surface-light px-2 py-1.5 text-left text-[11px] text-xp-text'
        }
        onClick={() => setOpen((v) => !v)}
        title={current ? `${current.providerLabel} · ${current.label}` : t('piChat.pickModel')}
        aria-label={current ? `${t('piChat.pickModel')}：${current.label}` : t('piChat.pickModel')}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid="pi-model-picker"
      >
        <Sparkles size={compact ? 16 : 11} className="shrink-0" />
        {!compact && (
          <>
            <span className="min-w-0 flex-1 truncate">
              {current ? `${current.providerLabel} · ${current.label}` : t('piChat.pickModel')}
            </span>
            <ChevronDown size={10} className="shrink-0 opacity-60" />
          </>
        )}
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute bottom-full z-50 mb-1 max-h-64 w-full min-w-44 overflow-y-auto rounded-md border border-xp-border bg-xp-popover p-1 shadow-lg ${
            compact ? 'right-0 w-52' : 'left-0'
          }`}
        >
          {models.map((m) => (
            <button
              key={m.ref}
              type="button"
              role="option"
              aria-selected={m.ref === value}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] ${
                m.ref === value
                  ? 'bg-xp-blue font-medium text-xp-on-accent'
                  : 'text-xp-text hover:bg-xp-blue hover:text-xp-on-accent'
              }`}
              onClick={() => pick(m)}
            >
              <span className="truncate">
                {m.providerLabel} · {m.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default PiModelPicker;
