# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 18 + Vite, React Router and Recharts (`client/`); Node.js + Express with ES modules (`server/`); PostgreSQL with plain parameterised SQL. Styling is plain CSS custom properties in one `tokens.css`; fonts self-hosted with `@fontsource`. CLAUDE.md is the source of truth and wins wherever this file differs.

## Users

- **Staff (primary):** staff members at the University of Nigeria, Nsukka (UNN) ordering meals on campus during the working day, some with a diet-related condition such as diabetes, hypertension or heart disease. Their job is to order a meal that is good for them today without having to work out nutrition themselves.
- **Caterers:** campus caterers who keep a meal library, mark dishes available or sold out each day, prepare orders and confirm delivery with the order's 4-digit code.
- **Admin:** has full control: approves and unapproves meals (including their RDI values), views reports, grants or removes caterer and admin access, sets VAT and the delivery fee, and views the audit log. The first admin and the sample caterer are seeded from environment variables. The admin can create caterer accounts and reset caterer passwords with a temporary password, which must be changed at the next login; every admin action is audit-logged. There is no separate super admin.

Login has no role picker; the account's role decides the dashboard. Staff self-register.

## Product Purpose

ChopWise is a web-based diet control food delivery system and a final-year BSc Computer Science project at UNN. Staff order meals from campus caterers, and a rule-based decision engine guides each choice using the staff member's daily intake as a percentage of the Recommended Daily Intake (RDI). A 3-input majority gate decides how strict that guidance is. Success means staff order food that keeps their intake in a healthy band, and the system behaves exactly as the written report (Chapters 1–4) describes.

## Positioning

A delivery app where the menu responds to what you have already eaten today. The majority gate `G = H·P1 + H·P2 + P1·P2` combines the user's declared health status (H) with their last two meals (P1, P2). Its result sets the guidance: soft (recommendations and warnings) at G = 0, and full (recommendations, warnings and restrictions) at G = 1.

## Operating Context

A staff member's day:

1. **Health onboarding (once, after first login):** a required yes/no question about diet-related conditions. H = 1 for any declared condition. Editable later.
2. **Daily check-in (once a day, before the first order):** the user confirms their last two meals, pre-filled from order history and changeable if they ate elsewhere. H, P1, P2 and G are computed once and stored in `daily_checkins`.
3. **Order:** browse dishes (photo, name, price, RDI values and Fit signal), choose quantities and add to the cart. The whole cart is evaluated on projected intake before checkout.
4. **Pay:** online only, through Paystack in test mode. The order is confirmed only after the server verifies the payment.
5. **Delivery:** order status goes paid → preparing → out for delivery → delivered. The caterer enters the 4-digit delivery code to mark the order delivered.

Intake comes from orders and the daily check-in; there is no manual meal logging. Intake and the check-in reset at midnight, Africa/Lagos time.

## Capabilities and Constraints

