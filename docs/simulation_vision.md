# Harvest Simulation Vision

This is the plain-language guide to what the Harvest simulation should become.
It explains the intended experience and main features without requiring the
reader to understand the technical architecture first.

## High-Level Overview

The Harvest simulation is a virtual Caribbean food system.

It creates a world containing farms, crops, buyers, transporters,
coordinators, weather, roads, orders and unexpected disruptions. Time moves
forward one simulated day at a time, and the participants make decisions based
on what they currently know.

The simulation should not be a pre-written animation. Actions should cause
real consequences:

- Crops grow and become ready for harvest.
- Farmers harvest produce and add it to their available stock.
- Buyers create demand and place orders.
- Produce is reserved or sold when an order is accepted.
- Transporters collect and deliver orders.
- Bad weather, road closures or shortages can interrupt the plan.
- Harvest's agents can suggest matching, delivery and recovery actions.

The simulation should use the same Harvest product system as the real website.
A simulated farmer should perform the same actions that a real farmer can
perform, and the same applies to buyers, transporters and coordinators.

The normal website remains the interface for farmers and other real product
users. The simulation is shown separately in a 3D control room for the team,
judges and demonstrations.

## How a Simulated Day Works

Each simulated day follows a simple cycle:

1. The world changes. Crops grow, weather changes, produce may spoil and
   disruptions may begin or end.
2. Each participant checks the information available to them.
3. Each participant decides whether they need to take an action.
4. Their actions update the Harvest marketplace, orders, deliveries and other
   shared records.
5. The simulation saves what happened so the day can be replayed later.

Participants should only know what they could realistically know. For example,
a farmer may know the condition of their own crops but should not automatically
know another farmer's stock or a buyer's private plans.

The simulation itself may know the true crop yield, weather damage or future
disruption, but this hidden information must not be given directly to the
participants or Harvest agents.

## Simulated Participants

### Farmer

Each day, a farmer may:

- Check their crops and crop stages.
- Check recent weather and crop risks.
- Submit an update about a crop.
- Harvest crops that are ready.
- Add harvested produce to available stock.
- Publish produce for sale.
- Check orders and upcoming collections.
- Accept or reject proposed commitments.
- Respond when Harvest asks for updated crop information.

For example, if carrots become ready, the farmer may harvest them and add them
to inventory. If a buyer has ordered carrots, some of that inventory may then
be reserved or sold.

### Buyer

Each day, a buyer may:

- Check available local produce.
- Create new demand for a product.
- Place an order.
- Check existing orders and expected deliveries.
- Approve a proposed multi-farm order.
- Accept or reject delivered produce.
- Respond to substitutions, delays or quantity changes.

A buyer should react to the supply that is currently visible rather than
knowing in advance what every farm will eventually produce.

### Transporter

Each day, a transporter may:

- Check available delivery work.
- Check their vehicle and availability.
- Accept a delivery mission.
- Travel to farms and buyer locations.
- Report arrival, collection, delays and delivery.
- Report road, vehicle or handling problems.

Vehicle movement and delivery routes should be visible in the control room.

### Coordinator

Each day, a coordinator may:

- Check information that needs verification.
- Help farmers submit or confirm crop updates.
- Review unusual estimates or missing information.
- Monitor orders involving several farms.
- Review delivery or supply exceptions.
- Approve or reject suitable recovery actions.

The coordinator supports the network but should not have unlimited access to
every participant's private information.

## Main Features

### Start a New Simulation

The control room should allow the user to choose:

- The location to simulate.
- The simulation policy.
- A repeatable simulation seed.
- Whether decisions are deterministic or AI-assisted.
- Optional disruptions such as bad weather or road closures.

Saint Lucia should remain the detailed first scenario.

Later, the user should be able to select:

- One Caribbean island.
- Several islands.
- The whole Caribbean.

The first Caribbean-wide version can treat each island as its own local food
system. Inter-island shipping, customs and regional trade do not need to be
included initially.

