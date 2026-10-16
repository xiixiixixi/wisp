/** 模型与思考强度共用文字入口，菜单内换页适配窄侧栏。 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { AvailableModel } from '@/lib/pi-engine/providers';
import type { ThinkingLevel } from './PiChatComposer';
import PiComposerMenu from './PiComposerMenu';

const LAST_MODEL_KEY = 'wisp:pi-last-model';

interface PiModelPickerProps {
  models: AvailableModel[];
  value: string;
  onChange: (ref: string) => void;
  thinking: ThinkingLevel;
  onThinkingChange: (level: ThinkingLevel) => void;
}

const PiModelPicker = ({
  models,
  value,
  onChange,
  thinking,
  onThinkingChange,
}: PiModelPickerProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<'main' | 'models' | 'thinking'>('main');
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((model) => model.ref === value);
  const levels = [
    { value: 'auto' as const, label: t('settings.aiCfg.thinkAuto') },
    { value: 'off' as const, label: t('settings.aiCfg.thinkOff') },
    { value: 'low' as const, label: t('settings.aiCfg.thinkLow') },
    { value: 'medium' as const, label: t('settings.aiCfg.thinkMedium') },
    { value: 'high' as const, label: t('settings.aiCfg.thinkHigh') },
  ];
  const effort = levels.find((level) => level.value === thinking)?.label ?? levels[0].label;
  const shortEffort = thinking === 'auto' ? t('piChat.thinkAutoShort') : effort;
  const modelLabel = current?.label ?? t('piChat.pickModel');
  const title = `${modelLabel} · ${effort}`;
  const pageLabel = page === 'models' ? t('piChat.modelLabel') : t('piChat.thinkLabel');
  const providerCount = new Set(models.map((model) => model.providerLabel)).size;

  return (
    <div ref={ref} className="pi-model-control">
      <button
        type="button"
        className="pi-model-trigger"
        onClick={() => {
          setPage('main');
          setOpen((previous) => !previous);
        }}
        title={title}
        aria-label={`${t('piChat.modelSettings')}：${title}`}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="pi-model-picker"
      >
        <span className="pi-model-trigger-name">{modelLabel}</span>
        <span className="pi-model-trigger-effort">· {shortEffort}</span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <PiComposerMenu
          anchorRef={ref}
          label={page === 'main' ? t('piChat.modelSettings') : pageLabel}
          width={264}
          focusKey={page}
          onClose={() => setOpen(false)}
          onBack={page === 'main' ? undefined : () => setPage('main')}
        >
          {page === 'main' ? (
            <>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="pi-menu-item"
                data-menu-keep-open
                data-testid="pi-model-options"
                onClick={() => setPage('models')}
              >
                <span>{t('piChat.modelLabel')}</span>
                <span className="pi-menu-value" title={modelLabel}>
                  {modelLabel}
                </span>
                <ChevronRight size={13} className="pi-menu-icon" aria-hidden="true" />
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="pi-menu-item"
                data-menu-keep-open
                data-testid="pi-thinking-picker"
                onClick={() => setPage('thinking')}
              >
                <span>{t('piChat.thinkLabel')}</span>
                <span className="pi-menu-value">{effort}</span>
                <ChevronRight size={13} className="pi-menu-icon" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="pi-menu-item pi-menu-back"
                data-menu-keep-open
                aria-label={t('piChat.menuBack')}
                onClick={() => setPage('main')}
              >
                <ArrowLeft size={14} aria-hidden="true" />
                <span>{pageLabel}</span>
              </button>
              {page === 'models' && models.length === 0 && (
                <div className="pi-menu-empty">
                  <p>{t('piChat.noModel')}</p>
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="pi-menu-item"
                    onClick={() => {
                      setOpen(false);
                      window.dispatchEvent(new CustomEvent('wisp-open-settings'));
                    }}
                  >
                    {t('piChat.goConfigure')}
                  </button>
                </div>
              )}
              {page === 'models' &&
                models.map((model) => (
                  <button
                    key={model.ref}
                    type="button"
                    role="menuitemradio"
                    tabIndex={-1}
                    aria-checked={model.ref === value}
                    className="pi-menu-item"
                    title={`${model.providerLabel} · ${model.label}`}
                    onClick={() => {
                      onChange(model.ref);
                      localStorage.setItem(LAST_MODEL_KEY, model.ref);
                      setOpen(false);
                    }}
                  >
                    <span className="pi-menu-item-copy pi-menu-single-line">{model.label}</span>
                    {providerCount > 1 && (
                      <span className="pi-menu-provider">{model.providerLabel}</span>
                    )}
                    {model.ref === value && (
                      <Check size={14} className="pi-menu-check" aria-hidden="true" />
                    )}
                  </button>
                ))}
              {page === 'thinking' &&
                levels.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    role="menuitemradio"
                    tabIndex={-1}
                    aria-checked={level.value === thinking}
                    className="pi-menu-item"
                    onClick={() => {
                      onThinkingChange(level.value);
                      setOpen(false);
                    }}
                  >
                    <span className="pi-menu-item-copy">{level.label}</span>
                    {level.value === thinking && (
                      <Check size={14} className="pi-menu-check" aria-hidden="true" />
                    )}
                  </button>
                ))}
            </>
          )}
        </PiComposerMenu>
      )}
    </div>
  );
};
export default PiModelPicker;
