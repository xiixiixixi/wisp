import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { language as languageFacet } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightTree } from '@lezer/highlight';
import { loadLanguageFor, WispCodeMirror, wispHighlightStyle } from '@/lib/codemirror';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.className = '';
});

describe('CodeMirror language detection', () => {
  it.each([
    ['main.ts', 'TypeScript'],
    ['main.mts', 'TypeScript'],
    ['main.cts', 'TypeScript'],
    ['Component.TSX', 'TSX'],
    ['script.js', 'JavaScript'],
    ['script.cjs', 'JavaScript'],
    ['script.mjs', 'JavaScript'],
    ['Component.jsx', 'JSX'],
    ['main.py', 'Python'],
    ['main.rs', 'Rust'],
    ['App.swift', 'Swift'],
    ['run.sh', 'Shell'],
    ['run.zsh', 'Shell'],
    ['.zshrc', 'Shell'],
    ['.bash_profile', 'Shell'],
    ['.env.local', 'Shell'],
    ['config.json', 'JSON'],
    ['config.YAML', 'YAML'],
    ['Cargo.toml', 'TOML'],
    ['config.ini', 'Properties files'],
    ['.editorconfig', 'Properties files'],
    ['.gitconfig', 'Properties files'],
    ['Dockerfile.dev', 'Dockerfile'],
    ['Containerfile', 'Dockerfile'],
    ['C:\\src\\BUILD', 'Python'],
  ])('loads the actual %s grammar as %s', async (file, expected) => {
    const description = await loadLanguageFor(file);
    expect(description?.name).toBe(expected);
    expect(description?.support?.language).toBeDefined();
  });

  it.each([
    ['typescriptreact', 'TSX'],
    ['javascriptreact', 'JSX'],
    ['shellscript', 'Shell'],
    [' PYTHON ', 'Python'],
  ])('honors the explicit %s language', async (override, name) => {
    expect((await loadLanguageFor('notes.txt', override))?.name).toBe(name);
  });

  it.each(['Makefile', '.gitignore', 'config.jsonc', 'config.json5', 'run.fish', 'README'])(
    'uses plain text for unsupported %s syntax',
    async (file) => {
      expect(await loadLanguageFor(file)).toBeNull();
    },
  );

  it.each(['plaintext', 'json5', 'jsonc', 'unavailable-grammar'])(
    'does not override an explicit %s request with the filename grammar',
    async (override) => {
      expect(await loadLanguageFor('main.ts', override)).toBeNull();
    },
  );

  it.each([
    ['test.ts', 'export function greet(name: string) { return "hello"; }', 'export', '"hello"'],
    ['test.tsx', 'export const App = () => <main title="hello">Hello</main>;', 'export', '"hello"'],
    ['test.js', 'function greet() { return "hello"; }', 'function', '"hello"'],
    ['test.jsx', 'export const App = () => <main title="hello" />;', 'export', '"hello"'],
    ['test.py', 'def greet():\n    return "hello"\n', 'def', '"hello"'],
    ['test.rs', 'fn main() { let greeting = "hello"; }', 'fn', '"hello"'],
    ['test.swift', 'func greet() { return "hello" }', 'func', '"hello"'],
    ['test.sh', 'if true; then echo "hello"; fi', 'if', '"hello"'],
  ])(
    'highlights keywords and strings using the real %s parser',
    async (file, doc, keyword, string) => {
      const description = await loadLanguageFor(file);
      const tree = description!.support!.language.parser.parse(doc);
      const tokens: { text: string; classes: string }[] = [];
      highlightTree(tree, wispHighlightStyle, (from, to, classes) => {
        tokens.push({ text: doc.slice(from, to), classes });
      });
      expect(tokens).toContainEqual({ text: keyword, classes: 'code-token-keyword' });
      // Stream grammars can split a quoted string into several adjacent spans.
      const stringTokens = tokens.filter((token) => token.classes.includes('code-token-string'));
      expect(stringTokens.map((token) => token.text).join('')).toContain(string);
      const errors: string[] = [];
      tree.iterate({
        enter: (node) => {
          if (node.type.isError) errors.push(doc.slice(node.from, node.to));
        },
      });
      expect(errors).toEqual([]);
    },
  );

  it('keeps function and property categories distinct from ordinary variables', async () => {
    const doc = 'function greet(name) { return person.title; }';
    const description = await loadLanguageFor('test.js');
    const tokens: Record<string, string> = {};
    highlightTree(
      description!.support!.language.parser.parse(doc),
      wispHighlightStyle,
      (from, to, classes) => {
        tokens[doc.slice(from, to)] = classes;
      },
    );
    expect(tokens.greet).toBe('code-token-function');
    expect(tokens.title).toBe('code-token-property');
    expect(tokens.person).toBe('code-token-variable');
  });
});