### Run and Watch the World

The user should be able to press Run and watch the simulation progress.

The control room should show:

- Farms and crop locations.
- Buyers and demand.
- Transporters and vehicles.
- Orders and reserved produce.
- Collection and delivery routes.
- Weather and disruptions.
- Agent actions.
- Human approval requests.
- Problems such as shortages or delayed deliveries.
- The current simulated date and time.

### Playback Controls

A completed simulation should be saved.

The control room should support:

- Play.
- Pause.
- Different playback speeds.
- Rewind.
- Timeline scrubbing.
- Reset.
- Loading a previously saved run.

Running AI participants may take time and cost money. For demonstrations, the
team should therefore be able to load a simulation that was completed earlier
and replay it instantly.

Loading or rewinding a simulation should not run the simulation again. It
should only replay the previously saved events and world states.

### Inspect Participants and Events

The user should be able to click items in the control room to understand what
is happening.

For example:

- Click a farmer to see their crops, stock and recent actions.
- Click a buyer to see their demand and orders.
- Click a transporter to see their mission and progress.
- Click an order to see which farms are supplying it.
- Click an agent action to see a short explanation and the information used.
- Click a problem to see the proposed recovery options.

Where practical, a simulated participant can also be opened in the same
website page that a real participant would use. This is useful for proving
that simulated users and real users share the same Harvest product.

### Baseline Versus Harvest

The simulation should be able to run the same world twice.

#### Baseline Run

Participants operate using fragmented coordination:

- Delayed or incomplete information.
- Manual buyer discovery.
- Limited shared inventory information.
- Manual delivery coordination.
- Shortages discovered late.
- No Harvest recovery support.

#### Harvest Run

The same farms, crops, weather, demand, roads and disruptions are used, but
participants have access to Harvest:

- Structured crop updates.
- Safer harvest estimates.
- Shared local supply.
- Multi-farm order fulfilment.
- Coordinated delivery missions.
- Earlier warnings.
- Recovery suggestions.
- Clear traceability.

The comparison must be fair. Both versions should begin with the same world
and differ mainly in how participants coordinate.

Results must always be labelled as synthetic simulation results. They are not
proof of real-world impact.

### Deterministic and AI-Assisted Decisions

The first working version should use predictable decision rules so it is fast,
reliable and repeatable.

An optional AI-assisted mode can later allow participants to reason about their
situation using role-specific instructions and available actions.

The AI should:

- Only receive information its participant is allowed to see.
- Only choose from approved actions.
- Never invent farms, orders, crops or tools.
- Never directly change the database.
- Never see hidden simulation truth.
- Produce a short explanation rather than private chain-of-thought.

Important quantities, permissions, reservations and state changes must still
be checked by normal Harvest rules.

## Intended Demonstration

A strong demonstration could show:

1. A farmer reports approximately 20 kg of cucumbers with possible rain damage.
2. Harvest estimates that only 14 kg can safely be promised.
3. A hotel requests 20 kg.
4. Harvest finds another farm that can supply the remaining 6 kg.
5. The farmers and buyer approve the combined plan.
6. A transporter accepts the delivery mission.
7. A road or weather disruption delays the mission.
8. Harvest proposes a recovery action.
9. A human participant approves the recovery.
10. The produce is delivered and the buyer records the outcome.
11. The control room rewinds and explains the important actions.
12. The same world is compared with a baseline that does not use Harvest.

## What This Is Not

The simulation is not:

- A page for normal farmers or buyers.
- A mobile application.
- A pre-recorded animation with fixed outcomes.
- A system where AI has perfect knowledge.
- Proof that Harvest has already improved the real Caribbean food system.
- A separate fake marketplace disconnected from the actual Harvest product.

## One-Sentence Vision

Harvest's simulation is a repeatable virtual Caribbean food system where
farmers, buyers, transporters and coordinators use the real Harvest product,
allowing us to watch their decisions, replay the results and fairly compare
coordination with and without Harvest.
