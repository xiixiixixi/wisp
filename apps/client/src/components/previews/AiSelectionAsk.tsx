/**
 * 文档选区 → 「引用」浮条（ZCode 交互：选区只负责引用，指令在主输入盒打）。
 *
 * 包住预览的渲染正文：拖选文字后，选区旁浮出「引用」小按钮，点一下把
 * 选区（结构化）经 wisp-open-chat 送进对话面板——上方出现引用条、光标
 * 落进主输入盒，用户在那里下指令，发送时按「只改选中段」模板拼装。
 * 选区检测全是普通 DOM 活：window.getSelection + 起止点都落在容器内。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextQuote } from 'lucide-react';

interface AiSelectionAskProps {
  filePath: string;
  fileName: string;
  className?: string;
  children: React.ReactNode;
}

/** 太短的选区（一个字/标点）大概率是误触，不弹。 */
const MIN_CHARS = 2;
/** 超长选区直接进提示词会撑爆上下文，砍掉。 */
const MAX_CHARS = 4000;

interface CapturedSelection {
  text: string;
  top: number;
  left: number;
}

export const AiSelectionAsk = ({ filePath, fileName, className, children }: AiSelectionAskProps) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<CapturedSelection | null>(null);

  const clear = useCallback(() => setSelection(null), []);

  // 捕获选区：鼠标松开 / shift 扩选后触发。只负责出现与更新，不负责
  // 消失（消失走「点外面」，避免打字时的 shift 键误伤按钮）。
  useEffect(() => {
    const capture = () => {
      const container = containerRef.current;
      if (!container) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const text = range.toString().trim();
      const within = (node: Node | null): boolean => {
        if (!node) return false;
        if (node === container) return true;
        return within(node.parentNode);
      };
      if (
        text.length < MIN_CHARS ||
        text.length > MAX_CHARS ||
        !within(range.startContainer) ||
        !within(range.endContainer)
      ) {
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const rects =
        typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
      const lastRect = rects[rects.length - 1];
      // jsdom 的 range 没有客户端矩形 → 退到容器左上角，交互仍可测。
      // 容器带 overflow-hidden 时按容器高度收口，防止按钮被裁掉。
      const rawTop = lastRect ? lastRect.bottom - containerRect.top + 6 : 8;
      const top = Math.min(Math.max(rawTop, 8), Math.max(containerRect.height - 30, 8));
      const left = lastRect
        ? Math.min(
            Math.max(lastRect.right - containerRect.left - 90, 8),
            Math.max(containerRect.width - 120, 8),
          )
        : 8;
      setSelection({ text, top, left });
    };
    const onMouseUp = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      capture();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.shiftKey) return;
      if (wrapRef.current?.contains(document.activeElement)) return;
      capture();
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // 点浮条外任意处 → 收掉。
  useEffect(() => {
    if (!selection) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      clear();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [selection, clear]);

  const quote = useCallback(() => {
    if (!selection) return;
    window.dispatchEvent(
      new CustomEvent('wisp-open-chat', {
        detail: { selection: { text: selection.text, filePath, fileName } },
      }),
    );
    clear();
  }, [selection, filePath, fileName, clear]);

  return (
    <div
      ref={containerRef}
      className={`relative ${className ?? ''}`}
      data-testid="ai-selection-layer"
    >
      {children}

      {selection && (
        <button
          ref={wrapRef}
          type="button"
          data-testid="ai-ask-button"
          aria-label={t('piChat.quoteSel')}
          title={t('piChat.quoteSel')}
          style={{ position: 'absolute', top: selection.top, left: selection.left, zIndex: 20 }}
          className="flex items-center gap-1 rounded-md border border-xp-border bg-xp-popover px-2 py-1 text-[11px] text-xp-text shadow-md transition-colors hover:bg-xp-surface-light"
          onClick={quote}
        >
          <TextQuote size={11} className="text-xp-accent" />
          {t('piChat.quoteSel')}
        </button>
      )}
    </div>
  );
};

export default AiSelectionAsk;
