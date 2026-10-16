import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { extensionHost } from '@/lib/extension-host';
import { Button } from '@/components/ui/button';
import { PanelMessage } from './PanelFeedback';

interface ExtensionPanelHostProps {
  panelId: string;
  builtinProps?: Record<string, unknown>;
}

class PanelBoundary extends React.Component<
  { children: React.ReactNode; fallback: (error: Error) => React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
const PanelRenderer = ({
  render,
  props,
}: {
  render: (props: Record<string, unknown>) => React.ReactNode;
  props: Record<string, unknown>;
}) => <>{render(props)}</>;

const ExtensionPanelHost = ({ panelId, builtinProps }: ExtensionPanelHostProps) => {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const panel = extensionHost.getPanel(panelId);
  if (!panel)
    {return (
      <div className="space-y-3 p-4">
        <PanelMessage>{t('panelActions.extensionUnavailable')}</PanelMessage>
        <p className="wisp-panel-help">{t('panelActions.extensionUnavailableHelp')}</p>
        <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          {t('common.error.tryAgain')}
        </Button>
      </div>
    );}
  return (
    <PanelBoundary
      key={`${panelId}:${attempt}`}
      fallback={(error) => (
        <div className="space-y-3 p-4">
          <PanelMessage error>
            {t('panelActions.extensionFailed', { name: panel.title })}
          </PanelMessage>
          <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            {t('common.error.tryAgain')}
          </Button>
          <details className="text-xs text-xp-text-secondary">
            <summary className="cursor-pointer">{t('panelActions.errorDetails')}</summary>
            <p className="mt-2 break-words">{String(error)}</p>
          </details>
        </div>
      )}
    >
      <PanelRenderer render={panel.render} props={builtinProps || {}} />
    </PanelBoundary>
  );
};
export default ExtensionPanelHost;
