-- Third-party x402 services seen through discovery. The relay only forwards to URLs listed
-- here, so it cannot be used as an open proxy.
CREATE TABLE IF NOT EXISTS x402_services (
  url TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  name TEXT,
  description TEXT,
  price_usd REAL,
  networks TEXT,
  payable INTEGER NOT NULL DEFAULT 0,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS x402_services_seen ON x402_services (seen_at);
