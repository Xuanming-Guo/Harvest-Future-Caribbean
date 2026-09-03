# Harvest — design mood board

Status: proposal for review. Direction chosen by the product owner (not up for
re-litigation here): **warm agrarian editorial**.

## 1. Design intent

Harvest should look like a working farm-to-market ledger that a hotel
procurement manager would trust and a farmer with a basic smartphone can
operate without training: big, confident type carries the one decision that
matters on a screen; the existing cream/forest/leaf palette gets a genuine
warm counterpart (soil, sun) instead of staying all-green; photography, where
it exists, is documentary and place-specific to the Caribbean rather than
generic stock; spacing is generous and touch targets are large because the
primary users are not power users; and copy stays plain and literal — no
gamification, no dashboard cosplay, nothing that reads as a template pulled
off the shelf.

## 2. Reference moodboard

Links only — no images are downloaded or embedded in this repo. Image and
brand rights stay with their respective owners; these are inspiration
references, not assets to copy.

1. **One Acre Fund** — https://oneacrefund.org/
   Borrow: dignified, real-farmer documentary photography paired with
   confident headlines ("Her Farm, Our Future") that treat farmers as
   protagonists, not beneficiaries.
   Don't borrow: its donor/nonprofit call-to-action pattern (“Donate”) — Harvest
   is a working tool, not a giving page.

2. **Farmerline** — https://farmerline.co/
   Borrow: pairing every icon with a plain-language label, generous
   whitespace, and multilingual affordance treated as a first-class layout
   element, not an afterthought.
   Don't borrow: its marketing-site density (logo walls, long partner
   sections) — Harvest's product screens need to stay task-focused.

3. **YUX Design — "UX design for Agriculture in Africa: case study from
   Zambia"** — https://yux.design/ux-design-agriculture-africa-case-study-zambia
   Borrow: the concrete finding that literal, locally-recognisable icons beat
   abstract ones (farmers misread a dollar note as a phone; a fertiliser icon
   drawn "on top of" a plant was misread because farmers apply it
   underneath) — every icon in Harvest needs a literal check, not just an
   aesthetic one.
   Don't borrow: assuming this maps 1:1 to Caribbean farmers — treat icon
   choices as hypotheses to test with actual users, not a solved library.

4. **Behance — "Agriculture e-commerce app – UX case study"** (Ayushi
   Saxena) — https://www.behance.net/gallery/122152695/Agriculture-e-commerce-app-UX-case-study
   Borrow: the B2B agri e-commerce framing (wireframe-level structure for
   farmer vs. buyer flows) as a sanity check for Harvest's own
   farmer/buyer/transporter split.
   Don't borrow: generic e-commerce chrome (cart icons, checkout stepper) —
   Harvest is commitments and missions, not a shopping cart.

5. **Behance — "Empowering Farmers with Better UX: iFarmer & Folon"** —
   https://www.behance.net/gallery/218589979/Empowering-Farmers-with-Better-UX-iFarmer-Folon
   Borrow: the explicit framing of usability/accessibility/engagement as
   co-equal goals for a real agri-marketplace product (iFarmer, Bangladesh).
   Don't borrow: take specific screen layouts as inspiration only — verify any
   pattern against Harvest's own data model before copying structure.

6. **Whetstone Magazine** — https://www.whetstonemagazine.com/journal
   Borrow: documentary, unstaged food-culture photography and a restrained
   editorial grid (black text on white/cream, large sans headlines, muted
   photography tones) — including its own Caribbean food coverage — as the
   reference for what "editorial" should feel like typographically.
   Don't borrow: its slow, longform-story pacing and moody/archival imagery —
   Harvest's screens are operational, not a magazine feature.

7. **Full Harvest** — https://fullharvest.com/
   Borrow: how a produce marketplace stays credible to commercial buyers
   (clean B2B layout, plain numbers, no cutesy farm iconography) — this is
   the closest public analogue to "must feel credible to a hotel procurement
   manager."
   Don't borrow: its US cold-chain/surplus-produce positioning — Harvest's
   story is availability and trust, not food-waste rescue.

8. **Dribbble — "Harvest Management App UI"** (Rumi Aktar) —
   https://dribbble.com/shots/23107631-Harvest-Management-App-UI
   Borrow: card-based status/quality treatment for produce batches as one
   visual reference point for the crop-batch cards already on the farmer
   page.
   Don't borrow: Dribbble-shot polish (oversaturated gradients, decorative
   shadows with no functional role) — treat it as a single static reference,
   not a system.

