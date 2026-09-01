import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type OrganizationAnalysis, type OrganizationPlan } from '@/lib/tauri-api';
import { formatFileSize } from '@/lib/utils';
import { FolderClosed } from 'lucide-react';
import {
  cardStyle,
  smallBtnStyle,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  OrganizerSectionHeader,
  OrganizerSuggestionItem,
} from '../performance-dashboard-helpers';

// ── Organizer Tab Content ────────────────────────────────────────────────────

interface OrganizerTabContentProps {
  currentPath: string;
  navigateToPath?: (path: string) => void;
}

const OrganizerTabContent = React.memo(
  ({ currentPath, navigateToPath }: OrganizerTabContentProps) => {
    const { t } = useTranslation();
    const [analysis, setAnalysis] = useState<OrganizationAnalysis | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
    const [preview, setPreview] = useState<OrganizationPlan | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const [organizing, setOrganizing] = useState(false);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
    const [lastAnalyzedPath, setLastAnalyzedPath] = useState<string>('');

    const analyze = useCallback(async () => {
      if (!currentPath) return;
      setLoading(true);
      setError(null);
      setPreview(null);
      setShowPreview(false);
      setSelectedSuggestions(new Set());
      try {
        const result = await TauriAPI.analyzeDirectory(currentPath);
        setAnalysis(result);
        setLastAnalyzedPath(currentPath);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }, [currentPath]);

    // Auto-analyze when path changes
    useEffect(() => {
      if (currentPath && currentPath !== lastAnalyzedPath) {
        analyze();
      }
    }, [currentPath, lastAnalyzedPath, analyze]);

    const toggleSection = (section: string) => {
      setCollapsedSections((prev) => {
        const next = new Set(prev);
        if (next.has(section)) next.delete(section);
        else next.add(section);
        return next;
      });
    };

    const toggleSuggestion = (idx: number) => {
      setSelectedSuggestions((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
    };

    const handlePreview = async () => {
      if (selectedSuggestions.size === 0) return;
      try {
        const indices = Array.from(selectedSuggestions);
        const plan = await TauriAPI.previewOrganization(currentPath, indices);
        setPreview(plan);
        setShowPreview(true);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    const handleOrganize = async () => {
      if (!preview) return;
      setOrganizing(true);
      try {
        const count = await TauriAPI.executeOrganization(preview);
        setShowPreview(false);
        setPreview(null);
        await analyze();
        setError(null);
        window.dispatchEvent(new CustomEvent('files-changed'));
        alert(`Successfully organized ${count} file${count !== 1 ? 's' : ''}!`);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setOrganizing(false);
      }
    };

    const truncatePath = (path: string) => {
      const name = path.split(/[\\/]/).pop() || path;
      return name.length > 30 ? `${name.substring(0, 27)}...` : name;
    };

    return (
      <div
        style={{
          padding: '10px 12px',
          overflowY: 'auto',
          overflowX: 'hidden',
          flex: '1 1 0%',
          minHeight: 0,
        }}
      >
        {/* Header with analyze button */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--xp-text)' }}>
            {t('performanceDashboard.fileOrganizer')}
          </span>
          <button
            onClick={analyze}
            disabled={loading}
            style={{
              ...smallBtnStyle,
              opacity: loading ? 0.5 : 1,
              background: '#6a6f8a',
              color: '#fff',
              border: 'none',
            }}
          >
            {loading ? t('organizer.analyzing') : t('organizer.analyze')}
          </button>
        </div>

        {error && (
          <div
            style={{
              ...cardStyle,
              background: 'rgb(var(--xp-red-rgb) / 0.08)',
              borderColor: 'rgb(var(--xp-red-rgb) / 0.3)',
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--xp-red)' }}>{error}</span>
          </div>
        )}

        {loading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px 0',
              color: 'var(--xp-text-secondary)',
              fontSize: 12,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              style={{ marginRight: 8, animation: 'spin 1s linear infinite' }}
            >
              <circle
                opacity="0.25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                opacity="0.75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            {t('organizer.scanning')}
          </div>
        )}

        {!loading && analysis && (
          <>
            {/* Categories Section */}
            <CategoriesSection
              analysis={analysis}
              expandedCategory={expandedCategory}
              setExpandedCategory={setExpandedCategory}
              collapsedSections={collapsedSections}
              toggleSection={toggleSection}
            />

            {/* Project Notice */}
            {analysis.is_project && (
              <ProjectNotice projectType={analysis.project_type ?? undefined} />
            )}

            {/* Smart Suggestions Section */}
            <SuggestionsSection
              analysis={analysis}
              selectedSuggestions={selectedSuggestions}
              collapsedSections={collapsedSections}
              toggleSection={toggleSection}
              toggleSuggestion={toggleSuggestion}
              handlePreview={handlePreview}
              handleOrganize={handleOrganize}
              organizing={organizing}
              showPreview={showPreview}
              preview={preview}
              setShowPreview={setShowPreview}
              setPreview={setPreview}
              truncatePath={truncatePath}
            />

            {/* Duplicate Cleanup Section */}
            <DuplicatesSection
              analysis={analysis}
              collapsedSections={collapsedSections}
              toggleSection={toggleSection}
              navigateToPath={navigateToPath}
            />

            {/* Insights Section */}
            <InsightsSection
              analysis={analysis}
              collapsedSections={collapsedSections}
              toggleSection={toggleSection}
              navigateToPath={navigateToPath}
            />
          </>
        )}

        {!loading && !analysis && !error && (
          <div
            style={{
              textAlign: 'center',
              padding: '32px 0',
              color: 'var(--xp-text-secondary)',
              fontSize: 12,
            }}
          >
            {t('organizer.clickAnalyze')}
          </div>
        )}
      </div>
    );
  },
);
OrganizerTabContent.displayName = 'OrganizerTabContent';

export default OrganizerTabContent;

// ── Sub-sections ─────────────────────────────────────────────────────────────

const CategoriesSection = ({
  analysis,
  expandedCategory,
  setExpandedCategory,
  collapsedSections,
  toggleSection,
}: {
  analysis: OrganizationAnalysis;
  expandedCategory: string | null;
  setExpandedCategory: (c: string | null) => void;
  collapsedSections: Set<string>;
  toggleSection: (s: string) => void;
}) => {
  const { t } = useTranslation();
  return (
    <>
      <OrganizerSectionHeader
        title={t('organizer.categories')}
        collapsed={collapsedSections.has('categories')}
        onToggle={() => toggleSection('categories')}
      />
      {!collapsedSections.has('categories') && (
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              marginBottom: 8,
            }}
          >
            {analysis.categories.map((cat) => (
              <button
                key={cat.name}
                onClick={() => setExpandedCategory(expandedCategory === cat.name ? null : cat.name)}
                style={{
                  ...cardStyle,
                  marginBottom: 0,
                  padding: '8px 10px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderColor: expandedCategory === cat.name ? '#6a6f8a' : 'var(--xp-border)',
                  background:
                    expandedCategory === cat.name
                      ? 'rgb(var(--xp-blue-rgb) / 0.08)'
                      : 'var(--xp-surface-light)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center' }}>
                    {CATEGORY_ICONS[cat.name] || (
                      <FolderClosed size={14} className="inline-block" />
                    )}
                  </span>
                  <span
                    style={{
                      fontWeight: 500,
                      fontSize: 12,
                      color: CATEGORY_COLORS[cat.name] || 'var(--xp-text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t(`organizer.categoryNames.${cat.name}`, { defaultValue: cat.name })}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--xp-text-secondary)' }}>
                  {t('performanceDashboard.filesUnit', { count: cat.file_count })} &middot;{' '}
                  {formatFileSize(cat.total_size)}
                </div>
              </button>
            ))}
          </div>

          {/* Expanded category file list */}
          {expandedCategory &&
            (() => {
              const cat = analysis.categories.find((c) => c.name === expandedCategory);
              if (!cat) return null;
              return (
                <div
                  style={{
                    ...cardStyle,
                    marginBottom: 8,
                    borderColor: '#6a6f8a',
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      marginBottom: 4,
                      color: CATEGORY_COLORS[cat.name] || 'var(--xp-text-secondary)',
                    }}
                  >
                    {t(`organizer.categoryNames.${cat.name}`, { defaultValue: cat.name })} (
                    {cat.extensions.join(', ')})
                  </div>
                  <div style={{ maxHeight: 128, overflowY: 'auto' }}>
                    {cat.example_files.map((file, i) => (
                      <div
                        // eslint-disable-next-line react/no-array-index-key
                        key={i}
                        style={{
                          fontSize: 11,
                          color: 'var(--xp-text-secondary)',
                          padding: '2px 0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {file}
                      </div>
                    ))}
                    {cat.file_count > 5 && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--xp-text-secondary)',
                          fontStyle: 'italic',
                          marginTop: 4,
                        }}
                      >
                        ...and {cat.file_count - 5} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
        </div>
      )}
    </>
  );
};
const ProjectNotice = ({ projectType }: { projectType?: string }) => {
  const { t } = useTranslation();
  return (
    <div
      style={{
        ...cardStyle,
        marginBottom: 16,
        background: 'rgb(var(--xp-blue-rgb) / 0.08)',
        borderColor: 'rgb(var(--xp-blue-rgb) / 0.3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="#6a6f8a">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
            clipRule="evenodd"
          />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--xp-blue)' }}>
          {t('organizer.projectNotice', {
            type: t(`organizer.categoryNames.${projectType || 'Software'}`, {
              defaultValue: projectType || 'Software',
            }),
          })}
        </span>
      </div>
      <p style={{ fontSize: 11, color: 'var(--xp-text-secondary)', lineHeight: 1.5 }}>
        This is a project directory. File organization is skipped to avoid breaking the project
        structure.
      </p>
    </div>
  );
};
const SuggestionsSection = ({
  analysis,
  selectedSuggestions,
  collapsedSections,
  toggleSection,
  toggleSuggestion,
  handlePreview,
  handleOrganize,
  organizing,
  showPreview,
  preview,
  setShowPreview,
  setPreview,
  truncatePath,
}: {
  analysis: OrganizationAnalysis;
  selectedSuggestions: Set<number>;
  collapsedSections: Set<string>;
  toggleSection: (s: string) => void;
  toggleSuggestion: (idx: number) => void;
  handlePreview: () => Promise<void>;
  handleOrganize: () => Promise<void>;
  organizing: boolean;
  showPreview: boolean;
  preview: OrganizationPlan | null;
  setShowPreview: (v: boolean) => void;
  setPreview: (v: OrganizationPlan | null) => void;
  truncatePath: (p: string) => string;
}) => {
  const { t } = useTranslation();
  return (
    <>
      <OrganizerSectionHeader
        title={t('organizer.smartSuggestions', { count: analysis.suggestions.length })}
        collapsed={collapsedSections.has('suggestions')}
        onToggle={() => toggleSection('suggestions')}
      />
      {!collapsedSections.has('suggestions') && (
        <div style={{ marginBottom: 16 }}>
          {analysis.suggestions.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--xp-text-secondary)', padding: '8px 0' }}>
              {analysis.is_project
                ? t('organizer.disabledForProjects')
                : t('organizer.noSuggestions')}
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 8 }}>
                {analysis.suggestions.map((suggestion, idx) => (
                  <OrganizerSuggestionItem
                    // eslint-disable-next-line react/no-array-index-key
                    key={idx}
                    suggestion={suggestion}
                    selected={selectedSuggestions.has(idx)}
                    onToggle={() => toggleSuggestion(idx)}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handlePreview}
                  disabled={selectedSuggestions.size === 0}
                  style={{
                    ...smallBtnStyle,
                    flex: 1,
                    textAlign: 'center',
                    opacity: selectedSuggestions.size === 0 ? 0.4 : 1,
                  }}
                >
                  Preview
                </button>
                <button
                  onClick={() => {
                    if (selectedSuggestions.size > 0 && preview) {
                      handleOrganize();
                    } else {
                      handlePreview().then(() => {});
                    }
                  }}
                  disabled={selectedSuggestions.size === 0 || organizing}
                  style={{
                    ...smallBtnStyle,
                    flex: 1,
                    textAlign: 'center',
                    background: '#6a6f8a',
                    color: '#fff',
                    border: 'none',
                    opacity: selectedSuggestions.size === 0 || organizing ? 0.4 : 1,
                  }}
                >
                  {organizing ? t('organizer.organizing') : t('organizer.organize')}
                </button>
              </div>

              {/* Preview panel */}
              {showPreview && preview && (
                <div
                  style={{
                    ...cardStyle,
                    marginTop: 8,
                    borderColor: 'rgb(var(--xp-blue-rgb) / 0.3)',
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      marginBottom: 4,
                      color: 'var(--xp-blue)',
                    }}
                  >
                    {t('organizer.previewMoves', { count: preview.moves.length })}
                  </div>
                  {preview.creates.length > 0 && (
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--xp-text-secondary)',
                        marginBottom: 4,
                      }}
                    >
                      Will create: {preview.creates.map((p) => truncatePath(p)).join(', ')}
                    </div>
                  )}
                  <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                    {preview.moves.map((move, i) => (
                      <div
                        // eslint-disable-next-line react/no-array-index-key
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          color: 'var(--xp-text-secondary)',
                          padding: '2px 0',
                        }}
                      >
                        <span
                          style={{
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {truncatePath(move.from)}
                        </span>
                        <span style={{ color: 'var(--xp-blue)', flexShrink: 0 }}>&rarr;</span>
                        <span
                          style={{
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'var(--xp-green)',
                          }}
                        >
                          {truncatePath(move.to)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => {
                        setShowPreview(false);
                        setPreview(null);
                      }}
                      style={{ ...smallBtnStyle, flex: 1, textAlign: 'center' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleOrganize}
                      disabled={organizing}
                      style={{
                        ...smallBtnStyle,
                        flex: 1,
                        textAlign: 'center',
                        background: 'var(--xp-green)',
                        color: '#000',
                        border: 'none',
                        opacity: organizing ? 0.4 : 1,
                      }}
                    >
                      {organizing ? t('organizer.moving') : t('organizer.confirm')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
};

const DuplicatesSection = ({
  analysis,
  collapsedSections,
  toggleSection,
  navigateToPath,
}: {
  analysis: OrganizationAnalysis;
  collapsedSections: Set<string>;
  toggleSection: (s: string) => void;
  navigateToPath?: (path: string) => void;
}) => {
  const { t } = useTranslation();
  return (
    <>
      <OrganizerSectionHeader
        title={t('organizer.duplicateCleanup')}
        collapsed={collapsedSections.has('duplicates')}
        onToggle={() => toggleSection('duplicates')}
      />
      {!collapsedSections.has('duplicates') && (
        <div style={{ marginBottom: 16 }}>
          {!analysis.duplicate_summary ? (
            <div style={{ fontSize: 12, color: 'var(--xp-text-secondary)', padding: '8px 0' }}>
              {t('organizer.noDuplicates')}
            </div>
          ) : (
            <>
              <div
                style={{
                  ...cardStyle,
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 12 }}>
                  <span style={{ color: 'var(--xp-red)', fontWeight: 500 }}>
                    {analysis.duplicate_summary.groups.length} group
                    {analysis.duplicate_summary.groups.length !== 1 ? 's' : ''}
                  </span>
                  <span style={{ color: 'var(--xp-text-secondary)' }}> &middot; </span>
                  <span style={{ color: 'var(--xp-yellow)', fontWeight: 500 }}>
                    {formatFileSize(analysis.duplicate_summary.total_wasted_space)} wasted
                  </span>
                </div>
              </div>
              {analysis.duplicate_summary.groups.map((group, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={i} style={{ ...cardStyle, marginBottom: 4 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: 'var(--xp-text)',
                      marginBottom: 4,
                    }}
                  >
                    {group.files.length} copies &middot; {formatFileSize(group.size)} each
                  </div>
                  <div style={{ maxHeight: 80, overflowY: 'auto' }}>
                    {group.files.map((file, j) => (
                      <div
                        // eslint-disable-next-line react/no-array-index-key
                        key={j}
                        onClick={() => {
                          const sep = file.path.includes('\\') ? '\\' : '/';
                          const parent = file.path.substring(0, file.path.lastIndexOf(sep));
                          if (parent && navigateToPath) navigateToPath(parent);
                        }}
                        title={file.path}
                        style={{
                          fontSize: 11,
                          color: 'var(--xp-text-secondary)',
                          padding: '2px 0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                        }}
                      >
                        {file.name}
                        {j === 0 && (
                          <span style={{ color: 'var(--xp-green)', marginLeft: 4 }}>
                            {t('organizer.newest')}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {analysis.duplicate_summary!.recommendations[i] && (
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--xp-yellow)',
                        marginTop: 4,
                        fontStyle: 'italic',
                      }}
                    >
                      {analysis.duplicate_summary!.recommendations[i].reason}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
};
const InsightsSection = ({
  analysis,
  collapsedSections,
  toggleSection,
  navigateToPath,
}: {
  analysis: OrganizationAnalysis;
  collapsedSections: Set<string>;
  toggleSection: (s: string) => void;
  navigateToPath?: (path: string) => void;
}) => {
  const { t } = useTranslation();
  return (
    <>
      <OrganizerSectionHeader
        title={t('organizer.insights')}
        collapsed={collapsedSections.has('insights')}
        onToggle={() => toggleSection('insights')}
      />
      {!collapsedSections.has('insights') && (
        <div style={{ marginBottom: 16 }}>
          {/* Stats cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8,
              marginBottom: 12,
            }}
          >
            {[
              { label: t('organizer.files'), value: analysis.insights.total_files.toString() },
              { label: t('organizer.size'), value: formatFileSize(analysis.insights.total_size) },
              { label: t('organizer.avg'), value: formatFileSize(analysis.insights.avg_file_size) },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  ...cardStyle,
                  marginBottom: 0,
                  textAlign: 'center',
                  padding: '8px 6px',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--xp-text)' }}>
                  {value}
                </div>
                <div style={{ fontSize: 11, color: 'var(--xp-text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Type distribution bar */}
          {analysis.insights.type_distribution.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--xp-text-secondary)', marginBottom: 4 }}>
                {t('organizer.typeDistribution')}
              </div>
              <div
                style={{
                  display: 'flex',
                  height: 16,
                  borderRadius: 4,
                  overflow: 'hidden',
                  background: 'var(--xp-surface-light)',
                }}
              >
                {analysis.insights.type_distribution.map((td) => {
                  const pct =
                    analysis.insights.total_files > 0
                      ? (td.count / analysis.insights.total_files) * 100
                      : 0;
                  if (pct < 1) return null;
                  return (
                    <div
                      key={td.category}
                      style={{
                        width: `${pct}%`,
                        backgroundColor: CATEGORY_COLORS[td.category] || 'var(--xp-text-muted)',
                        transition: 'width 0.3s ease',
                      }}
                      title={t('organizer.typeCount', {
                        name: t(`organizer.categoryNames.${td.category}`, {
                          defaultValue: td.category,
                        }),
                        count: td.count,
                        pct: pct.toFixed(1),
                      })}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', marginTop: 4 }}>
                {analysis.insights.type_distribution.map((td) => (
                  <div
                    key={td.category}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      color: 'var(--xp-text-secondary)',
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        display: 'inline-block',
                        backgroundColor: CATEGORY_COLORS[td.category] || 'var(--xp-text-muted)',
                      }}
                    />
                    {td.category} ({td.count})
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Largest files */}
          {analysis.insights.largest_files.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--xp-text-secondary)', marginBottom: 4 }}>
                {t('organizer.largestFiles')}
              </div>
              {analysis.insights.largest_files.map((file) => (
                <div
                  key={file.path}
                  onClick={() => {
                    const sep = file.path.includes('\\') ? '\\' : '/';
                    const parent = file.path.substring(0, file.path.lastIndexOf(sep));
                    if (parent && navigateToPath) navigateToPath(parent);
                  }}
                  title={file.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '2px 4px',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--xp-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      marginRight: 8,
                    }}
                  >
                    {file.name}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--xp-text-secondary)', flexShrink: 0 }}>
                    {formatFileSize(file.size)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Oldest files */}
          {analysis.insights.oldest_files.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--xp-text-secondary)', marginBottom: 4 }}>
                {t('organizer.oldestFiles')}
              </div>
              {analysis.insights.oldest_files.map((file) => (
                <div
                  key={file.path}
                  onClick={() => {
                    const sep = file.path.includes('\\') ? '\\' : '/';
                    const parent = file.path.substring(0, file.path.lastIndexOf(sep));
                    if (parent && navigateToPath) navigateToPath(parent);
                  }}
                  title={file.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '2px 4px',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--xp-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      marginRight: 8,
                    }}
                  >
                    {file.name}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--xp-text-secondary)', flexShrink: 0 }}>
                    {file.modified > 0
                      ? new Date(file.modified * 1000).toLocaleDateString()
                      : 'Unknown'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};
