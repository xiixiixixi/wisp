/**
 * Finder's seven standard tag colours.
 *
 * The colour indices match what macOS stores in
 * com.apple.metadata:_kMDItemUserTags ("Name\n<index>"): 1 gray, 2 green,
 * 3 purple, 4 blue, 5 yellow, 6 red, 7 orange. Hex values mirror the
 * macOS system colours the Rust side maps indices to — keep both tables
 * in sync.
 */
export interface FinderTagColor {
  id: string;
  hex: string;
  index: number;
}

import i18n from '@/i18n';

/**
 * macOS stores the seven standard tag names in English in
 * com.apple.finder.plist (Red, Orange, …) and localizes them only for
 * display. We keep those canonical names on disk so tags stay identical
 * to Finder's, and localize purely for display.
 */
const CANONICAL_TAG_NAME_TO_COLOR_ID: Record<string, string> = {
  red: 'red',
  orange: 'orange',
  yellow: 'yellow',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
  gray: 'gray',
  grey: 'gray',
};

/** Localize a stored tag name for display; custom names pass through. */
export const displayTagName = (name: string): string => {
  const mapped = CANONICAL_TAG_NAME_TO_COLOR_ID[name.trim().toLowerCase()];
  return mapped ? i18n.t(`dialogs.colors.${mapped}`) : name;
};

export const FINDER_TAG_COLORS: FinderTagColor[] = [
  { id: 'red', hex: '#FF453A', index: 6 },
  { id: 'orange', hex: '#FF9F0A', index: 7 },
  { id: 'yellow', hex: '#FFD60A', index: 5 },
  { id: 'green', hex: '#30D158', index: 2 },
  { id: 'blue', hex: '#0A84FF', index: 4 },
  { id: 'purple', hex: '#BF5AF2', index: 3 },
  { id: 'gray', hex: '#98989D', index: 1 },
];
