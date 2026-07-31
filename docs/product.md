# Product brief

## Mission

Harvest is an agentic farm-to-market coordination network for Caribbean food
systems. It helps existing farmers, buyers, transporters, and coordinators
exchange more dependable information without forcing them into admin-heavy
software.

The marketplace is the accessible interface. The core product is the
coordination layer and the outcome dataset created as produce is predicted,
promised, moved, accepted, and learned from.

## Users

- **Farmers** provide low-friction crop updates and approve commitments.
- **Buyers** browse dependable supply, request recurring demand, and accept
  deliveries.
- **Transporters** accept structured pickup and delivery missions.
- **Coordinators** verify information, resolve missing data, and handle
  escalations.
- **Agricultural organisations** may later use permission-controlled operational
  views and analytics.

## Core workflow

1. A farmer or coordinator submits a form, voice, photo, or assisted crop
   update with its provenance.
2. Harvest structures and validates the observation.
3. Crop intelligence produces a harvest window, marketable-yield range,
   confidence, risk factors, and safe available-to-promise quantity.
4. A buyer requests current or future produce.
5. Deterministic commitment rules prevent overpromising.
6. Matching combines compatible supply from multiple farms when needed.
7. Farmers and buyers approve commitments and substitutions.
8. Logistics creates a pickup and delivery mission.
9. Exception handling proposes recovery when crops, weather, roads, vehicles,
   quality, or demand change.
10. Actual pickup, delivery, acceptance, and rejection outcomes update
    traceability, reliability, and future model evaluation.

## Hackathon demonstration

The target demonstration is a historically calibrated counterfactual simulation
for Saint Lucia:

- Run a fragmented baseline and a Harvest-enabled system from the same initial
  world, weather, demand, hidden crop outcomes, disruptions, and random seed.
- Let a farmer report roughly 20 kg of cucumber with rain damage.
- Show a conservative safe quantity of 14 kg rather than promising the maximum.
- Fulfil a 20 kg hotel order by adding 6 kg from a second farm.
- Create a delivery mission, inject a disruption, propose a recovery, require
  human approval, and complete the delivery.
- Compare operational outcomes across paired runs and show the supporting event
  and agent traces.

This is a counterfactual simulation, not proof of historical or deployed impact.

## Product non-negotiables

- Uncertainty remains visible through ranges, confidence, freshness, and
  verification status.
- Farmer input remains low friction and compatible with existing habits.
- Real and simulated users use the same Product API.
- Inventory, reservations, allocation, and routing use validated deterministic
  logic.
- Sensitive commitments and disclosures remain human-controlled.
- Every operational transition is traceable.
- Data provenance distinguishes observed, inferred, synthetic,
  stakeholder-calibrated, and model-predicted values.
- Synthetic results are never presented as real-world outcomes.

## Not in the initial scope

- Full Caribbean or inter-island deployment.
- Payments, financing, insurance, or complex social-marketplace features.
- Guaranteed yield or exact crop recognition from satellite imagery.
- A complete offline-sync platform.
- Claims of customer satisfaction based only on simulation.
- Building every interface described in the full context before the core
  end-to-end scenario works.
