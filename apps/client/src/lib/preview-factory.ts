import { FileEntry } from '@/lib/tauri-api';

// Preview types
export type PreviewType =
  | 'image'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'text'
  | 'code'
  | 'csv'
  | 'json'
  | 'markdown'
  | 'html'
  | 'video'
  | 'audio'
  | 'iwork'
  | 'epub'
  | 'font'
  | 'archive'
  | 'plist'
  | 'contact'
  | 'quicklook'
  | 'folder'
  | 'unknown';

// Preview capability interface
export interface PreviewCapability {
  type: PreviewType;
  extensions: string[];
  mimeTypes?: string[];
  maxSize?: number; // Maximum file size in bytes for preview
  priority: number; // Higher priority previews are preferred
  canPreview: (file: FileEntry) => boolean;
  getPreviewComponent: () => Promise<React.ComponentType<PreviewProps>>;
}

// Preview component props
export interface PreviewProps {
  file: FileEntry;
  onError?: (error: Error) => void;
  onLoad?: () => void;
}

// Preview factory configuration
export interface PreviewFactoryConfig {
  enabledTypes: PreviewType[];
  maxFileSize: number;
  enableFallback: boolean;
  customPreviews?: Map<string, PreviewCapability>;
}

// ─── Finder-parity extension lists ─────────────────────────────────────────
//
// The goal: every file Finder's Quick Look can preview, Wisp can too.
// WebKit natively decodes the common web raster/vector formats; formats only
// ImageIO understands (HEIC/HEIF, camera RAW, PSD, …) still register here and
// ImagePreview converts them through the Rust `sips` bridge on load failure.

// WebKit cannot decode these without the Rust conversion bridge, but Finder
// previews them, so they stay in the image list.
const IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
  'svg',
  'svgz',
  'ico',
  'tiff',
  'tif',
  'avif',
  'heic',
  'heif', // iPhone photos — WebKit ≥17 renders these; bridge covers older
  'psd',
  'psb', // Photoshop (flattened composite via ImageIO)
  'dng',
  'cr2',
  'cr3',
  'nef',
  'nrw',
  'arw',
  'srf',
  'sr2',
  'raf',
  'orf',
  'rw2',
  'raw',
  'pef',
  'ptx',
  'dcr',
  'rwl',
  'mrw',
  'kdc',
  'erf',
  'iiq',
  '3fr',
  'fff',
  'x3f', // camera RAW
  'pict',
  'pct',
  'exr',
  'hdr',
  'tga',
  'icns',
  'pbm',
  'pgm',
  'ppm',
  'pnm',
] as const;

const CODE_EXTENSIONS = [
  'js',
  'mjs',
  'cjs',
  'ts',
  'mts',
  'cts',
  'jsx',
  'tsx',
  'py',
  'java',
  'cpp',
  'cc',
  'c',
  'h',
  'hpp',
  'cs',
  'php',
  'rb',
  'go',
  'rs',
  'css',
  'scss',
  'less',
  'vue',
  'svelte',
  'sh',
  'bash',
  'zsh',
  'fish',
  'toml',
  'sql',
  'swift',
  'kt',
  'kts',
  'xml',
  'yml',
  'yaml',
  'diff',
  'patch',
  'bat',
  'cmd',
  'ps1',
  'pl',
  'lua',
  'scala',
  'dart',
  'r',
  'm',
  'mm',
  'gradle',
  'makefile',
] as const;

const CODE_FILENAMES = new Set([
  'makefile',
  'gnumakefile',
  'dockerfile',
  'containerfile',
  'gemfile',
  'rakefile',
  '.gitignore',
  '.gitattributes',
  '.gitconfig',
  '.editorconfig',
  '.env',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
]);

const isNamedCodeFile = (name: string): boolean => {
  const baseName = name.toLowerCase();
  return (
    CODE_FILENAMES.has(baseName) || /^(?:dockerfile|containerfile|\.env)\.[\w.-]+$/.test(baseName)
  );
};

const VIDEO_EXTENSIONS = [
  'mp4',
  'm4v',
  'mov',
  'webm',
  'mkv',
  'avi',
  'ogv',
  'mpg',
  'mpeg',
  'm1v',
  'm2v',
  'm4b',
  '3gp',
  '3g2',
] as const;

