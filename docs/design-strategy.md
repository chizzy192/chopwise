# ChopWise: Design Architecture Strategy

Status: **draft for agreement**. No component code until this is signed off.
Product truth lives in [PRODUCT.md](../PRODUCT.md), and [CLAUDE.md](../CLAUDE.md) wins wherever they differ. This file covers the visual and interaction framework for the staff ordering app (web, mobile-first, React + Vite with plain CSS custom properties).

---

## 0. Pre-flight critique: decisions to confirm

The brief is the authority. These are the places where following it literally would hurt the product, each with a recommendation.

| # | Brief says | Problem | Recommendation |
|---|---|---|---|
| 1 | Light-theme action buttons in terracotta `oklch(0.58 0.14 55)` | Cream text on it measures **4.1:1**, below the 4.5:1 WCAG AA requires for button-size text. Espresso text on it fails too. | Split the token. `--action` for filled buttons drops to `oklch(0.52 0.13 50)`: cream text on it measures 5.3:1, and chroma 0.13 keeps it inside the sRGB gamut. The brief's 0.58 stays as `--action-tint` for badges, the cart dot and other fills that carry no text. |
| 2 | Dark theme has no action color | Terracotta at 0.52 disappears on 0.15 obsidian. | In dark mode the gold `oklch(0.82 0.07 85)` with espresso text (about 11:1) is the primary action color. Terracotta survives in dark mode only as a warm tint. |
| 3 | Cart sheet uses `cubic-bezier(0.34, 1.56, 0.64, 1)` | That curve overshoots by about 10%. A bottom sheet that overshoots lifts off the screen edge and shows a gap underneath. It also feels toy-like on a surface people use to pay. | Sheet: `cubic-bezier(0.32, 0.72, 0, 1)`, a fast-out, no-overshoot drawer curve, at 280ms, with drag-to-dismiss. **Move the 1.56 overshoot to the cart badge and the quantity counter**, where a spring reads as tactile and nothing gets exposed. If you still want the sheet to overshoot, it needs 48px of background overscan below its bottom edge. |
| 4 | Card press `scale: 0.96`; the motion skill says buttons press to `0.97` | No conflict: they are different elements. | Cards press to **0.96** and buttons to **0.97**. Both get written down as tokens so nobody improvises a third value. |
| 5 | "Playfair style" serif | Playfair Display is one of the most over-used AI-default faces. | **Decided: Young Serif** (free, warm, soft-terminaled), self-hosted with `@fontsource`. |
| 6 | Cream + serif + terracotta | The brief pins it, so it stands. It is also the single most common AI-generated look, which makes the default rendition the risk. | Keep the palette but avoid the soft version of it. Character comes from **photography direction, the dark theme as a real stage, and the Fit signal**, not from more cream. See §2 and §6. |
| 7 | The brief doesn't mention the decision engine | The majority gate and decision engine are what set ChopWise apart (PRODUCT.md › Positioning). | Every dish surface carries a **Fit signal** from the engine (§6), shown to every staff member. It is part of the layout system from the start, not a later overlay. |
| 8 | Variance 8 (editorial) everywhere | Editorial layout suits **discovery**. Menus, cart and checkout are tasks where scanability matters most. | Editorial at 8 on Home and caterer pages. Menu, cart and checkout drop to about 4: consistent rows, predictable controls, the same type system. |

---

## 1. Surfaces and modes

| Surface | Mode | Variance | Notes |
|---|---|---|---|
| Landing page (`/`, logged out) | Persuade | 7 | What ChopWise is, how a day works, the guidance bands, roles, example receipt |
| Home / Discover (staff) | Persuade-leaning Operate | 8 | Editorial, asymmetric, photo-led |
| Caterer page | Experience → Operate | 7 → 4 | Cover at the top, menu list below |
| Dish detail | Operate | 5 | Photo, RDI values, Fit explanation, add control |
| Cart sheet / Checkout | Operate | 3 | Projected intake, breakdown, Paystack; fast, calm, no surprises |
| Health onboarding / Daily check-in / Intake view | Operate | 3 | Clarity first; data-viz rules apply |
| Caterer and admin dashboards | Operate | 3 | Meal library, order status, approvals, settings, reports |

