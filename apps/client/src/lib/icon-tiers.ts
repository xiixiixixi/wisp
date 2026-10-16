// ── Native icon size tiers (Finder's display ladder) ────────────────────────
// Native fetches snap to Finder's 16/32/64/128/256/512 ladder at the smallest
// tier covering the display size (times the device pixel ratio), so a raster
// is never upscaled: the blur case was a fixed 96px asset behind a 128px+
// gallery slot.
export const ICON_SIZE_TIERS: readonly number[] = [16, 32, 64, 128, 256, 512];

export const pickNativeIconTier = (displayPx: number, pixelRatio = 1): number => {
  const needed = Math.max(16, Math.ceil(Math.max(1, displayPx) * Math.max(1, pixelRatio)));
  return ICON_SIZE_TIERS.find((tier) => tier >= needed) ?? 512;
};
