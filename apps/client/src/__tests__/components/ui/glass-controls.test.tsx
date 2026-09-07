import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

describe('shared glass control interactions', () => {
  it('switches wrapped tab panels with arrow keys, skips disabled tabs and links the panel', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="first">
        <TabsList aria-label="Comparison">
          <TabsTrigger value="first">Summary</TabsTrigger>
          <TabsTrigger value="disabled" disabled>
            Unavailable
          </TabsTrigger>
          <TabsTrigger value="last">Changes</TabsTrigger>
        </TabsList>
        <div>
          <TabsContent value="first">First content</TabsContent>
          <TabsContent value="last">Last content</TabsContent>
        </div>
      </Tabs>,
    );
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    const active = screen.getByRole('tab', { name: 'Changes' });
    expect(active).toHaveFocus();
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Last content');
    expect(screen.getByRole('tabpanel').id).toBe(active.getAttribute('aria-controls'));
    await user.keyboard('{Home}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('First content');
    await user.keyboard('{End}');
    expect(active).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveFocus();
  });

  it('does not accidentally submit a form from a secondary action', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Button variant="secondary">Cancel</Button>
        <Button type="submit">Save</Button>
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('escapes a clipped parent, traps focus and returns focus after conditional unmount', async () => {
    const user = userEvent.setup();
    const Example = () => {
      const [open, setOpen] = useState(false);
      return (
        <div data-testid="clipped" style={{ overflow: 'hidden', transform: 'translateX(0)' }}>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <Dialog open onOpenChange={setOpen}>
              <DialogContent>
                <DialogTitle>Rename</DialogTitle>
                <input aria-label="Name" />
                <Button onClick={() => setOpen(false)}>Close</Button>
              </DialogContent>
            </Dialog>
          )}
        </div>
      );
    };
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('clipped')).not.toContainElement(screen.getByRole('dialog'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus());
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });
});