const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'ogg',
  'oga',
  'flac',
  'm4a',
  'm4b',
  'm4r',
  'aac',
  'wma',
  'opus',
  'aiff',
  'aif',
  'aifc',
  'caf',
  'mp2',
  'ac3',
] as const;

// iWork bundles embed a QuickLook/Preview.pdf the Rust side extracts so the
// native PDF viewer renders the exact document Finder shows.
const IWORK_EXTENSIONS = [
  'pages',
  'numbers',
  'key',
  'pagestemplate',
  'nmbtemplate',
  'kth',
] as const;

const FONT_EXTENSIONS = ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2', 'dfont'] as const;

const ARCHIVE_EXTENSIONS = ['zip', 'jar', 'apk', 'ipa', 'war', 'ear'] as const;

const PLIST_EXTENSIONS = ['plist', 'strings', 'mobileconfig'] as const;

const CONTACT_EXTENSIONS = ['vcf', 'vcard', 'ics', 'ical', 'icalendar'] as const;

// Formats with no dedicated web renderer: the Rust bridge asks Quick Look
// itself for a first-page thumbnail (ppt/pptx, USDZ, ICC, …).
const QUICKLOOK_EXTENSIONS = [
  'ppt',
  'pptx',
  'pps',
  'ppsx',
  'pot',
  'potx',
  'usdz',
  'usda',
  'usdc',
  'icc',
  'icm',
] as const;

const extOf = (file: FileEntry): string => file.name.split('.').pop()?.toLowerCase() || '';

const matchesExtensions = (file: FileEntry, exts: readonly string[]): boolean =>
  exts.includes(extOf(file));

// Default configuration
const DEFAULT_CONFIG: PreviewFactoryConfig = {
  enabledTypes: [
    'image',
    'pdf',
    'document',
    'spreadsheet',
    'text',
    'code',
    'csv',
    'json',
    'markdown',
    'html',
    'video',
    'audio',
    'iwork',
    'epub',
    'font',
    'archive',
    'plist',
    'contact',
    'quicklook',
  ],
  maxFileSize: 50 * 1024 * 1024, // 50MB — media types override with their own caps
  enableFallback: true,
  customPreviews: new Map(),
};

export class PreviewFactory {
  private config: PreviewFactoryConfig;
  private capabilities: Map<PreviewType, PreviewCapability>;
  /** True when the caller explicitly set maxFileSize, overriding per-type caps. */
  private maxFileSizeExplicit: boolean;

  constructor(config: Partial<PreviewFactoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.maxFileSizeExplicit = config.maxFileSize !== undefined;
    this.capabilities = new Map();
    this.initializeCapabilities();
  }

