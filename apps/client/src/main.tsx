import React from 'react';
import ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import './i18n';
import App from './App';
import './index.css';
import { migrateLegacyDefaultView } from './lib/view-default';

// One-time rewrite of stored legacy view defaults ('grid'/'medium') to details
migrateLegacyDefaultView();

// Expose React on window so extensions loaded via new Function() can access it
(window as unknown as Record<string, unknown>).React = React;
(window as unknown as Record<string, unknown>).ReactDOM = ReactDOM;

// Expose the Extension SDK so extensions can import from '@wisp/extension-sdk'
import * as WispSDK from '@wisp/extension-sdk';
(window as unknown as Record<string, unknown>).WispSDK = WispSDK;

import { toast } from './hooks/use-toast';
window.addEventListener('wisp:extension-toast', ((e: CustomEvent) => {
  const { title, description, variant } = e.detail;
  toast({ title, description, variant });
}) as EventListener);

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise Rejection]', event.reason);
});

createRoot(document.getElementById('root')!).render(<App />);
