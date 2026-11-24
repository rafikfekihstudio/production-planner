# Gumroad thumbnail design brief

Status: draft brief only. No images generated. Not committed.

Four matching square thumbnails for the Production Planner Gumroad listings. Style: dark dashboard. Each thumbnail includes the product title and price as live type.

## Shared spec for all four

- **Canvas:** 1200 × 1200 px, 1:1, PNG, sRGB. Gumroad requires square and at least 600 × 600.
- **Safe margin:** 90 px on all sides.
- **Background:** near-black `#0B0F14`, subtle radial glow `#10202B` from top-left, faint 1px grid at 60 px spacing, ~12% opacity.
- **Motif:** a simplified rounded dashboard card with a `07:00–23:00` timeline and 3–4 colored schedule bars. Keep it abstract — no real client data.
- **Type:** Inter / Geist SemiBold.
  - Top wordmark: `PRODUCTION PLANNER`, 24 px, uppercase, letter-spacing `.14em`, white 70%.
  - Price: 104 px, Bold.
  - Product title: 58 px, SemiBold.
  - Badge: 26 px, uppercase, letter-spacing `.12em`.
- **Layout:** wordmark top-left; dashboard card centered; price and title in lower third; badge top-right or directly under title.
- **Important:** build the artwork **without text**, then add all words as live type in Figma/Canva. Image generators often garble text.

## Palette and copy per thumbnail

| Thumbnail | Accent | Badge | Main text | Secondary line |
|---|---|---|---|---|
| Personal | Teal `#2DD4BF` | `1 STUDIO • INTERNAL USE` | `$39` / `Personal Studio` | `Self-hosted • Source code` |
| Commercial | Indigo `#8B9BFF` | `CLIENT WORK • WHITE-LABEL` | `$99` / `Commercial License` | `Client projects • Self-host` |
| Setup | Amber `#FBBF24` | `HANDS-ON HELP` | `$149` / `Setup & Customization` | `Install • Configure • Handoff` |
| Ownership | Gold `#F5C451` | `ONE BUYER ONLY` | `$699` / `Full Ownership` | `All rights • Signed transfer` |

## Suggested file names

- `production-planner-personal-thumbnail.png`
- `production-planner-commercial-thumbnail.png`
- `production-planner-setup-thumbnail.png`
- `production-planner-ownership-thumbnail.png`

## Upload notes

Upload these on each product's **Product tab → Thumbnail**. The separate **Cover** field wants a horizontal image at least 1280 × 720, so don't reuse these squares there.

Before upload, check all four at **128 px** and **600 px**. The price should still be the first thing you read, then the tier, then the wordmark.

## Generator prompts

Use these to generate the **text-free background**, then add the words from the table above as live type. Do not paste a raw app screenshot into the square thumbnail — at small sizes it becomes noise and can expose client data. If you want realism, use a screenshot only as a faint blurred texture at 10–15% opacity behind the card.

### Shared negative prompt

```text
text, letters, numbers, words, typography, watermark, signature, logos, brand names, people, faces, hands, phones, laptops, monitors, desks, photorealism, messy composition, low contrast, client data, emails, dates, credentials
```

### Personal

```text
Square 1:1 digital product thumbnail background, dark premium scheduling SaaS aesthetic, deep charcoal-black background #0B0F14 with a subtle cool radial glow #10202B from the top-left, faint thin grid lines at 60px spacing at 12% opacity, one centered rounded glass dashboard card with a thin teal #2DD4BF border, inside the card a simplified horizontal timeline from morning to late evening and three calm teal and soft-blue schedule bars, generous clean empty space in the lower third for typography, crisp vector-like rendering, sharp edges, minimal, high contrast, no text, no letters, no numbers, no logos, no people, no devices, no clutter -- square 1:1 composition
```

### Commercial

```text
Square 1:1 digital product thumbnail background, dark premium scheduling SaaS aesthetic, deep charcoal-black background #0B0F14 with a subtle indigo radial glow #171B33 from the top-left, faint thin grid lines at 60px spacing at 12% opacity, one centered rounded glass dashboard card with a thin indigo #8B9BFF border, inside the card a more structured multi-column timeline with four or five indigo, violet and blue schedule bars, small abstract layered panels suggesting client work, generous clean empty space in the lower third for typography, crisp vector-like rendering, sharp edges, minimal, high contrast, no text, no letters, no numbers, no logos, no people, no devices, no clutter -- square 1:1 composition
```

### Setup

```text
Square 1:1 digital product thumbnail background, dark premium scheduling SaaS aesthetic, deep charcoal-black background #0B0F14 with a subtle warm amber radial glow #2A2110 from the top-left, faint thin grid lines at 60px spacing at 12% opacity, one centered rounded glass dashboard card with a thin amber #FBBF24 border, inside the card a simplified timeline with three schedule bars plus abstract sliders and toggle shapes suggesting configuration and handoff, generous clean empty space in the lower third for typography, crisp vector-like rendering, sharp edges, minimal, high contrast, no text, no letters, no numbers, no logos, no people, no devices, no clutter -- square 1:1 composition
```

### Ownership

```text
Square 1:1 digital product thumbnail background, dark premium scheduling SaaS aesthetic, deep charcoal-black background #0B0F14 with a subtle gold radial glow #2B2412 from the top-left, faint thin grid lines at 60px spacing at 12% opacity, one centered rounded glass dashboard card with a thin gold #F5C451 border, inside the card one prominent solid gold schedule bar with the remaining bars dimmed to near-black, subtle gold rim light, feeling of exclusivity and a single final buyer, generous clean empty space in the lower third for typography, crisp vector-like rendering, sharp edges, minimal, high contrast, no text, no letters, no numbers, no logos, no people, no devices, no clutter -- square 1:1 composition
```