  private initializeCapabilities() {
    // Image previews (incl. HEIC/RAW/PSD via the ImageIO conversion bridge)
    this.capabilities.set('image', {
      type: 'image',
      extensions: [...IMAGE_EXTENSIONS],
      mimeTypes: ['image/'],
      maxSize: 200 * 1024 * 1024, // RAW files are huge; conversion handles scaling
      priority: 10,
      canPreview: (file) => this.canPreviewImage(file),
      getPreviewComponent: () =>
        import('@/components/previews/ImagePreview').then((m) => m.default),
    });

    // PDF previews
    this.capabilities.set('pdf', {
      type: 'pdf',
      extensions: ['pdf'],
      mimeTypes: ['application/pdf'],
      maxSize: 100 * 1024 * 1024, // 100MB
      priority: 10,
      canPreview: (file) => this.canPreviewPdf(file),
      getPreviewComponent: () => import('@/components/previews/PdfPreview').then((m) => m.default),
    });

    // Document previews (DOCX, DOC, RTF, ODT, webarchive — textutil → HTML bridge)
    this.capabilities.set('document', {
      type: 'document',
      extensions: ['docx', 'doc', 'rtf', 'rtfd', 'odt', 'webarchive'],
      mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      maxSize: 50 * 1024 * 1024, // 50MB
      priority: 9,
      canPreview: (file) => this.canPreviewDocument(file),
      getPreviewComponent: () =>
        import('@/components/previews/DocumentPreview').then((m) => m.default),
    });

    // Spreadsheet previews
    this.capabilities.set('spreadsheet', {
      type: 'spreadsheet',
      extensions: ['xlsx', 'xls', 'ods', 'csv'],
      mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      maxSize: 20 * 1024 * 1024, // 20MB
      priority: 9,
      canPreview: (file) => this.canPreviewSpreadsheet(file),
      getPreviewComponent: () =>
        import('@/components/previews/SpreadsheetPreview').then((m) => m.default),
    });

    // Text previews — CodeMirror-backed, virtualised so large files are fine
    this.capabilities.set('text', {
      type: 'text',
      extensions: ['txt', 'log', 'ini', 'cfg', 'conf'],
      mimeTypes: ['text/plain'],
      maxSize: 10 * 1024 * 1024, // 10MB
      priority: 8,
      canPreview: (file) => this.canPreviewText(file),
      getPreviewComponent: () => import('@/components/previews/TextPreview').then((m) => m.default),
    });

    // Code previews — CodeMirror 6 preview + edit, 100+ lazy languages
    this.capabilities.set('code', {
      type: 'code',
      extensions: [...CODE_EXTENSIONS],
      mimeTypes: ['text/', 'application/javascript', 'application/typescript'],
      maxSize: 10 * 1024 * 1024, // 10MB
      priority: 9,
      canPreview: (file) => this.canPreviewCode(file),
      getPreviewComponent: () => import('@/components/previews/CodePreview').then((m) => m.default),
    });

    // CSV previews
    this.capabilities.set('csv', {
      type: 'csv',
      extensions: ['csv', 'tsv'],
      mimeTypes: ['text/csv'],
      maxSize: 10 * 1024 * 1024, // 10MB
      priority: 10,
      canPreview: (file) => this.canPreviewCsv(file),
      getPreviewComponent: () => import('@/components/previews/CsvPreview').then((m) => m.default),
    });

    // JSON previews
    this.capabilities.set('json', {
      type: 'json',
      extensions: ['json', 'jsonl', 'ndjson', 'ipynb'],
      mimeTypes: ['application/json'],
      maxSize: 5 * 1024 * 1024, // 5MB
      priority: 9,
      canPreview: (file) => this.canPreviewJson(file),
      getPreviewComponent: () => import('@/components/previews/JsonPreview').then((m) => m.default),
    });

    // Markdown previews — rendered + editable source tabs
    this.capabilities.set('markdown', {
      type: 'markdown',
      extensions: ['md', 'markdown', 'mdown', 'mkd'],
      mimeTypes: ['text/markdown'],
      maxSize: 10 * 1024 * 1024, // 10MB
      priority: 10, // beats 'code', whose text/* mime would otherwise match .md first
      canPreview: (file) => this.canPreviewMarkdown(file),
      getPreviewComponent: () =>
        import('@/components/previews/MarkdownPreview').then((m) => m.default),
    });

    // HTML previews — sandboxed iframe render + editable source
    this.capabilities.set('html', {
      type: 'html',
      extensions: ['html', 'htm'],
      mimeTypes: ['text/html'],
      maxSize: 10 * 1024 * 1024, // 10MB
      priority: 10, // beats 'code' so .html files render instead of showing markup
      canPreview: (file) => this.canPreviewHtml(file),
      getPreviewComponent: () => import('@/components/previews/HtmlPreview').then((m) => m.default),
    });

    // Video previews (undecodable codecs fall back to a Quick Look poster)
    this.capabilities.set('video', {
      type: 'video',
      extensions: [...VIDEO_EXTENSIONS],
      mimeTypes: ['video/'],
      maxSize: 2 * 1024 * 1024 * 1024, // 2GB
      priority: 10,
      canPreview: (file) => this.canPreviewVideo(file),
      getPreviewComponent: () =>
        import('@/components/previews/VideoPreview').then((m) => m.default),
    });

    // Audio previews
    this.capabilities.set('audio', {
      type: 'audio',
      extensions: [...AUDIO_EXTENSIONS],
      mimeTypes: ['audio/'],
      maxSize: 500 * 1024 * 1024, // 500MB
      priority: 10,
      canPreview: (file) => this.canPreviewAudio(file),
      getPreviewComponent: () =>
        import('@/components/previews/AudioPreview').then((m) => m.default),
    });

    // iWork documents (Pages/Numbers/Keynote) — embedded QuickLook PDF
    this.capabilities.set('iwork', {
      type: 'iwork',
      extensions: [...IWORK_EXTENSIONS],
      maxSize: 200 * 1024 * 1024,
      priority: 10,
      canPreview: (file) => matchesExtensions(file, IWORK_EXTENSIONS),
      getPreviewComponent: () =>
        import('@/components/previews/IworkPreview').then((m) => m.default),
    });

    // EPUB books — unpacked by Rust, chapters rendered in a sandboxed iframe
    this.capabilities.set('epub', {
      type: 'epub',
      extensions: ['epub'],
      maxSize: 200 * 1024 * 1024,
      priority: 10,
      canPreview: (file) => extOf(file) === 'epub',
      getPreviewComponent: () => import('@/components/previews/EpubPreview').then((m) => m.default),
    });

    // Font specimens (TTF/OTF/TTC/WOFF…) — @font-face rendering
    this.capabilities.set('font', {
      type: 'font',
      extensions: [...FONT_EXTENSIONS],
      maxSize: 50 * 1024 * 1024,
      priority: 10,
      canPreview: (file) => matchesExtensions(file, FONT_EXTENSIONS),
      getPreviewComponent: () => import('@/components/previews/FontPreview').then((m) => m.default),
    });

    // Archive listings (zip family) — Finder shows the entry list
    this.capabilities.set('archive', {
      type: 'archive',
      extensions: [...ARCHIVE_EXTENSIONS],
      maxSize: 2 * 1024 * 1024 * 1024, // listing reads central directory only
      priority: 10,
      canPreview: (file) => matchesExtensions(file, ARCHIVE_EXTENSIONS),
      getPreviewComponent: () =>
        import('@/components/previews/ArchivePreview').then((m) => m.default),
    });

    // Property lists (XML and binary) and .strings via plutil
    this.capabilities.set('plist', {
      type: 'plist',
      extensions: [...PLIST_EXTENSIONS],
      maxSize: 20 * 1024 * 1024,
      priority: 10,
      canPreview: (file) => matchesExtensions(file, PLIST_EXTENSIONS),
      getPreviewComponent: () =>
        import('@/components/previews/PlistPreview').then((m) => m.default),
    });

    // Contact/calendar cards (vCard, iCalendar)
    this.capabilities.set('contact', {
      type: 'contact',
      extensions: [...CONTACT_EXTENSIONS],
      maxSize: 10 * 1024 * 1024,
      priority: 10,
      canPreview: (file) => matchesExtensions(file, CONTACT_EXTENSIONS),
      getPreviewComponent: () =>
        import('@/components/previews/ContactPreview').then((m) => m.default),
    });

    // Everything else Finder previews via a Quick Look generator: ask the
    // same engine for a first-page thumbnail (pptx, USDZ, ICC, …).
    this.capabilities.set('quicklook', {
      type: 'quicklook',
      extensions: [...QUICKLOOK_EXTENSIONS],
      maxSize: 500 * 1024 * 1024,
      priority: 10,
      canPreview: (file) => matchesExtensions(file, QUICKLOOK_EXTENSIONS),
      getPreviewComponent: () =>
        import('@/components/previews/QuickLookPreview').then((m) => m.default),
    });

    // Add custom previews from config
    if (this.config.customPreviews) {
      this.config.customPreviews.forEach((capability, _key) => {
        this.capabilities.set(capability.type, capability);
      });
    }
  }

