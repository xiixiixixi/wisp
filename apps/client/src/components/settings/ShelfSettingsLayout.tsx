import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cloud,
  FolderSync,
  MousePointer2,
  PanelsTopLeft,
  Settings2,
  UserRound,
  Zap,
} from 'lucide-react';
import { SelectField } from './shared';
import './shelf-settings.css';

export const SHELF_SETTINGS_CATEGORIES = [
  'activation',
  'interaction',
  'general',
  'cloud',
  'customActions',
  'instantActions',
  'watching',
] as const;
export type ShelfSettingsCategory = (typeof SHELF_SETTINGS_CATEGORIES)[number];

const CATEGORY_ICONS = {
  activation: MousePointer2,
  interaction: PanelsTopLeft,
  general: Settings2,
  cloud: Cloud,
  customActions: UserRound,
  instantActions: Zap,
  watching: FolderSync,
};

interface ShelfSettingsLayoutProps {
  panels: Record<ShelfSettingsCategory, ReactNode>;
  busy: boolean;
  status?: ReactNode;
  /** #84：设置页顶部的「快速上手」入口等页级动作。 */
  headerExtra?: ReactNode;
  onCategoryChange: () => void;
}

export const ShelfSettingsLayout = ({
  panels,
  busy,
  status,
  headerExtra,
  onCategoryChange,
}: ShelfSettingsLayoutProps) => {
  const { t } = useTranslation();
  const id = useId();
  const [category, setCategory] = useState<ShelfSettingsCategory>('activation');
  const [visited, setVisited] = useState<ShelfSettingsCategory[]>(['activation']);
  const select = (next: ShelfSettingsCategory) => {
    if (next === category) {
      return;
    }
    onCategoryChange();
    setCategory(next);
    setVisited((prev) => (prev.includes(next) ? prev : [...prev, next]));
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      next = (index + 1) % SHELF_SETTINGS_CATEGORIES.length;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      next = (index - 1 + SHELF_SETTINGS_CATEGORIES.length) % SHELF_SETTINGS_CATEGORIES.length;
    }
    if (event.key === 'Home') {
      next = 0;
    }
    if (event.key === 'End') {
      next = SHELF_SETTINGS_CATEGORIES.length - 1;
    }
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    const selected = SHELF_SETTINGS_CATEGORIES[next];
    select(selected);
    document.getElementById(`${id}-category-${selected}`)?.focus();
  };
  return (
    <div className="wisp-shelf-preferences">
      <div className="wisp-shelf-preferences-layout">
        <nav
          className="wisp-shelf-category-nav"
          role="tablist"
          aria-label={t('shelf.preferences.categoriesLabel')}
          aria-orientation="vertical"
        >
          {SHELF_SETTINGS_CATEGORIES.map((item, index) => {
            const Icon = CATEGORY_ICONS[item];
            return (
              <button
                key={item}
                type="button"
                id={`${id}-category-${item}`}
                role="tab"
                aria-selected={category === item}
                aria-controls={`${id}-page-${item}`}
                tabIndex={category === item ? 0 : -1}
                onClick={() => select(item)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
                <span>{t(`shelf.preferences.categories.${item}`)}</span>
              </button>
            );
          })}
        </nav>
        <div className="wisp-shelf-preferences-content">
          <div className="wisp-shelf-category-select">
            <SelectField
              label={t('shelf.preferences.categoriesLabel')}
              value={category}
              onChange={(value) => select(value as ShelfSettingsCategory)}
              options={SHELF_SETTINGS_CATEGORIES.map((value) => ({
                value,
                label: t(`shelf.preferences.categories.${value}`),
              }))}
            />
          </div>
          <header className="wisp-shelf-category-heading">
            <h3>{t(`shelf.preferences.categories.${category}`)}</h3>
            {headerExtra}
          </header>
          {status && <div className="wisp-shelf-settings-status">{status}</div>}
          <fieldset disabled={busy} className="wisp-shelf-category-panels">
            {visited.map((item) => (
              <div
                key={item}
                id={`${id}-page-${item}`}
                role="tabpanel"
                aria-labelledby={`${id}-category-${item}`}
                hidden={category !== item}
                data-active={category === item}
                className="wisp-shelf-settings-page"
                tabIndex={0}
              >
                {panels[item]}
              </div>
            ))}
          </fieldset>
        </div>
      </div>
    </div>
  );
};
