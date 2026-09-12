/**
 * Extract Wisp-ready design tokens from a Figma file via the REST API.
 *
 * Why this exists: the Figma MCP tools (mcp__figma__get_figma_data) go through
 * the /v1/files/:key/nodes endpoint, which is rate-limited to exhaustion on the
 * Starter plan. The plain /v1/files/:key?depth=N endpoint is NOT limited and
 * carries the same style/component payload, so this script reads that instead.
 *
 * Usage:
 *   FIGMA_API_KEY=xxx node scripts/figma-extract-tokens.mjs <fileKey> [outFile]
 *   node scripts/figma-extract-tokens.mjs <fileKey> --depth 4
 *
 * Output: JSON with fills, text styles, effect styles and component inventory,
 * normalised to #rrggbb(aa) hex plus the metadata Wisp needs for tokens.
 */

const API = 'https://api.figma.com/v1';

/** Convert a Figma 0..1 RGBA colour to #rrggbb, appending alpha when not opaque. */
const toHex = ({ r, g, b, a }) => {
  const channel = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  const base = `#${channel(r)}${channel(g)}${channel(b)}`;
  return a == null || a >= 1 ? base : `${base}${channel(a)}`;
};

/** Reduce a node's fills array to the first visible solid colour. */
const solidFill = (node) => {
  const fill = (node.fills ?? []).find((f) => f.visible !== false && f.type === 'SOLID');
  return fill?.color ? toHex({ ...fill.color, a: fill.opacity ?? fill.color.a }) : null;
};

/**
 * GET a Figma API path, retrying on 429.
 *
 * The Starter plan's quota is small and a deep read is rate-limit type "high",
 * so a single script run can exhaust it. Deep reads are correspondingly
 * expensive to retry, so the delay is honoured from Retry-After and capped by
 * MAX_RETRY_WAIT_MS; once the wait exceeds that, failing fast is kinder than
 * hanging for the ~101 hours a starter retry-after can report.
 */
const MAX_RETRY_WAIT_MS = 60_000;
const MAX_ATTEMPTS = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const get = async (path, key) => {
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(`${API}${path}`, { headers: { 'X-Figma-Token': key } });
    if (res.ok) return res.json();

    const body = (await res.text()).slice(0, 300);
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? 0) * 1000;
      const tier = res.headers.get('x-figma-plan-tier') ?? 'unknown';
      if (attempt >= MAX_ATTEMPTS || retryAfter > MAX_RETRY_WAIT_MS) {
        throw new Error(
          `Figma rate limit (429) on ${path}; plan tier "${tier}", retry-after ${Math.round(retryAfter / 1000)}s. ` +
            `Quota exhausted — wait for it to reset, or reduce --depth. Body: ${body}`,
        );
      }
      const wait = Math.max(retryAfter, 1000 * 2 ** (attempt - 1));
      console.error(`figma-extract-tokens: 429, retrying in ${Math.round(wait / 1000)}s (attempt ${attempt})`);
      await sleep(wait);
      continue;
    }
    throw new Error(`Figma ${path} -> HTTP ${res.status}: ${body}`);
  }
};

const main = async () => {
  const [fileKey, ...rest] = process.argv.slice(2);
  if (!fileKey) {
    console.error('usage: figma-extract-tokens.mjs <fileKey> [outFile] [--depth N]');
    process.exit(1);
  }
  const depthFlag = rest.indexOf('--depth');
  const depth = depthFlag >= 0 ? rest[depthFlag + 1] : 4;
  const outFile = rest.find((a, i) => !a.startsWith('--') && i !== depthFlag + 1);

  const key = process.env.FIGMA_API_KEY;
  if (!key) {
    console.error('FIGMA_API_KEY is required (personal access token, file_content:read)');
    process.exit(1);
  }

  const file = await get(`/files/${fileKey}?depth=${depth}`, key);

  // Figma returns styles/components as id-keyed maps; resolve them into arrays
  // so the output is directly consumable.
  const styles = Object.entries(file.styles ?? {}).map(([id, s]) => ({
    id,
    name: s.name,
    type: s.styleType,
    description: s.description || undefined,
  }));

  // Walk the tree once, collecting every node that carries a style reference so
  // concrete values (colour, radius, font) land next to the style names.
  const samples = { FILL: {}, TEXT: {}, EFFECT: {} };
  const componentNames = new Set();
  const walk = (node) => {
    if (node.styles) {
      for (const [type, styleId] of Object.entries(node.styles)) {
        if (!samples[type] || samples[type][styleId]) continue;
        samples[type][styleId] = {
          nodeName: node.name,
          nodeType: node.type,
          fill: solidFill(node),
          radius: node.cornerRadius ?? undefined,
          font: node.style?.fontFamily
            ? {
                family: node.style.fontFamily,
                size: node.style.fontSize,
                weight: node.style.fontWeight,
                lineHeight: node.style.lineHeightPx,
                letterSpacing: node.style.letterSpacing,
              }
            : undefined,
        };
      }
    }
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') componentNames.add(node.name);
    (node.children ?? []).forEach(walk);
  };
  walk(file.document);

  const fills = styles
    .filter((s) => s.type === 'FILL')
    .map((s) => ({ ...s, ...samples.FILL[s.id], value: samples.FILL[s.id]?.fill ?? null }));
  const texts = styles
    .filter((s) => s.type === 'TEXT')
    .map((s) => ({ ...s, ...samples.TEXT[s.id], value: samples.TEXT[s.id]?.font ?? null }));

  const result = {
    file: { key: fileKey, name: file.name, lastModified: file.lastModified, version: file.version },
    counts: {
      pages: (file.document?.children ?? []).length,
      styles: styles.length,
      components: Object.keys(file.components ?? {}).length,
      componentNames: componentNames.size,
    },
    fills,
    texts,
    otherStyles: styles.filter((s) => !['FILL', 'TEXT'].includes(s.type)),
  };

  const json = JSON.stringify(result, null, 2);
  if (outFile) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, json);
    console.error(`wrote ${outFile}`);
    console.error(`fills=${fills.length} texts=${texts.length} components=${result.counts.components}`);
  } else {
    console.log(json);
  }
};

main().catch((error) => {
  console.error(`figma-extract-tokens: ${error.message}`);
  process.exit(1);
});
