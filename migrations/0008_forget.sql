-- Private results. The settlement row (tool, payer, amount, tx, result fingerprint) stays public. What the call
-- returned is not kept, except generated media, which is served for 7 days. media_key points at that file so the
-- payer can delete it early; forgotten_at records when they did.
ALTER TABLE settlements ADD COLUMN media_key TEXT;
ALTER TABLE settlements ADD COLUMN forgotten_at INTEGER;
