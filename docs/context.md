This is our application:

# Harvest - Future Caribbean Application and Pitch Drafts

> Consolidated draft note moved from the vault root during organization. Original content is preserved below.

## Application answers

17. Secondary Skillsets - AI prototyping, product strategy, UX/UI design, data modelling, API integrations, market research, business design, startup development, and technical product management.

18. Technical Stack Experience - TypeScript, JavaScript, React, Next.js, React Native/Expo, Node.js, Python, REST APIs, SQL, PostgreSQL, Prisma, Git/GitHub, cloud deployment, Docker, OpenAI-compatible APIs, structured model outputs, AI workflow prototyping, geospatial APIs, and responsive product development.
    
19. Have you worked with AI or agentic AI systems before? Yes
    
20. Have you participated in a hackathon or buildathon before? Yes
    
21. Have you launched a startup, product, or company before? Yes
    
22. Which track are you applying for? Food Systems and Supply chains
    
23. Why did you choose this track? - 
    We chose the Food Systems & Supply Chains track because the problem we are addressing sits directly between agricultural production, food security, market access, inventory visibility, buyer demand, transportation, trade logistics, and distribution infrastructure.

Across the wider Caribbean, this is not just a supply-chain problem. It is a household problem. Families are being priced out of food while farmers still struggle to reliably reach the buyers who need local produce. The Future Caribbean track brief notes that the wider Caribbean imports roughly 80% of its food, spends over $10B annually on food imports, and spans 30+ island states and territories. The issue is not the absence of systems, but that existing systems are not sufficiently supported or coordinated.

Our research and early conversations with people connected to Caribbean food, hospitality, sourcing, and agricultural technology point to the same coordination gap. Farmers and buyers already trade through relationships, calls, WhatsApp-style messages, markets, cooperatives, and distributors. The problem is that the information moving through those systems is fragmented, informal, and uncertain. A farmer saying “I have 20 kilograms available” may mean expected yield, harvested stock, ungraded produce, or simply what they believe they can fulfil. Farmers are focused on the field, and the product should not force them into admin-heavy software.

Harvest is designed to strengthen those existing systems rather than replace them. The marketplace is the user-friendly interface, but the real product is the coordination layer underneath: low-friction farmer input, confidence-aware inventory, available-to-promise calculations, multi-farm fulfilment, logistics coordination, exception recovery, traceability, and learning from actual outcomes.
    
24. What real-world opportunity are you trying to solve? - 
    The opportunity is to make Caribbean local food procurement more dependable without forcing farmers, buyers, transporters, or coordinators into a completely new way of working.

Caribbean farmers and buyers already trade through relationships, phone calls, WhatsApp-style messages, markets, cooperatives, distributors, and agricultural organisations. We are not trying to replace those systems. We are trying to make the information moving through them more structured, trusted, actionable, and connected.

First, there is supply ambiguity. Expected yield, harvested quantity, verified stock, reserved stock, and safely orderable stock are not the same thing, but they can be communicated as though they are.

Second, there is coordination failure. Several farmers may independently grow the same crop without visibility into aggregate future supply or dependable buyer demand. This can lead to oversupply for one buyer, location, crop, or week while another part of the market remains undersupplied.

Third, there is execution failure. Even when supply and demand are matched, an order can fail because of weather, crop damage, quality, packaging, transport availability, route delays, buyer changes, or incomplete communication.

Fourth, there is adoption friction. Farmers are focused on growing, harvesting, selling, and sustaining income. The solution cannot require them to become data administrators.

Harvest targets the full workflow from the initial field signal to the final accepted delivery. It helps determine what can safely be promised, coordinates how produce reaches the buyer, and learns from what actually happened.
    
25. Describe your proposed solution or idea - 
    Harvest is an agentic Caribbean farm-to-market coordination network with a marketplace interface.

Farmers can submit crop information through a short form, voice update, photo, video, or assisted entry from a trusted coordinator. An Intake Agent structures that update into a crop record with provenance, source, crop stage, quantity range, unit, expected timing, and confidence.

A Crop Intelligence Agent then estimates the harvest window, marketable-yield range, confidence level, risk factors, and safely available-to-promise quantity. This matters because Harvest does not show the optimistic maximum as the orderable amount. It separates predicted yield, marketable yield, harvested stock, verified stock, reserved stock, and safely orderable quantity.

Buyers can browse local produce, reserve future harvests, or publish recurring demand. When one farm cannot safely cover an order, a Matching and Aggregation Agent finds compatible supply across multiple farms and proposes a combined fulfilment plan.

After buyer and farmer approval, a Commitment Agent creates safe reservations. A Logistics Agent creates a delivery mission with pickup stops, quantities, handling requirements, route, ETA, and deadline. Farmers can still self-deliver or use a trusted driver, but when they do not want to handle delivery, the order can become structured paid work for verified local transporters.

If crop quantity, weather, quality, buyer demand, or transport conditions change, an Exception Agent proposes recovery actions such as adding another farm, rerouting the driver, rescheduling, or offering a buyer-approved substitute. Sensitive actions remain human-in-the-loop: farmers and buyers approve commitments, substitutions, disputes, and private data access.

We are also adding a harvest-estimation model layer using satellite imagery, geospatial data, weather, farmer updates, and actual harvest outcomes. The model will estimate harvest size as a range with confidence, not as a fixed guarantee. Over time, completed transactions create predicted-versus-actual harvest data, allowing the model to be retrained and calibrated.

After delivery, actual picked-up, delivered, accepted, and rejected quantities update inventory, traceability, cause-aware reliability, and future forecasts. This creates the long-term data advantage: every transaction improves the system’s understanding of what can actually be produced, promised, moved, and accepted.
    
