# Deploying ChopWise (Render + Neon)

ChopWise runs as **one Render web service** (free plan) with a **Neon PostgreSQL** database. Express
serves the API under `/api`, dish photos under `/uploads/dishes/…` (stored in the database) and the
built React client for every other path. The repository's `render.yaml` describes the service.

```
Browser ──HTTPS──▶ Render web service (Node 22)
                     ├─ /api/*            Express API
                     ├─ /uploads/dishes/* dish photos (bytes stored in PostgreSQL)
                     └─ everything else   client/dist (index.html for app routes)
                              │
                              └──TLS──▶ Neon PostgreSQL (sslmode=require)
```

Why photos are in the database: Render's free plan wipes the service's disk on every restart and
deploy, so files saved under `server/uploads` would vanish.

---

## 1. Environment variables

Set these on the Render service (Dashboard → your service → **Environment**). **Secret** means:
never commit it, never paste it into chats or screenshots, and change it if it leaks.

| Variable | Secret? | Value |
|---|---|---|
| `NODE_ENV` | no | `production` (set by `render.yaml`). Turns on Secure cookies, HTTPS upgrades and the proxy settings. |
| `NODE_VERSION` | no | `22` (set by `render.yaml`). |
| `CLIENT_ORIGIN` | no | The site's own address, e.g. `https://chopwise.onrender.com`. No trailing slash. Cookies, CORS, the Origin check and Paystack's return link all use it. On Render you may leave it out: the server then uses `RENDER_EXTERNAL_URL`, which Render sets for every web service. Set it if you add a custom domain. |
| `DATABASE_URL` | **yes** | Neon's connection string, ending in `?sslmode=require` (see §2). It contains the database password. |
| `JWT_SECRET` | **yes** | Random, at least 32 characters. `render.yaml` asks Render to generate it. Changing it signs everyone out. |
| `DELIVERY_CODE_KEY` | **yes** | 64 hex characters. Generate once with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Never change it after launch**: orders' delivery codes are encrypted with it. |
| `PAYSTACK_SECRET_KEY` | **yes** | Your Paystack **test** secret key (`sk_test_…`). The server refuses live keys. |
| `PAYSTACK_PUBLIC_KEY` | no | Your Paystack test public key (`pk_test_…`). |
| `ADMIN_EMAIL` | no | The first admin's email. `npm run db:migrate` creates this account if it doesn't exist. |
| `ADMIN_PASSWORD` | **yes** | The first admin's password (at least 10 characters). Only used when the account is created. |
| `ADMIN_NAME` | no | Optional display name for the first admin (default "System Administrator"). |
| `CATERER_EMAIL` | no | Only needed for `npm run db:seed` (the sample caterer). |
| `CATERER_PASSWORD` | **yes** | The sample caterer's password (at least 10 characters). Only for `db:seed`. |
| `SMTP_HOST` | no | Your mail provider's SMTP server, for password reset emails. Leave empty and reset links are only printed in Render's logs. |
| `SMTP_PORT` | no | `587` (STARTTLS) or `465` (TLS). |
| `SMTP_USER` | no | SMTP user name. |
| `SMTP_PASS` | **yes** | SMTP password or app password. |
| `MAIL_FROM` | no | Sender, e.g. `ChopWise <no-reply@your-domain>`. |

Don't set `PORT` (Render sets it) or `PAYSTACK_API_URL` (tests only).

---

## 2. Neon (database)