describe('CodeMirror view lifecycle', () => {
  it('preserves the editor, draft, selection and undo history across appearance changes', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const editorRef = { current: null as EditorView | null };
    const props = { doc: 'const value = 1;', fileName: 'main.ts', readOnly: false, editorRef };
    const { rerender } = render(<WispCodeMirror {...props} />);
    const view = editorRef.current!;
    act(() =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: '\n// draft' },
        selection: { anchor: 3 },
      }),
    );
    document.documentElement.className = 'theme-fluid theme-rolex';
    rerender(<WispCodeMirror {...props} />);
    expect(editorRef.current).toBe(view);
    expect(view.state.doc.toString()).toBe('const value = 1;\n// draft');
    expect(view.state.selection.main.anchor).toBe(3);
    rerender(<WispCodeMirror {...props} lineWrapping />);
    expect(editorRef.current).toBe(view);
    expect(view.contentDOM).toHaveClass('cm-lineWrapping');
    expect(view.state.doc.toString()).toBe('const value = 1;\n// draft');
    expect(view.state.selection.main.anchor).toBe(3);
    act(() => {
      expect(undo(view)).toBe(true);
    });
    expect(view.state.doc.toString()).toBe(props.doc);
    document.documentElement.className = 'theme-fluid theme-light';
    rerender(<WispCodeMirror {...props} />);
    expect(editorRef.current).toBe(view);
    expect(view.contentDOM).not.toHaveClass('cm-lineWrapping');
  });

  it('clears the previous grammar and label when the next grammar fails', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const python = await loadLanguageFor('main.py');
    const rust = languages.find((item) => item.name === 'Rust')!;
    vi.spyOn(rust, 'load').mockRejectedValue(new Error('Grammar download failed'));
    const editorRef = { current: null as EditorView | null };
    const onLanguageLoaded = vi.fn();
    const { rerender } = render(
      <WispCodeMirror
        doc="pass"
        fileName="main.py"
        editorRef={editorRef}
        onLanguageLoaded={onLanguageLoaded}
      />,
    );
    await act(async () => {});
    expect(editorRef.current!.state.facet(languageFacet)).toBe(python!.support!.language);
    rerender(
      <WispCodeMirror
        doc="fn main() {}"
        fileName="main.rs"
        editorRef={editorRef}
        onLanguageLoaded={onLanguageLoaded}
      />,
    );
    await act(async () => {});
    expect(editorRef.current!.state.facet(languageFacet)).toBeNull();
    expect(onLanguageLoaded).toHaveBeenLastCalledWith('');
  });

  it('ignores a grammar that finishes after switching to an unsupported file', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const swift = await loadLanguageFor('main.swift');
    let finish!: () => void;
    vi.spyOn(swift!, 'load').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(swift!.support!);
        }),
    );
    const editorRef = { current: null as EditorView | null };
    const onLanguageLoaded = vi.fn();
    const { rerender } = render(
      <WispCodeMirror
        doc="let value = 1"
        fileName="main.swift"
        ariaLabel="main.swift"
        editorRef={editorRef}
        onLanguageLoaded={onLanguageLoaded}
      />,
    );
    const view = editorRef.current!;
    rerender(
      <WispCodeMirror
        doc="notes"
        fileName="notes.txt"
        ariaLabel="notes.txt"
        editorRef={editorRef}
        onLanguageLoaded={onLanguageLoaded}
      />,
    );
    await act(async () => finish());
    expect(editorRef.current).toBe(view);
    expect(view.state.doc.toString()).toBe('notes');
    expect(view.state.facet(languageFacet)).toBeNull();
    expect(view.contentDOM).toHaveAttribute('aria-label', 'notes.txt');
    expect(onLanguageLoaded).not.toHaveBeenCalledWith('Swift');
    expect(view.state.facet(EditorState.readOnly)).toBe(true);
  });
});