26. Why does this matter for the Caribbean or the world? - 
    This matters because food security in the Caribbean is not only about producing more food. It is about coordinating production, demand, logistics, and trust so that more local food can actually reach the people, hotels, supermarkets, processors, and institutions that need it.

Our further research shows that the region consists of more than 30 island states and territories with active but fragmented agricultural, transport and distribution systems.

That fragmentation shows up directly in people’s lives. CARICOM and WFP’s 2025 Food Security and Livelihoods Survey estimates that 3.2 million people, or 42% of the surveyed English- and Dutch-speaking Caribbean population, are food insecure. The same survey found that 94% of respondents reported higher food prices, 30% skipped meals or ate less than usual, 6% went an entire day without eating, and 65% had spent savings to meet basic needs. The report also notes that the Caribbean’s cost of a healthy diet remains the highest in the world.

At the same time, the region is already trying to increase local production. CARICOM’s food-security initiative, now extended to 2030, reported about a 24% increase in regional food production between 2022 and late 2024, alongside investments in cold storage, farm-to-market roads, solar dryers and other food-production infrastructure. The problem is therefore not simply production; it is coordination. The Caribbean needs better ways to connect what is grown, where it is needed, how it is verified, and how it is moved.

This is exactly where Harvest fits. The Caribbean Development Bank identifies market-access infrastructure such as packhouses, cold storage, transport and port modernisation as priorities, and notes that low shipping connectivity and inefficient port operations contribute to high trade costs. Harvest addresses the digital coordination layer around those same problems: farmer signals, buyer demand, inventory confidence, multi-farm fulfilment, logistics visibility and delivery outcomes.

Harvest matters because it can make local procurement more dependable without demanding admin-heavy behaviour from farmers. Farmers gain clearer access to demand, support fulfilling larger orders, and visibility into transport. Buyers gain a more reliable view of current and future supply. Transporters gain structured delivery opportunities. Agricultural organisations gain a privacy-controlled operational picture of supply, demand, verification, and emerging risks.

At a regional level, the same infrastructure could eventually coordinate surpluses and shortages between islands, incorporate inter-island freight and trade requirements, and support a more connected Caribbean food market.

The global relevance is also significant. Small island economies, rural regions, and emerging markets around the world face similar challenges: informal information, small producers, uncertain supply, fragmented logistics, and disconnected buyers. If Harvest can coordinate food commerce across fragmented Caribbean island environments, the same architecture can be adapted to distributed markets globally.
    
27. If your solution succeeds, what could it become in five years?
    In five years, Harvest could become the coordination and transaction layer for Caribbean food commerce.

Farmers would report field conditions through whichever method best fits their workflow: mobile, voice, photos, coordinators, farmer organisations, extension officers, or connected farm systems. Buyers would use Harvest to forecast requirements, source local produce, manage recurring procurement programmes, and coordinate multi-farm orders.

Transporters, packhouses, processors, cooperatives, aggregators, and agricultural organisations would use the same network to manage collection, verification, storage, delivery, exceptions, and traceability.

The platform could expand from a local pilot into the Eastern Caribbean and then across CARICOM, supporting multiple islands, currencies, units, crop aliases, organisations, permission models, and regional trade requirements.

Its long-term defensibility would come from proprietary workflow data generated through completed transactions:

- predicted versus actual harvest;
- promised versus delivered quantity;
- delivered versus accepted quality;
- expected versus actual readiness;
- expected versus actual delivery time;
- causes of transaction failure;
- effectiveness of recovery actions;
- farmer, buyer, transporter, and coordinator reliability histories.

This creates a data and model advantage that a simple marketplace cannot copy. Over time, Harvest can improve forecasting, matching, routing, trust, financing readiness, insurance readiness, and institutional food-system planning.

The business could generate revenue through buyer procurement subscriptions, aggregator or cooperative licences, institutional deployments, transaction fees, delivery coordination fees, and analytics for approved organisations. Farmer participation would initially remain free or be sponsored by buyers, cooperatives, institutions, or development programmes.
    
28. As a team
    
29. no clue
    
30. **Faisal Lawan — Technical Lead / AI Systems / Agentic Workflows**  
Faisal is a PhD researcher in Control Systems and Machine Learning, a five-time hackathon winner, and has published research in robotics and AI. He has worked in several robotics research labs. For Harvest, he leads the technical build, AI system engineering, agent orchestration, and workflow implementation.

**Xuanming Guo — Product Lead / Full-Stack / Agentic AI / Harvest-Estimation Model**  
Xuanming is a computer science student and quant developer. He has won three hackathons, received an AI and machine learning award from Cambridge, worked on multiple agentic AI projects including Hermes Agent and Codex-based workflows, and has experience running a startup. For Harvest, he leads product direction, full-stack execution, agentic AI architecture, and the harvest-estimation model layer.

**Micky — Business Lead / Product-Market Fit / Venture / Go-to-Market**  
Micky is an EEE student, has exited one company, is building another, and works in venture with a focus on market evaluation and product-market fit. He has experience across hackathons and case competitions. For Harvest, he leads business strategy, customer discovery, market research, go-to-market, and venture positioning.
    
31. a
    
32. a
    
33. a
    
34. a
    
35. What tools, models, APIs or frameworks are you planning to use?
    **Web:** Next.js, React, TypeScript, Tailwind CSS, and an accessible component system.

**Mobile:** Expo React Native, TypeScript, Expo Router, local/offline storage, camera/media capture, and location permissions for active delivery tracking.

**Backend and data:** Node.js or Next.js APIs, Prisma, PostgreSQL or SQLite for the prototype, Zod validation, versioned REST APIs, event logs, and audit trails.

**Agentic AI:** LangGraph or a typed custom state graph with specialist agents: Intake, Crop Intelligence, Market Balance, Commitment, Matching, Logistics, Exception, Traceability, and Learning Agents. The system will use structured tool calls, persistent workflow state, auditable decision traces, and human approval gates.