  // Get file category/type
  public getFileType(file: FileEntry): PreviewType {
    if (file.is_dir) return 'folder';

    // Find the best matching capability
    let bestMatch: PreviewCapability | null = null;
    let highestPriority = -1;

    const capabilitiesArray = Array.from(this.capabilities.values());
    for (const capability of capabilitiesArray) {
      if (!this.config.enabledTypes.includes(capability.type)) continue;

      if (capability.canPreview(file)) {
        if (capability.priority > highestPriority) {
          highestPriority = capability.priority;
          bestMatch = capability;
        }
      }
    }

    return bestMatch?.type || 'unknown';
  }

  // Check if file can be previewed
  public canPreview(file: FileEntry): boolean {
    if (file.is_dir) return false;

    const fileType = this.getFileType(file);
    if (fileType === 'unknown') return false;

    // Per-type caps (e.g. 2GB video, 200MB RAW) override the DEFAULT global
    // cap so large media previews like Finder's; an explicitly configured
    // maxFileSize still wins as the user's intent.
    const typeMax = this.capabilities.get(fileType)?.maxSize ?? this.config.maxFileSize;
    const max = this.maxFileSizeExplicit ? Math.min(typeMax, this.config.maxFileSize) : typeMax;
    return file.size <= max;
  }

  // Get preview component for file
  public async getPreviewComponent(
    file: FileEntry,
  ): Promise<React.ComponentType<PreviewProps> | null> {
    const fileType = this.getFileType(file);
    const capability = this.capabilities.get(fileType);

    if (!capability) return null;
    if (!capability.canPreview(file)) return null;

    try {
      return await capability.getPreviewComponent();
    } catch (error) {
      console.error(`Failed to load preview component for ${fileType}:`, error);
      // Rethrow with the top stack frames so the preview panel surfaces the
      // real cause (and where) instead of a generic "not supported".
      const err = error instanceof Error ? error : new Error(String(error));
      const frames = (err.stack || '')
        .split('\n')
        .filter((l) => l.includes('.mjs') || l.includes('.js'))
        .slice(0, 3)
        .map((l) => l.trim().replace(/^at\s+/, ''));
      const wrapped = new Error(
        frames.length ? `${err.message} — ${frames.join(' <- ')}` : err.message,
      );
      wrapped.cause = err;
      throw wrapped;
    }
  }