9. **Dribbble — "Farmers Marketplace App"** (Abdellah Askane) —
   https://dribbble.com/shots/22494311-Farmers-Marketplace-App
   Borrow: the produce-listing card pattern (photo/icon + crop name +
   quantity + short meta row) as a comparison point for Harvest's own
   `listing-card`.
   Don't borrow: consumer-marketplace framing ("shop", "cart") — Harvest's
   buyers request and commit to supply, they don't browse a storefront.

10. **Figma Community — "Farmzi UI"** —
    https://www.figma.com/community/file/1534534746004452093/farmzi-ui
    Borrow: as a structural starting point for an agritech component library
    (crop-tracking screens, farmer-entrepreneur framing) the Figma owner can
    duplicate into a scratch file to compare against Harvest's existing
    `ui.tsx` primitives.
    Don't borrow: its literal visual style wholesale — it is a generic
    agritech kit, not warm-agrarian-editorial; use it for structure, not skin.

11. **Jade Mountain / Anse Chastanet — Emerald Farm** —
    https://jademountain.com/cuisine/emerald.html
    Borrow: the credibility pattern a real Saint Lucia hotel uses to sell
    farm provenance to guests — specific, concrete claims ("since 2007",
    named consulting chef, named crops) rather than vague sustainability
    language. This is literally the hotel-buyer side of Harvest's own
    Saint Lucia demo scenario.
    Don't borrow: the page is copy-heavy with almost no visible produce
    photography in the fetched markup — Harvest needs stronger visual proof
    than this page currently provides, not less.

12. **Saint Lucia Tourism Authority** — https://stlucia.org/en/
    Borrow: the tropical colour register actually associated with the demo
    island (turquoise water, golden light, deep rainforest green) as a
    photography-mood reference, and its confident, large-type hero treatment.
    Don't borrow: its vacation-brochure tone ("Let Her Inspire You") — Harvest
    is a working tool for people who live there, not a tourist pitch.

## 3. Token proposal

All contrast ratios below were computed with the WCAG relative-luminance
formula against the actual foreground/background pairs (not just against a
blank white page). "Text 4.5" = WCAG AA for normal text; "Large/Icon 3.0" =
WCAG AA for large text (≥18.66px bold / 24px regular) and for meaningful
non-text/icon contrast (SC 1.4.11).

### Existing tokens

| Token | Current | Proposed | Ratio (key pairs) | Rationale |
|---|---|---|---|---|
| `--ink` | `#17332a` | unchanged | ink/cream 12.68:1, ink/card 13.61:1 | Already far above AA; don't touch a working value. |
| `--muted` | `#6b7f77` | **`#526158`** | muted/cream **3.97→6.10:1**, muted/card **4.26→6.54:1** | Bug fix. `--muted` is used for 11–12px labels and captions (`.field label`, `.metric span`, `.crop-card p`) which do not qualify as "large text," so the current value fails AA (3.97–4.26 < 4.5). The darkened value keeps the same muted-green hue and clears AA with margin. |
| `--forest` | `#1d5c45` | unchanged | forest/mint 7.18:1, forest/cream 7.33:1 | Strong everywhere it's actually used as text. |
| `--forest-dark` | `#124333` | unchanged | white/forest-dark 11.19:1 | Sidebar text is fine. |
| `--leaf` | `#5ba64b` | unchanged value; **usage restricted** | leaf/cream **2.79:1 (fails even large-text AA)** | Keep the vivid hex for icons and decorative marks ≥24px, where it reads well and isn't held to text-contrast rules. Stop using it as `.eyebrow` text colour (currently 11px bold uppercase) — swap that one CSS rule to `--forest`, which already passes at 7.33:1. This is a component fix, not a token-value change. |
| `--mint` | `#edf7ef` | unchanged | forest/mint 7.18:1 | Fine as the light tint for forest/leaf. |
| `--cream` | `#f8f7f1` | **`#f7f4ec`** | ink/cream-v2 12.38:1, muted-v2/cream-v2 5.95:1 | Cosmetic warm shift only (less grey, more parchment/paper) — contrast is unaffected within rounding. This is the single biggest lever for "warm" without touching any component logic. |
| `--card` | `#ffffff` | unchanged | — | Keep pure white for contrast headroom against the warmed cream. |
| `--line` | `#dce6df` | **`#e2dbc8`** | line/cream-v2 1.26:1 (current line/cream is 1.19:1) | Cosmetic warm shift to match cream-v2. This is a decorative divider, not a text or required-boundary colour (the codebase already uses a separate, darker `#cfdcd3` for input borders where a real 3:1 boundary is needed) — no AA claim is being made or broken here. |
| `--amber` | `#d99b2b` | unchanged | raw amber/cream 2.26:1 (fails) | Document, don't change: the codebase never actually uses raw `--amber` as text or icon colour — every real usage (`.tone-amber`, `.badge-pending`) already substitutes a hand-picked darker shade (`#9b6910`, `#8b620f`) that passes. Keep that convention explicit for new components rather than tokenising every tint. |
| `--red` | `#c45645` | **`#b84a39`** | red/card **4.41→5.15:1**, red on its actual `.button-danger` bg **4.23→~4.9:1** | Bug fix. `.button-danger` text and the exception icon use raw `--red` at normal text/icon sizes and land just under 4.5:1. Slightly darkened, same hue family, clears AA. |
| `--blue` | `#377f8c` | unchanged | blue on its actual `.tone-blue` bg (icon, non-text) 4.13:1 | This pairing is an icon container, not text, so the 3:1 non-text standard applies, not 4.5:1 — it already passes comfortably. No change needed; noted here so the icon-vs-text distinction is explicit for whoever builds the Figma styles. |

