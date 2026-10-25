-- ChopWise database schema (Chapter 3.4.6, Tables 3.2 to 3.7)

CREATE TYPE user_role AS ENUM ('staff', 'admin', 'caterer');
CREATE TYPE intake_level AS ENUM ('High', 'Critical');

-- password_hash holds an Argon2id hash; failed_attempts and locked_until drive account lockout.
CREATE TABLE users (
  user_id         SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  email           VARCHAR(150) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  role            user_role    NOT NULL,
  failed_attempts INT          NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until    TIMESTAMPTZ,
  -- Set when an admin gives a temporary password (new caterer or reset); cleared when the user changes it.
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  -- Part of every session cookie. Raising it signs out all of the user's sessions (password reset or change).
  session_version INT NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- A caterer's dish library (CLAUDE.md item 11). Meals carry RDI values and need admin approval.
-- Extras (such as yoghurt) also carry RDI values, need approval and count toward intake, but are not
-- meals: they are not in the check-in list and a cart still needs a meal. Add-ons (such as extra
-- bottled water) carry none, need no nutrition approval and never affect intake.
CREATE TYPE dish_type AS ENUM ('meal', 'extra', 'addon');

CREATE TABLE meals (
  meal_id         SERIAL PRIMARY KEY,
  caterer_id      INT          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  dish_type       dish_type    NOT NULL DEFAULT 'meal',
  name            VARCHAR(150) NOT NULL,
  description     VARCHAR(200),
  -- "<id>.webp" of the re-encoded photo in dish_photos; never the uploaded filename.
  photo           VARCHAR(64)  CHECK (photo ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'),
  -- Whole kobo (₦1 = 100 kobo).
  price_kobo      INT          NOT NULL CHECK (price_kobo BETWEEN 100 AND 10000000),
  carb_percent    NUMERIC(5,2) CHECK (carb_percent BETWEEN 0 AND 100),
  protein_percent NUMERIC(5,2) CHECK (protein_percent BETWEEN 0 AND 100),
  fat_percent     NUMERIC(5,2) CHECK (fat_percent BETWEEN 0 AND 100),
  vitamin_percent NUMERIC(5,2) CHECK (vitamin_percent BETWEEN 0 AND 100),
  mineral_percent NUMERIC(5,2) CHECK (mineral_percent BETWEEN 0 AND 100),
  dominant_class  VARCHAR(50),
  is_balanced     BOOLEAN,
  is_approved     BOOLEAN      NOT NULL DEFAULT FALSE,
  -- RDI values at the last approval, so the admin can see what changed before re-approving.
  approved_values JSONB,
  approved_at     TIMESTAMPTZ,
  approved_by     INT          REFERENCES users(user_id) ON DELETE SET NULL,
  -- Sold out for this Africa/Lagos date only; any earlier date means available again.
  sold_out_on     DATE,
  -- Plates left today (CLAUDE.md item 14). Counts only while stock_date is today's Lagos date,
  -- so stock resets at midnight. Reserved at checkout, returned if payment fails or expires.
  stock_date      DATE,
  plates_left     INT          CHECK (plates_left >= 0),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK (dish_type = 'addon' OR (carb_percent IS NOT NULL AND protein_percent IS NOT NULL AND fat_percent IS NOT NULL
    AND vitamin_percent IS NOT NULL AND mineral_percent IS NOT NULL AND dominant_class IS NOT NULL AND is_balanced IS NOT NULL)),
  CHECK (dish_type <> 'addon' OR (carb_percent IS NULL AND protein_percent IS NULL AND fat_percent IS NULL
    AND vitamin_percent IS NULL AND mineral_percent IS NULL AND dominant_class IS NULL AND is_balanced IS NULL
    AND approved_values IS NULL))
);

-- Timestamps are TIMESTAMPTZ (an absolute instant); "which day" is always worked out in
-- Africa/Lagos time, never from the server's timezone or CURRENT_DATE.
-- Orders (CLAUDE.md items 6, 7 and 13). Amounts are whole kobo, worked out by the server at
-- checkout and locked: later price or settings changes never alter an existing order.
CREATE TYPE order_status AS ENUM ('pending_payment', 'paid', 'preparing', 'out_for_delivery', 'delivered', 'cancelled');

CREATE TABLE orders (
  order_id           SERIAL       PRIMARY KEY,
  user_id            INT          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  caterer_id         INT          NOT NULL REFERENCES users(user_id),
  status             order_status NOT NULL DEFAULT 'pending_payment',
  order_date         DATE         NOT NULL,  -- Africa/Lagos date of checkout (the stock day)
  subtotal_kobo      INT          NOT NULL CHECK (subtotal_kobo > 0),
  vat_rate           NUMERIC(5,2) NOT NULL,
  vat_kobo           INT          NOT NULL CHECK (vat_kobo >= 0),
  delivery_fee_kobo  INT          NOT NULL CHECK (delivery_fee_kobo >= 0),
  total_kobo         INT          NOT NULL,
  paystack_reference VARCHAR(64)  NOT NULL UNIQUE,
  reserved_until     TIMESTAMPTZ  NOT NULL,
  paid_at            TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      VARCHAR(200),
  -- Delivery code: HMAC hash to check it, encrypted copy for the staff member only.
  code_hash          CHAR(64),
  code_encrypted     VARCHAR(120),
  code_attempts      INT          NOT NULL DEFAULT 0,
  code_locked        BOOLEAN      NOT NULL DEFAULT FALSE,
  status_updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ordered_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK (total_kobo = subtotal_kobo + vat_kobo + delivery_fee_kobo),
  CHECK (status = 'pending_payment' OR status = 'cancelled' OR (paid_at IS NOT NULL AND code_hash IS NOT NULL))
);

-- What was bought, as it was at checkout: name, unit price and RDI values per serving.
CREATE TABLE order_items (
  item_id         SERIAL       PRIMARY KEY,
  order_id        INT          NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  meal_id         INT          NOT NULL REFERENCES meals(meal_id),
  dish_type       dish_type    NOT NULL,
  name            VARCHAR(150) NOT NULL,
  unit_price_kobo INT          NOT NULL CHECK (unit_price_kobo > 0),
  quantity        INT          NOT NULL CHECK (quantity BETWEEN 1 AND 2),  -- at most 2 plates per dish per order
  line_total_kobo INT          NOT NULL,
  -- Bottled water bought with this meal line (one per plate, or none if removed), at the price then.
  water_quantity        INT    NOT NULL DEFAULT 0 CHECK (water_quantity >= 0),
  water_unit_price_kobo INT    NOT NULL DEFAULT 0 CHECK (water_unit_price_kobo >= 0),
  carb_percent    NUMERIC(5,2),
  protein_percent NUMERIC(5,2),
  fat_percent     NUMERIC(5,2),
  vitamin_percent NUMERIC(5,2),
  mineral_percent NUMERIC(5,2),
  CHECK (line_total_kobo = unit_price_kobo * quantity)
);

-- session_date is the Africa/Lagos date, set by the server (todayInLagos).
CREATE TABLE session_intake (
  session_id    SERIAL PRIMARY KEY,
  user_id       INT  NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_date  DATE NOT NULL,
  carb_total    NUMERIC(6,2) NOT NULL DEFAULT 0,
  protein_total NUMERIC(6,2) NOT NULL DEFAULT 0,
  fat_total     NUMERIC(6,2) NOT NULL DEFAULT 0,
  vitamin_total NUMERIC(6,2) NOT NULL DEFAULT 0,
  mineral_total NUMERIC(6,2) NOT NULL DEFAULT 0,
  UNIQUE (user_id, session_date)
);

-- Health onboarding answer (CLAUDE.md item 9). has_condition and answered_at stay NULL until
-- the staff member answers; staff routes are closed to them until then.
CREATE TABLE health_profiles (
  profile_id      SERIAL PRIMARY KEY,
  user_id         INT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  has_condition   BOOLEAN,
  conditions      TEXT[]       NOT NULL DEFAULT '{}',
  other_condition VARCHAR(100),
  is_controlled   BOOLEAN      NOT NULL DEFAULT FALSE, -- no longer asked: every declared condition gives H = 1
  answered_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  CHECK ((has_condition IS NULL) = (answered_at IS NULL))
);

-- Daily check-in (CLAUDE.md item 8): H, P1, P2 and G are computed once per Africa/Lagos day
-- and every catalogue and order request that day reads them from here.
CREATE TYPE meal_source AS ENUM ('history', 'manual');

CREATE TABLE daily_checkins (
  checkin_id    SERIAL PRIMARY KEY,
  user_id       INT         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  checkin_date  DATE        NOT NULL,
  prev1_meal_id INT         NOT NULL REFERENCES meals(meal_id),
  prev2_meal_id INT         REFERENCES meals(meal_id),
  source_prev1  meal_source NOT NULL,
  source_prev2  meal_source,
  h             SMALLINT    NOT NULL CHECK (h IN (0, 1)),
  p1            SMALLINT    NOT NULL CHECK (p1 IN (0, 1)),
  p2            SMALLINT    NOT NULL CHECK (p2 IN (0, 1)),
  g             SMALLINT    NOT NULL CHECK (g IN (0, 1)),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, checkin_date),
  CHECK ((prev2_meal_id IS NULL) = (source_prev2 IS NULL))
);

CREATE TABLE notifications (
  notification_id SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  food_class      VARCHAR(50)  NOT NULL,
  intake_level    intake_level NOT NULL,
  message         TEXT         NOT NULL,
  issued_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Single row of checkout settings, set by the admin (used by checkout in a later phase).
CREATE TABLE settings (
  setting_id   SMALLINT      PRIMARY KEY DEFAULT 1 CHECK (setting_id = 1),
  vat_rate     NUMERIC(5,2)  NOT NULL CHECK (vat_rate BETWEEN 0 AND 100),
  delivery_fee NUMERIC(12,2) NOT NULL CHECK (delivery_fee >= 0),
  -- Price of the bottle of water offered with each meal (CLAUDE.md item 6), in naira.
  water_price  NUMERIC(12,2) NOT NULL DEFAULT 300 CHECK (water_price BETWEEN 0 AND 100000),
  updated_by   INT           REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Admin actions and account lockouts. actor_id is NULL for actions the system takes itself.
CREATE TABLE audit_log (
  audit_id    BIGSERIAL    PRIMARY KEY,
  actor_id    INT          REFERENCES users(user_id) ON DELETE SET NULL,
  action      VARCHAR(50)  NOT NULL,
  target_type VARCHAR(30)  NOT NULL,
  target_id   INT,
  details     JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_user_time ON orders (user_id, ordered_at DESC);
CREATE INDEX idx_orders_caterer_date ON orders (caterer_id, order_date);
CREATE INDEX idx_orders_pending ON orders (reserved_until) WHERE status = 'pending_payment';
CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX idx_meals_approved ON meals (is_approved);
CREATE INDEX idx_meals_caterer ON meals (caterer_id);

-- Password reset links (CLAUDE.md item 18). Only the SHA-256 hash of the emailed token is stored.
-- A link works once and for 30 minutes; asking for a new one cancels the older ones.
CREATE TABLE password_resets (
  reset_id    SERIAL       PRIMARY KEY,
  user_id     INT          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash  CHAR(64)     NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX password_resets_user ON password_resets (user_id);

-- Staff feedback (CLAUDE.md item 17): one response per staff member. Comments are read by admins only.
CREATE TYPE feedback_answer AS ENUM ('yes', 'no', 'sometimes');
CREATE TABLE feedback (
  feedback_id     SERIAL          PRIMARY KEY,
  user_id         INT             NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  ordering_score  SMALLINT        NOT NULL CHECK (ordering_score BETWEEN 1 AND 5),
  guidance_score  SMALLINT        NOT NULL CHECK (guidance_score BETWEEN 1 AND 5),
  changed_order   feedback_answer NOT NULL,
  comment         VARCHAR(500),
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- How often the feedback pop-up has been shown, and at which delivered-order count it was last shown.
CREATE TABLE feedback_prompts (
  user_id             INT          PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  times_shown         INT          NOT NULL CHECK (times_shown BETWEEN 1 AND 3),
  shown_at_delivered  INT          NOT NULL CHECK (shown_at_delivered >= 0),
  last_shown_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Dish photos (CLAUDE.md item 11): the re-encoded WebP bytes, stored in the database because the
-- host's disk is wiped on every restart. meals.photo holds "<photo_id>.webp".
CREATE TABLE dish_photos (
  photo_id      UUID         PRIMARY KEY,
  content_type  VARCHAR(30)  NOT NULL CHECK (content_type = 'image/webp'),
  bytes         BYTEA        NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 3145728),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
