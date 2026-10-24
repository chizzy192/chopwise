# ChopWise

A diet control food delivery system for staff members on a university campus (UNN). Once a day, at a check-in before the first order, a **3-input majority gate** checks the user's health status (H) and their last two meals (P1, P2). The gate output sets how strongly a **rule-based decision engine** guides meal choices: soft guidance (recommendations and warnings) when G = 0, full guidance (recommendations, warnings and restrictions) when G = 1. The engine uses the user's daily intake as a percentage of the Recommended Daily Intake (RDI).

| Intake (% of RDI) | Band | Action when G = 1 |
|---|---|---|
| 0–40% | Low | No action |
| >40–70% | Moderate | Recommend meals from under-eaten food classes |
| >70–90% | High | Warning notification |
| >90% | Critical | Non-balanced meals dominated by that food class stay visible but locked ("Restricted today"), with alternative dishes suggested |

Balanced meals (every food class between 5% and 35% of RDI) are always shown and never restricted.

## Stack

- **Frontend:** React (Vite), React Router, Recharts
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL

## Running it locally

You need Node.js 18 or later and PostgreSQL.

1. Create a database:
   ```
   createdb chopwise
   ```
2. Set up the server:
   ```
   cd server
   cp .env.example .env      # then fill in the values (see below)
   npm install
   npm run db:setup          # creates tables, the first admin and demo data
   npm test                  # logic and security tests (no database needed)
   npm run dev               # API on http://localhost:4000
   ```
   In `.env`, set `DATABASE_URL`, a random `JWT_SECRET` of at least 32 characters, `CLIENT_ORIGIN`
   (the address the app is opened at), and the first admin's `ADMIN_EMAIL` and `ADMIN_PASSWORD`
   (at least 10 characters, not the demo password). `db:setup` refuses to run without them.
3. In a second terminal, start the frontend:
   ```
   cd client
   npm install
   npm run dev               # app on http://localhost:5173
   ```

### Demo accounts

`npm run db:setup` prints every sample account's email and password when it finishes. The admin and
the sample caterer come from `server/.env` (`ADMIN_EMAIL`/`ADMIN_PASSWORD` and
`CATERER_EMAIL`/`CATERER_PASSWORD`); their passwords are not written here, because `.env` is never
committed. All sample passwords have at least 10 characters.

| Role | Email | Password | Notes |
|---|---|---|---|
| Staff | staff@chopwise.ng | `password123` | Declared hypertension, so H = 1. Has 2 delivered orders and no feedback yet, so the feedback pop-up appears |
| Staff | staff2@chopwise.ng | `password123` | No declared condition, so H = 0. Has given the sample feedback shown on the admin report |
| Caterer | `CATERER_EMAIL` (caterer@chopwise.ng in `.env.example`) | `CATERER_PASSWORD` in `server/.env` | Manages the sample dish library (19 meals, 1 extra, 1 add-on): uploads photos on My dishes and photos, sets plates on Today's stock |
| Admin | `ADMIN_EMAIL` from `.env` | `ADMIN_PASSWORD` in `server/.env` | Full control: approves and unapproves meals and their RDI values, grants or removes caterer and admin access, creates caterer accounts and resets caterer passwords (temporary passwords must be changed at the next login), sets VAT and the delivery fee, views reports and the audit log |

The new sample dishes (Moi moi, Okpa, Achicha, Ayaraya oka, Ayaraya ji and Yoghurt) have RDI values
estimated from published composition data, and placeholder prices; confirm both with the caterer.

There is no role picker at login; each account opens its own dashboard. Five wrong passwords lock an
account for 15 minutes (an admin can unlock it on the Users page).

### System test scenarios

After `npm run db:setup`, run `npm run test:system` in `server/`. The script starts its own copy of the
API on a free port and a local mock of Paystack, so it never calls the real Paystack API and doesn't
need (or affect) the dev server. Run `db:setup` again before each run, because the scenarios change
the demo data.

### Front-end checks (in `client/`)

| Command | What it checks |
|---|---|
| `npm run test:ui` | Playwright smoke tests in your installed Microsoft Edge: every page for every role loads, its main controls can really be clicked (hit-tested), touch targets are at least 44 × 44 px, and at 320, 390 and 1440 px in both themes nothing scrolls sideways and every control on screen can be hit. The browser must log no errors. Also runnable from `server/` as `npm run test:ui`. It starts its own API (port 4100, a separate `<database>_ui_test` database, mock Paystack) and Vite (port 5180), so your dev servers and data are untouched. |
| `npm run screenshots` | Saves every screen at 1440 px (light theme, sample data) to `docs/screenshots/`, numbered in reading order, plus 390 px versions of the landing, login and order pages. |
| `npm run test:contrast` | WCAG contrast for every colour token pair, light and dark. |
| `npm run lint` | ESLint with the jsx-a11y accessibility rules. |

### Payments (Paystack test mode)

Put your Paystack **test** keys in `server/.env` as `PAYSTACK_SECRET_KEY` (`sk_test_…`) and
`PAYSTACK_PUBLIC_KEY`, and a random 64-hex-character `DELIVERY_CODE_KEY`. The server refuses live
keys. Checkout sends the staff member to Paystack's own checkout page; Paystack sends them back to
`CLIENT_ORIGIN/payment/return`, and the server confirms the payment with Paystack before marking the
order paid. Paystack's webhook (`POST /api/paystack/webhook`) needs a public address, so locally the
verify step does the confirming. Paystack's test cards are listed in their documentation.

Plates left are set per dish for today on the caterer's Today's stock page (or on My dishes);
`db:setup` gives every sample dish 20 plates (50 for add-ons) for the day it runs.

### Email (password reset)

"Forgot password?" on the login page emails a single-use link that works for 30 minutes. Set
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in `server/.env` to send real
email. Without `SMTP_HOST` (development) nothing is sent: the server prints the reset link to its
console, so copy it from the terminal running `npm run dev`.

## Project structure

```
server/
  src/logic/      gate.js (majority gate), engine.js (decision engine), meal.js (classification)
  src/services/   diet.js connects the database to the gate and engine
  src/db/         schema.sql, demo data setup
  src/routes.js   REST API
  test/           unit tests, including all 8 rows of the truth table
client/
  src/pages/      staff, caterer and admin screens
  src/components.jsx  intake meter and gate display
```

## How P1 and P2 are worked out

Once a day, before the first order, the staff member does a check-in: they confirm their last two meals, which are pre-filled from their two most recent orders and can be changed (including "I ate something not on ChopWise" with the closest match). The older meal (P2) is added to an empty intake first, then the most recent meal (P1) is added on top. Each input is 1 if any food class is above 70% of RDI at that point, and 0 otherwise.

H comes from the health onboarding question every staff member answers after signing up: it is 1 for any declared diet-related condition. H, P1, P2 and G are computed once at the check-in, stored in `daily_checkins`, and used for every catalogue and order request that day. Days, intake and check-ins reset at midnight Africa/Lagos time.

## Production build

```
cd client && npm run build
cd ../server && npm start   # serves the API and the built app on port 4000
```