1. Sign in at [neon.tech](https://neon.tech) and create a project. Pick the region closest to the
   Render region in `render.yaml` (Frankfurt → **AWS Europe Central 1**).
2. Keep the default database (`neondb`) or create one called `chopwise`.
3. Open **Connect**, choose your database and role, and copy the connection string. It looks like
   `postgresql://<role>:<password>@<endpoint>.neon.tech/neondb?sslmode=require&channel_binding=require`.
   This is your `DATABASE_URL`. ChopWise keeps full certificate checks on (it treats
   `sslmode=require` as `verify-full`), which Neon supports.

---

## 3. Create the tables and the first admin (from your laptop)

Run these once before the first deploy, and again after any update that changes the database.
They talk to Neon directly from your computer.

In `server/.env` (never committed), set `DATABASE_URL` to the Neon connection string, plus
`ADMIN_EMAIL` and `ADMIN_PASSWORD` (and `CATERER_EMAIL` / `CATERER_PASSWORD` if you'll seed). Then:

```bash
cd server
npm run db:migrate      # creates or updates the tables, the settings row and the first admin; never deletes data
npm run db:seed         # optional: sample caterer, demo staff, dishes and order history (adds nothing if already there)
```

`db:seed` prints every sample account's email and password at the end. Skip it for a site with
only real users.

Alternatively, without editing `.env` (PowerShell):

```powershell
cd server
$env:DATABASE_URL = "postgresql://…neon.tech/neondb?sslmode=require"
npm run db:migrate
Remove-Item Env:DATABASE_URL
```

**Never run `npm run db:setup` against Neon.** It deletes every table first. It refuses when
`NODE_ENV=production` or when `DATABASE_URL` isn't a database on your own computer, unless you add
`-- --force`. Don't.

Upgrading a database made by an older ChopWise: `db:migrate` also copies any dish photos still in
`server/uploads/dishes` into the database.

---

## 4. Render (web service)

1. Push the repository to GitHub (`main` branch).
2. In the [Render dashboard](https://dashboard.render.com): **New → Blueprint**, connect your GitHub
   account and pick the `chopwise` repository. Render reads `render.yaml` and proposes one web
   service, **chopwise** (free plan, Node).
3. Fill in every variable marked "sync: false" (see §1). `JWT_SECRET` is generated for you. For
   `CLIENT_ORIGIN`, use `https://chopwise.onrender.com`, or whatever name Render gives the service
   (shown at the top of the service page). If the name differs, update `CLIENT_ORIGIN` after the
   first deploy and redeploy.
4. Click **Apply**. Render runs:
   - **Build:** `npm run build` (installs and builds the client with Vite, then installs the server)
   - **Start:** `npm start` (starts Express, which serves the API and `client/dist`)
   - **Health check:** `GET /api/health` must answer 200
5. When the deploy is live, open the site, log in as the admin from §3, and check: the landing
   page, log in, Users, Settings (set the VAT rate and delivery fee), and a caterer adding a dish
   with a photo.

Setting it up by hand instead of the Blueprint: **New → Web Service**, Runtime **Node**, Build
Command `npm run build`, Start Command `npm start`, Health Check Path `/api/health`, Instance type
**Free**, then add the environment variables from §1.

**Free plan behaviour.** The service sleeps after 15 minutes without visitors; the next visit takes
about a minute to wake it. Timers stop while it sleeps, so ChopWise also returns expired plate
reservations (unpaid after 15 minutes) before every stock read and checkout. Neon's free compute
also suspends when idle and wakes on the first query.

Each push to `main` deploys again automatically. If the update changes the database, run
`npm run db:migrate` against Neon (§3) first.

---

## 5. Paystack webhook (test mode)

The server confirms every payment with Paystack itself (the "verify" step when the customer returns
to `/payment/return`). The webhook is the backup for customers who close the tab before returning.

1. In the [Paystack dashboard](https://dashboard.paystack.com), stay in **Test mode**.
2. **Settings → API Keys & Webhooks.**
3. **Test Webhook URL:** `https://chopwise.onrender.com/api/paystack/webhook` (your `CLIENT_ORIGIN`
   + `/api/paystack/webhook`).
4. Save. Copy the **Test Secret Key** and **Test Public Key** into Render as
   `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` if you haven't already.

The webhook is accepted only with a valid `x-paystack-signature` (HMAC SHA512 of the body with your
secret key). The callback URL needs no dashboard setting: each payment sends customers back to
`CLIENT_ORIGIN/payment/return`.

---

## 6. Production settings already in the code

- **Proxy:** Express trusts exactly one proxy hop in production (`trust proxy = 1`), so rate limits
  see real visitor addresses and Secure cookies work behind Render's HTTPS proxy.
- **Cookies:** the session cookie is httpOnly, Secure and SameSite=Lax in production.
- **Security headers:** Helmet's CSP allows only the site itself, Paystack's script, API and checkout
  frame, and Google Fonts (the app's own fonts are self-hosted). HSTS is on, and HTTP requests are
  upgraded to HTTPS.
- **Health check:** `GET /api/health` returns `{"status":"ok"}`.