### New tokens

| Token | Value | Role | Ratio (key pairs) |
|---|---|---|---|
| `--soil` | `#4a3324` | Deep warm umber. The palette currently has **zero** earth tone — everything warm-adjacent is either cautionary amber or dangerous red. `--soil` is the "this is farmland, not a spreadsheet" fix: dark warm surfaces (an alternative to `--forest-dark` for hero/photography-backed panels), fallow/empty plot-tile fill, footer or caption bars over imagery. | white/soil 11.73:1, soil/cream-v2 10.67:1, soil/sand 9.54:1 — usable as body text or as a dark surface with white text. |
| `--sand` | `#f3e6d3` | Light warm tint, the `--soil`/`--sun` family's equivalent of `--mint`. Background for plot tiles, the "ready" badge, and any warm-toned card variant. | forest/sand 6.40:1, soil/sand 9.54:1 |
| `--sun` | `#dd7d1f` | Ripe harvest orange-gold. Reserved for **icon fills, large decorative accents, and illustration** — not for text or button labels at any size. At normal size it's 2.72–2.99:1 against cream/white/sand, which fails even the large-text/icon 3.0 threshold; oranges at this saturation simply can't carry small text and stay warm. For the one place this hue needs to be text (the "ready" status badge), use the hand-tuned pairing below instead of the raw token — exactly the same convention `--amber` and the existing badge family already use. | sun/cream-v2 2.72:1, sun/card 2.99:1 — **icon/decorative only, not text.** |

**"Ready" badge text (documented pairing, not a fourth token):** `#8a4a12` text
on `--sand` background = **5.56:1**, comfortably clears AA. This follows the
exact pattern already in `globals.css` for every other badge
(`badge-approved` is `#26724f` on `#e3f5e8`, not raw `--forest` on raw
`--mint`) — the badge system has always hand-tuned per-status text darkness,
this just extends that convention.

### Type scale — farmer-page hero action

The farmer home page currently opens straight into a metric grid. The
"Recommended now" hero card (see §4) needs its own scale, distinct from and
larger than `.metric strong` (currently 22px), because it is the one thing on
the page a farmer must be able to read and act on without help:

| Element | Size | Line-height | Weight/family | Colour |
|---|---|---|---|---|
| Eyebrow ("Recommended now") | 12px | 1.3 | DM Sans 800, uppercase, `.1em` tracking | `--forest` (not `--leaf` — see token table) |
| Headline (the action, in plain language: *"14 kg cucumber is safe to sell today"*) | `clamp(26px, 4vw, 38px)` | 1.15 | Manrope 800, `-.03em` tracking | `--ink` |
| Supporting range/confidence line | 16px | 1.5 | DM Sans 500 | `--muted` (v2) |
| Primary CTA label | 17px | 1.2 | DM Sans 700 | white on `--forest` |
| Secondary ("Not now") | 15px | 1.2 | DM Sans 600 | `--forest` on transparent |

### Spacing scale

