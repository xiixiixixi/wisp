import React, { useState, useEffect } from 'react';
import i18n from '@/i18n';
import { convertAssetUrl } from '@/lib/transport';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { FileIcon, X, Clock, Hash, Scale, AlertTriangle } from 'lucide-react';
import {
  FileComparison,
  type FileComparisonResult,
  type ComparisonOptions,
} from '@/lib/file-comparison';
import { formatFileSize } from '@/lib/utils';

interface FileComparisonDialogProps {
  isOpen: boolean;
  onClose: () => void;
  file1Path: string;
  file2Path: string;
  onError?: (error: string) => void;
}

const FileComparisonDialog = ({
  isOpen,
  onClose,
  file1Path,
  file2Path,
  onError,
}: FileComparisonDialogProps) => {
  const [comparisonResult, setComparisonResult] = useState<FileComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState('summary');

  useEffect(() => {
    if (isOpen && file1Path && file2Path) {
      performComparison();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, file1Path, file2Path]);

  const performComparison = async () => {
    setLoading(true);
    try {
      const options: ComparisonOptions = {
        ignoreWhitespace: false,
        ignoreCase: false,
        ignoreLineEndings: false,
        contextLines: 3,
        algorithm: 'myers',
        maxFileSize: 50 * 1024 * 1024, // 50MB
        binaryThreshold: 0.3,
      };

      const result = await FileComparison.compareFiles(file1Path, file2Path, options);
      setComparisonResult(result);
      setSelectedTab(
        result.comparisonType === 'image' || result.comparisonType === 'video'
          ? 'side-by-side'
          : 'summary',
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : i18n.t('dialogs.fileComparison.failed');
      onError?.(errorMessage);
      console.error('File comparison error:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const renderSummaryTab = () => {
    if (!comparisonResult) return null;

    const { file1, file2, identical, similarity, comparisonType, metadata } = comparisonResult;

    return (
      <div className="space-y-6">
        {/* Status Banner */}
        <div
          className={`rounded-[2px] border p-4 ${identical ? 'border-xp-green/30 bg-xp-green/10' : 'border-xp-orange/30 bg-xp-orange/10'}`}
        >
          <div className="flex items-center gap-2">
            {identical ? (
              <Badge variant="success" className="gap-2">
                <Scale className="h-4 w-4" />
                Files are identical
              </Badge>
            ) : (
              <Badge variant="warning" className="gap-2">
                <AlertTriangle className="h-4 w-4" />
                Files differ
              </Badge>
            )}
            <Badge variant="outline" className="ml-2">
              {(similarity * 100).toFixed(1)}% similar
            </Badge>
            <Badge variant="outline">{comparisonType} comparison</Badge>
          </div>
        </div>

        {/* File Information */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-xp-text-secondary">File 1</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <FileIcon className="h-4 w-4 text-xp-blue" />
                <span className="truncate font-mono" title={file1.path}>
                  {file1.name}
                </span>
              </div>
              <div className="text-xp-text-secondary">Size: {formatFileSize(file1.size)}</div>
              <div className="text-xp-text-secondary">Modified: {formatDate(file1.modified)}</div>
              {file1.hash && (
                <div className="flex items-center gap-2 text-xp-text-secondary">
                  <Hash className="h-3 w-3" />
                  <span className="truncate font-mono text-xs">{file1.hash}</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-xp-text-secondary">File 2</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <FileIcon className="h-4 w-4 text-xp-green" />
                <span className="truncate font-mono" title={file2.path}>
                  {file2.name}
                </span>
              </div>
              <div className="text-xp-text-secondary">Size: {formatFileSize(file2.size)}</div>
              <div className="text-xp-text-secondary">Modified: {formatDate(file2.modified)}</div>
              {file2.hash && (
                <div className="flex items-center gap-2 text-xp-text-secondary">
                  <Hash className="h-3 w-3" />
                  <span className="truncate font-mono text-xs">{file2.hash}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <Separator />

        {/* Statistics */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-[2px] bg-xp-surface-light p-3 text-center">
            <div className="text-lg font-medium text-xp-green">{metadata.linesAdded}</div>
            <div className="text-xs text-xp-text-secondary">Lines Added</div>
          </div>
          <div className="rounded-[2px] bg-xp-surface-light p-3 text-center">
            <div className="text-lg font-medium text-xp-red">{metadata.linesRemoved}</div>
            <div className="text-xs text-xp-text-secondary">Lines Removed</div>
          </div>
          <div className="rounded-[2px] bg-xp-surface-light p-3 text-center">
            <div className="text-lg font-medium text-xp-orange">{metadata.linesModified}</div>
            <div className="text-xs text-xp-text-secondary">Lines Modified</div>
          </div>
          <div className="rounded-[2px] bg-xp-surface-light p-3 text-center">
            <div className="text-lg font-medium text-xp-blue">
              {formatFileSize(metadata.bytesDifferent)}
            </div>
            <div className="text-xs text-xp-text-secondary">Bytes Different</div>
          </div>
        </div>

        {/* Processing Info */}
        <div className="flex items-center gap-4 text-xs text-xp-text-muted">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Processed in {metadata.processingTime}ms
          </div>
          <div>Algorithm: {metadata.algorithm}</div>
          <div>
            Total lines: {metadata.totalLines1} / {metadata.totalLines2}
          </div>
        </div>
      </div>
    );
  };

  const renderDifferencesTab = () => {
    if (!comparisonResult || comparisonResult.differences.length === 0) {
      return (
        <div className="py-8 text-center text-xp-text-muted">
          <Scale className="mx-auto mb-4 h-12 w-12 text-xp-text-secondary" />
          <div className="text-lg font-medium">No differences found</div>
          <div className="text-sm">The files are identical</div>
        </div>
      );
    }

    return (
      <ScrollArea className="h-96">
        <div className="space-y-3">
          {comparisonResult.differences.map((diff, index) => (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              className={(() => {
                const base = 'rounded-[2px] border-l-4 p-4';
                if (diff.diffType === 'added') return `${base} border-xp-green bg-xp-green/10`;
                if (diff.diffType === 'removed') return `${base} border-xp-red bg-xp-red/10`;
                if (diff.diffType === 'modified') return `${base} border-xp-orange bg-xp-orange/10`;
                return `${base} border-xp-blue bg-xp-blue/10`;
              })()}
            >
              <div className="mb-2 flex items-center gap-2">
                <Badge
                  variant={
                    // eslint-disable-next-line no-nested-ternary
                    diff.diffType === 'added'
                      ? 'success'
                      : diff.diffType === 'removed'
                        ? 'destructive'
                        : 'secondary'
                  }
                  className="text-xs"
                >
                  {diff.diffType}
                </Badge>
                {diff.line1 && (
                  <span className="text-xs text-xp-text-secondary">Line {diff.line1}</span>
                )}
                {diff.line2 && (
                  <span className="text-xs text-xp-text-secondary">→ Line {diff.line2}</span>
                )}
                <Badge variant="outline" className="text-xs">
                  {diff.severity}
                </Badge>
              </div>

              <div className="space-y-2 font-mono text-sm">
                {diff.content1 && (
                  <div className="rounded-[2px] border-l-2 border-xp-red/60 bg-xp-red/10 p-2">
                    <span className="text-xp-red">- {diff.content1}</span>
                  </div>
                )}
                {diff.content2 && (
                  <div className="rounded-[2px] border-l-2 border-xp-green/60 bg-xp-green/10 p-2">
                    <span className="text-xp-green">+ {diff.content2}</span>
                  </div>
                )}
              </div>

              {diff.context && diff.context.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-xp-text-secondary hover:text-xp-text">
                    Show context ({diff.context.length} lines)
                  </summary>
                  <div className="mt-2 rounded-[2px] bg-xp-surface-light p-2 font-mono text-xs">
                    {diff.context.map((line, idx) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <div key={idx} className="text-xp-text-secondary">
                        {line}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  };

  const renderSideBySideTab = () => {
    if (!comparisonResult) return null;
    const { file1, file2, comparisonType } = comparisonResult;

    if (comparisonType === 'image') {
      return (
        <div className="grid h-96 grid-cols-2 gap-4">
          {[file1, file2].map((file, i) => (
            <div key={file.path} className="flex flex-col overflow-hidden rounded-[2px] border">
              <div className="shrink-0 border-b bg-xp-surface-light p-2">
                <h3
                  className="flex items-center gap-2 truncate text-sm font-medium"
                  title={file.path}
                >
                  <FileIcon className={`h-4 w-4 ${i === 0 ? 'text-xp-blue' : 'text-xp-green'}`} />
                  {file.name}
                  <span className="ml-auto text-xs text-xp-text-muted">
                    {formatFileSize(file.size)}
                  </span>
                </h3>
              </div>
              <div className="flex flex-1 items-center justify-center overflow-auto bg-xp-surface p-4">
                <img
                  src={convertAssetUrl(file.path)}
                  alt={file.name}
                  className="max-h-full max-w-full rounded-[2px] object-contain"
                  draggable={false}
                />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (comparisonType === 'video') {
      return (
        <div className="grid h-96 grid-cols-2 gap-4">
          {[file1, file2].map((file, i) => (
            <div key={file.path} className="flex flex-col overflow-hidden rounded-[2px] border">
              <div className="shrink-0 border-b bg-xp-surface-light p-2">
                <h3
                  className="flex items-center gap-2 truncate text-sm font-medium"
                  title={file.path}
                >
                  <FileIcon className={`h-4 w-4 ${i === 0 ? 'text-xp-blue' : 'text-xp-green'}`} />
                  {file.name}
                  <span className="ml-auto text-xs text-xp-text-muted">
                    {formatFileSize(file.size)}
                  </span>
                </h3>
              </div>
              <div className="flex flex-1 items-center justify-center overflow-auto bg-xp-surface p-4">
                <video
                  src={convertAssetUrl(file.path)}
                  controls
                  className="max-h-full max-w-full rounded-[2px]"
                />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (comparisonType !== 'text') {
      return (
        <div className="py-8 text-center text-xp-text-muted">
          <FileIcon className="mx-auto mb-4 h-12 w-12 text-xp-text-secondary" />
          <div className="text-lg font-medium">Side-by-side view not available</div>
          <div className="text-sm">
            This view is only available for text, image, and video files
          </div>
        </div>
      );
    }

    const lines1 = file1.lines || [];
    const lines2 = file2.lines || [];

    return (
      <div className="grid h-96 grid-cols-2 gap-4">
        <div className="rounded-[2px] border">
          <div className="border-b bg-xp-surface-light p-2">
            <h3 className="truncate text-sm font-medium" title={file1.path}>
              {file1.name}
            </h3>
          </div>
          <ScrollArea className="h-80">
            <div className="p-2 font-mono text-xs">
              {lines1.map((line, idx) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={idx} className="flex">
                  <span className="w-8 select-none text-xp-text-muted">{idx + 1}</span>
                  <span className="pl-2">{line}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="rounded-[2px] border">
          <div className="border-b bg-xp-surface-light p-2">
            <h3 className="truncate text-sm font-medium" title={file2.path}>
              {file2.name}
            </h3>
          </div>
          <ScrollArea className="h-80">
            <div className="p-2 font-mono text-xs">
              {lines2.map((line, idx) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={idx} className="flex">
                  <span className="w-8 select-none text-xp-text-muted">{idx + 1}</span>
                  <span className="pl-2">{line}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-6xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              File Comparison
            </DialogTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {/* eslint-disable-next-line no-nested-ternary */}
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-xp-text-muted" />
                <div className="text-sm text-xp-text-secondary">Comparing files...</div>
              </div>
            </div>
          ) : comparisonResult ? (
            <Tabs value={selectedTab} onValueChange={setSelectedTab} className="h-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="differences">
                  Differences ({comparisonResult.differences.length})
                </TabsTrigger>
                <TabsTrigger value="side-by-side">Side by Side</TabsTrigger>
              </TabsList>

              <div className="mt-4 h-full">
                <TabsContent value="summary" className="mt-0 h-full">
                  {renderSummaryTab()}
                </TabsContent>
                <TabsContent value="differences" className="mt-0 h-full">
                  {renderDifferencesTab()}
                </TabsContent>
                <TabsContent value="side-by-side" className="mt-0 h-full">
                  {renderSideBySideTab()}
                </TabsContent>
              </div>
            </Tabs>
          ) : (
            <div className="py-8 text-center text-xp-text-muted">
              <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-xp-text-secondary" />
              <div className="text-lg font-medium">Comparison failed</div>
              <div className="text-sm">Unable to compare the selected files</div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {comparisonResult && (
            <Button onClick={performComparison} disabled={loading}>
              Refresh Comparison
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FileComparisonDialog;
