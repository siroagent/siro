-- What each paid call handed back. Every settlement keeps a fingerprint of its result (sha256 of
-- JSON.stringify(result), its size and its kind), so a payer can check that the result they received is the
-- one on the ledger. Calls the Siro team pays for itself also keep the full result, which /activity shows.
ALTER TABLE settlements ADD COLUMN result_sha TEXT;
ALTER TABLE settlements ADD COLUMN result_bytes INTEGER;
ALTER TABLE settlements ADD COLUMN result_kind TEXT;

CREATE TABLE proofs (
  tx      TEXT PRIMARY KEY,
  result  TEXT NOT NULL,   -- the JSON the payer received, cut at 64 KB (cut = 1)
  cut     INTEGER NOT NULL DEFAULT 0
);
