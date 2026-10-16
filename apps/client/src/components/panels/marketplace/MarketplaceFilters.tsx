import { useTranslation } from 'react-i18next';
import React from 'react';

type SortOption = 'popular' | 'recent' | 'rating';
interface MarketplaceFiltersProps {
  categories: Array<{ id: string; name: string; slug: string }>;
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  sortBy: SortOption;
  setSortBy: (sort: SortOption) => void;
  pagination: { total: number };
}
const MarketplaceFilters = React.memo(
  ({
    categories,
    selectedCategory,
    setSelectedCategory,
    sortBy,
    setSortBy,
    pagination,
  }: MarketplaceFiltersProps) => {
    const { t } = useTranslation();
    return (
      <div className="space-y-3 border-b border-xp-border px-4 py-3">
        {categories.length > 0 && (
          <div
            className="flex flex-wrap gap-1.5"
            aria-label={t('panelActions.extensionCategories')}
          >
            {[
              { slug: '', name: t('eventsPanel.filterAll') },
              ...categories.filter((category) => category.slug !== 'all'),
            ].map((category) => (
              <button
                key={category.slug}
                aria-pressed={selectedCategory === category.slug}
                onClick={() => setSelectedCategory(category.slug)}
                className={`min-h-8 rounded-md px-2.5 py-1 text-xs transition-colors ${selectedCategory === category.slug ? 'bg-[var(--ds-accent)] text-white' : 'bg-[var(--ds-fill)] text-xp-text-secondary hover:bg-[var(--ds-hover)]'}`}
              >
                {category.slug
                  ? t(`panelActions.category.${category.slug}`, { defaultValue: category.name })
                  : category.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-xp-text-secondary">
            {t('counts.extensions', { count: pagination.total })}
          </span>
          <label className="flex items-center gap-2 text-xs text-xp-text-secondary">
            {t('interface.sortLabel')}
            <select
              className="rounded-md border border-xp-border px-2 text-xp-text"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortOption)}
            >
              {(['popular', 'recent', 'rating'] as const).map((sort) => (
                <option key={sort} value={sort}>
                  {t(`panelActions.sort.${sort}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    );
  },
);
export default MarketplaceFilters;
