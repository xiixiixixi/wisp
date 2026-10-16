/** Hover preview for terminal links: shows the full href before the modifier
 *  click opens it (anti-phishing). Plain singleton DOM — no React state, so
 *  tracking the mouse never re-renders the terminal panel. */

let tooltip: HTMLDivElement | undefined;

const ensureTooltip = (): HTMLDivElement => {
  if (tooltip) return tooltip;
  tooltip = document.createElement('div');
  tooltip.className = 'wisp-terminal-link-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);
  return tooltip;
};

const place = (x: number, y: number): void => {
  if (!tooltip) return;
  const margin = 8;
  const offset = 14;
  const rect = tooltip.getBoundingClientRect();
  const left = Math.max(margin, Math.min(x + offset, window.innerWidth - rect.width - margin));
  const top =
    y + offset + rect.height > window.innerHeight - margin
      ? Math.max(margin, y - rect.height - offset)
      : y + offset;
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
};

export const showTerminalLinkTooltip = (href: string, x: number, y: number): void => {
  const node = ensureTooltip();
  if (node.textContent !== href) node.textContent = href;
  node.style.display = 'block';
  place(x, y);
};

/** Keep the preview under the cursor while it stays visible. */
export const moveTerminalLinkTooltip = (x: number, y: number): void => {
  if (tooltip && tooltip.style.display !== 'none') place(x, y);
};

export const hideTerminalLinkTooltip = (): void => {
  if (tooltip) tooltip.style.display = 'none';
};
