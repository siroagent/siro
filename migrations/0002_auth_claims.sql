-- Sign-In with Ethereum: one-time nonces bound to the address that asked for them.
CREATE TABLE auth_nonces (
  nonce      TEXT    PRIMARY KEY,
  address    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_nonces_expires_at ON auth_nonces (expires_at);

-- Sessions store only a hash of the cookie value, so a database leak
-- cannot be replayed as a login.
CREATE TABLE sessions (
  id_hash    TEXT    PRIMARY KEY,
  address    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_address ON sessions (address);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

-- Token metadata cached from chain reads. Any token someone looks up lands
-- here, claimed or not, so search can warn about duplicate tickers.
CREATE TABLE tokens (
  address      TEXT    PRIMARY KEY,               -- lowercase 0x…
  chain_id     INTEGER NOT NULL DEFAULT 4663,
  name         TEXT,
  symbol       TEXT,
  decimals     INTEGER,
  total_supply TEXT,                              -- base units, decimal string
  first_seen_at INTEGER NOT NULL,
  refreshed_at  INTEGER NOT NULL
);
CREATE INDEX tokens_symbol ON tokens (symbol COLLATE NOCASE);

-- One claim per token. Only the wallet that sent the launch transaction can
-- create it (pin 1), so there is never a race between claimants.
CREATE TABLE claims (
  token_address      TEXT    PRIMARY KEY REFERENCES tokens (address),
  launcher           TEXT    NOT NULL,            -- tx.from, lowercase
  launch_tx          TEXT    NOT NULL,
  launch_block       INTEGER NOT NULL,
  launch_time        INTEGER,                     -- block timestamp, unix seconds
  origin_evidence    TEXT    NOT NULL CHECK (origin_evidence IN ('contract_creation', 'first_activity_mint')),
  origin_verified_at INTEGER NOT NULL,
  domain             TEXT,
  domain_verified_at INTEGER,
  x_code             TEXT    NOT NULL,            -- one-time code the X post must contain
  x_handle           TEXT,
  x_post_url         TEXT,
  x_verified_at      INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX claims_launcher ON claims (launcher);