---

## 2. Color system (OKLCH)

### Tokens

Semantic names only. Components never reference raw values.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--surface` | `oklch(0.97 0.015 75)` | `oklch(0.15 0.02 45)` | Page ground |
| `--surface-raised` | `oklch(0.93 0.025 80)` | `oklch(0.20 0.025 45)` | Cards, sheet |
| `--surface-sunken` | `oklch(0.94 0.02 78)` | `oklch(0.12 0.018 45)` | Inputs, steppers, tracks |
| `--ink` | `oklch(0.22 0.035 45)` | `oklch(0.95 0.015 75)` | Primary text |
| `--ink-muted` | `oklch(0.45 0.03 50)` | `oklch(0.75 0.02 70)` | Meta text (light 6.9 / 6.1:1, dark 8.8 / 8.2:1 on surface / raised) |
| `--action` | `oklch(0.52 0.13 50)` | `oklch(0.82 0.07 85)` | Filled primary buttons (text on it: light 5.3:1, dark 10.0:1) |
| `--on-action` | `oklch(0.97 0.015 75)` | `oklch(0.22 0.035 45)` | Text on action |
| `--action-tint` | `oklch(0.58 0.14 55)` | `oklch(0.58 0.12 55)` | Text-free fills: cart dot, active rail marker |
| `--accent` | `oklch(0.58 0.14 55)` | `oklch(0.82 0.07 85)` | Active state, focus ring, highlights |
| `--rule` | `oklch(0.22 0.035 45 / 0.12)` | `oklch(0.95 0.015 75 / 0.10)` | Hairlines |

### Fit state colors (the four engine states; never colour alone)

Each state is a **shape + word + colour**. The shape and word carry the meaning on their own. Contrast is measured against `--surface` / `--surface-raised`, and every value passes AA for text (4.5:1).

| Token | State | Shape | Light | Contrast (light) | Dark | Contrast (dark) |
|---|---|---|---|---|---|---|
| `--fit-balanced` | **Balanced** | Filled circle ● | sage `oklch(0.47 0.09 140)` | 6.0 / 5.4 | `oklch(0.80 0.09 140)` | 10.9 / 10.0 |
| `--fit-recommended` | **Recommended** | Upward chevron ▲ | indigo `oklch(0.46 0.10 265)` | 6.6 / 5.9 | `oklch(0.80 0.08 265)` | 10.5 / 9.7 |
| `--fit-caution` | **Caution** | Triangle with ! | amber `oklch(0.50 0.10 70)` | 5.6 / 5.0 | `oklch(0.82 0.11 80)` | 11.2 / 10.3 |
| `--fit-restricted` | **Restricted today** | Padlock | brick `oklch(0.46 0.13 30)` | 7.0 / 6.2 | `oklch(0.76 0.10 30)` | 8.8 / 8.2 |

- Indigo for Recommended draws on adire cloth and keeps the two positive states apart: green means "balanced", blue means "good for you right now".
- `--fit-restricted` sits at hue 30 and a lower lightness than the terracotta `--action`, and it always carries the padlock, so a lock never looks like a button.
- The figures were computed from OKLCH → sRGB with the WCAG 2 formula. The token contrast test (§8) re-checks them in CI.

### Shadows: tinted, two-layer, light theme only

```
--shadow-card:  0 1px 2px  oklch(0.22 0.035 45 / 0.06),
                0 12px 32px -12px oklch(0.22 0.035 45 / 0.18);
--shadow-lift:  0 2px 4px  oklch(0.22 0.035 45 / 0.08),
                0 24px 48px -16px oklch(0.22 0.035 45 / 0.24);   /* sheet, pressed-release */
