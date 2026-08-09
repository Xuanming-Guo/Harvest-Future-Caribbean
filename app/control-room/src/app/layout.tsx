import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Harvest control room",
  description:
    "Simulated Saint Lucia food-system control room. All figures shown are synthetic simulated counterfactual evidence, not measured real-world impact.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
