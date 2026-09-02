"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  clearDevelopmentSession,
  consumeDevelopmentPersona,
  consumeSimulationSession,
  createDevelopmentSession,
  currentActor,
  type SessionActor,
} from "@/lib/api";
import {
  QUERY_CACHE_BUSTER,
  QUERY_CACHE_MAX_AGE,
  createLocalStoragePersister,
} from "@/lib/offline";
import { flushOutbox } from "@/lib/outbox";

interface SessionContextValue {
  actor: SessionActor | null;
  ready: boolean;
  signIn: (persona: string) => Promise<SessionActor>;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    // Cached reads must outlive the default garbage collection window, or a
    // restored offline cache would be discarded moments after it is rehydrated.
    defaultOptions: { queries: { staleTime: 5_000, gcTime: QUERY_CACHE_MAX_AGE, retry: 1, refetchOnWindowFocus: true } },
  }));
  const [persister] = useState(() => createLocalStoragePersister());
  const [actor, setActor] = useState<SessionActor | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const launchedActor = await consumeDevelopmentPersona();
        setActor(launchedActor ?? await consumeSimulationSession() ?? currentActor());
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // A replayed simulation identity must never install a worker or send a write.
  const offlineCapable = ready && Boolean(actor) && !actor?.readOnly;

  useEffect(() => {
    if (!offlineCapable || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // An unavailable worker only costs the offline shell, never the workspace.
    });
  }, [offlineCapable]);

  useEffect(() => {
    if (!offlineCapable || !actor) return;
    const flush = () => {
      void flushOutbox(actor).then((items) => {
        if (items.some((item) => item.status === "synced")) void queryClient.invalidateQueries();
      });
    };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [offlineCapable, actor, queryClient]);

  const value = useMemo<SessionContextValue>(() => ({
    actor,
    ready,
    async signIn(persona) {
      const next = await createDevelopmentSession(persona);
      setActor(next);
      queryClient.clear();
      return next;
    },
    signOut() {
      clearDevelopmentSession();
      setActor(null);
      queryClient.clear();
      void persister.removeClient();
    },
  }), [actor, ready, queryClient, persister]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: QUERY_CACHE_MAX_AGE, buster: QUERY_CACHE_BUSTER }}
    >
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </PersistQueryClientProvider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within Providers");
  return value;
}