```

Dark theme: shadows don't show up on obsidian, so elevation comes from **a lighter surface plus a 1px top highlight** (`inset 0 1px 0 oklch(0.95 0.015 75 / 0.05)`). No black shadows anywhere.

### Theme scenes

- **Light, the bakery counter at 10am:** daylight, photos look fresh, cream ground, espresso ink. A staff member ordering lunch at their office desk on campus.
- **Dark, the speakeasy at 9pm:** the default **after dusk** (`prefers-color-scheme` first, user override persisted). Photos sit on obsidian like plates under a pin-spot, and gold marks what's active. This should be a stage in its own right, not just an inverted light theme.

---

## 3. Asymmetric layout strategy (Home / Discover)

**Principle:** each section has its own structure, so the page reads like a food magazine issue rather than a feed. Every section uses the same grid, radii and type, so it still feels like one product.

**Grid:** mobile is 4 columns with 16px gutters and 16px page margins. Desktop is 12 columns, max 1280px, 24px gutters. One spacing scale (4-based: 4, 8, 12, 16, 24, 32, 48, 72, 112), with more space above section heads than below.

### Section map (mobile first; desktop in brackets)

**① Masthead (sticky, compact)**
Wordmark left, today's guidance chip centre ("Soft guidance" at G = 0, "Full guidance" at G = 1, with its shape icon; tapping it opens today's intake), cart right. The cart shows a count dot in `--action-tint`. No search bar in the hero; search is an icon that expands.

**② Featured caterers: the cover story**
- "Featured chefs" means the campus caterers. One caterer per viewport. Horizontal scroll-snap, `scroll-snap-type: x mandatory`, with the next card peeking about 12% at the edge to show the row scrolls.
- 4:5 portrait plate (one of the caterer's dish photos) at full bleed minus margins, 20px radius. The caterer name sits **over the bottom third** of the photo in the display serif at about 40px on a soft espresso scrim gradient (text contrast verified, not guessed). Below the photo, only facts from the database: how many dishes are available today, and how many of them are Balanced or Recommended for this user.
- [Desktop: 7 columns of photo and 5 columns of text side by side, like a magazine spread with the image bleeding left.]
- **Refuses:** the avatar circle + name + star row, and any invented ratings, reviews or caterer stories.

**③ Categories: a typographic index, not icon tiles**
- A horizontal rail of **words in the display serif** (Soups · Grills · Swallow · Rice · Light plates…), each followed by a superscript count in the sans. The active one is underlined with a 2px `--accent` rule that slides between words (transform only).
- No icons and no emoji tiles. It reads like the contents line on a menu.
- [Desktop: wraps to two lines, left-aligned, at a larger size, and works as a section break.]

**④ For you today: the guidance shelf (ChopWise's signature section)**
- Shown to **every** staff member once the daily check-in is done. Title: "For you today".
- A one-line summary from today's check-in sits above the list, e.g. "Carbohydrates are at 75% today. You have 15% left before the limit." Under G = 1 it also names any restricted class.
- Structure: **a list, not cards.** Balanced dishes come first, then Recommended ones, following the engine's order. Each row has a 72px square thumbnail, the dish name in serif, the Fit signal, the price right-aligned in the sans, and an add control. Up to five rows, then "See all".
- The deliberate shift to a calm, dense list after the photo-heavy cover signals "this part is information you can trust".
- [Desktop: two columns of rows.]

**⑤ Trending Dishes: broken grid**
- Mobile: a **lead dish at full width in 4:5**, then two dishes side by side in 1:1 with the **right one offset 48px lower** for a staggered baseline, then a full-width 16:9 landscape dish, then the pattern repeats with the stagger mirrored.
- [Desktop: the lead spans 7 columns × 2 rows, two stacked dishes take 5 columns, then a row of three at 4/4/4 with the middle one raised.]
- Dish name in serif, price in the sans at a **larger size than the meta line**, the caterer name and RDI values in the sans muted, and the Fit signal as a small shape plus word.
- "Trending" is counted from real orders over the last 7 days. With too few orders it becomes "Available today", never fake popularity.

**⑥ Quiet passage**
One full-width photo, the brand's only big type moment ("Cooked with care. Matched to you.", placeholder copy), with lots of space. It gives the eye a rest before the final section.

**⑦ Reorder**
A practical compact horizontal rail of past orders, with one-tap reorder. The page ends here, on a concrete task.

### Rhythm

Cover (loud) → index (typographic) → list (dense, calm) → broken grid (lively) → quiet passage → utility rail. Density alternates through the whole page, and no two neighbouring sections share a structure.

### Where editorial stops

Caterer page menus, cart and checkout use **uniform rows**: name and description on the left, price and the add control on the right in a fixed column. Asymmetry there would slow ordering down (Principle 5).

**Change of decision: grids on laptops and desktops (1024 px and wider).** Below 1024 px (phones and small tablets) the single-column layouts above stay as they are. From 1024 px, the pages where people scan and act on many items use uniform **card grids**, because one long column wastes most of a wide screen and makes comparing dishes slower:

- **Staff menu (Order page):** every section's dishes become cards in `repeat(auto-fill, minmax(var(--card-min), 1fr))` (about 3 columns at 1280 px, 4 at 1440 px). Each card: 4:3 photo with the 20 px radius, name, price, Fit label, "Only N left" / "Sold out", RDI values, and the Add / − 1 + control at the bottom. Cards in a row share one height and their controls line up along the bottom. "Not today" cards stay in the grid, marked with the dashed lock, the Add control disabled and a "See alternatives" link. The cart stays a side panel on the right.
- **My orders:** order cards in a grid (2–3 columns), newest first.
- **My intake:** the food-class bars and the intake donut sit side by side.
- **Caterer Orders:** a board with one column per status (Paid → Preparing → Out for delivery → Delivered today); each column scrolls on its own when long.
- **Caterer My dishes** and **Admin Meal approval:** dish cards in a grid.
- **Admin Users, Settings, Audit log, Report:** tables and panels use the full page width; the Report's figures are a grid of stat cards and charts.

**Update (cards on phones too):** the staff menu and the caterer's My dishes use the same card grid at every width: one column of cards on phones (photos fill the card at 4:3, larger than the old 72 px thumbnails), more columns as the screen widens. On phones and small tablets (860 px and below) the app bar shows only the logo, the cart and a Menu button; the Menu opens a panel with the page links, the user's name, the theme switch and Log out.

Rules: columns come from `auto-fill` / `minmax`, never fixed column counts; gaps and minimum card widths are tokens (`--grid-gap`, `--card-min`, `--order-card-min`, `--board-col-min`); no horizontal page scroll at any width; keyboard order follows the visual order (left to right, top to bottom; on the board, column by column); an empty grid shows a helpful message across the whole grid area.

---

## 4. Typography

### Faces (decided)

| Role | Face | Use |
|---|---|---|
| Display serif | **Young Serif** (`@fontsource/young-serif`) | Caterer names, dish names, category index, section titles, the quiet-passage line |
| Sharp geometric sans | **Jost** (`@fontsource/jost`) with **tabular figures** | Prices, RDI values, counts, buttons, body, labels, everything functional |

Rules:
- **The serif never sets body text, prices, or controls.** It is for names and titles only.
- **All numbers use `font-variant-numeric: tabular-nums`**, so prices align in columns and the counter doesn't jitter while it ticks.
- No tracked-out tiny uppercase mono labels (an AI-editorial tell). Small labels are the sans in sentence case at 13px, weight 500.

### Scale (fluid, `clamp()`)

| Token | Mobile → Desktop | Face / weight | Use |
|---|---|---|---|
| `display-xl` | 40 → 72px, lh 1.0 | Serif 400 | Cover caterer name, quiet passage |
| `display-l` | 28 → 44px, lh 1.05 | Serif 400 | Section titles, caterer page title |
| `title` | 20 → 24px, lh 1.15 | Serif 400 | Dish names on cards |
| `title-s` | 17 → 18px, lh 1.2 | Serif 400 | Dish names in list rows |
| `price` | 18 → 20px, lh 1 | Sans 600, tnum | Prices |
| `body` | 16px, lh 1.5 | Sans 400 | Descriptions (max 60ch) |
| `meta` | 14px, lh 1.3 | Sans 500, `--ink-muted` | RDI values, caterer name, order status |
| `label` | 13px, lh 1.2 | Sans 500 | Fit words, chips |

### Hierarchy on a dish

**Dish name (serif) → price (sans, bold) → Fit signal → RDI values (meta)**.
The price is always the second thing read, and the Fit signal always sits next to it, so the decision is made from one glance.

RDI values appear on every dish card as a compact row of the five classes in `meta` with tabular figures, e.g. "Carb 48% · Protein 12% · Fat 20% · Vitamin 8% · Mineral 6%". The class that drives the Fit state is set in `--ink` at weight 600; the rest stay `--ink-muted`.

Format: prices via `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })`, e.g. "₦2,500.00". No made-up ratings.

---

## 5. Imagery and surfaces

- **Radii:** images **20px**. Cards that wrap an image with 8px padding use **28px** (outer = inner + padding, so the curves nest). Buttons and chips are fully rounded pills. Sheet top corners are 28px.
- **Aspect ratios:** 4:5 (cover, lead dish), 1:1 (grid, thumbnails), 16:9 (landscape break). Reserved with CSS `aspect-ratio` on a plain `<img>` with `loading="lazy"` and `decoding="async"` (the cover image above the fold loads eagerly), never by image load.
- **Source:** caterers upload dish photos (JPEG, PNG or WebP, size-limited, stored under generated names).
- **Photography direction** (for real shoots or briefs to vendors): overhead or 30° angle, natural side light, the dish filling 70% of the frame, a warm surface (wood, clay, linen), steam or texture visible. Avoid white cyc backgrounds and avoid stock photos of people.
- **Placeholders** until real assets arrive: neutral `--surface-sunken` blocks with the dish name. No fake food photos.

---

## 6. The Fit signal (decision engine)

The Fit signal is the decision engine's verdict on a dish for this user today. It is **not** based on nutrient limits for a particular condition. It is shown to **every** staff member, because every order affects intake. The server computes it from today's check-in (H, P1, P2, G) and projected intake.

| State | When (from CLAUDE.md) | Shape | Dish behaviour |
|---|---|---|---|
| **Balanced** | Every class between 5% and 35% of RDI | Filled circle ● | Always available, never restricted, listed first |
| **Recommended** | Fills an under-eaten class (still in Low) when a class is Moderate, or fits within the remaining allowance (`90 − current intake`) when a class is High | Upward chevron ▲ | Available |
| **Caution** | Would push a class to High or Critical | Triangle with ! | Available, with a warning. Under G = 0 a meal dominated by a Critical class gets the strong warning here instead of a lock |
| **Restricted today** | G = 1, the meal isn't balanced, and its dominant class is Critical | Padlock | **Visible but locked.** The add control becomes "See alternatives", and alternative dishes are suggested |

- **Anatomy:** shape icon (12px) + word + `--fit-*` colour (§2). Shape and word carry the meaning without colour, so it holds up for colourblind users and in greyscale.
- **Placement:** directly under or next to the price on every dish surface, including the cart.
- **Restricted card treatment:** the photo dims to 60% opacity behind a `--surface` wash; the name, price and RDI values stay at full contrast so the user can read why. It is not hidden, blurred or moved.
- **Tap:** opens a small popover with *why*, citing the RDI numbers: "Adds 48% carbohydrates. You're at 75% today; the limit is 90%." It ends with the line "Guidance, not medical advice."
- **Never:** a red/green traffic light, scores out of 100, "healthy" labels without a reason, or Fit used as a sales badge.

---

## 7. Motion system

### Tokens

```
--ease-out:      cubic-bezier(0.23, 1, 0.32, 1);     /* default UI */
--ease-drawer:   cubic-bezier(0.32, 0.72, 0, 1);     /* sheets, no overshoot */
--ease-spring:   cubic-bezier(0.34, 1.56, 0.64, 1);  /* the brief's curve: small elements only */
--dur-press:     120ms;
--dur-fast:      180ms;
--dur-base:      240ms;
--dur-sheet:     280ms;
```

Hard rules (from the motion skill): **transform and opacity only**, nothing above 300ms, no `ease-in`, and `prefers-reduced-motion` handled centrally. No animation on keyboard or high-frequency actions: tab switches, typing and filtering are instant.

### Press states

| Element | Press | Release |
|---|---|---|
| Dish / caterer card | `scale(0.96)`, `--dur-press`, `--ease-out` | back to 1 over `--dur-base` |
| Buttons, add control | `scale(0.97)` | same |

- The press triggers on `pointerdown` and **cancels if the pointer moves more than 8px**, so scrolling a feed never shrinks cards.
- No hover-scale on cards. On fine pointers hover is only a slight shadow shift (light) or highlight brightening (dark).

### Add to cart: button → counter morph

The control has a **fixed footprint** (e.g. 112 × 44px) in every state, so nothing around it shifts.

| State | Visual | Transition in |
|---|---|---|
| `idle` | Pill "Add · ₦price" (or "+ Add" in compact rows) | n/a |
| `idle → 1` | The label fades out with a slight 4px upward shift and blur (120ms). `−` and `+` slide in from the centre outwards (translateX ±8px → 0, opacity 0 → 1, 180ms `--ease-out`). "1" rises into place. The background changes from `--action` to `--surface-sunken` via an opacity crossfade between two stacked layers (no color animation). | 180ms |
| `n → n±1` | **Slot roll:** the old number translates Y −100% (up) or +100% (down) and fades; the new one comes in from the opposite side. 160ms `--ease-spring`, interruptible on fast repeat taps (the next value starts from the current position). | 160ms |
| `1 → 0` | The reverse of the morph back to `idle`. | 180ms |
| Side effect | The masthead **cart dot bumps**: `scale 1 → 1.2 → 1`, 240ms `--ease-spring`, and the count rolls in the same way. This is where the brief's spring curve belongs. | 240ms |

- `aria-live="polite"` announces "2 Jollof rice in cart". The buttons are labelled "Remove one Jollof rice" and "Add one Jollof rice".
- Optional: `navigator.vibrate(8)` where supported. iOS Safari has no Vibration API, so it can only be an enhancement.
- **Reduced motion:** no slides or rolls. A 120ms opacity crossfade between states, and the number swaps instantly.

### Cart sheet

| Phase | Behavior |
|---|---|
| Open | `translateY(100%) → 0`, `--dur-sheet` `--ease-drawer`. The scrim fades 0 → 0.4 opacity over 200ms. The page behind scales to 0.98 (desktop: none). Origin-aware: opening from the masthead cart on desktop slides it in from the right as a side panel instead. |
| Drag | Follows the finger 1:1. Dragging above the top meets rubber-band resistance (logarithmic damping), so it never springs past its edge. |
| Dismiss | Release beyond 30% of its height **or** with a fast flick → closes over 200ms `--ease-out`. Otherwise it snaps back. |
| Content | Line items keep their counter controls. Below them, the **projected intake** after this cart for all five classes (from the server's cart evaluation), with the Fit warning for any class it would push to High or Critical. Then the breakdown: meals, add-ons, VAT, delivery fee, total. Removing an item collapses its row height with a FLIP animation (transform-based) at 200ms. |
| A11y | `role="dialog"`, focus moves to the sheet title, focus is trapped, Esc closes, and focus returns to the cart button. |
| Reduced motion | The sheet fades in place (opacity, 150ms) with no slide. |

### Theme toggle (light ↔ dark)

- **The switch itself is instant for the page:** add `[data-theme-switching]` to suppress every CSS transition for one frame, swap the token set, then remove it. This stops hundreds of elements from fading their colors out of sync, which looks muddy.
- **The one deliberate flourish:** where the View Transitions API is supported, a **circular reveal clip from the toggle's position** (origin-aware), 300ms `--ease-out`, over a snapshot of the old theme. Elsewhere it is the instant swap.
- **Toggle icon:** the sun becomes a moon via rotate(−90° → 0) + opacity, 200ms.
- The theme preference (not a session token) is persisted to `localStorage`, applied by a small no-flash inline script in `client/index.html`'s `<head>`. Default follows the system.
- Reduced motion: instant swap with no reveal.

### Not animated

Route changes between tabs, search typing and results, filters, price updates, list re-sorting and skeleton shimmer (use a static skeleton instead).

---

## 8. Frontend code-cleanliness checklist

**Tokens and theming**
- [ ] Every color, radius, shadow, duration and easing comes from a CSS custom property in one `tokens.css`. No raw `oklch()`, hex or ms values in components.
- [ ] Semantic token names (`--surface-raised`, not `--khaki`).
- [ ] Themes via `[data-theme]` + `prefers-color-scheme`, with the no-flash script. Both themes are tested on every component.
- [ ] A contrast test script asserts AA for every text/background token pair in both themes, including the Fit tokens.

**Type and assets**
- [ ] Fonts self-hosted with `@fontsource` (Young Serif, Jost), imported once in the entry file, with `font-display: swap` and a size-adjusted fallback (no layout shift when fonts load).
- [ ] `tabular-nums` on every numeric element.
- [ ] Plain `<img>` with `width`/`height` or CSS `aspect-ratio` reserved, `loading="lazy"` and `decoding="async"` below the fold. Placeholders are a `--surface-sunken` block, never a generic grey spinner.

**Components and structure**
- [ ] Components are named after the domain: `CatererCover`, `CategoryIndex`, `ForYouShelf`, `DishTile`, `DishRow`, `AddToCartControl`, `CartSheet`, `FitSignal`, `ThemeToggle`.
- [ ] One API client module for all fetches (cookies sent with `credentials: 'include'`); pages never call `fetch` directly.
- [ ] Fit states, totals and gate values come from the server. The client renders them and never recomputes them.
- [ ] One source of truth for cart state (a React context), so the control, badge and sheet always agree.
- [ ] Sample data lives in `server/src/db/setup.js` and is clearly marked as sample data. No invented ratings, caterer stories, nutrition values or health claims.

**Interaction and motion**
- [ ] Animate only `transform` and `opacity`. `will-change` is applied only while animating.
- [ ] Durations and easings live in `tokens.css`, and one `motion.js` exports the same values for the few JavaScript-driven animations (sheet drag, FLIP). No component defines its own curve.
- [ ] `prefers-reduced-motion` is handled in that one module and in a global CSS block.
- [ ] Press states cancel on scroll movement. Touch targets are at least 44 × 44px.

**Accessibility**
- [ ] Real `<button>` and `<a>` elements; no clickable divs.
- [ ] `:focus-visible` rings using `--accent` with 2px offset, visible on photos and in both themes.
- [ ] Health meaning never relies on color alone. Fit popovers are keyboard reachable.
- [ ] Cart changes are announced through `aria-live`. The sheet follows the dialog pattern.
- [ ] Layout holds at 200% zoom and 320px width.

**Layout hygiene**
- [ ] A defined z-index scale (`base`, `sticky`, `scrim`, `sheet`, `toast`), with no ad-hoc 9999s.
- [ ] No fixed-pixel grids that break at in-between widths. Use fluid `clamp()` spacing and type.
- [ ] No horizontal page scroll; horizontal scrolling happens only inside rails.
- [ ] Empty, loading, error and overlong-name states designed for every section.

**Gatekeeping**
- [ ] ESLint with `jsx-a11y`, and the Impeccable detector run on changed UI files before review.
- [ ] Screenshots at 390 and 1440 wide, in both themes, before any surface is called done.

---

## 9. Decisions (answered)

1. **Market and currency:** Nigeria, naira (₦), formatted with `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })`.
2. **Health conditions:** one required yes/no question about diet-related conditions (diabetes, hypertension, heart disease, etc.), with a "well controlled through diet" option, asked after sign-up and first login and editable later. It sets H for the majority gate; there are no per-condition Fit rules.
3. **Display serif:** Young Serif (free). Sans: Jost with tabular figures. Both self-hosted with `@fontsource`.
4. **Styling approach:** plain CSS custom properties in one `tokens.css`. No Tailwind, no CSS Modules.
5. **Sheet curve:** accepted as proposed: drawer curve for the sheet, spring for the badge and counter.
6. **Nutrition data source:** caterers enter each dish's RDI values (% of daily RDI per serving), and the admin approves them. Editing RDI values sends the dish back for approval; editing price or photo doesn't.
