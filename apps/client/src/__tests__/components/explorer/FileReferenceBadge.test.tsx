import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FileReferenceBadge } from '@/components/explorer/FileReferenceBadge';
import type { FileEntry } from '@/lib/tauri-api';

const baseFile: FileEntry = {
  name: 'document.txt',
  path: '/tmp/document.txt',
  is_dir: false,
  size: 1,
  modified: 0,
  file_type: 'text',
  is_readonly: false,
};

describe('FileReferenceBadge', () => {
  it('does not mark a regular file', () => {
    render(
      <FileReferenceBadge file={baseFile}>
        <span>file</span>
      </FileReferenceBadge>,
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('marks a symbolic link with the link icon', () => {
    render(
      <FileReferenceBadge
        file={{ ...baseFile, is_symlink: true, symlink_target: '../original.txt' }}
      >
        <span>file</span>
      </FileReferenceBadge>,
    );

    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'symlinkTo');
    expect(screen.getByTestId('icon-Link2')).toBeInTheDocument();
  });

  it('marks a Finder alias with a different icon', () => {
    render(
      <FileReferenceBadge file={{ ...baseFile, is_alias: true }}>
        <span>file</span>
      </FileReferenceBadge>,
    );

    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'alias');
    expect(screen.getByTestId('icon-CornerUpRight')).toBeInTheDocument();
  });
});