**Models:** OpenAI-compatible and open-source language or multimodal models for structured extraction, explanation, and exception reasoning. Deterministic calculations will handle quantities, reservations, matching, available-to-promise logic, and routing so that language models do not invent inventory.

**Harvest-estimation model:** A model using satellite imagery, geospatial data, farm-area data, weather, farmer updates, and actual harvest outcomes to estimate harvest size as a range with confidence. Predictions will be calibrated against actual harvested and accepted quantities over time.

**Geospatial and logistics:** OpenStreetMap, Leaflet, React Native Maps, route/ETA services, and a real geographic base map for regional route visualisation.

**Infrastructure:** GitHub, Docker, cloud deployment, optional vector storage, and NVIDIA compute for model training, multimodal experimentation, and agent evaluation.

**Data adapters:** WFP, FAOSTAT, CARICOM, CARDI, ministries of agriculture, CDB/IDB agricultural data, CIMH weather and climate data, satellite/geospatial data, OpenStreetMap, and verified shipping/cruise/transport route references.
    
36. Which tools have you previously worked with? select all
    
37. yes
    
38. High
    
39. Will your project require external datasets? - yes
    We plan to combine public contextual datasets with clearly labelled synthetic operational data.

Public and contextual data sources may include:

- WFP Caribbean Food Security and Livelihoods Survey data;
- FAO FAOSTAT agricultural production data;
- CARICOM trade and import statistics;
- CARDI agricultural information;
- ministries of agriculture data;
- CDB and IDB agricultural-development data;
- CIMH weather and climate data;
- satellite and geospatial imagery;
- OpenStreetMap roads, markets, ports, and production zones;
- verified operator route references for shipping, cruise, and transport corridors.

For the Buildathon, farm records, crop batches, orders, prices, vehicle routes, delivery events, and transaction outcomes will be synthetic unless explicitly sourced or validated. Public data will calibrate the Caribbean context and simulation rather than imply live institutional integration.

Every dataset will retain its source, geography, date, update frequency, licence/access notes, and whether it is synthetic, a public snapshot, or live.
    
40. Will your project involve sensitive or private data? - yes
    A real deployment would involve sensitive or commercially private information, including farmer identity, exact farm coordinates, planting plans, crop quantities, expected harvest dates, buyer demand, private prices, transporter GPS, conversations, delivery outcomes, and reliability histories.

Harvest will use consent-based collection, role-based access, data minimisation, audit logs, encryption, permission-controlled disclosure, and clear provenance.

Public marketplace listings will show only a general production zone and safely orderable quantity. Exact pickup locations will be visible only to authorised participants after an order is confirmed. Transporter location sharing will be opt-in and limited to an active delivery.

Forecasts will show ranges, confidence, data age, and verification status rather than false certainty. Disputed reliability events will require human review before affecting a participant’s profile.

This privacy approach matches the product logic you have been using: the system should support voice/photo/assisted input, keep uncertainty visible, maintain provenance, support two-sided trust, and keep sensitive actions human-controlled.

We will also have extensive privacy policies, terms of conditions, and have industry standard encryption and software security
    
41. a
    
42. loop link: https://www.loom.com/share/58285a7d69a44b59abb64cd6039bc5c3
    google drive for agentic workflow diagram: https://drive.google.com/drive/folders/1U-pWwSIeHh1dRY4UOAFNwEmmFoCdVnvp?usp=drive_link
43. yes
    
44. 20hrs or smth idk
    
45. yes
    
46. 
    
47. Have you raised venture funding before? yes
    
48. yes
    
49. yes
    
50. Anything else you would like us to know?
    Harvest is being designed as a locally informed coordination system rather than a generic agricultural application imported into the Caribbean.

We have already begun speaking with people connected to Caribbean food, hospitality, sourcing, and agricultural technology. One of the strongest early insights is that farmers should not be expected to become data administrators. The product must work through existing habits and relationships: voice messages, photographs, field officers, coordinators, buyers, transporters, and WhatsApp-style workflows.

We are deliberately keeping several assumptions configurable until additional farmer and buyer interviews are completed. These include who should verify detailed farm information, which organisation should coordinate the network, what minimum farmer update is realistic, which buyer channel should be targeted first, and who should guarantee a multi-farm order. This makes the system adaptable and locally grounded rather than forcing one operating model across every island or organisation.

We already have a defined product concept, user journeys, technical architecture, workflow diagram, mobile and website interface direction
We believe Harvest can become more than a marketplace. The marketplace is the easy interface. The company is the coordination layer: safer commitments, multi-farm fulfilment, delivery tracking, exception handling, trust, and a learning loop that improves over time.










Hi Future Caribbean

"I'm Faisal Lawan. I'm a PhD researcher in Control Systems and Machine Learning and a five-time hackathon winner. I've published research in robotics and AI and worked in several robotics research labs. For this project, I'm leading the technical side: building the product, engineering the AI system, and designing the agentic workflows."

"I'm Micky, an EEE student, but I've also exited one company and I'm building the next. In between I work in venture, where my whole job is finding product-market fit I can find wheter people actually want something. I move constantly, so I'm always reading new markets and finding where the real demand is. Between the exit, the venture work, and a bunch of hackathons and case competitions, I cover the full business side.

I’m **Xuanming Guo**. I’m a computer science student and currently a quant developer. I’ve won three hackathons, received an AI and machine learning award from Cambridge, worked on multiple agentic AI projects including Hermes Agent and Codex-based workflows, and I’ve also had experience running my own startup. For this project, I’m leading product direction, full-stack execution, agentic AI architecture and the harvest-estimation model layer.



