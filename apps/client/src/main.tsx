import React from 'react';
import ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import './i18n';
import { migrateFolderColorsToFinderTags } from '@/lib/folder-colors';
import { ensureTagPalette } from '@/lib/file-tags-cache';
import { installAutoScrollbars } from '@/lib/auto-scrollbars';
import App from './App';
import SkySync from '@/components/weather/SkySync';
import './index.css';
import './styles/liquid-glass.css';
import { migrateLegacyDefaultView } from './lib/view-default';

// One-time rewrite of stored legacy view defaults ('grid'/'medium') to details
migrateLegacyDefaultView();

// Finder-style scrollbars: only visible while actually scrolling
installAutoScrollbars();

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

// One-time: convert private folder colours into real Finder tags,
// and preload Finder's tag palette for the context menu.
migrateFolderColorsToFinderTags();
ensureTagPalette();

// Radix portals hide the application root while a modal surface is open.
// Mirror that state to the native inert attribute so hidden controls also
// leave the keyboard focus order until the elevated surface closes.
const appRoot = document.getElementById('root')!;
let inertReturnTarget: HTMLElement | null = null;
const syncRootInert = () => {
  const hidden = appRoot.getAttribute('aria-hidden') === 'true';
  if (hidden) {
    inertReturnTarget = appRoot.querySelector<HTMLElement>('[aria-expanded="true"]');
    appRoot.setAttribute('inert', '');
    return;
  }

  appRoot.removeAttribute('inert');
  const returnTarget = inertReturnTarget;
  inertReturnTarget = null;
  queueMicrotask(() => {
    if (document.activeElement === document.body && returnTarget?.isConnected) {
      returnTarget.focus({ preventScroll: true });
    }
  });
};
new MutationObserver(syncRootInert).observe(appRoot, {
  attributes: true,
  attributeFilter: ['aria-hidden'],
});

createRoot(appRoot).render(
  <>
    <SkySync />
    <App />
  </>,
);
