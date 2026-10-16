import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Baseline,
  Bell,
  Combine,
  Copy,
  History,
  Lock,
  MousePointerClick,
  Plus,
  SquareTerminal,
  Timer,
  Type,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TauriAPI } from '@/lib/tauri-api';
import {
  MAX_TERMINAL_ENV_VARS,
  MAX_TERMINAL_SCROLLBACK,
  MAX_COMMAND_NOTIFY_SECONDS,
  MIN_TERMINAL_SCROLLBACK,
  MIN_COMMAND_NOTIFY_SECONDS,
  readTerminalEnvVars,
  writeTerminalEnvVars,
  type TerminalEnvVar,
  type TerminalLinkModifier,
} from '@/lib/terminal-settings';
import { TERMINAL_FONT_SIZE } from '@/lib/terminal-input';
import { Toggle, SelectField, SettingRow, SettingInput, SettingsSection, type AppSettings } from './shared';

/** Free-text monospace families offered as quick picks (#42); anything else
 *  goes through the custom input. */
const FONT_FAMILY_SUGGESTIONS = ['Menlo', 'SF Mono', 'JetBrains Mono', 'Cascadia Mono', 'Consolas'];
// Radix forbids empty-string option values; sentinels stand in for "none".
const CUSTOM_VALUE = '__custom__';
const BUILTIN_VALUE = '__builtin__';

interface TerminalSettingsProps {
  settings: AppSettings;
  updateSetting: (key: string, value: string | boolean | number) => void;
}

/** Editable env row: the persisted entry plus a stable React key (entries
 *  can be blank while typing, so position alone cannot key them). */
interface EnvRow extends TerminalEnvVar {
  id: string;
}

let envRowSeq = 0;
const nextEnvRowId = (): string => `env-row-${(envRowSeq += 1)}`;

/** Number box that keeps the raw draft while typing and clamps on commit
 *  (blur/Enter) — a controlled input would snap "1" back to the minimum
 *  halfway through typing "15". */
const NumberField = ({
  value,
  min,
  max,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onCommit: (value: number) => void;
}) => {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  // External updates (⌘± elsewhere, another window) only adopt when idle.
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);
  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <SettingInput
      type="number"
      min={min}
      max={max}
      step={1}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="w-24 text-right"
    />
  );
};