Micky:
	Currently, families are being priced out of food. The CARICOM 2025 survey states 3.2million people remain food insecure and 65% used or exhausted savings to meet food needs. Across the 30+ island states and territories, 80% of the food is imported and over $10B are spent on annual food imports. However the caribbean has the ability to produce far more than what it consumes. The issue is not the absence of systems, but that existing ones are not sufficiently supported or coordinated. And this causes price increases and pressure on families
	

Faisal
	So this is the problem we are focused on, and the solution we are pursuing
	From our research and early conversations with 5 people connected to Caribbean food and agricultural technology, one thing is clear: farmers and buyers already trade through relationships, calls, WhatsApp-style messages, markets and distributors. The problem is that the information moving through those systems is fragmented, informal and uncertain.



Xuanming:
	For example, when a farmer says, “I have 20 kilograms available,” that can mean expected yield, harvested stock, ungraded produce, or simply what they believe they can fulfil. But hotels, supermarkets, processors and institutions need dependable quantity, quality, timing and delivery.

Faisal:
	At the same time, farmers are focused on the field: growing, harvesting, selling and sustaining income. So the solution cannot be forcing them into admin-heavy management software.

Xuanming:
	That is why we are building **Harvest**: an AI-powered farm-to-market marketplace with an agentic coordination layer underneath. A farmer can submit crop information through a form, voice update, photo, video, or assisted entry. Buyers can browse local produce, reserve future harvests, or publish recurring demand.

Micky:
	But the important part is what happens underneath the marketplace.  Instead of showing the optimistic maximum, Harvest shows what can safely be promised. If one farm cannot cover an order safely, the system can combine compatible supply from multiple farms.

Xuanming:
	The marketplace is the easy interface. The real product is the coordination layer: safer commitments, multi-farm fulfilment, delivery tracking, exception handling and a learning loop that improves over time.
	 
Micky:
	Delivery is also key. Once an order is confirmed, Harvest creates a delivery mission with pickup stops, quantities, route, ETA and deadline, so a bit like Uber.  Farmers can still self-deliver or use a driver they trust. But when they do not want to handle delivery, the order becomes structured paid work for verified local transporters. Larger or inter-island orders can use the same tracked workflow.

Faisal:
	The system is also agentic because the workflow needs specialised agents coordinating together: agents for inputs, harvest windows, oversupply, multi-farm matching and disruptions

Micky:
	Sensitive actions stay human-in-the-loop. Agents can recommend, but farmers and buyers approve commitments, substitutions, disputes and private data access. We avoid false precision by showing forecasts as ranges with confidence, not fixed guarantees. As we collect more data, this range will become more confident

Xuanming:
	Trust is designed into the workflow. Every crop update has a source: farmer-reported, photo-supported, coordinator-verified, physically measured, or buyer-confirmed. Buyers see the general production zone and safely orderable quantity, while private farm details stay permission-controlled.

Micky:
	We are also adding a harvest-estimation model using satellite imagery, geospatial data, weather, farmer updates and actual harvest outcomes to train a model to estimate harvest size as a range with confidence.

Xuanming:
	Over time, completed transactions give us predicted-versus-actual harvest data, so the model can be retrained and calibrated. That creates a data advantage: every delivery improves future forecasting.

Faisal:
	This matters because Caribbean food systems are active but fragmented. The region imports a large share of what it consumes, while local producers still face uncertainty around demand, logistics and reliable market access.

Micky:
	And because we have started those conversations and research, we are designing onboarding carefully. We are not replacing WhatsApp groups or existing relationships. We are changing the framework beneath the surface: turning informal information into trusted coordination.
Xuanming:
	This will increase productivity, trust between suppliers and buyers, delivery coordination and cost of mis-communication whilst also being able to provide more jobs for the community, And this will also help with the problem of importing large shares of food instead of using local producers

Faisal:
	Thank you for listening, and we look forward to hearing back from you





We got in, so the next step is building. After back and forth with chatgpt, this is what it recommended to do in regards to the project, simulation, demo and building



this is what chatgpt said:
Yes. The key insight is that **the simulation should not be a separate side feature added after the app is built**.

It should be the spine of the entire project:

> **The simulation creates the world.
> The agents operate the world.
> The mobile app and website expose that world to each user.
> The benchmark proves whether Harvest improves it.**

That is also consistent with the accepted application: you proposed a role-based mobile app and operational website, with agents handling crop intelligence, matching, commitments, logistics, exceptions and learning from actual outcomes. 

# The actual end product

The strongest final demonstration is a **historically calibrated counterfactual replay**.

You select one Caribbean island and one evaluation month, initialise the simulation using real public context from that period, then run the same world twice:

### Run A — Fragmented baseline

Farmers, buyers and transporters operate through the kinds of fragmented workflows identified in your research:

* approximate crop information;
* delayed or verbal updates;
* relationship-based buyer discovery;
* no shared inventory state;
* manual farm-to-farm coordination;
* manual delivery assignment;
* shortfalls discovered late;
* no agentic exception recovery.

### Run B — Harvest-enabled system

The same farms, crops, buyers, roads, weather, demand and disruptions are replayed under identical conditions, but participants now use Harvest:

* structured voice/photo updates;
* confidence-aware yield estimates;
* safe available-to-promise quantities;
* multi-farm fulfilment;
* agentic logistics;
* live delivery tracking;
* proactive exception recovery;
* traceability and model feedback.

At the end, judges see a direct comparison.

That is much more credible than simply showing a polished marketplace and claiming it would improve agriculture.

---

# The benchmark must be scientifically fair

Do not choose a random month and produce one convenient simulation result.

Use a **paired experimental design**:

```text
Identical initial world
Identical weather events
Identical buyer demand
Identical crop ground truth
Identical road disruptions
Identical transporter availability
Identical random seed

        ↓

Baseline policy        Harvest policy
        ↓                     ↓

Compare outcomes
```