- **Food classes:** carb, protein, fat, vitamin, mineral. Meal values are % of daily RDI per serving; quantity multiplies them.
- **Bands per class:** Low 0–40%, Moderate >40–70%, High >70–90%, Critical >90% (upper bounds inclusive).
- **P1, P2:** 1 if, after that meal, any class is above 70% of RDI. The older meal is applied first, then the recent one on top.
- **Balanced meal:** every class between 5% and 35%. Balanced meals are always exempt from restriction and listed first.
- **Dominant class:** the class with the highest % in a meal.
- **Guidance:** Moderate recommends meals from classes still in Low. High warns and recommends only meals that keep every High class at or under 90% (remaining allowance `90 − current intake`). Under G = 1 a non-balanced dish is locked ("Restricted today", Add disabled, alternatives shown) when its dominant class would end above 90% after the whole cart; the server refuses it with 409 at cart evaluation and checkout. Under G = 0 it shows a strong warning instead.
- **Fit signal:** comes from the decision engine, not per-condition nutrient limits, and is shown to every staff member. Four states, each a shape + word, never colour alone: Balanced, Recommended, Caution, Restricted today. The "why" popover cites the RDI numbers.
- **Nutrition values:** entered by caterers and approved by an admin. Editing a dish's RDI values sends it back for approval; editing price or photo doesn't.
- **Dish types:** add-ons with no RDI values (water) never affect intake; extras with RDI values (yoghurt) count toward intake, get a Fit signal and follow the 2-per-order limit, but are not meals. Every meal line comes with a bottle of water per plate at the admin's standard price (₦300 to start); staff can remove it per meal line in the cart.
- **Checkout:** meals + extras + add-ons + VAT + flat delivery fee. VAT and the fee are admin settings. The server calculates and locks the total with item prices snapshotted.
- **Currency:** naira (₦), formatted with `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })`.
- **Security:** Argon2id passwords; httpOnly, Secure, SameSite session cookies; login rate-limiting and temporary lockout; Helmet; strict CORS; Zod validation; role checks on every route; JPEG/PNG/WebP uploads with size limits and generated names; secrets only in `.env`.
- **Plain language:** the landing page and staff pages say "health check", "your last two meals", "guidance level: gentle or firm", "your daily limit" and the Fit states Balanced, "Good for you right now", "Careful" and "Not today"; the technical terms appear in tooltips.
- **Landing page:** standalone at `/` with no app navigation; logged-in users who open it go to their own home.
- **Feedback:** after a staff member's 2nd delivered order, a one-time pop-up (at most 3 showings; "Not now" waits for the next delivered order) asks two 1–5 scores, whether the guidance changed the order, and an optional comment. Admins see the averages, the split and the latest comments on the report; comments are never public.
- **Password reset:** "Forgot password?" emails a single-use link valid for 30 minutes (only its SHA-256 hash is stored), always answers with the same message, signs out every session on success, and is rate-limited (5 per hour per IP, 3 per hour per email). Sign-up and reset ask for the password twice, checked by the browser and the server.
- **Engineering:** `server/src/logic/` stays pure and unit-tested; `npm test` passes after every phase.

## Brand Commitments

- Name: ChopWise ("chop" is Nigerian Pidgin for food).
- Copy: plain and clear, in sentence case.
- The earth-tone OKLCH palette is the brand asset (no logo file yet):
  - Light: background oklch(0.97 0.015 75), cards oklch(0.93 0.025 80), text oklch(0.22 0.035 45), action oklch(0.58 0.14 55).
  - Dark: background oklch(0.15 0.02 45), cards oklch(0.20 0.025 45), text oklch(0.95 0.015 75), accent oklch(0.82 0.07 85).
- Type: Young Serif for caterer and dish names and titles; Jost with tabular figures for prices, numbers and UI.
- Look and feel follows [docs/design-strategy.md](docs/design-strategy.md), with CLAUDE.md's corrections.

## Evidence on Hand

- Working code in `client/` and `server/`: gate, engine and meal classification in `server/src/logic/`, tests in `server/test/` (including all 8 truth-table rows), system scenarios in `server/scripts/system-scenarios.js`, and demo data from `server/src/db/setup.js`.
- Demo accounts for staff (with and without a condition), caterer and admin (see README).
- No real caterer photos, logo or brand assets yet. Never invent ratings, reviews, caterer stories or nutrition values; demo data stays clearly marked as sample data.

## Product Principles

1. The report is the spec: behaviour matches Chapters 1–4 and does not drift without the user agreeing.
2. Guidance sits where the decision happens: every dish shows its Fit signal and the RDI numbers behind it.
3. Restrict only with a reason: balanced meals are always available, and locked meals stay visible with alternatives.
4. The server is the authority: totals, payment verification and gate values are computed server-side, never trusted from the client.
5. Ordering stays fast: the check-in is once a day and the premium feel never slows add-to-cart or checkout.

## Accessibility & Inclusion

The Fit signal and guidance bands never rely on colour alone and meet WCAG 2.2 AA contrast in both themes. Respect reduced-motion preferences. Health guidance carries the line "Guidance, not medical advice."