  // Register a new preview capability
  public registerPreview(capability: PreviewCapability): void {
    this.capabilities.set(capability.type, capability);
  }

  // Unregister a preview capability
  public unregisterPreview(type: PreviewType): void {
    this.capabilities.delete(type);
  }

  // Helper methods for determining file types
  private canPreviewImage(file: FileEntry): boolean {
    const capability = this.capabilities.get('image')!;
    return (
      matchesExtensions(file, capability.extensions) ||
      (file.mime_type?.startsWith('image/') ?? false)
    );
  }

  private canPreviewPdf(file: FileEntry): boolean {
    return extOf(file) === 'pdf' || file.mime_type === 'application/pdf';
  }

  private canPreviewDocument(file: FileEntry): boolean {
    const capability = this.capabilities.get('document')!;
    return (
      matchesExtensions(file, capability.extensions) ||
      (file.mime_type?.includes('wordprocessingml') ?? false)
    );
  }

  private canPreviewSpreadsheet(file: FileEntry): boolean {
    const capability = this.capabilities.get('spreadsheet')!;
    return (
      matchesExtensions(file, capability.extensions) ||
      (file.mime_type?.includes('spreadsheetml') ?? false)
    );
  }

  private canPreviewText(file: FileEntry): boolean {
    const capability = this.capabilities.get('text')!;
    return (
      matchesExtensions(file, capability.extensions) ||
      (file.mime_type?.startsWith('text/plain') ?? false)
    );
  }

  private canPreviewCode(file: FileEntry): boolean {
    const capability = this.capabilities.get('code')!;
    return (
      matchesExtensions(file, capability.extensions) ||
      isNamedCodeFile(file.name) ||
      (file.mime_type?.startsWith('text/') ?? false) ||
      (file.mime_type?.includes('javascript') ?? false) ||
      (file.mime_type?.includes('typescript') ?? false)
    );
  }

  private canPreviewCsv(file: FileEntry): boolean {
    return ['csv', 'tsv'].includes(extOf(file)) || file.mime_type === 'text/csv';
  }

  private canPreviewJson(file: FileEntry): boolean {
    const capability = this.capabilities.get('json')!;
    return (
      matchesExtensions(file, capability.extensions) || (file.mime_type?.includes('json') ?? false)
    );
  }

  private canPreviewMarkdown(file: FileEntry): boolean {
    const capability = this.capabilities.get('markdown')!;
    return (
      matchesExtensions(file, capability.extensions) ||
      (file.mime_type?.includes('markdown') ?? false)
    );
  }

  private canPreviewHtml(file: FileEntry): boolean {
    return ['html', 'htm'].includes(extOf(file)) || file.mime_type === 'text/html';
  }

  private canPreviewVideo(file: FileEntry): boolean {
    const capability = this.capabilities.get('video')!;
    return (
      matchesExtensions(file, capability.extensions) ||
      (file.mime_type?.startsWith('video/') ?? false)
    );
  }

  private canPreviewAudio(file: FileEntry): boolean {
    const capability = this.capabilities.get('audio')!;
    return (
      matchesExtensions(file, capability.extensions) ||
      (file.mime_type?.startsWith('audio/') ?? false)
    );
  }
}

// Export a default instance
export const defaultPreviewFactory = new PreviewFactory();