The only major difference between the runs should be the coordination mechanism.

For the final results, run the simulation many times—perhaps 100 paired seeds—and report:

* median improvement;
* range of outcomes;
* best and worst cases;
* confidence intervals.

The live demo can show one visually compelling run, while the evidence dashboard shows the results across all runs. That prevents judges from thinking you selected one lucky scenario.

## Important language

Do not call it proof that Harvest improved the real historical month.

Call it:

> **A historically calibrated counterfactual simulation showing how Harvest would have changed coordination under the same operating conditions.**

Real deployment evidence comes later.

---

# Do not use GPT as an uncontrolled web scraper

GPT can assist with extracting and normalising data, but it should not be the authoritative source.

Use this ingestion process:

```text
Official/public source
        ↓
Raw snapshot archived
        ↓
Parser or API adapter
        ↓
LLM-assisted extraction where necessary
        ↓
Schema validation
        ↓
Human review for ambiguous records
        ↓
Source registry and provenance
```

Every value in the simulation should be labelled as one of:

* **Observed:** directly sourced historical value;
* **Inferred:** estimated from public evidence;
* **Synthetic:** created because private operational data was unavailable;
* **Stakeholder-calibrated:** based on interview evidence;
* **Model-predicted:** generated by your crop model.

That transparency will significantly strengthen both technical credibility and judge trust.

---

# Recommended benchmark scope

## Geography

Use **Saint Lucia** for the initial world.

You already have stakeholder access and Saint Lucia has an official iFarm system intended to capture planting information, anticipate potential yield, track crop prices and report information geographically across farms and market outlets. The public iFarm interface also exposes projected-yield functionality based on captured and verified data. ([iFarm][1])

That does not mean all underlying iFarm records will be publicly accessible. It means Saint Lucia has the right institutional context for the story and gives you a credible model to research and potentially approach.

## Evaluation period

Use:

* **60–90 days of prior state** to initialise crops already growing;
* **one 30-day month** as the formal benchmark period.

A single month alone is too short to show planting-to-harvest for many crops. Warm-starting the world with crops at different stages solves that:

* some newly planted;
* some growing;
* some approaching harvest;
* some already harvested;
* some entering delivery.

## Initial simulated network

A credible MVP world could contain:

* 12–20 farms;
* 20–35 crop batches;
* 5–6 crop types;
* 3 hospitality buyers;
* 1 supermarket;
* 1 processor;
* 3–5 transporters;
* 1 cooperative or coordinator;
* several production and demand zones.

That is large enough to demonstrate system-level coordination but still small enough to understand visually.

---

# The simulation architecture

Use a discrete-event simulation rather than a continuous game engine.

Each event changes the world state:

```text
Planting event
Crop observation
Weather update
Growth-stage transition
Yield revision
Buyer demand
Marketplace listing
Reservation
Farmer confirmation
Harvest
Transport assignment
Pickup
Road or weather delay
Delivery
Buyer acceptance
Payment or settlement state
Forecast evaluation
```

## Two versions of reality

Every crop must have:

### Hidden ground truth

Known to the simulation engine:

* real eventual yield;
* actual crop condition;
* actual harvest date;
* actual marketable quantity;
* actual quality;
* true weather damage.

### Observed system state

Known to Harvest:

* farmer estimate;
* latest voice/photo update;
* satellite-derived features;
* climate context;
* coordinator verification;
* model prediction;
* confidence interval.

That distinction is essential.

Otherwise, your agents would have perfect knowledge and the simulation would be artificially easy.

---

# What the live simulation should look like

The control room should show:

* farms and crop plots;
* crop-stage colours;
* buyer locations;
* transporter locations;
* active orders;
* delivery routes;
* demand events;
* weather fronts;
* agent actions;
* human approval requests;
* API/tool calls;
* business throughput;
* model predictions;
* simulation time.

Suggested visual language:

* **green:** crop and harvest events;
* **amber:** buyer demand and reservations;
* **blue:** transport and delivery;
* **purple:** agent decisions;
* **red:** exceptions or unmet demand;
* **white outline:** human approval pending.

The timeline should support:

* play;
* pause;
* 2×, 8× and 30× speed;
* inject event;
* rewind;
* reset;
* baseline/Harvest toggle;
* side-by-side comparison.

Clicking any visible object should open its detailed state.

For example:

* click a farm → open farmer app view;
* click an order → open buyer order page;
* click a vehicle → open transporter mission;
* click an agent action → open trace;
* click a crop batch → open model prediction and provenance;
* click an exception → open evidence and alternatives.

---

# The app and website should be designed around the simulation events

You should not build every possible page and then hope they produce a convincing demo.

Freeze the demo journey first, then build the exact product surfaces needed to expose it.

# Mobile app

## Farmer surfaces

1. **Farmer home**

   * current crops;
   * local weather;
   * pending actions;
   * next pickup;
   * buyer opportunity.

2. **Submit crop update**

   * voice;
   * form;
   * photo/video;
   * coordinator assistance.

3. **Crop intelligence**

   * q10/q50/q90 yield estimate;
   * harvest window;
   * confidence;
   * affecting factors;
   * safe available-to-promise.

4. **Order decision**

   * buyer request;
   * optimistic maximum;
   * safe commitment;
   * proposed combined fulfilment;
   * human confirmation.

5. **Delivery and order chat**

   * other participating farms;
   * transporter;
   * coordinator;
   * live order status.

6. **Outcome and reliability**

   * predicted versus actual;
   * accepted quantity;
   * cause attribution;
   * payment/revenue;
   * updated reliability.

## Buyer surfaces

1. Marketplace;
2. recurring demand request;
3. listing detail and provenance;
4. multi-farm checkout;
5. order tracking;
6. acceptance and rejection.

