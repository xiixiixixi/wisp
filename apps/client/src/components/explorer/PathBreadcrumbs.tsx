import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, ExternalLink, HardDrive, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AnchoredMenu } from '@/components/ui/AnchoredMenu';
import { TauriAPI } from '@/lib/tauri-api';
import { getBreadcrumbStart } from '@/lib/breadcrumb-layout';

interface PathSegment {
  name: string;
  fullPath: string;
}

interface PathBreadcrumbsProps {
  segments: PathSegment[];
  currentPath: string;
  navigateToPath?: (path: string) => void;
  onEdit: () => void;
}

const SegmentLabel = ({ segment, root }: { segment: PathSegment; root: boolean }) =>
  root && (segment.name === '/' || /^[A-Za-z]:$/.test(segment.name)) ? (
    <span className="flex items-center gap-1">
      <HardDrive size={12} className="shrink-0" aria-hidden="true" />
      {segment.name}
    </span>
  ) : (
    segment.name
  );

export default function PathBreadcrumbs({
  segments,
  currentPath,
  navigateToPath,
  onEdit,
}: PathBreadcrumbsProps) {
  const { t } = useTranslation();
  const trailRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(0);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useLayoutEffect(() => {
    const trail = trailRef.current;
    const measure = measureRef.current;
    if (!trail || !measure) return;
    const update = () => {
      const widths = Array.from(measure.children, (child) => child.getBoundingClientRect().width);
      setStart(getBreadcrumbStart(widths, trail.clientWidth));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(trail);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [currentPath, t]);

  useEffect(() => {
    setOpen(false);
  }, [currentPath, start]);
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  return (
    <nav
      aria-label={t('navigation.breadcrumb')}
      className="wisp-path-breadcrumbs relative flex h-full min-w-0 flex-1 items-center gap-1"
    >
      {/* Non-interactive sizing copy: actual font metrics, including localized/current labels. */}
      <div ref={measureRef} className="wisp-breadcrumb-measure" aria-hidden="true" inert>
        {segments.map((segment, index) => (
          <span className="wisp-breadcrumb-segment" key={segment.fullPath}>
            {index > 0 && <ChevronRight size={12} className="shrink-0" />}
            <span
              className="wisp-breadcrumb"
              data-current={index === segments.length - 1 ? 'true' : undefined}
            >
              <SegmentLabel segment={segment} root={index === 0} />
            </span>
          </span>
        ))}
      </div>
      <div
        ref={trailRef}
        className="wisp-breadcrumb-trail flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
      >
        {start > 0 && (
          <button
            ref={triggerRef}
            className="wisp-breadcrumb-ellipsis wisp-control-icon shrink-0"
            type="button"
            aria-label={t('navigation.showParentFolders', { defaultValue: 'Show parent folders' })}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            title={currentPath}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setOpen(true);
              }
            }}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        )}
        {segments.slice(start).map((segment, offset) => {
          const index = start + offset;
          const current = index === segments.length - 1;
          return (
            <span
              className={`wisp-breadcrumb-segment ${current ? 'min-w-0 shrink' : 'shrink-0'}`}
              key={segment.fullPath}
            >
              {index > 0 && (
                <ChevronRight
                  size={12}
                  className="shrink-0 text-xp-text-muted opacity-60"
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                className="wisp-breadcrumb"
                aria-current={current ? 'location' : undefined}
                aria-label={t('navigation.navigateTo', { name: segment.name })}
                title={segment.fullPath}
                data-drop-target={current ? undefined : segment.fullPath}
                data-is-folder={current ? undefined : 'true'}
                onClick={(event) => {
                  event.stopPropagation();
                  navigateToPath?.(segment.fullPath);
                }}
              >
                <SegmentLabel segment={segment} root={index === 0} />
              </button>
            </span>
          );
        })}
        {/* 网页标签：分享/在浏览器打开 落在面包屑尾端（用户定稿） */}
        {/^https?:\/\//i.test(currentPath) && (
          <a
            href={currentPath}
            target="_blank"
            rel="noopener noreferrer"
            className="wisp-control-icon shrink-0 text-xp-text-secondary"
            aria-label={t('navigation.openInBrowser')}
            title={t('navigation.openInBrowser')}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void TauriAPI.openUrl(currentPath);
            }}
          >
            <ExternalLink size={13} />
          </a>
        )}
      </div>
      {open && start > 0 && (
        <AnchoredMenu
          anchorRef={triggerRef}
          menuRef={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('navigation.showParentFolders', { defaultValue: 'Show parent folders' })}
          className="wisp-breadcrumb-menu wisp-popover-menu min-w-48 rounded-xl border border-xp-border bg-xp-popover p-1"
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
              return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
            );
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            let next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = items.length - 1;
            items[next]?.focus();
          }}
        >
          {segments.slice(0, start).map((segment) => (
            <button
              key={segment.fullPath}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="flex w-full min-w-0 rounded-lg px-3 py-2 text-left text-sm text-xp-text hover:bg-xp-surface-light focus:bg-xp-selection-bg focus:outline-none"
              title={segment.fullPath}
              data-drop-target={segment.fullPath}
              data-is-folder="true"
              onClick={() => {
                close();
                navigateToPath?.(segment.fullPath);
              }}
            >
              <span className="truncate">{segment.name}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="mt-1 flex w-full rounded-lg border-t border-xp-border px-3 py-2 text-left text-sm text-xp-text-secondary focus:bg-xp-selection-bg focus:outline-none"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            {t('navigation.showFullPath')}
          </button>
        </AnchoredMenu>
      )}
    </nav>
  );
}
