import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface MarketplacePaginationProps {
  pagination: PaginationInfo;
  isLoading: boolean;
  onPageChange: (page: number) => void;
}

const MarketplacePagination = React.memo(
  ({ pagination, isLoading, onPageChange }: MarketplacePaginationProps) => {
    if (pagination.totalPages <= 1) return null;

    return (
      <div className="flex items-center justify-between border-t border-xp-border px-3 py-2">
        <button
          onClick={() => onPageChange(pagination.page - 1)}
          disabled={pagination.page <= 1 || isLoading}
          className="flex items-center gap-1 rounded border border-xp-border bg-xp-surface px-2 py-1 text-xs text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3 w-3" />
          Previous
        </button>
        <span className="text-xs text-xp-text-muted">
          Page {pagination.page} of {pagination.totalPages}
        </span>
        <button
          onClick={() => onPageChange(pagination.page + 1)}
          disabled={pagination.page >= pagination.totalPages || isLoading}
          className="flex items-center gap-1 rounded border border-xp-border bg-xp-surface px-2 py-1 text-xs text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    );
  },
);

export default MarketplacePagination;