## Transporter surfaces

1. available delivery jobs;
2. mission detail;
3. route and pickup order;
4. proof of pickup;
5. live status;
6. proof of delivery and earnings.

## Coordinator mobile surface

Keep this narrow:

* verification queue;
* missing information;
* disputed event;
* approval request;
* exception escalation.

---

# Website

> **Scope clarification for implementation:** the judge-facing website section
> below is the design brief for a future, separate simulation/control-room
> frontend. It is not `app/website`, which is the real product used by farmers,
> buyers, transporters and coordinators. The product website runs on port 3000.
> The future simulation frontend may use port 3002 and should contain the map,
> benchmark, Model Lab, data/provenance evidence and trace viewer described
> below. Issue #8 does not implement or scaffold that frontend.

The website is where most of the judge-facing wow factor should live.

## 1. Simulation Control Room

```text
/simulation
```

Shows the living digital twin, timeline, events, agents and human approvals.

## 2. Operations Centre

```text
/operations
```

Shows:

* crop supply;
* buyer demand;
* orders at risk;
* deliveries;
* verification queue;
* exceptions;
* marketplace activity.

## 3. Benchmark Dashboard

```text
/benchmark
```

Shows baseline versus Harvest outcomes.

## 4. Agent Trace Viewer

```text
/agents/traces/:traceId
```

Shows:

* triggering event;
* orchestrator state;
* agent selected;
* evidence;
* tool calls;
* recommendation;
* confidence;
* human approval;
* state change;
* latency;
* compute usage.

Show concise decision summaries, not hidden chain-of-thought.

## 5. Model Lab

```text
/model-lab
```

Shows:

* satellite sequence;
* vegetation indices;
* weather features;
* prediction interval;
* actual outcome;
* calibration error;
* model version;
* retraining history.

## 6. Data Provenance

```text
/data
```

Shows whether each input is:

* observed;
* inferred;
* synthetic;
* stakeholder-calibrated;
* predicted.

## 7. Judge Mode

```text
/judge
```

A guided version of the entire demo with:

* next-step controls;
* short explanations;
* reset button;
* deterministic scenario;
* highlighted rubric evidence.

---

# The simulation and the app must use the same API

This is crucial.

Do not make an animated simulator whose data is disconnected from the actual product.

The simulated users should call the same endpoints that real users call.

```text
Simulation actor
      ↓
Public product API
      ↓
Database / event log
      ↓
Agent orchestration
      ↓
State change
      ↓
Website and mobile update live
```

A simulated farmer should submit a crop update through the same endpoint as a real farmer.

A simulated buyer should create an order through the same endpoint as the buyer app.

A simulated transporter should accept a mission through the same endpoint as the transporter app.

This allows you to truthfully say:

> “The simulation does not animate a prewritten story. It drives the actual product workflow through the same API and agent system.”

That will score very well on technical execution.

---

# Event-stream architecture

Use an append-only event log.

Every action creates an event:

```json
{
  "eventId": "evt_123",
  "simulationRunId": "run_harvest_004",
  "simulationTime": "2025-06-14T08:43:00",
  "actorType": "FARMER",
  "actorId": "farm_07",
  "eventType": "CROP_OBSERVATION_SUBMITTED",
  "entityId": "crop_batch_22",
  "traceId": "trace_991",
  "sourceType": "VOICE",
  "payload": {},
  "provenance": "SYNTHETIC_CALIBRATED"
}
```

The control room subscribes over WebSockets or server-sent events.

This powers:

* live map changes;
* phone updates;
* order timelines;
* agent activity;
* benchmark calculations;
* replay;
* debugging.

---

# Agentic architecture

The Agentic AI score is 50%, so judges must see real coordination—not a list of agent names.

## Orchestrator

Receives a world event and decides which workflow to execute.

## Intake Agent

Turns voice, text, image metadata or coordinator notes into a validated observation.

## Crop Intelligence Agent

Combines:

* field update;
* plot area;
* crop type;
* planting date;
* satellite features;
* weather;
* farm history.

Outputs:

* yield range;
* harvest window;
* confidence;
* marketable quantity;
* safe quantity.

## Market Balance Agent

Detects:

* shortages;
* oversupply;
* uncovered buyer demand;
* concentration risk;
* possible alternative buyers.

## Commitment Agent

Prevents overcommitment and creates transactional reservations.

## Matching Agent

Builds single- or multi-farm fulfilment plans.

## Logistics Agent

Creates:

* delivery mission;
* pickup order;
* route;
* ETA;
* vehicle fit;
* notifications.

## Exception Agent

Handles:

* crop shortfall;
* rain;
* road delay;
* buyer cancellation;
* quality issue;
* vehicle failure.

## Traceability Agent

Records every operational transition.

## Trust and Learning Agent

Updates:

* source reliability;
* farmer fulfilment;
* buyer behaviour;
* transporter performance;
* model calibration dataset.

## Human approval gates

Require explicit approval for:

* committing farmer inventory;
* substitution;
* changing price;
* order cancellation;
* private location disclosure;
* disputed reliability changes;
* rejecting produce;
* inter-island commitment.

---

# Efficient AI matters

The rubric explicitly says they do not want systems that simply consume large amounts of compute.

Therefore:

* use normal code for arithmetic;
* use database transactions for reservations;
* use graph/routing algorithms for routes;
* use optimisation or heuristics for allocation;
* use LLMs for unstructured extraction and complex exception explanation;
* cache repeated outputs;
* use a smaller model for voice/text structuring;
* only use a larger reasoning model when the exception requires it.

The judge dashboard should show:

* LLM calls;
* deterministic tool calls;
* model used;
* token usage;
* latency;
* cache hits;
* estimated cost;
* human waiting time.

