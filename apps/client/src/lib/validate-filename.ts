/**
 * Inline file rename validation helper.
 *
 * Checks for invalid characters, reserved names (Windows), length limits,
 * and name conflicts within the same directory.
 */

export interface FileNameValidation {
  /** True when the name is acceptable (no errors). May still have a warning. */
  valid: boolean;
  /** True when there is a soft warning (e.g. name conflict) but the rename could still proceed. */
  warning: boolean;
  /** Human-readable message describing the issue. Empty string when fully valid with no warning. */
  message: string;
  /** Stable reason used by UI surfaces to provide localized feedback. */
  code?:
    | 'empty'
    | 'invalidCharacters'
    | 'trailingDotOrSpace'
    | 'reservedName'
    | 'tooLong'
    | 'conflict';
  /** Optional detail for localized messages. */
  detail?: string | number;
}

// Characters forbidden in file names on Windows (and generally problematic everywhere).
const INVALID_CHARS = /[/\\:*?"<>|]/;
const INVALID_CHARS_DISPLAY = '/ \\ : * ? " < > |';

// Windows reserved device names (case-insensitive, with or without extension).
const WINDOWS_RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM0',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT0',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * Extension of `name` ('' when it has none). Dotfiles like `.bashrc` and
 * extensionless names return '' — Finder treats those as "no extension".
 */
export const getExtension = (name: string): string => {
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(lastDot + 1) : '';
};

/**
 * `name` with its extension removed. Dotfiles and extensionless names pass
 * through unchanged.
 */
export const stripExtension = (name: string): string => {
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(0, lastDot) : name;
};

/**
 * Validate a file name for inline renaming.
 *
 * @param name         The proposed new file name (basename only, no path separators).
 * @param existingNames Array of file/folder names in the current directory.
 * @param currentName  The file's current name (excluded from conflict checks).
 */
export const validateFileName = (
  name: string,
  existingNames: string[],
  currentName: string,
): FileNameValidation => {
  // Trim trailing spaces/dots that Windows silently strips (leads to confusion).
  const trimmed = name.trim();

  // 1. Empty name
  if (trimmed.length === 0) {
    return { valid: false, warning: false, message: 'Name cannot be empty', code: 'empty' };
  }

  // 2. Invalid characters
  if (INVALID_CHARS.test(trimmed)) {
    return {
      valid: false,
      warning: false,
      message: `Name contains invalid characters: ${INVALID_CHARS_DISPLAY}`,
      code: 'invalidCharacters',
    };
  }

  // 3. Names ending with a dot or space (Windows limitation)
  if (trimmed.endsWith('.') || trimmed.endsWith(' ')) {
    return {
      valid: false,
      warning: false,
      message: 'Name cannot end with a dot or space',
      code: 'trailingDotOrSpace',
    };
  }

  // 4. Windows reserved names (check the basename without extension)
  const dotIdx = trimmed.indexOf('.');
  const basePart = (dotIdx > 0 ? trimmed.slice(0, dotIdx) : trimmed).toUpperCase();
  if (WINDOWS_RESERVED.has(basePart)) {
    return {
      valid: false,
      warning: false,
      message: `"${basePart}" is a reserved system name`,
      code: 'reservedName',
      detail: basePart,
    };
  }

  // 5. Length limit
  if (trimmed.length > 255) {
    return {
      valid: false,
      warning: false,
      message: `Name is too long (${trimmed.length}/255 characters)`,
      code: 'tooLong',
      detail: trimmed.length,
    };
  }

  // 6. Conflict check (case-insensitive to match Windows behavior)
  const lowerName = trimmed.toLowerCase();
  const lowerCurrent = currentName.toLowerCase();
  if (lowerName !== lowerCurrent) {
    const conflict = existingNames.find((n) => n.toLowerCase() === lowerName);
    if (conflict) {
      return {
        valid: false,
        warning: true,
        message: `"${conflict}" already exists in this folder`,
        code: 'conflict',
        detail: conflict,
      };
    }
  }

  // 7. Same name as current — no-op but not an error
  if (trimmed === currentName) {
    return { valid: true, warning: false, message: '' };
  }

  return { valid: true, warning: false, message: '' };
};
