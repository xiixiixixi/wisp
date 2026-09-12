import { Slider } from '@/components/ui/slider';
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Copy, MoreHorizontal, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ContextMenu from '@/components/ui/ContextMenu';
import { SettingRow, SettingsSection, Toggle } from '@/components/settings/shared';
import '../index.css';
import '../styles/liquid-glass.css';
import '../styles/fluid-glass.css';
import '../styles/design-system.css';

/** A separate development entry using the real application controls.
 * Specimen interactions update local values and expose no file or system operations. */
function ComponentPreview() {
  const [appearance, setAppearance] = useState('light');
  const [checked, setChecked] = useState(true);
  const [mixed, setMixed] = useState<boolean | 'indeterminate'>('indeterminate');
  const [enabled, setEnabled] = useState(true);
  const [secondaryEnabled, setSecondaryEnabled] = useState(false);
  const [text, setText] = useState('Component preview');
  const [selection, setSelection] = useState('medium');
  const [range, setRange] = useState(60);
  const [radio, setRadio] = useState('automatic');
  const [notes, setNotes] = useState('A multiline field for reviewing text, selection, and focus.');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogText, setDialogText] = useState('Untitled specimen');
  const [notice, setNotice] = useState('Ready to inspect. Changes stay in this preview.');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('theme-light', appearance === 'light');
    html.classList.toggle('theme-fluid', appearance === 'light');
    html.classList.toggle('theme-rolex', appearance === 'dark');
    html.style.colorScheme = appearance;
    html.lang = 'en';
  }, [appearance]);

  const runAction = (name: string) => setNotice(`${name} pressed. Preview state only.`);
  const showMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setMenu({ x: bounds.left, y: bounds.bottom + 6 });
  };

  return (
    <div className="h-dvh overflow-y-auto bg-xp-bg text-xp-text">
      <header className="wisp-titlebar sticky top-0 z-10 border-b border-xp-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <Settings2 size={22} aria-hidden="true" />
            <div>
              <h1 className="text-lg font-semibold">Component Preview</h1>
              <p className="text-xs text-xp-text-secondary">
                Development only · Shared Wisp controls
              </p>
            </div>
          </div>
          <Tabs value={appearance} onValueChange={setAppearance}>
            <TabsList aria-label="Preview appearance">
              <TabsTrigger value="light">Light</TabsTrigger>
              <TabsTrigger value="dark">Dark</TabsTrigger>
            </TabsList>
            <TabsContent value="light" className="sr-only" tabIndex={-1}>
              Light appearance
            </TabsContent>
            <TabsContent value="dark" className="sr-only" tabIndex={-1}>
              Dark appearance
            </TabsContent>
          </Tabs>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-5 px-6 py-6 md:grid-cols-2">
        <PreviewSection
          title="Buttons"
          description="Action hierarchy, sizing, and disabled states."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => runAction('Primary')}>Primary</Button>
            <Button variant="secondary" onClick={() => runAction('Secondary')}>
              Secondary
            </Button>
            <Button variant="outline" onClick={() => runAction('Outline')}>
              Outline
            </Button>
            <Button variant="ghost" onClick={() => runAction('Ghost')}>
              Ghost
            </Button>
            <Button variant="destructive" onClick={() => runAction('Destructive')}>
              Destructive
            </Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-xp-border pt-4">
            <Button size="sm" variant="secondary" onClick={() => runAction('Small')}>
              Small
            </Button>
            <Button variant="secondary" onClick={() => runAction('Regular')}>
              Regular
            </Button>
            <Button size="lg" variant="secondary" onClick={() => runAction('Large')}>
              Large
            </Button>
            <Button
              variant="ghost"
              aria-label="More preview actions"
              title="More preview actions"
              onClick={showMenu}
            >
              <MoreHorizontal size={18} aria-hidden="true" />
            </Button>
          </div>
        </PreviewSection>

        <PreviewSection
          title="Fields"
          description="Editable, invalid, disabled, and menu selection."
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Text field" htmlFor="preview-text">
              <Input
                id="preview-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
            <Field label="Text size" htmlFor="preview-select">
              <Select value={selection} onValueChange={setSelection}>
                <SelectTrigger id="preview-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Text size</SelectLabel>
                    <SelectItem value="small">Small</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="large">Large</SelectItem>
                    <SelectItem value="unavailable" disabled>
                      Unavailable
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Invalid field" htmlFor="preview-invalid">
              <Input
                id="preview-invalid"
                aria-invalid="true"
                aria-describedby="preview-invalid-help"
                placeholder="Required value"
              />
              <p id="preview-invalid-help" className="text-xs text-xp-red">
                Enter a value to continue.
              </p>
            </Field>
            <Field label="Disabled field" htmlFor="preview-disabled">
              <Input id="preview-disabled" value="Unavailable" disabled />
            </Field>
          </div>
        </PreviewSection>

        <PreviewSection
          title="Checkboxes"
          description="Use labels and marks to make each state clear."
        >
          <div className="grid grid-cols-2 gap-4">
            <CheckRow id="preview-check" label="Checked" checked={checked} onChange={setChecked} />
            <CheckRow
              id="preview-mixed"
              label="Mixed selection"
              checked={mixed}
              onChange={setMixed}
            />
            <CheckRow id="preview-check-disabled" label="Disabled" checked={false} disabled />
            <CheckRow id="preview-check-disabled-on" label="Disabled checked" checked disabled />
          </div>
          <div className="mt-4">
            <Button size="sm" variant="ghost" onClick={() => setMixed('indeterminate')}>
              Reset mixed state
            </Button>
          </div>
        </PreviewSection>

        <SettingsSection
          title="Switches"
          description="The same rows and switches used in settings."
        >
          <SettingRow
            label="Enabled switch"
            description="Click or press Space to change the state."
          >
            <Toggle
              id="preview-enabled"
              label="Enabled switch"
              checked={enabled}
              onChange={setEnabled}
            />
          </SettingRow>
          <SettingRow label="Secondary switch" description="Starts in the off state.">
            <Toggle
              id="preview-secondary"
              label="Secondary switch"
              checked={secondaryEnabled}
              onChange={setSecondaryEnabled}
            />
          </SettingRow>
        </SettingsSection>

        <PreviewSection
          title="Segmented controls"
          description="Arrow keys, Home, and End change the active segment."
        >
          <Tabs defaultValue="general">
            <TabsList aria-label="Preview sections">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="disabled" disabled>
                Unavailable
              </TabsTrigger>
            </TabsList>
            <TabsContent value="general">
              <p className="text-sm text-xp-text-secondary">General controls are selected.</p>
            </TabsContent>
            <TabsContent value="details">
              <p className="text-sm text-xp-text-secondary">Details controls are selected.</p>
            </TabsContent>
            <TabsContent value="disabled">This segment is unavailable.</TabsContent>
          </Tabs>
        </PreviewSection>

        <PreviewSection
          title="Badges"
          description="Status uses both a label and a distinct visual treatment."
        >
          <div className="flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="destructive">Error</Badge>
          </div>
          <p className="mt-4 text-sm text-xp-text-secondary">
            This is the shared Card surface. Content remains readable beneath the functional layer.
          </p>
        </PreviewSection>

        <PreviewSection
          title="Native controls"
          description="Browser controls inherit the same semantic colors."
        >
          <div className="space-y-4">
            <Field label={`Preview level: ${range}%`} htmlFor="preview-range">
              <Slider
                id="preview-range"
                min="0"
                max="100"
                value={range}
                onChange={(event) => setRange(Number(event.target.value))}
                className="w-full"
              />
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Radio options</legend>
              <div className="flex flex-wrap gap-4">
                {['automatic', 'manual'].map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="preview-mode"
                      value={value}
                      checked={radio === value}
                      onChange={() => setRadio(value)}
                    />
                    {value === 'automatic' ? 'Automatic' : 'Manual'}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm text-xp-text-secondary">
                  <input type="radio" name="preview-mode" value="disabled" disabled />
                  Unavailable
                </label>
              </div>
            </fieldset>
            <Field label="Notes" htmlFor="preview-notes">
              <textarea
                id="preview-notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="w-full rounded-lg border border-xp-border bg-xp-surface-light p-3 text-sm"
              />
            </Field>
          </div>
        </PreviewSection>

        <PreviewSection
          title="Presentations"
          description="Menus and dialogs use the elevated material."
        >
          <div className="flex flex-wrap gap-2">
            <Button
              id="preview-open-dialog"
              variant="secondary"
              onClick={() => setDialogOpen(true)}
            >
              Open Dialog…
            </Button>
            <Button
              variant="outline"
              onClick={showMenu}
              aria-haspopup="menu"
              aria-expanded={menu !== null}
            >
              Open Menu
            </Button>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-xp-text-secondary">
            Open the dialog to check autofocus, Tab containment, Return to save, Escape to close,
            and focus returning to its opener.
          </p>
          <p className="mt-4 border-t border-xp-border pt-4 text-xs leading-relaxed text-xp-text-secondary">
            This page is a development specimen. Its controls update preview values and expose no
            file or system operations.
          </p>
        </PreviewSection>

        <p
          role="status"
          aria-live="polite"
          className="text-sm text-xp-text-secondary md:col-span-2"
        >
          {notice}
        </p>
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} maxWidth="28rem">
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setNotice(`Saved specimen name: ${dialogText}`);
              setDialogOpen(false);
            }}
          >
            <DialogHeader>
              <div className="flex items-center justify-between gap-4">
                <DialogTitle>Edit Specimen</DialogTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Close dialog"
                  title="Close dialog"
                  onClick={() => setDialogOpen(false)}
                >
                  <X size={16} aria-hidden="true" />
                </Button>
              </div>
              <DialogDescription>This dialog edits only the local preview name.</DialogDescription>
            </DialogHeader>
            <div className="mb-5">
              <Field label="Specimen name" htmlFor="preview-dialog-name">
                <Input
                  id="preview-dialog-name"
                  data-autofocus
                  value={dialogText}
                  onChange={(event) => setDialogText(event.target.value)}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ContextMenu
        isOpen={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={[
          {
            id: 'preview-action',
            label: 'Run Preview Action',
            icon: <Copy size={15} />,
            shortcut: 'Cmd+C',
            action: () => runAction('Menu action'),
          },
          {
            id: 'preview-option',
            label: 'Checked Option',
            icon: <Check size={15} />,
            checked,
            action: () => setChecked(!checked),
          },
          { id: 'preview-separator', label: '', separator: true },
          { id: 'preview-unavailable', label: 'Unavailable Action', disabled: true },
        ]}
      />
    </div>
  );
}

function PreviewSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function CheckRow({
  id,
  label,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  checked: boolean | 'indeterminate';
  onChange?: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange?.(value === true)}
      />
      <label
        htmlFor={id}
        className={`text-sm ${disabled ? 'text-xp-text-secondary' : 'text-xp-text'}`}
      >
        {label}
      </label>
    </div>
  );
}

if (import.meta.env.DEV) {
  const root = document.getElementById('component-preview-root');
  if (root) createRoot(root).render(<ComponentPreview />);
}
