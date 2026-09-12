/**
 * WCAG AA contrast audit for the Anthropic restyle — run inside the app page.
 *
 * DESIGN.md's muted grey tiers were chosen for tonal calm, and two of them fell
 * below AA on the oat chrome surface (#F0EEE6) once measured. This walks every
 * rendered text node, resolves its effective background, and reports the
 * worst offenders so regressions are caught before they ship.
 *
 * Usage (Sleuth shared browser, from the Wisp repo):
 *   JS=$(cat scripts/audit-contrast.js)
 *   node scripts/shared-browser.mjs exec --owner <id> --tab <label> -- eval "$JS"
 */
(() => {
  const channel = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = (p) => 0.2126 * channel(p.r) + 0.7152 * channel(p.g) + 0.0722 * channel(p.b);
  const parse = (value) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : parseFloat(m[4]) };
  };
  // Walk ancestors until an opaque-enough background is found; that is what the
  // eye actually reads against.
  const backgroundOf = (el) => {
    let node = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.5) return c;
      node = node.parentElement;
    }
    return { r: 250, g: 249, b: 245, a: 1 };
  };

  const fails = [];
  let checked = 0;
  document.querySelectorAll('p,span,h1,h2,h3,h4,h5,button,label,a,time,li,td,th,div').forEach((el) => {
    const text = (el.textContent || '').trim();
    if (!text || el.children.length > 0) return; // leaf text nodes only
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 6) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') return;
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.5) return;

    const bg = backgroundOf(el);
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const isLarge = size >= 24 || (size >= 18.66 && bold);
    const need = isLarge ? 3 : 4.5;
    checked++;
    if (ratio < need) {
      fails.push({
        text: text.slice(0, 24),
        size: size,
        ratio: +ratio.toFixed(2),
        need: need,
        fg: cs.color,
        bg: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')',
      });
    }
  });

  fails.sort((a, b) => a.ratio - b.ratio);
  return JSON.stringify({ path: location.pathname, checked: checked, fails: fails.length, worst: fails.slice(0, 8) });
})()
