import { useTranslation } from 'react-i18next';
import React, { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { usePerformanceStats } from '@/hooks/use-performance-stats';
import {
  sectionHeaderStyle,
  type PerformanceDashboardProps,
} from './performance-dashboard-helpers';
import MetricCards from './performance/MetricCards';
import OrganizerTabContent from './performance/PerformanceCharts';

// ── Main component ────────────────────────────────────────────────────────────

const PerformanceDashboard = React.memo(
  ({ currentPath, allFiles, navigateToPath }: PerformanceDashboardProps) => {
    const { t } = useTranslation();
    const [metricsExpanded, setMetricsExpanded] = useState(true);
    const [organizerExpanded, setOrganizerExpanded] = useState(true);

    const { recentOps, suggestions, isLoading, refreshStats } = usePerformanceStats(
      currentPath,
      allFiles,
      true,
    );

    const handleCollapseAll = useCallback(() => {
      setMetricsExpanded(false);
      setOrganizerExpanded(false);
    }, []);

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: '1 1 0%',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Single scrollable container for both sections */}
        <div
          style={{
            overflowY: 'auto',
            overflowX: 'hidden',
            flex: '1 1 0%',
            minHeight: 0,
          }}
        >
          {/* Performance Metrics Section */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={() => setMetricsExpanded((v) => !v)}
                className="hover:bg-xp-surface-light"
                style={sectionHeaderStyle}
              >
                {metricsExpanded ? (
                  <ChevronDown size={14} style={{ flexShrink: 0 }} />
                ) : (
                  <ChevronRight size={14} style={{ flexShrink: 0 }} />
                )}
                {t('performanceDashboard.title')}
              </button>
              <button
                onClick={handleCollapseAll}
                style={{
                  fontSize: 10,
                  color: 'var(--xp-text-secondary)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  opacity: 0.7,
                  transition: 'opacity 0.15s',
                }}
                title={t('performanceDashboard.collapseAll')}
              >
                {t('performanceDashboard.collapseAll')}
              </button>
            </div>

            {metricsExpanded && (
              <MetricCards
                recentOps={recentOps}
                suggestions={suggestions}
                allFiles={allFiles}
                isLoading={isLoading}
                onRefresh={refreshStats}
              />
            )}
          </div>

          {/* File Organizer Section */}
          <div>
            <button
              onClick={() => setOrganizerExpanded((v) => !v)}
              className="hover:bg-xp-surface-light"
              style={sectionHeaderStyle}
            >
              {organizerExpanded ? (
                <ChevronDown size={14} style={{ flexShrink: 0 }} />
              ) : (
                <ChevronRight size={14} style={{ flexShrink: 0 }} />
              )}
              {t('performanceDashboard.fileOrganizer')}
            </button>

            {organizerExpanded && (
              <OrganizerTabContent currentPath={currentPath} navigateToPath={navigateToPath} />
            )}
          </div>
        </div>
      </div>
    );
  },
);
PerformanceDashboard.displayName = 'PerformanceDashboard';

export default PerformanceDashboard;