`globals.css` currently uses spacing values ad hoc (4, 5, 6, 7, 9, 11, 13, 15,
17, 18, 21, 25, 26px all appear with no discernible system). Proposed scale
— a plain 4px base, matching the closest existing values so this is a
rounding pass, not a rewrite:

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64` (px)

Example remaps: `.card` padding 22px → 24px; `.metric` padding 17px → 16px;
`.crop-card` gap 13px → 12px; `.main-column main` padding 42px/38px →
`48px`/`40px`. None of these are large enough visual jumps to require a
redesign pass — they're a consistency cleanup to do opportunistically as
components are touched.

### Radius scale

Current radii are similarly ad hoc (6, 8, 9, 10, 11, 12, 13, 14, 15, 17, 22px).
Proposed:

| Step | Value | Use |
|---|---|---|
| sm | 8px | inputs, small chips, icon buttons |
| md | 12px | buttons, plot tiles, small cards |
| lg | 16px | standard cards (`.card` is 17px today — effectively unchanged) |
| xl | 24px | hero action card, modals (`.onboarding-prompt` is 22px today — effectively unchanged) |
| full | 999px | pills, badges, avatars (already used, keep as-is) |

### Shadow

Keep `--shadow: 0 12px 35px rgba(25, 64, 48, .08)` for ordinary cards — it
works and most list rows (`.crop-card`, `.order-row`) correctly use a plain
border instead, which should stay that way (not everything needs elevation).

Add one new shadow, warm-toned, reserved for the hero action card and any
photography-backed panel, so the single most important element on the page
is visually distinct from a generic card, not just bigger:

```css
--shadow-warm: 0 20px 50px rgba(74, 51, 36, .16); /* soil-tinted, not forest-tinted */
```

## 4. Component notes

**Primary "Recommended now" hero action card.** One card, above the metric
grid on the farmer home page, surfacing the single highest-value action
(e.g. "14 kg cucumber is safe to sell today — publish it now"). Structure:
eyebrow → headline → one supporting line that keeps the range/confidence
language visible per `product.md`'s "uncertainty remains visible through
ranges, confidence, freshness" non-negotiable (never collapse a range into a
single fake-precise number just because the card is prominent) → one primary
CTA (large touch target, see below) + one quiet "not now" dismissal. When
there is nothing to recommend, this must render as a proper empty state
(see below), never an empty card shell or a hidden component — a farmer
should never wonder if the app is broken versus genuinely having nothing
pending.

**Accordion / progressive disclosure.** Use native `<details>`/`<summary>`,
fully restyled, as the base — it's keyboard- and screen-reader-accessible by
default and isn't in the front-end contract's disallowed-native-chrome list
(that list is native select/date/colour/file pickers and OS scrollbars, not
disclosure elements). Rule: the summary row must show the outcome even
collapsed (status badge + key number), never just a bare label — collapsing
should hide detail, not hide the answer. Candidates: mission stop lists,
order allocation breakdowns, coordinator verification detail.

**Status badges — growing / ready / waiting to sync / needs attention.**
Map onto the existing badge family rather than inventing a parallel system:

| Status | Text / background | Family |
|---|---|---|
| Growing | `--forest` / `--mint` | existing default badge |
| Ready | `#8a4a12` / `--sand` | new — see token table |
| Waiting to sync | `#286b78` / `#e1f2f5` | existing `badge-in-transit` family |
| Needs attention | `#a74334` / `#fce5df` | existing `badge-critical` family |

"Waiting to sync" is read here as *submitted but not yet structured/validated*
by the crop-intelligence pipeline (`product.md` step 2), not as full
device-offline sync — `roadmap.md` explicitly puts "full offline
synchronisation" in P2/not-in-scope, so the badge should not imply a
capability that doesn't exist. Every status must also carry a distinct icon,
not colour alone (WCAG 1.4.1) — relevant here specifically because three of
the four statuses currently differ only by hue.

**Plot tiles for a farm map.** `context.md` already describes the
control-room concept of "farms and crop plots" shown by "crop-stage colours,"
and farmer crop updates already carry a `plot area` field — this component
gives the farmer-facing site (not just the internal control room) a spatial
alternative to the current list-based `crop-grid`. Each tile: status colour
(reusing the badge mapping above) + status icon + short plain-language label
(crop name, not a code) + plot size, minimum 44×44px hit target, grouped in a
responsive grid. Because `frontend-design-contract.md` requires the
participant site and the control room to "feel like one product," the same
status→colour mapping must be reused in the control room's plot view, not
redefined there.

