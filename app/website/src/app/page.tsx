"use client";

import { ArrowRight, ClipboardCheck, Leaf, ShoppingBasket, Sprout, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useSession } from "@/components/providers";
import { withPreviewFlag } from "@/lib/action-preview";
import { roleHome } from "@/lib/api";

const personas = [
  { id: "farmer-ana", role: "Farmer", name: "Ana Joseph", Icon: Sprout },
  { id: "buyer-hotel", role: "Buyer", name: "Bay Gardens Hotel", Icon: ShoppingBasket },
  { id: "transporter-daniel", role: "Transporter", name: "Daniel Felix", Icon: Truck },
  { id: "coordinator-maya", role: "Coordinator", name: "Maya Charles", Icon: ClipboardCheck },
] as const;

export default function SignInPage() {
  const router = useRouter();
  const { actor, ready, signIn } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A control-room preview frame lands here first, so the flag it carries has
    // to survive this redirect or the preview never reaches a page that runs it.
    if (ready && actor) router.replace(withPreviewFlag(roleHome(actor.role), window.location.search));
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
        <p className="eyebrow">Caribbean food network</p>
        <h1>From field<br />to table.</h1>

      </div>
      <section className="role-picker" aria-label="Demo roles">
        <div className="role-picker-heading"><p className="eyebrow">Demo sign in</p><h2>Your workspace</h2></div>
        <div className="role-grid">
          {personas.map(({ id, role, name, Icon }) => (
            <button key={id} className="role-card" onClick={() => void choose(id)} disabled={!ready || busy !== null}>
              <span className="role-icon"><Icon size={22} /></span>
              <span><small>{role}</small><strong>{name}</strong></span>
              {busy === id ? <span className="spinner" /> : <ArrowRight size={19} />}
            </button>
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
      </section>
    </main>
  );
}
