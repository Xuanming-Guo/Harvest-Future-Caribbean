import type { PersistedClient, Persister } from "@tanstack/query-persist-client-core";

const CACHE_KEY = "harvest.query-cache.v1";
const CACHE_TIMESTAMP_KEY = "harvest.query-cache.updated-at";

/** Bump when a contract change makes an older cached payload unsafe to reuse. */
export const QUERY_CACHE_BUSTER = "harvest-1";
export const QUERY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * Keeps the last successful read of every Product API query on the device so a
 * farmer with no signal still opens a populated workspace instead of a spinner.
 * Only responses already fetched for this actor are stored; nothing is invented.
 */
export function createLocalStoragePersister(): Persister {
  if (typeof window === "undefined") {
    return { persistClient: () => undefined, restoreClient: () => undefined, removeClient: () => undefined };
  }
  return {
    persistClient(client: PersistedClient) {
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(client));
        window.localStorage.setItem(CACHE_TIMESTAMP_KEY, String(client.timestamp));
      } catch {
        // A full or blocked storage quota must never break the workspace.
      }
    },
    restoreClient() {
      const stored = window.localStorage.getItem(CACHE_KEY);
      if (!stored) return undefined;
      try {
        return JSON.parse(stored) as PersistedClient;
      } catch {
        return undefined;
      }
    },
    removeClient() {
      window.localStorage.removeItem(CACHE_KEY);
      window.localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    },
  };
}

/** When the cached data on this device was last written by a successful read. */
export function readCacheTimestamp(): number | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(CACHE_TIMESTAMP_KEY);
  const timestamp = stored ? Number(stored) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function subscribeToConnection(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