That directly demonstrates compute efficiency.

---

# Satellite model plan

The model and simulation are related, but they have different data windows.

## Training window

Use multiple seasons or years of imagery and outcomes where available.

## Benchmark window

Use one held-out month for the live comparison.

Do not train on the benchmark month and then present it as unseen evidence.

## Important scope correction

Do not make the core claim:

> “We identify every crop and exact yield from satellite imagery.”

Sentinel-2 has 13 spectral bands at 10 m, 20 m and 60 m resolution. That is useful for vegetation monitoring, but small or mixed Caribbean farm plots may not contain enough pure pixels for reliable crop recognition by themselves. ([Copernicus Data Space Documentation][2])

Instead, the initial model should assume:

* farm boundary is known;
* crop type is provided by farmer/coordinator;
* planting date is known or estimated;
* satellite imagery contributes growth and health features.

## Model inputs

* crop type;
* variety where available;
* plot area;
* planting date;
* crop stage;
* farmer observation;
* photo evidence;
* Sentinel-2 spectral features;
* climate history;
* rainfall forecast;
* previous farm outcomes.

Useful satellite features:

[
NDVI = \frac{NIR - Red}{NIR + Red}
]

[
NDRE = \frac{NIR - RedEdge}{NIR + RedEdge}
]

[
EVI = 2.5 \times \frac{NIR-Red}{NIR + 6Red - 7.5Blue + 1}
]

Also use:

* temporal NDVI slope;
* peak vegetation value;
* days since planting;
* rainfall accumulation;
* heat-stress days;
* cloud-quality score.

Copernicus now provides long-running Sentinel mosaics and API-accessible analysis-ready datasets, which are useful for consistent machine-learning time series. ([Copernicus Data Space Ecosystem][3])

## Prediction outputs

Do not output one number.

Output:

* q10 yield;
* q50 yield;
* q90 yield;
* predicted marketable yield;
* harvest readiness;
* confidence;
* data-quality warning.

Use the conservative lower quantile operationally:

[
AvailableToPromise =
q_{10}(\text{marketable yield})

* reservations
* commitments
* safety\ buffer
  ]

## Model progression

### MVP model

Quantile gradient boosting or quantile random forest.

This is realistic for a small dataset, fast to train and explainable.

### Stretch model

Temporal transformer or multimodal model combining satellite sequence, weather and metadata.

### Evaluation

Show:

* MAE;
* RMSE;
* pinball loss;
* interval coverage;
* bias by crop;
* bias by location;
* calibration before and after new outcomes.

For the hackathon, be transparent when labels are synthetic, weakly supervised or proxy-derived.

---

# Before-and-after metrics

## Food-system metrics

* order fill rate;
* on-time-in-full rate;
* unfilled demand;
* crop waste or spoilage;
* overcommitted quantity;
* emergency substitute volume;
* local procurement share;
* time to match an order;
* time to resolve an exception.

## Economic metrics

* farmer revenue;
* buyer spend;
* transporter income;
* average logistics cost;
* revenue lost through spoilage;
* value of orders rescued by multi-farm matching.

## Forecasting metrics

* forecast MAE;
* interval coverage;
* overprediction;
* underprediction;
* days-to-harvest error.

## Agentic metrics

* percentage of workflows completed without intervention;
* approval rate;
* successful recovery rate;
* tool calls per order;
* model calls per order;
* average workflow latency;
* compute cost;
* number of escalations.

## Trust metrics

* quantity accuracy;
* quality acceptance;
* early warning rate;
* wrongly attributed failure count;
* dispute rate.

## Technical metrics

Separate business throughput from API throughput:

**Business throughput**

* kilograms traded;
* orders completed;
* deliveries completed.

**Technical throughput**

* events processed;
* API requests;
* agent workflows;
* p95 latency;
* error rate.

---

# Do not simulate customer satisfaction

A simulation cannot honestly prove that users became more satisfied.

Instead:

* use simulation for operational and economic metrics;
* use actual prototype testing for satisfaction and adoption.

Run usability testing with your five existing contacts and additional participants.

Measure:

* task completion;
* time to submit a crop update;
* preferred input method;
* confidence in marketplace quantities;
* willingness to trial;
* willingness to pay or sponsor;
* trust concerns;
* perceived administrative burden.

Then the pitch can say:

> “The simulation improved operational metrics, while direct stakeholder testing measured usability and adoption separately.”

That distinction makes the evidence much stronger.

---

# Exact demo storyline

## 1. Establish the benchmark

Show the selected historical month and the data layers:

* weather;
* crop state;
* buyer demand;
* roads;
* farms;
* transporters.

Explain which fields are observed, inferred and synthetic.

## 2. Run the fragmented baseline

Accelerate the month.

Show:

* one farmer overpromising;
* buyer demand not matched;
* several isolated chats;
* a delivery arranged late;
* produce left unsold;
* emergency substitute or import;
* baseline metrics.

## 3. Reset to the same world

Same seed. Same weather. Same demand. Same hidden crop outcomes.

Turn Harvest on.

## 4. Enter the farmer app

A farmer submits a voice update:

> “I expect around 20 kg of cucumber, but one bed was affected by rain.”

Show:

* Intake Agent extraction;
* crop model;
* q10/q50/q90 prediction;
* 14 kg safe available-to-promise.

## 5. Enter the buyer app

A hotel orders 20 kg.

Show:

* Commitment Agent refusing to promise 20 kg from one farm;
* Matching Agent adding 6 kg from a second farm;
* buyer and farmers approving.

## 6. Show logistics

A delivery mission is created.

The transporter accepts.

On the simulation map, a blue route appears.

Click the route to show:

* pickup stops;
* ETA;
* order chat;
* API calls;
* tool trace.

## 7. Inject a disruption

