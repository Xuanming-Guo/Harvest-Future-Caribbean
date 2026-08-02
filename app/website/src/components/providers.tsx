"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { createDevelopmentSession, currentActor, ensureDevelopmentSession, type SessionActor } from "@/lib/api";

interface SessionContextValue {
  actor: SessionActor | null;
  ready: boolean;
  switchPersona: (persona: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } }));
  const [actor, setActor] = useState<SessionActor | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setActor(currentActor());
    ensureDevelopmentSession()
      .then(setActor)
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<SessionContextValue>(() => ({
    actor,
    ready,
    async switchPersona(persona) {
      const next = await createDevelopmentSession(persona);
      setActor(next);
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
