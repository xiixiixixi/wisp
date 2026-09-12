"""Map leftover cool-toned hard-coded colours in the glass layer onto warm tokens.

The glass stylesheets hard-code many blue-grey / blue-white values with `!important`,
which outrank the semantic token classes the components already carry (for example a
heading with `text-xp-text` was still painting `#162033`). DESIGN.md allows no cool
greys and no pure white, so every cool value is remapped by the property it paints:
text -> an ink step, background/border -> a paper/oat/sand/hairline step.

Warm values and neutral black/white alphas are left untouched: the latter are inset
highlights and transparent scrims, not surface tints.
"""

import pathlib
import re

# Alpha threshold below which a value is treated as a neutral scrim, not a tint.
NEUTRAL_ALPHA = 0.02

TEXT_TARGETS = {
    'dark': 'var(--ds-label-primary)',
    'mid': 'var(--ds-label-secondary)',
    'light': 'var(--ds-label-tertiary)',
}
SURFACE_TARGETS = {
    'strong': 'var(--ds-canvas)',
    'tint': 'var(--ds-mat-ultra-thin-bg)',
    'sand': 'var(--ds-sand)',
}


def parse_color(value):
    """Return (r, g, b, a) for hex or rgb()/rgba(), else None."""
    m = re.fullmatch(r'#([0-9A-Fa-f]{6})', value)
    if m:
        h = m.group(1)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
    m = re.fullmatch(r'rgba?\(([^)]*)\)', value)
    if not m:
        return None
    parts = [p.strip() for p in m.group(1).split(',')]
    if len(parts) < 3:
        return None
    try:
        r, g, b = (int(float(p)) for p in parts[:3])
        a = float(parts[3]) if len(parts) == 4 else 1.0
    except ValueError:
        return None
    return (r, g, b, a)


def is_cool(rgb):
    """Blue-dominant values are the cool greys and Apple blues DESIGN.md excludes."""
    r, g, b, a = rgb
    if a < NEUTRAL_ALPHA:
        return False
    if (r, g, b) in ((255, 255, 255), (0, 0, 0)):
        return False
    return b > r + 6


def is_near_white(rgb):
    r, g, b, a = rgb
    return a > 0.3 and min(r, g, b) > 240


def luminance(rgb):
    r, g, b, _ = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def pick_text_token(rgb):
    lum = luminance(rgb)
    if lum < 110:
        return TEXT_TARGETS['dark']
    if lum < 190:
        return TEXT_TARGETS['mid']
    return TEXT_TARGETS['light']


def pick_surface_token(rgb):
    r, g, b, a = rgb
    if is_near_white(rgb) or (a < 0.5 and b > 240):
        return SURFACE_TARGETS['strong']
    if a < 0.25:
        return SURFACE_TARGETS['tint']
    lum = luminance(rgb)
    return SURFACE_TARGETS['strong'] if lum > 200 else SURFACE_TARGETS['sand']


COLOR_RE = re.compile(r'(#[0-9A-Fa-f]{6}|rgba?\([0-9][^)]*\))')
PROP_RE = re.compile(r'([a-z-]+)\s*:\s*[^;]*;?\s*$')

TEXT_PROPS = {'color', 'fill', 'stroke', 'caret-color'}
SURFACE_PROPS = {'background', 'background-color', 'border-color', 'border-top-color',
                 'border-bottom-color', 'border-left-color', 'border-right-color',
                 'border', 'outline-color'}

# Only opaque-ish paint is remapped. Low-alpha values are composited layers —
# inset highlights, translucent scrims — where swapping in a solid token would
# change visual weight far more than it changes hue.
OPAQUE_ENOUGH = 0.6


def should_remap(rgb, prop):
    r, g, b, a = rgb
    if prop in TEXT_PROPS:
        return is_cool(rgb) or is_near_white(rgb)
    if a < OPAQUE_ENOUGH:
        return False
    return is_cool(rgb) or is_near_white(rgb)


def transform(path):
    text = path.read_text(encoding='utf-8')
    out = []
    changed = 0
    for line in text.split('\n'):
        m_prop = PROP_RE.search(line)
        prop = m_prop.group(1) if m_prop else None
        # A custom-property *definition* is a token, not paint — never rewrite it.
        if prop is None or prop.startswith('-') or prop not in TEXT_PROPS | SURFACE_PROPS:
            out.append(line)
            continue

        def repl(match):
            nonlocal changed
            rgb = parse_color(match.group(1))
            if rgb is None or not should_remap(rgb, prop):
                return match.group(1)
            target = pick_text_token(rgb) if prop in TEXT_PROPS else pick_surface_token(rgb)
            changed += 1
            return target

        out.append(COLOR_RE.sub(repl, line))
    if changed:
        path.write_text('\n'.join(out), encoding='utf-8')
    return changed


if __name__ == '__main__':
    import sys
    for name in sys.argv[1:]:
        print(f'{name}: {transform(pathlib.Path(name))} colours remapped')
