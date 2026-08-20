"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  clearDevelopmentSession,
  consumeDevelopmentPersona,
  consumeSimulationSession,
  createDevelopmentSession,
  currentActor,
  type SessionActor,
} from "@/lib/api";

interface SessionContextValue {
  actor: SessionActor | null;
  ready: boolean;
  signIn: (persona: string) => Promise<SessionActor>;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true } },
  }));
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
    },
  }), [actor, ready, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </QueryClientProvider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within Providers");
  return value;
}
