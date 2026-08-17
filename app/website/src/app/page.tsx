"use client";

import { ArrowRight, ClipboardCheck, Leaf, ShoppingBasket, Sprout, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useSession } from "@/components/providers";
import { roleHome } from "@/lib/api";

const personas = [
  { id: "farmer-ana", role: "Farmer", name: "Ana Joseph", detail: "Update crops, review forecasts and approve supply.", Icon: Sprout },
  { id: "buyer-hotel", role: "Buyer", name: "Bay Gardens Hotel", detail: "Find local produce, place orders and receive deliveries.", Icon: ShoppingBasket },
  { id: "transporter-daniel", role: "Transporter", name: "Daniel Felix", detail: "Accept delivery jobs and share journey updates.", Icon: Truck },
  { id: "coordinator-maya", role: "Coordinator", name: "Maya Charles", detail: "Resolve missing information, approvals and exceptions.", Icon: ClipboardCheck },
] as const;

export default function SignInPage() {
  const router = useRouter();
  const { actor, ready, signIn } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && actor) router.replace(roleHome(actor.role));
  }, [actor, ready, router]);

  async function choose(persona: string) {
    setBusy(persona);
    setError(null);
    try {
      const next = await signIn(persona);
      router.replace(roleHome(next.role));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect to Harvest.");
      setBusy(null);
    }
  }

  return (
    <main className="sign-in-page">
      <div className="sign-in-copy">
        <div className="brand sign-in-brand"><span className="brand-mark"><Leaf size={24} /></span><strong>Harvest</strong></div>
        <p className="eyebrow">Saint Lucia food coordination</p>
        <h1>Local food, coordinated from field to table.</h1>
        <p>Choose a demo role to explore the same product each participant uses in the Harvest network.</p>
      </div>
      <section className="role-picker" aria-label="Demo roles">
        <div className="role-picker-heading"><p className="eyebrow">Demo sign in</p><h2>Who are you working as?</h2></div>
        <div className="role-grid">
          {personas.map(({ id, role, name, detail, Icon }) => (
            <button key={id} className="role-card" onClick={() => void choose(id)} disabled={!ready || busy !== null}>
              <span className="role-icon"><Icon size={22} /></span>
              <span><small>{role}</small><strong>{name}</strong><em>{detail}</em></span>
              {busy === id ? <span className="spinner" /> : <ArrowRight size={19} />}
            </button>
          ))}
        </div>
        {error && <p className="form-error">{error} Make sure the Product API is running on port 3001.</p>}
      </section>
    </main>
  );
}
