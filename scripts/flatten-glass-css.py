"""Flatten gradient declarations in the glass stylesheets.

DESIGN.md forbids gradients outright, but the glass layers hard-code ~23 of them
across single- and multi-line declarations. A blind line-based edit would corrupt
multi-line values, so this walks balanced parentheses and rewrites only the
declaration's value.
"""

import pathlib
import re
import sys


def find_declarations(text, prop):
    """Yield (start, end) spans of `prop: ...;` declarations, paren-balanced."""
    for match in re.finditer(rf'(?m)^([ \t]*){prop}\s*:', text):
        start = match.start()
        i = match.end()
        depth = 0
        while i < len(text):
            ch = text[i]
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
            elif ch == ';' and depth <= 0:
                yield start, i + 1
                break
            i += 1


def flatten(path, replacers):
    text = path.read_text(encoding='utf-8')
    original = text
    # Rewrite back-to-front so earlier spans keep their offsets.
    spans = []
    for prop, replacer in replacers.items():
        for start, end in find_declarations(text, prop):
            spans.append((start, end, prop, replacer))
    spans.sort(key=lambda s: s[0], reverse=True)

    changed = 0
    for start, end, prop, replacer in spans:
        declaration = text[start:end]
        new = replacer(declaration)
        if new is not None and new != declaration:
            text = text[:start] + new + text[end:]
            changed += 1

    if text != original:
        path.write_text(text, encoding='utf-8')
    return changed, len(spans)


def strip_scrim(declaration):
    """A radial scrim/gradient is decorative — remove the background entirely."""
    return 'background: none;'


def strip_filter(declaration):
    """Backdrop blur/saturate is forbidden by DESIGN.md."""
    lead = re.match(r'^([ \t]*-[a-z-]*backdrop-filter|backdrop-filter)', declaration)
    if not lead:
        return None
    return f'{lead.group(1)}: none;'


def flatten_fill(declaration):
    """Flatten ONLY gradient-valued fills; leave plain colour values alone."""
    if 'gradient(' not in declaration:
        return None
    if re.match(r'^\s*(background|background-image)\s*:\s*radial-gradient', declaration):
        # A radial scrim/ambient glow is pure decoration.
        return 'background: none;'
    # A linear gradient used as a fill becomes a flat tonal surface.
    return 'background: var(--ds-accent);'


REPLACERS = {
    'background': flatten_fill,
    'background-image': flatten_fill,
    '-webkit-backdrop-filter': strip_filter,
    'backdrop-filter': strip_filter,
}


def main():
    total_changed = 0
    for name in sys.argv[1:]:
        path = pathlib.Path(name)
        changed, seen = flatten(path, REPLACERS)
        total_changed += changed
        print(f'{name}: rewrote {changed}/{seen} declarations')
    print(f'total rewrites: {total_changed}')


if __name__ == '__main__':
    main()
