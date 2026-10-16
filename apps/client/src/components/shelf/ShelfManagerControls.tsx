import type { MouseEvent } from 'react';
import { Grid2X2, List, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ShelfIconButtonProps {
  label: string;
  icon: LucideIcon;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  menu?: boolean;
  className?: string;
}

export const ShelfIconButton = ({
  label,
  icon: Icon,
  onClick,
  disabled,
  pressed,
  expanded,
  menu,
  className,
}: ShelfIconButtonProps) => (
  <button
    type="button"
    className={className ? `shelf-manager-icon ${className}` : 'shelf-manager-icon'}
    title={label}
    aria-label={label}
    aria-pressed={pressed}
    aria-haspopup={menu ? 'menu' : undefined}
    aria-expanded={expanded}
    onClick={onClick}
    disabled={disabled}
  >
    <Icon size={15} strokeWidth={1.6} aria-hidden="true" />
  </button>
);

export const ShelfViewToggle = ({
  view,
  onChange,
}: {
  view: 'list' | 'gallery';
  onChange: (view: 'list' | 'gallery') => void;
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="shelf-manager-view-toggle"
      role="group"
      aria-label={t('shelf.manager.contents')}
    >
      <ShelfIconButton
        label={t('shelf.manager.gallery')}
        icon={Grid2X2}
        pressed={view === 'gallery'}
        onClick={() => onChange('gallery')}
      />
      <ShelfIconButton
        label={t('shelf.manager.list')}
        icon={List}
        pressed={view === 'list'}
        onClick={() => onChange('list')}
      />
    </div>
  );
};
