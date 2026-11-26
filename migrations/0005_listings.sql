-- Sell a tool: someone else's HTTPS API, sold per call through Siro. The buyer's payment goes
-- straight to the seller's pay_to address on-chain; Siro verifies it, runs the seller's API and
-- settles only when the API returned a result. Siro never holds the money.
CREATE TABLE IF NOT EXISTS listings (
  id         TEXT PRIMARY KEY,              -- slug, served at /v1/s/<id>
  name       TEXT NOT NULL,
  summary    TEXT NOT NULL,
  category   TEXT NOT NULL,
  price      TEXT NOT NULL,                 -- USD decimal string, like the catalog
  endpoint   TEXT NOT NULL,                 -- seller's https URL, never shown publicly
  host       TEXT NOT NULL,
  pay_to     TEXT NOT NULL,                 -- seller's EVM address (checksummed)
  fields     TEXT NOT NULL,                 -- JSON array of catalog-style input fields
  returns    TEXT NOT NULL,
  secret     TEXT NOT NULL,                 -- sent to the seller as x-siro-secret; also the owner key
  status     TEXT NOT NULL DEFAULT 'live',  -- live | paused | removed
  fails      INTEGER NOT NULL DEFAULT 0,    -- consecutive failed runs; 5 pauses the listing
  created_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS listings_status ON listings (status, created_at);
