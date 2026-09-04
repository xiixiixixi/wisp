import React from 'react';
import { createPortal } from 'react-dom';

const HOST_ID = 'wisp-bottom-right-overlay-stack';

const ensureHost = (): HTMLElement | null => {
  if (typeof document === 'undefined') return null;

  const existing = document.getElementById(HOST_ID);
  if (existing) return existing;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.className =
    'pointer-events-none fixed bottom-4 right-4 z-[9998] flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-sm flex-col-reverse gap-2 overflow-y-auto';
  document.body.appendChild(host);
  return host;
};

interface BottomRightOverlayStackItemProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Places independently owned bottom-right notices in one shared visual stack.
 * The persistent host avoids layout collisions without coupling their state or
 * close/cancel behavior.
 */
export const BottomRightOverlayStackItem = ({
  children,
  className = '',
}: BottomRightOverlayStackItemProps) => {
  const host = React.useMemo(ensureHost, []);
  if (!host) return null;

  return createPortal(
    <div className={`pointer-events-auto w-full ${className}`.trim()}>{children}</div>,
    host,
  );
};
