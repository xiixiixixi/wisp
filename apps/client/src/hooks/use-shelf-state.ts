import { useEffect, useSyncExternalStore } from 'react';
import { TauriAPI, type ShelfRequest, type ShelfState } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';

interface ShelfResource {
  state: ShelfState | null;
  loading: boolean;
  error: string | null;
}

let resource: ShelfResource = { state: null, loading: false, error: null };
const subscribers = new Set<() => void>();
let consumers = 0;
let listenerGeneration = 0;
let eventRevision = 0;
let nativeRevision: number | null = null;
let listenerError: string | null = null;
let unlisten: (() => void) | null = null;
let refreshPromise: Promise<ShelfState> | null = null;

const notify = (next: ShelfResource) => {
  resource = next;
  subscribers.forEach((subscriber) => subscriber());
};

const acceptState = (state: ShelfState) => {
  if (state.supported && typeof state.revision === 'number') {
    if (nativeRevision !== null && state.revision < nativeRevision) return;
    nativeRevision = state.revision;
  } else if (!state.supported) nativeRevision = null;
  notify({ state, loading: false, error: state.error ?? listenerError });
};

const subscribe = (callback: () => void) => {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
};

const getSnapshot = () => resource;

export const requestShelf = async (request: ShelfRequest): Promise<ShelfState> => {
  const revision = eventRevision;
  try {
    const state = await TauriAPI.shelfRequest(request);
    // A newer native event must not be replaced by an older in-flight reply.
    if (revision === eventRevision || (state.supported && typeof state.revision === 'number')) {
      acceptState(state);
    }
    return state;
  } catch (error) {
    notify({ ...resource, loading: false, error: String(error) });
    throw error;
  }
};

export const refreshShelfState = (): Promise<ShelfState> => {
  if (refreshPromise) return refreshPromise;
  notify({ ...resource, loading: resource.state === null, error: listenerError });
  refreshPromise = requestShelf({ action: 'snapshot' }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
};

const connect = async () => {
  const generation = ++listenerGeneration;
  listenerError = null;
  notify({ ...resource, loading: resource.state === null, error: null });
  if (isTauri()) {
    try {
      const stop = await TauriAPI.listenToShelfState((state) => {
        if (generation !== listenerGeneration) return;
        eventRevision += 1;
        acceptState(state);
      });
      if (generation !== listenerGeneration) {
        stop();
        return;
      }
      unlisten = stop;
    } catch (error) {
      if (generation !== listenerGeneration) return;
      listenerError = String(error);
      notify({ ...resource, error: listenerError });
    }
  }
  if (generation !== listenerGeneration) return;
  // Register first, then read: changes cannot fall between the snapshot and listener.
  if (refreshPromise) {
    try {
      await refreshPromise;
    } catch {
      // Read again after registration, even when an earlier disconnected read failed.
    }
    if (generation !== listenerGeneration) return;
  }
  void refreshShelfState().catch(() => undefined);
};

/** All Wisp surfaces read one native-owned snapshot; no local duplicate is saved. */
export const useShelfState = () => {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    consumers += 1;
    if (consumers === 1) void connect();
    return () => {
      consumers -= 1;
      if (consumers === 0) {
        listenerGeneration += 1;
        // A helper can restart while no Wisp surface is subscribed.
        nativeRevision = null;
        unlisten?.();
        unlisten = null;
      }
    };
  }, []);
  return { ...snapshot, refresh: refreshShelfState, request: requestShelf };
};
