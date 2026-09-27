/**
 * AiSelectionAsk — 文档选区「引用」浮条（ZCode 交互）。
 * 划选 → 浮出「引用」按钮 → 点击把选区（结构化）经 wisp-open-chat
 * 送进对话面板；指令在主输入盒里打，这里只负责引用。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import AiSelectionAsk from '@/components/previews/AiSelectionAsk';

const selectText = (node: HTMLElement) => {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection?.removeAllRanges();
  selection?.addRange(range);
};

describe('AiSelectionAsk', () => {
  it('shows the quote button for an in-container selection and dispatches wisp-open-chat on click', () => {
    render(
      <AiSelectionAsk filePath="/docs/周报.md" fileName="周报.md">
        <p>本周完成了三件事，下周继续推进画布模式。</p>
      </AiSelectionAsk>,
    );
    const para = screen.getByText('本周完成了三件事，下周继续推进画布模式。');

    selectText(para);
    fireEvent.mouseUp(document);

    expect(screen.getByTestId('ai-ask-button')).toBeInTheDocument();

    const spy = vi.fn();
    window.addEventListener('wisp-open-chat', spy);
    fireEvent.click(screen.getByTestId('ai-ask-button'));

    expect(spy).toHaveBeenCalledTimes(1);
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.prompt).toBeUndefined();
    expect(detail.selection).toEqual({
      text: '本周完成了三件事，下周继续推进画布模式。',
      filePath: '/docs/周报.md',
      fileName: '周报.md',
    });
    // 引用后浮条收起
    expect(screen.queryByTestId('ai-ask-button')).not.toBeInTheDocument();
    window.removeEventListener('wisp-open-chat', spy);
  });

  it('ignores selections that start outside the layer', () => {
    render(
      <>
        <p id="outside">外面的文字不应触发浮条</p>
        <AiSelectionAsk filePath="/a.md" fileName="a.md">
          <p>容器内的文字</p>
        </AiSelectionAsk>
      </>,
    );
    selectText(screen.getByText('外面的文字不应触发浮条'));
    fireEvent.mouseUp(document);
    expect(screen.queryByTestId('ai-ask-button')).not.toBeInTheDocument();
  });

  it('ignores trivially short selections', () => {
    render(
      <AiSelectionAsk filePath="/a.md" fileName="a.md">
        <p>字</p>
      </AiSelectionAsk>,
    );
    selectText(screen.getByText('字'));
    fireEvent.mouseUp(document);
    expect(screen.queryByTestId('ai-ask-button')).not.toBeInTheDocument();
  });

  it('dismisses the button on outside mousedown', () => {
    render(
      <AiSelectionAsk filePath="/a.md" fileName="a.md">
        <p>一段足够长的可选中文字</p>
      </AiSelectionAsk>,
    );
    selectText(screen.getByText('一段足够长的可选中文字'));
    fireEvent.mouseUp(document);
    expect(screen.getByTestId('ai-ask-button')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('ai-ask-button')).not.toBeInTheDocument();
  });

  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
  });
});