Introduce heavy rain or a road delay.

Show:

* climate event;
* Logistics Agent recalculating;
* Exception Agent proposing a recovery;
* human approval;
* buyer notification;
* updated ETA.

## 8. Complete delivery

Buyer accepts the order.

Show:

* actual quantity;
* quality;
* payment/revenue;
* trust updates;
* model prediction error;
* training record created.

## 9. Month-end comparison

Display:

```text
Fragmented baseline      Harvest
Order fill rate          …
OTIF                     …
Waste                    …
Farmer revenue           …
Local procurement        …
Transport jobs           …
Overcommitment           …
Resolution time          …
Compute cost             …
```

Also show the distribution across repeated paired runs, not just the hero scenario.

## 10. Close with the company

> “The marketplace is the interface. The coordination graph and outcome dataset are the company.”

---

# Repository structure

```text
/
├── mobile-app/
│   ├── farmer/
│   ├── buyer/
│   ├── transporter/
│   ├── coordinator/
│   └── shared/
│
├── website/
│   ├── marketplace/
│   ├── operations/
│   ├── simulation/
│   ├── benchmark/
│   ├── agents/
│   ├── model-lab/
│   └── api-gateway/
│
└── simulation/
    ├── engine/
    ├── scenarios/
    ├── agents/
    ├── model/
    ├── data-ingestion/
    ├── event-store/
    ├── evaluation/
    └── api/
```

## Suggested stack

**Mobile:** Expo React Native
**Website:** Next.js
**Database:** Supabase/PostgreSQL
**Simulation:** Python, SimPy or a custom event queue
**Simulation API:** FastAPI
**Agents:** LangGraph or typed state graph
**Maps:** MapLibre/OpenStreetMap
**Remote sensing:** rasterio, xarray, STAC APIs
**Model:** LightGBM/XGBoost quantiles initially; PyTorch for stretch model
**Live events:** WebSockets or server-sent events
**Tracing:** custom event/agent trace viewer, optionally backed by OpenTelemetry-style records

---

# Build priority

## P0 — must work

* paired baseline and Harvest runs;
* deterministic reset;
* live simulation map;
* farmer voice/text update;
* crop prediction range;
* safe available-to-promise;
* multi-farm matching;
* human approval;
* delivery mission;
* live tracking;
* disruption recovery;
* month-end benchmark;
* agent trace;
* five critical mobile screens;
* operations/control-room website.

## P1 — strong additions

* multiple crops;
* 12–20 farms;
* real satellite time series;
* climate feature service;
* repeated Monte Carlo runs;
* stakeholder usability data;
* model calibration dashboard;
* business and compute efficiency dashboards.

## P2 — only after the core demo is excellent

* payments;
* complete inter-island shipping integration;
* crop recognition from imagery;
* all Caribbean islands;
* insurance;
* financing;
* full offline sync;
* complex marketplace social features.

---

# Three-week execution plan

## Week 1 — Build the world

**Faisal**

* simulation engine;
* event model;
* baseline policy;
* agent orchestration;
* exception workflow.

**Xuanming**

* database/API contract;
* website control room;
* mobile role flows;
* model feature pipeline.

**Micky**

* benchmark-month data audit;
* source registry;
* stakeholder interviews;
* business-model validation;
* pitch evidence.

End of Week 1:

> One scenario runs headlessly from start to finish in both modes.

## Week 2 — Make it live

* connect simulation to shared APIs;
* build WebSocket/event stream;
* connect mobile and website;
* implement agent trace viewer;
* train model baseline;
* implement logistics map;
* add human approval;
* produce first paired benchmark.

End of Week 2:

> Judges could already watch the cucumber scenario end to end.

## Week 3 — Make it win

* increase network scale;
* run repeated paired simulations;
* polish judge mode;
* add business and compute metrics;
* usability testing;
* pitch and demo rehearsal;
* failure recovery;
* offline recording backup;
* freeze scenario and random seed.

End of Week 3:

> One flawless live demo, one backup recording, and one defensible evidence dashboard.

---

# How this maps to the rubric

## Team Quality

Your complementary roles and rapid execution become visible in the repository, demo and pitch.

## Innovation and Defensibility

The differentiator is:

* historically calibrated digital twin;
* confidence-aware supply;
* multi-party coordination graph;
* predicted-versus-actual feedback;
* proprietary transaction outcomes;
* agentic exception recovery.

## Product-Market Fit

Demonstrate:

* actual stakeholder feedback;
* low-friction adoption;
* clear first buyer segment;
* clear payer;
* transaction and institutional revenue models;
* local-to-regional expansion.

## Agentic AI Excellence

Demonstrate:

* orchestrated specialist agents;
* tools;
* shared workflow state;
* agent-to-agent outputs;
* human approval;
* autonomous recovery;
* live traces;
* deterministic calculations;
* efficient model usage;
* measurable impact.

# The single most important principle

Do not build three disconnected impressive things.

Build **one instrumented world** where:

* the crop model informs the Crop Intelligence Agent;
* the agents change the simulation;
* the simulation changes the mobile app and website;
* the users interact through the same APIs;
* every action enters the evidence log;
* the final dashboard compares outcomes.

The final demo sentence should be:

> **“We replayed the same Caribbean food system under the same conditions. The only intervention was Harvest—and here is every decision, transaction and outcome that changed.”**

[1]: https://ifarm.govt.lc/?utm_source=chatgpt.com "Home | iFarm App :"
[2]: https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel2.html?utm_source=chatgpt.com "Sentinel-2 – Documentation"
[3]: https://dataspace.copernicus.eu/news/2025-2-25-copernicus-browser-receives-upgrades?utm_source=chatgpt.com "Copernicus Browser receives upgrades | Copernicus Data Space Ecosystem"
