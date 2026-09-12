import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { SettingRow, Toggle, SelectField } from '@/components/settings/shared';

describe('shared glass control interactions', () => {
  it('cycles focus through summaries while excluding controls inside closed disclosures', async () => {
    const user = userEvent.setup();
    render(
      <Dialog open>
        <DialogTitle>Preferences</DialogTitle>
        <button>First action</button>
        <details>
          <summary>Advanced</summary>
          <button data-autofocus>Hidden reset</button>
          <details open>
            <summary>Nested actions</summary>
            <button>Hidden nested action</button>
          </details>
        </details>
      </Dialog>,
    );
    const first = screen.getByRole('button', { name: 'First action' });
    const summary = screen.getByText('Advanced');
    await waitFor(() => expect(first).toHaveFocus());
    await user.tab({ shift: true });
    expect(summary).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();

    fireEvent.click(summary);
    const nestedAction = screen.getByRole('button', { name: 'Hidden nested action' });
    first.focus();
    await user.tab({ shift: true });
    expect(nestedAction).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
  });

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

  it('names settings controls from their row and changes a switch with the keyboard', async () => {
    const user = userEvent.setup();
    const Example = () => {
      const [enabled, setEnabled] = useState(false);
      return (
        <>
          <SettingRow
            label="Show hidden files"
            description="Include files whose names begin with a dot."
          >
            <Toggle id="hidden-files" checked={enabled} onChange={setEnabled} />
          </SettingRow>
          <SettingRow label="Default view">
            <SelectField
              value="details"
              onChange={vi.fn()}
              options={[{ value: 'details', label: 'Details' }]}
            />
          </SettingRow>
        </>
      );
    };
    render(<Example />);
    const toggle = screen.getByRole('switch', { name: 'Show hidden files' });
    expect(toggle).toHaveAccessibleDescription('Include files whose names begin with a dot.');
    expect(screen.getByRole('combobox', { name: 'Default view' })).toHaveTextContent('Details');
    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard(' ');
    expect(toggle).toBeChecked();
  });

  it('preserves explicit switch labels and prevents disabled switches from changing', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <SettingRow label="File visibility">
        <Toggle
          id="disabled-files"
          label="Show hidden files"
          checked={false}
          onChange={change}
          disabled
        />
      </SettingRow>,
    );
    const toggle = screen.getByRole('switch', { name: 'Show hidden files' });
    expect(toggle).toBeDisabled();
    await user.click(toggle);
    expect(change).not.toHaveBeenCalled();
  });

  it('exposes a mixed checkbox and moves to the checked state from the keyboard', async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Select all files" defaultChecked="indeterminate" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Select all files' });
    expect(checkbox).toBePartiallyChecked();
    await user.tab();
    expect(checkbox).toHaveFocus();
    await user.keyboard(' ');
    expect(checkbox).toBeChecked();
    await user.keyboard(' ');
    expect(checkbox).not.toBeChecked();
  });
});