**Empty and error states.** `ui.tsx` already has `EmptyState`/`ErrorState`
components (text-only: a `strong` + a `span`, or a spinner). Keep the
components, extend the content pattern: add a small line-art/icon (not a
photo, not a mascot) so absence doesn't read as a blank clinical box, and
every empty state should name the next action ("Buyer needs for your crops
will appear here" already does this — keep that pattern, don't regress to
generic "No data"). Error states must never imply farmer error and must
always offer a retry button, not just a message.

## 5. Figma next steps (owner-actioned — cannot be done from this repo)

- [ ] Create/update Figma colour styles for all 12 existing tokens plus
      `--soil`, `--sand`, `--sun`, using the proposed values in §3.
- [ ] Create text styles for the DM Sans body scale, Manrope heading scale,
      and the new hero-action scale (§3).
- [ ] Build the **hero action card** component with variants: has-recommendation
      / empty / loading.
- [ ] Build the **status badge** component with variants: growing / ready /
      waiting-to-sync / needs-attention, each with an icon slot (not colour-only).
- [ ] Build the **accordion/disclosure** component: collapsed state must show
      the summary badge + number, not just a label.
- [ ] Build the **plot tile** component with the same 4 status variants plus
      selected/focus states, at a documented minimum 44×44px.
- [ ] Build **empty** and **error** state components (icon + message + next
      action / retry).
- [ ] Lay out a frame applying the hero action card above the metric grid on
      the existing farmer home page design.
- [ ] Lay out a new **farm map** frame (grid of plot tiles) — this doesn't
      exist as a page yet; it's a proposed addition, not a retrofit.
- [ ] Add accessibility annotations to hand off to engineering: contrast
      ratios per §3, touch-target sizes, and which elements need
      `aria-expanded`/accessible names.
- [ ] Build one moodboard frame pulling in 3–4 of the §2 references as visual
      inspiration tiles (screenshots taken manually by the owner — do not
      hot-link or scrape), labelled borrow/avoid per the notes above.
- [ ] Review every new frame at the existing mobile breakpoints (560px,
      820px) already defined in `globals.css`. Note: the current roadmap
      (`docs/roadmap.md`) marks dedicated mobile *engineering* out of scope
      for the hackathon P0 — these breakpoints and touch-target sizes are
      about not regressing the existing responsive web app, not a request to
      start new mobile-specific build work.

## 6. Anti-patterns (would read as AI slop or generic template)

- Purple/violet gradient accents outside the existing, deliberate
  `simulation-replay-banner` (`#6f3fa0`) use — that colour is scoped to
  meaning "you are in replay/simulation mode" and must not bleed into the
  main product palette or it reads as generic AI-startup purple.
- Dark-mode dashboard aesthetics, neon glows, glassy black panels — explicitly
  ruled out by the chosen direction ("not a dark dashboard").
- Gamification: confetti, XP bars, achievement badges, mascot characters —
  explicitly ruled out ("not a game"). A completed delivery is a fact to
  confirm plainly, not a level-up.
- Generic "diverse hands stacked together" or staged-office stock photography.
  If real Caribbean photography isn't available yet, use icons — a fake-feeling
  stock photo undermines credibility with a hotel buyer faster than no photo.
- Flat isometric-people illustration packs (the oversized-head clipart style
  that appears on every generic SaaS marketing site).
- Icon-only buttons or nav items with no text label — fails both the
  low-literacy requirement and the accessible-names requirement in
  `frontend-design-contract.md`.
- Walls of identically-weighted 14px text with no size hierarchy. "Big
  confident type" means some things must be dramatically bigger than others —
  a page where everything is the same size reads as a template, not a design.
- Vague, overly-warm microcopy substituting for plain instructions ("Let's
  grow together! 🌱") — the product's own non-negotiable is low-friction,
  literal farmer input; cute copy adds a comprehension tax the audience can't
  afford.
- Colour-only status signalling (see §4 status badges) — a generic template
  shortcut that also happens to fail WCAG 1.4.1.
- Heavy, page-wide glassmorphism/blur. The existing subtle `backdrop-filter`
  on the topbar is fine; escalating it into frosted-glass panels everywhere
  is a 2021-template tell.
- Emoji standing in for real iconography in the product UI (marketing copy
  outside the app is a different conversation).
