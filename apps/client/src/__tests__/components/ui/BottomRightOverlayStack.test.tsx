import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BottomRightOverlayStackItem } from '@/components/ui/BottomRightOverlayStack';

describe('BottomRightOverlayStackItem', () => {
  it('places independent notices in one non-overlapping stack host', () => {
    const { unmount } = render(
      <>
        <BottomRightOverlayStackItem>
          <div>First notice</div>
        </BottomRightOverlayStackItem>
        <BottomRightOverlayStackItem>
          <div>Second notice</div>
        </BottomRightOverlayStackItem>
      </>,
    );

    const host = document.getElementById('wisp-bottom-right-overlay-stack');
    expect(host).toBeInTheDocument();
    expect(host).toHaveClass('flex-col-reverse', 'gap-2');
    expect(host).toContainElement(screen.getByText('First notice'));
    expect(host).toContainElement(screen.getByText('Second notice'));

    unmount();
    expect(host).toBeEmptyDOMElement();
  });
});
