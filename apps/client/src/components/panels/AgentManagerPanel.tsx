import { useTranslation } from 'react-i18next';
import { History, Play, Radio } from 'lucide-react';
import ExternalAgentLauncher from './agent-manager/ExternalAgentLauncher';
import ProjectMemorySection from './agent-manager/ProjectMemorySection';
import TerminalAgentDetector from './agent-manager/TerminalAgentDetector';

interface AgentManagerPanelProps {
  currentPath: string;
}

interface SectionTitleProps {
  icon: typeof Play;
  title: string;
}

const SectionTitle = ({ icon: Icon, title }: SectionTitleProps) => (
  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-xp-text-muted">
    <Icon size={12} aria-hidden="true" />
    <span>{title}</span>
  </div>
);

const AgentManagerPanel = ({ currentPath }: AgentManagerPanelProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="agent-cockpit">
      <div className="border-b border-xp-border px-3 py-3">
        <p className="text-xs leading-5 text-xp-text-secondary">
          {t('agentManager.cockpit.description')}
        </p>
      </div>

      <section className="flex flex-col gap-3 border-b border-xp-border px-3 py-4">
        <SectionTitle icon={Play} title={t('agentManager.cockpit.startTitle')} />
        <ExternalAgentLauncher currentPath={currentPath} />
      </section>

      <section className="flex flex-col gap-2 border-b border-xp-border px-3 py-4">
        <SectionTitle icon={Radio} title={t('agentManager.cockpit.runningTitle')} />
        <TerminalAgentDetector />
      </section>

      <section className="flex flex-col gap-2 px-3 py-4">
        <SectionTitle icon={History} title={t('agentManager.cockpit.historyTitle')} />
        <ProjectMemorySection currentPath={currentPath} />
      </section>
    </div>
  );
};

export default AgentManagerPanel;
