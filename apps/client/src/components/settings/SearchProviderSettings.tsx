import { Brain, Cpu, Key } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { SettingRow, type AppSettings, SettingsSection } from './shared';

interface SearchProviderSettingsProps {
  settings: AppSettings;
  updateSetting: (key: string, value: string | boolean | number) => void;
}

const MODEL_PLACEHOLDERS: Record<string, string> = {
  claude: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  ollama: 'llama3',
  openrouter: 'anthropic/claude-sonnet-4',
};

const SearchProviderSettings = ({ settings, updateSetting }: SearchProviderSettingsProps) => {
  const { t } = useTranslation();
  const provider = settings.aiSearchProvider || 'auto';
  const usesRemoteKey = provider !== 'auto' && provider !== 'ollama';
  let apiKeyPlaceholder = 'sk-...';
  if (provider === 'claude') apiKeyPlaceholder = 'sk-ant-...';
  if (provider === 'openrouter') apiKeyPlaceholder = 'sk-or-...';

  return (
    <section className="border-t border-xp-border pt-7" data-testid="search-provider-settings">
      <SettingsSection
        title={t('settings.ai.aiSearch')}
        description={t('settings.ai.searchProviderDesc')}
      >
        <SettingRow
          icon={Cpu}
          label={t('settings.ai.searchProvider')}
          description={t('settings.ai.searchProviderDesc')}
        >
          <Select
            value={provider}
            onValueChange={(value) => updateSetting('aiSearchProvider', value)}
          >
            <SelectTrigger className="h-9 min-w-[160px]" aria-label="AI Search Provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('settings.ai.providerAuto')}</SelectItem>
              <SelectItem value="ollama">{t('settings.ai.providerOllama')}</SelectItem>
              <SelectItem value="claude">{t('settings.ai.providerClaude')}</SelectItem>
              <SelectItem value="openai">{t('settings.ai.providerOpenAI')}</SelectItem>
              <SelectItem value="openrouter">{t('settings.ai.providerOpenRouter')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <div className="rounded-[2px] px-4 py-3 transition-colors hover:bg-xp-surface-light/50">
          <div className="mb-2 flex items-center gap-3">
            <Brain size={18} className="shrink-0 text-xp-text-secondary" aria-hidden="true" />
            <div>
              <div className="text-sm font-medium text-xp-text">{t('settings.ai.searchModel')}</div>
              <div className="mt-0.5 text-xs text-xp-text-secondary">
                {t('settings.ai.searchModelDesc')}
              </div>
            </div>
          </div>
          <input
            type="text"
            value={settings.aiSearchModel || ''}
            onChange={(event) => updateSetting('aiSearchModel', event.target.value)}
            placeholder={MODEL_PLACEHOLDERS[provider] || t('settings.ai.searchModelPlaceholder')}
            className="ml-[30px] h-9 w-[calc(100%_-_30px)] rounded-[2px] border border-xp-border bg-xp-bg px-3 font-mono text-sm text-xp-text transition-colors hover:border-xp-text-secondary focus:border-xp-text-secondary focus:outline-none"
          />
        </div>

        {usesRemoteKey && (
          <div className="rounded-[2px] px-4 py-3 transition-colors hover:bg-xp-surface-light/50">
            <div className="mb-2 flex items-center gap-3">
              <Key size={18} className="shrink-0 text-xp-text-secondary" aria-hidden="true" />
              <div>
                <div className="text-sm font-medium text-xp-text">
                  {t('settings.ai.searchApiKey')}
                </div>
                <div className="mt-0.5 text-xs text-xp-text-secondary">
                  {t('settings.ai.searchApiKeyDesc')}
                </div>
              </div>
            </div>
            <input
              type="password"
              value={settings.aiSearchApiKey || ''}
              onChange={(event) => updateSetting('aiSearchApiKey', event.target.value)}
              placeholder={apiKeyPlaceholder}
              className="ml-[30px] h-9 w-[calc(100%_-_30px)] rounded-[2px] border border-xp-border bg-xp-bg px-3 font-mono text-sm text-xp-text transition-colors hover:border-xp-text-secondary focus:border-xp-text-secondary focus:outline-none"
            />
          </div>
        )}
      </SettingsSection>{' '}
      <div className="rounded-[2px] px-4 py-3 transition-colors hover:bg-xp-surface-light/50">
        <div className="mb-2 flex items-center gap-3">
          <Cpu size={18} className="shrink-0 text-xp-text-secondary" aria-hidden="true" />
          <div>
            <div className="text-sm font-medium text-xp-text">
              {t('settings.ai.ollamaEndpoint')}
            </div>
            <div className="mt-0.5 text-xs text-xp-text-secondary">
              {t('settings.ai.ollamaEndpointDesc')}
            </div>
          </div>
        </div>
        <input
          type="text"
          defaultValue={localStorage.getItem(STORAGE_KEYS.OLLAMA_URL) || 'http://localhost:11434'}
          onChange={(event) => localStorage.setItem(STORAGE_KEYS.OLLAMA_URL, event.target.value)}
          placeholder="http://localhost:11434"
          className="ml-[30px] h-9 w-[calc(100%_-_30px)] rounded-[2px] border border-xp-border bg-xp-bg px-3 font-mono text-sm text-xp-text transition-colors hover:border-xp-text-secondary focus:border-xp-text-secondary focus:outline-none"
        />
      </div>
    </section>
  );
};

export default SearchProviderSettings;
