# ChopWise: project brief for Claude Code

ChopWise is a final-year BSc Computer Science project (University of Nigeria, Nsukka). It is a web-based **diet control food delivery system** for staff members on campus. A **3-input majority gate** decides how strictly a **rule-based decision engine** guides each staff member's meal choices, based on their daily intake as a percentage of the Recommended Daily Intake (RDI).

The written report (Chapters 1–4) describes this system, so the behaviour below must not drift without the user agreeing. When something here is unclear, ask before guessing.

## Stack (keep it)

- **Client:** React 18 + Vite, React Router, Recharts (`client/`)
- **Server:** Node.js + Express (`server/`), ES modules
- **Database:** PostgreSQL (`server/src/db/schema.sql`), plain SQL with parameterised queries
- **Tests:** Node built-in test runner (`npm test` in `server/`); system scenarios in `server/scripts/system-scenarios.js`

## Core logic (already built, keep behaviour)

`server/src/logic/` holds the pure logic. Keep it free of database code so it stays unit-testable.

- **Food classes:** carb, protein, fat, vitamin, mineral. Meal values are % of daily RDI per serving.
- **Dish types:** meals, extras and add-ons. Add-ons with no RDI values (water) never affect intake; extras with RDI values (yoghurt) count toward intake.
- **Majority gate:** `G = H·P1 + H·P2 + P1·P2`. Inputs are 0/1:
  - **H:** 1 if the user declared a diet-related condition. (There is no "well controlled through diet" option; it was removed at the user's request.)
  - **P1, P2:** 1 if, after that meal, any food class is above 70% of RDI. The older meal is applied first, then the recent one on top.
- **Bands per food class:** Low 0–40%, Moderate >40–70%, High >70–90%, Critical >90%. Upper bounds are inclusive.
- **Warnings:** above 70% (High), above 90% (Critical), and a third once a class passes **100% of the daily limit** (level `Over`, added at the user's request): "Carbohydrates intake is at 124% of your daily limit: you've gone past your full daily limit for today." The 100% warning shows under both guidance levels, in the cart (for the projected intake) and as a saved notification; exactly 100% is not past it. It doesn't change the bands or the lock, which stays at 90% under G = 1.
- **Balanced meal:** every class between 5% and 35%. Balanced meals are **always exempt** from restriction and listed first.
- **Dominant class:** the class with the highest % in a meal.

## Agreed changes to build

1. **Guidance strength depends on G**
   - **G = 0 (soft):** recommendations and warnings only. Nothing is locked.
   - **G = 1 (full):** recommendations, warnings and restrictions.
2. **Moderate:** recommend meals from under-eaten classes (classes still in Low).
3. **High:** show a warning, and recommend only meals that keep every High class at or under 90%. The remaining allowance is `90 − current intake`.
4. **Critical (G = 1):** non-balanced meals whose dominant class is Critical stay **visible but locked** ("Restricted today"), with alternative dishes suggested. Under G = 0, show a strong warning instead.
   - **Projected-intake lock (G = 1):** restriction is judged on projected intake. On the menu, a non-balanced dish is Restricted today if one serving would take its dominant class above 90% of RDI. At checkout, a non-balanced line is Restricted today if its dominant class would end above 90% after **all** cart lines are added, and checkout is blocked with a message that names the line and suggests the quantity that would fit, or alternatives. Exactly 90% still fits. Balanced meals stay exempt. Under G = 0 the same cart gets a strong warning only.
   - **Never addable:** a Restricted today dish's Add button is disabled and replaced by "Not today" (the on-screen name for Restricted today, item 16), with the reason and the alternatives, on the menu and the dish page. The alternatives list only offers dishes that can be added.
   - **Server refusal:** the server returns 409 for a Restricted today line at cart evaluation (the body still carries the whole evaluation, so the cart can show the line), at checkout and at any add endpoint. It never trusts the client.
   - **Restricted inside the cart:** if a line becomes Restricted today because of another line, the cart marks it ("Not today: reduce or remove"), its counter can only go down, and checkout stays blocked until it is reduced or removed.
   - **Alternatives:** drawn from balanced meals and from unlocked, available meals whose dominant class is not Critical, sorted by how little they add to the locked meal's class (lowest first), up to 3, each shown with its contribution (e.g. "Adds 6% carbohydrates").
5. **Delivery-app ordering:**
   - Dish cards with photo, name, price and RDI values.
   - Quantity selector and a cart. Quantity multiplies RDI values.
   - **At most 2 plates of one dish per order**, enforced by the server; the counter stops at 2 with a short note. This applies to extras and add-ons too.
   - **The whole cart is evaluated before checkout**, using projected intake.
6. **Checkout breakdown:** meals + extras + add-ons + VAT + flat delivery fee.
   - **Bottled water with meals (changed at the user's request; it used to be free):** every meal line comes with one bottle of water per plate, charged at the standard price the admin sets on Settings (`settings.water_price`, starting at ₦300). It is on by default and staff can remove it for any meal line with a switch in the cart (`water: false` on that cart line). It shows under the meal line on the cart, checkout and receipt ("2 × Bottled water ₦600.00"), counts in the subtotal and VAT, and is snapshotted on the order (`order_items.water_quantity`, `water_unit_price_kobo`). It carries no RDI values and is not stock-tracked. Extras and add-ons don't come with water. Orders from before the change show their free water at ₦0.
   - **Extras** (e.g. yoghurt) carry RDI values: they need admin approval, get a Fit signal, count toward intake and the cart evaluation, and follow the 2-per-order limit. They are not meals: they are not in the check-in list, never come with bottled water, and a cart still needs at least one meal. An extra is only Restricted today when its own dominant class would go above 90% (a balanced extra never is).
   - **Add-ons** (e.g. extra bottled water) carry no RDI values, need no approval and never affect intake.
   - VAT rate, delivery fee and the bottled water price are admin settings, not hard-coded.
   - The server calculates the total and locks it on the order, with item prices snapshotted.
7. **Payment:** online only, through **Paystack in test mode**. No pay on delivery.
   - Confirm an order only after the **server verifies** the payment (verify endpoint or webhook with signature check). Never trust the client.
   - Each order gets a **4-digit delivery code**. The caterer enters it to mark the order delivered.
8. **Daily check-in:** once per day, before the first order, staff confirm their last two meals.
   - Pre-fill from order history; the user can change it if they ate elsewhere.
   - Compute H, P1, P2 and G **once a day** and store them in a `daily_checkins` table.
   - Intake and the check-in reset at **midnight, Africa/Lagos time**.
9. **Health onboarding:** after sign-up and first login, a **required** yes/no question about diet-related conditions (diabetes, hypertension, heart disease, etc.). "Yes" needs at least one condition (from the list or "Other") and gives H = 1. There is no "well controlled through diet" option. It can be edited later.
10. **Roles:** staff, caterer, admin. There is no separate super admin; the admin has full control.
    - Login has **no role picker**; the account's role decides the dashboard.
    - Staff self-register (with a confirmed password, item 19). The first admin and the sample caterer are seeded from environment variables at setup (`ADMIN_EMAIL`/`ADMIN_PASSWORD`, `CATERER_EMAIL`/`CATERER_PASSWORD`). `npm run db:setup` prints every sample account's email and password at the end; README.md lists them under "Demo accounts". Sample passwords meet the 10-character rule.
    - The admin can create a caterer account with a temporary password and reset any caterer's password (only caterers). A temporary password must be changed at the next login: until then the server refuses every route except "who am I" and "change password" (`PASSWORD_CHANGE_REQUIRED`). Creating, resetting and changing are audit-logged; passwords never are.
    - Only an admin grants or removes caterer and admin access.
    - The admin approves meals, views reports, sets VAT and the delivery fee, and views the audit log.
11. **Caterer meal library:**
    - A dish is saved once (name, photo, price, RDI values) and toggled **Available / Sold out** daily.
    - Sold-out dishes show "Sold out" and can't be added to the cart.
    - Caterer navigation: Today's orders, My dishes and photos (each dish row has its own photo upload), Today's stock (plates left for every dish).
    - Editing RDI values sends the dish back for approval; editing price or photo doesn't.
12. **Landing page** at `/`: a standalone page for logged-out visitors, with no app navigation. Its Log in and Create account buttons go to `/login` and `/register`. After login each role goes to its own home (staff `/order`, caterer `/caterer`, admin `/admin/meals`); a logged-in user who opens `/` goes straight to their home. It covers:
    - what ChopWise is
    - how a day works (check in → guidance level → order → pay)
    - an interactive demo: "Answer three quick questions and see how ChopWise would guide your lunch."
    - what ChopWise does as the day fills up, for gentle and firm guidance
    - what each role does
    - an example receipt
    - log in and sign-up links
    - (No "How it works in detail" section: it was removed at the user's request. The technical account lives in the written report.)
    - It is written for someone with no technical or nutrition background (see **Plain language** below).
13. **Order status for caterers:** paid → preparing → out for delivery → delivered (by code).
14. **Plates left:**
    - Caterers set a daily stock (plates_left) per dish for today (Africa/Lagos, `todayInLagos()`). Add-ons can also have stock.
    - A dish with no stock set for today is not orderable ("Not available today").
    - Staff see "Only N left" when N ≤ 5. The cart quantity can't exceed plates left.
    - Stock is reserved when payment starts, using an atomic `UPDATE ... SET plates_left = plates_left - qty WHERE plates_left >= qty` inside a transaction. If any line can't be reserved, nothing is reserved and checkout returns 409 naming the dish.
    - Reservations expire after 15 minutes if payment isn't verified, and the plates go back to stock. The expiry check runs on a timer and before each stock read.
    - At 0 plates the dish shows "Sold out". The manual Sold out switch still works.
    - Stock resets at midnight Lagos time; the caterer sets new numbers each day.
15. **Order decisions (agreed):**
    - One caterer per cart: adding a dish from another caterer starts a new cart, and checkout refuses mixed carts.
    - The delivery code is checked against an HMAC hash. An AES-256-GCM encrypted copy lets only the staff member who ordered see it until delivery. Caterers and admins never see it.
16. **Plain language (landing page and staff pages):**
    - "health check" (not H), "your last two meals" / "was your last meal heavy?" and "was the meal before that heavy?" (not P1/P2), "gentle guidance" / "firm guidance" (not G = 0/1), "your daily limit" (not RDI), "the 90% cut-off" for the restriction threshold.
    - **Fit states on screen:** Balanced; "Good for you right now" (Recommended); "Careful" (Caution); "Not today" (Restricted today). Each keeps its own shape, word and colour; the badge tooltip shows the technical name ("Technical name: Restricted today"). "Not today" is a dashed, square-cornered lock that never looks like the filled Add button.
    - Staff pages show the technical term in a small tooltip where helpful (`Term` in `components.jsx`: hover or keyboard focus). Server messages shown to staff use the same words.
    - The server keeps its internal names (`Recommended`, `g`, `h`, `p1`, `p2`); only the words on screen change. Caterer and admin pages may keep "RDI".
17. **Feedback pop-up (staff):**
    - Shown after a staff member's 2nd delivered order (all time), the next time they open the app.
    - Questions: How easy was ordering? (1–5); How helpful was the meal guidance? (1–5); Did the guidance change what you ordered? (Yes / No / Sometimes); What should we improve? (optional, max 500 characters).
    - Showing it is recorded at once (`feedback_prompts`), so "Not now" (or closing it) postpones it until another order is delivered. It is shown at most 3 times in total, and never again once submitted.
    - Answers are stored in `feedback` (user_id, ordering_score, guidance_score, changed_order, comment, created_at), one response per staff member. Comments are visible only to admins (on the admin report, without names) and never shown publicly.
    - The admin report shows the number of responses, the average scores, the Yes / No / Sometimes split and the latest comments.
18. **Forgot password:**
    - "Forgot password?" on the login page → email → always the same message: "If an account exists for that email, we've sent a reset link." It never reveals whether an account exists.
    - A random single-use token (`crypto.randomBytes(32)`) is emailed as `/reset-password?token=…`. Only its SHA-256 hash is stored (`password_resets`), with a 30-minute expiry. Asking again cancels older links.
    - Email goes through SMTP settings in `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`) with nodemailer. Without `SMTP_HOST` (development) the link is printed to the server console instead.
    - The reset page asks for the new password twice (10-character rule). On success the token is used up, all of the user's sessions are signed out, any lockout is cleared, any temporary-password flag is cleared, and `password.reset_by_email` is audit-logged.
    - Rate limits: 5 forgot-password requests per hour per IP and 3 per hour per email address.
    - Sessions carry a version (`users.session_version`, checked on every request). A reset by email, a password change and an admin's reset of a caterer's password all raise it, signing out every other session; a password change gives the current session a new cookie.
19. **Confirm password:** sign-up, reset and change-password pages have a confirm field. "Passwords don't match" appears under it as soon as the two differ, and the submit button is disabled. The server checks the match too (Zod) on sign-up and reset.

## Security requirements

- Argon2id password hashing (replace bcrypt).
- Sessions in **httpOnly, Secure, SameSite** cookies. No tokens in localStorage.
- Rate-limit login and lock the account temporarily after repeated failures. Rate-limit forgot-password requests (item 18).
- Password reset tokens are single-use, expire after 30 minutes and are stored only as SHA-256 hashes; a reset signs out every session.
- Helmet security headers; strict CORS.
- Validate every request body with Zod.
- Role checks on **every** server route.
- Image uploads: allow only JPEG, PNG and WebP (checked from the contents), at most 2 MB (the caterer's browser shrinks bigger phone photos to at most 1600 px JPEG before upload; the server limit stays), re-encoded to WebP with sharp, stored with generated names. Photos are stored in PostgreSQL (`dish_photos`), not on disk, because the host wipes its disk on restart; they are served at `/uploads/dishes/<id>.webp` with nosniff and a one-year cache.
- Audit log of admin actions.
- Secrets only in `.env`. Never commit them.

## Deployment

- One Render web service (free plan) and a Neon PostgreSQL database; see `docs/DEPLOY.md` and `render.yaml`. The root `npm run build` builds the client and installs the server; `npm start` runs Express, which serves `client/dist` and falls back to `index.html` for app routes. `GET /api/health` is the health check.
- In production Express trusts one proxy hop (`trust proxy = 1`), cookies are Secure and SameSite=Lax, and `CLIENT_ORIGIN` is the site's own address.
- Database scripts: `db:migrate` creates or updates tables and never deletes data; `db:seed` adds the sample data; `db:setup` wipes and rebuilds, and refuses when `NODE_ENV=production` or the database isn't local, unless `--force`. Neon needs `sslmode=require` (kept as full certificate checks).
- A sleeping free service stops timers, so reservation expiry also runs before every stock read and checkout.

## Visual design

Follow `docs/design-strategy.md` for the look and feel (earth-tone OKLCH palette, light and dark themes, editorial Home, uniform rows for ordering, motion tokens, add-to-cart morph, cart sheet, code checklist). Its design decisions stand, with these product corrections:

- **Stack:** React + Vite with plain CSS custom properties in one `tokens.css`. Not Next.js. Self-host fonts with `@fontsource`; use `<img>` with `aspect-ratio` and `loading="lazy"` in place of `next/image`.
- **Display serif:** Young Serif (free). Sans: Jost with tabular figures.
- **Sheet curve:** accepted as proposed (drawer curve for the sheet, spring for badge and counter).
- **"Featured chefs"** means the campus caterers. Never invent ratings, reviews or chef stories.
- **Fit signal = the ChopWise decision engine**, not per-condition nutrient limits. Map it like this (shape + word, never colour alone):
  - **Balanced** (always available): balanced meals
  - **Recommended** (shown as "Good for you right now", item 16): fills an under-eaten class, or fits within the remaining allowance at High
  - **Caution** (shown as "Careful"): would push a class to High or Critical (G = 0 shows a warning only)
  - **Restricted today** (shown as "Not today"): G = 1, non-balanced meal whose dominant class is Critical. Locked, with alternatives shown
- Fit is shown to **every** staff member, because every order affects intake. The "why" popover cites the numbers as % of the daily limit, e.g. "Adds 48% carbohydrates. You're at 75% today; the cut-off is 90%." Add the line "Guidance, not medical advice."
- **Layouts:** the staff menu and caterer My dishes are card grids at every width (one column on phones, with photos filling the card); My orders, the caterer order board and admin Meal approval are single columns on phones and grids from 1024 px. On phones and small tablets (≤ 860 px) the app bar shows only the logo, the cart and a Menu button that opens the page links, name, theme switch and Log out. Grids use `repeat(auto-fill, minmax(var(--card-min), 1fr))`. See design-strategy §3, "Where editorial stops".
- **Design system details:** fonts have size-adjusted local fallbacks (no layout shift); tappable cards press to 0.96 and buttons to 0.97 (`--press-card`, `--press-button`), both 1 under reduced motion; every screen is checked at 320, 390 and 1440 px in both themes (`npm run test:ui`).
- **Currency:** ₦ via `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })`.

`PRODUCT.md` must agree with this file. Where they differ, this file wins.

## Working rules

- Build in phases and keep `npm test` passing after each phase. Add tests for every new rule.
- Whenever the schema changes, update `server/src/db/schema.sql`, add an additive step to `server/src/db/migrate.js`, and update the sample data in `server/src/db/seed.js`.
- Use plain, clear UI copy in sentence case.
- After each phase, summarise what changed so the report (Chapters 3–4) can be updated.
