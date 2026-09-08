import { useTranslation } from 'react-i18next';
import React from 'react';
import { extensionHost } from '@/lib/extension-host';

interface ExtensionPanelHostProps {
  panelId: string;
  builtinProps?: Record<string, unknown>;
}

const ExtensionPanelHost = ({ panelId, builtinProps }: ExtensionPanelHostProps) => {
  const { t: tUi } = useTranslation();
  const panel = extensionHost.getPanel(panelId);

  if (!panel) {
    return (
      <div className="p-4 text-sm text-xp-text-muted">
        {tUi('messages.panelNotFound', { panel: panelId })}
      </div>
    );
  }

  try {
    return panel.render(builtinProps || {});
  } catch (err) {
    return (
      <div className="p-4 text-sm text-xp-red">
        {tUi('messages.panelRenderError', { panel: panel.title, error: String(err) })}
      </div>
    );
  }
};

export default ExtensionPanelHost;