const TerminalSettings = ({ settings, updateSetting }: TerminalSettingsProps) => {
  const { t } = useTranslation();
  const [detectedShell, setDetectedShell] = useState<string | null>(null);
  // "Custom" keeps the select + input pair honest: picking it reveals the
  // path input without writing a bogus value until the user types one.
  const [shellCustomOpen, setShellCustomOpen] = useState(() => settings.terminalShell !== '');
  // Env entries persist through their own writer (arrays stay out of the
  // scalar updateSetting signature); drafts with an empty name simply never
  // reach storage until they become valid.
  const [envRows, setEnvRows] = useState<EnvRow[]>(() =>
    readTerminalEnvVars().map((entry) => ({ ...entry, id: nextEnvRowId() })),
  );

  useEffect(() => {
    let cancelled = false;
    TauriAPI.ptyLoginShell()
      .then((shell) => {
        if (!cancelled) setDetectedShell(shell);
      })
      .catch(() => {
        /* the Auto row falls back to the platform default text */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistEnvRows = (rows: EnvRow[]) => {
    setEnvRows(rows);
    writeTerminalEnvVars(rows.map(({ id: _id, ...entry }) => entry));
  };

  const updateEnvRow = (id: string, patch: Partial<TerminalEnvVar>) => {
    persistEnvRows(envRows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const fontFamily = settings.terminalFontFamily;
  // Picking "Custom" only reveals the editor — switching back to a suggestion
  // or Built-in closes it again.
  const [familyCustomOpen, setFamilyCustomOpen] = useState(
    () => fontFamily !== '' && !FONT_FAMILY_SUGGESTIONS.includes(fontFamily),
  );
  const fontFamilySelectValue = (() => {
    if (familyCustomOpen) return CUSTOM_VALUE;
    return FONT_FAMILY_SUGGESTIONS.includes(fontFamily) ? fontFamily : BUILTIN_VALUE;
  })();

  const linkModifierOptions = [
    { value: 'super', label: t('settings.terminal.modifierSuper') },
    { value: 'alt', label: t('settings.terminal.modifierAlt') },
    { value: 'ctrl', label: t('settings.terminal.modifierCtrl') },
  ];

  const shellOptions = [
    {
      value: 'auto',
      label: detectedShell
        ? t('settings.terminal.shellAutoDetected', { shell: detectedShell })
        : t('settings.terminal.shellAuto'),
    },
    { value: 'custom', label: t('settings.terminal.shellCustom') },
  ];

  const envFull = envRows.length >= MAX_TERMINAL_ENV_VARS;

  return (
    <div className="space-y-4">
      <SettingsSection title={t('settings.terminal.appearance')}>
        <SettingRow
          icon={Type}
          label={t('settings.terminal.fontSize')}
          description={t('settings.terminal.fontSizeDesc')}
        >
          <NumberField
            value={settings.terminalFontSize || TERMINAL_FONT_SIZE}
            min={10}
            max={28}
            label={t('settings.terminal.fontSize')}
            onCommit={(size) => updateSetting('terminalFontSize', size)}
          />
        </SettingRow>
        <SettingRow
          icon={Baseline}
          label={t('settings.terminal.fontFamily')}
          description={t('settings.terminal.fontFamilyDesc')}
        >
          <div className="flex items-center gap-2">
            <SelectField
              label={t('settings.terminal.fontFamily')}
              value={fontFamilySelectValue}
              onChange={(value) => {
                if (value === BUILTIN_VALUE) {
                  setFamilyCustomOpen(false);
                  updateSetting('terminalFontFamily', '');
                } else if (value === CUSTOM_VALUE) {
                  setFamilyCustomOpen(true);
                } else {
                  setFamilyCustomOpen(false);
                  updateSetting('terminalFontFamily', value);
                }
              }}
              options={[
                { value: BUILTIN_VALUE, label: t('settings.terminal.fontFamilyBuiltin') },
                ...FONT_FAMILY_SUGGESTIONS.map((family) => ({ value: family, label: family })),
                { value: CUSTOM_VALUE, label: t('settings.terminal.fontFamilyCustom') },
              ]}
            />
            {familyCustomOpen && (
              <SettingInput
                type="text"
                value={fontFamily}
                placeholder="JetBrains Mono"
                aria-label={t('settings.terminal.fontFamilyCustom')}
                onChange={(event) => updateSetting('terminalFontFamily', event.target.value)}
                className="w-40"
              />
            )}
          </div>
        </SettingRow>
        <SettingRow
          icon={Combine}
          label={t('settings.terminal.ligatures')}
          description={t('settings.terminal.ligaturesDesc')}
        >
          <Toggle
            id="terminalLigatures"
            label={t('settings.terminal.ligatures')}
            checked={settings.terminalLigatures}
            onChange={(v) => updateSetting('terminalLigatures', v)}
          />
        </SettingRow>
        <SettingRow
          icon={History}
          label={t('settings.terminal.scrollback')}
          description={t('settings.terminal.scrollbackDesc')}
        >
          <NumberField
            value={settings.terminalScrollback}
            min={MIN_TERMINAL_SCROLLBACK}
            max={MAX_TERMINAL_SCROLLBACK}
            label={t('settings.terminal.scrollback')}
            onCommit={(lines) => updateSetting('terminalScrollback', lines)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings.terminal.behavior')}>
        <SettingRow
          icon={Copy}
          label={t('settings.terminal.copyOnSelect')}
          description={t('settings.terminal.copyOnSelectDesc')}
        >
          <Toggle
            id="terminalCopyOnSelect"
            label={t('settings.terminal.copyOnSelect')}
            checked={settings.terminalCopyOnSelect}
            onChange={(v) => updateSetting('terminalCopyOnSelect', v)}
          />
        </SettingRow>
        <SettingRow
          icon={MousePointerClick}
          label={t('settings.terminal.linkModifier')}
          description={t('settings.terminal.linkModifierDesc')}
        >
          <SelectField
            label={t('settings.terminal.linkModifier')}
            value={settings.terminalLinkModifier || 'super'}
            onChange={(v) => updateSetting('terminalLinkModifier', v as TerminalLinkModifier)}
            options={linkModifierOptions}
          />
        </SettingRow>
        <SettingRow
          icon={Lock}
          label={t('settings.terminal.readonlyDefault')}
          description={t('settings.terminal.readonlyDefaultDesc')}
        >
          <Toggle
            id="terminalReadonlyDefault"
            label={t('settings.terminal.readonlyDefault')}
            checked={settings.terminalReadonlyByDefault}
            onChange={(v) => updateSetting('terminalReadonlyByDefault', v)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings.terminal.alerts')}>
        <SettingRow
          icon={Bell}
          label={t('settings.terminal.bell')}
          description={t('settings.terminal.bellDesc')}
        >
          <Toggle
            id="terminalBell"
            label={t('settings.terminal.bell')}
            checked={settings.terminalBell}
            onChange={(v) => updateSetting('terminalBell', v)}
          />
        </SettingRow>
        <SettingRow
          icon={Timer}
          label={t('settings.terminal.commandNotify')}
          description={t('settings.terminal.commandNotifyDesc')}
        >
          <div className="flex items-center gap-2">
            <NumberField
              value={settings.terminalCommandNotifySeconds}
              min={MIN_COMMAND_NOTIFY_SECONDS}
              max={MAX_COMMAND_NOTIFY_SECONDS}
              label={t('settings.terminal.commandNotify')}
              onCommit={(seconds) => updateSetting('terminalCommandNotifySeconds', seconds)}
            />
            <span className="text-xs text-xp-text-secondary">
              {t('settings.terminal.commandNotifyUnit')}
            </span>
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t('settings.terminal.shellSection')}
        description={t('settings.terminal.shellSectionDesc')}
      >
        <SettingRow
          icon={SquareTerminal}
          label={t('settings.terminal.shell')}
          description={t('settings.terminal.shellDesc')}
        >
          <SelectField
            label={t('settings.terminal.shell')}
            value={shellCustomOpen || settings.terminalShell ? 'custom' : 'auto'}
            onChange={(value) => {
              if (value === 'custom') {
                setShellCustomOpen(true);
              } else {
                setShellCustomOpen(false);
                updateSetting('terminalShell', '');
              }
            }}
            options={shellOptions}
          />
        </SettingRow>
        {(shellCustomOpen || settings.terminalShell) && (
          <SettingRow label={t('settings.terminal.shellCustomPath')}>
            <SettingInput
              type="text"
              value={settings.terminalShell}
              placeholder="/opt/homebrew/bin/fish"
              aria-label={t('settings.terminal.shellCustomPath')}
              onChange={(event) => updateSetting('terminalShell', event.target.value)}
              className="w-64 font-mono text-xs"
            />
          </SettingRow>
        )}
        <div className="px-3 pb-2 pt-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-[13px] font-normal leading-4 text-xp-text">
              {t('settings.terminal.envTitle')}
            </h4>
            <span className="text-xs text-xp-text-secondary">
              {envRows.length}/{MAX_TERMINAL_ENV_VARS}
            </span>
          </div>
          <p className="mt-1 text-xs leading-[1.4] text-xp-text-secondary">
            {t('settings.terminal.envDesc')}
          </p>
          <div className="mt-3 space-y-2">
            {envRows.length === 0 && (
              <p className="text-xs text-xp-text-secondary">{t('settings.terminal.envEmpty')}</p>
            )}
            {envRows.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <SettingInput
                  type="text"
                  value={row.key}
                  placeholder="EDITOR"
                  aria-label={t('settings.terminal.envKey')}
                  spellCheck={false}
                  onChange={(event) => updateEnvRow(row.id, { key: event.target.value })}
                  className="w-40 font-mono text-xs"
                />
                <SettingInput
                  type="text"
                  value={row.value}
                  placeholder="vim"
                  aria-label={t('settings.terminal.envValue')}
                  onChange={(event) => updateEnvRow(row.id, { value: event.target.value })}
                  className="min-w-0 flex-1 font-mono text-xs"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t('settings.terminal.envRemove')}
                  title={t('settings.terminal.envRemove')}
                  onClick={() => persistEnvRows(envRows.filter((entry) => entry.id !== row.id))}
                >
                  <X size={13} aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              disabled={envFull}
              onClick={() => persistEnvRows([...envRows, { id: nextEnvRowId(), key: '', value: '' }])}
            >
              <Plus size={13} aria-hidden="true" />
              {t('settings.terminal.envAdd')}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
};

export default TerminalSettings;
