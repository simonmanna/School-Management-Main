-- Wave 14: a fresh production database could not create its first school —
-- Organization.currencyCode references Currency, and no migration seeded any.
-- Found by re-running the 2026-09-27 audit's HTTP probe on an empty database.
-- Reference data for the East African launch plus common settlement
-- currencies. Idempotent; existing rows are untouched.
INSERT INTO "Currency" ("id", "code", "symbol", "name", "decimalPlaces", "isActive", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, 'UGX', 'USh', 'Ugandan Shilling', 0, true, now(), now()),
  (gen_random_uuid()::text, 'KES', 'KSh', 'Kenyan Shilling', 2, true, now(), now()),
  (gen_random_uuid()::text, 'TZS', 'TSh', 'Tanzanian Shilling', 2, true, now(), now()),
  (gen_random_uuid()::text, 'RWF', 'FRw', 'Rwandan Franc', 0, true, now(), now()),
  (gen_random_uuid()::text, 'USD', '$', 'US Dollar', 2, true, now(), now()),
  (gen_random_uuid()::text, 'EUR', '€', 'Euro', 2, true, now(), now()),
  (gen_random_uuid()::text, 'GBP', '£', 'Pound Sterling', 2, true, now(), now())
ON CONFLICT ("code") DO NOTHING;
