-- Siro v2: commerce for AI agents. Every paid call that settled on-chain is one row here.
CREATE TABLE settlements (
  id         INTEGER PRIMARY KEY,
  resource   TEXT    NOT NULL,
  network    TEXT    NOT NULL,              -- eip155:4663 | eip155:8453
  payer      TEXT    NOT NULL,              -- lowercase 0x…
  amount     INTEGER NOT NULL,              -- 6-decimal base units
  tx         TEXT    NOT NULL,
  ms         INTEGER,                       -- time spent running the resource
  at         INTEGER NOT NULL
);
CREATE INDEX settlements_payer ON settlements (payer, at);
CREATE INDEX settlements_at ON settlements (at);

-- A signed authorization can only be spent once, even across parallel requests.
CREATE TABLE x402_nonces (
  nonce TEXT PRIMARY KEY,
  payer TEXT NOT NULL,
  at    INTEGER NOT NULL
);

INSERT INTO settings (key, value) VALUES ('agent_daily_cap', '3000') ON CONFLICT (key) DO NOTHING;
