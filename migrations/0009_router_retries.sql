-- What Siro spent on router retries per UTC day, at list price in 6-decimal units. Retries are paid by Siro,
-- never by the agent, and stop for the day once shared/router.ts RETRY_DAILY_UNITS is reached.
CREATE TABLE router_retries (
  day   TEXT    PRIMARY KEY,   -- YYYY-MM-DD, UTC
  units INTEGER NOT NULL
);
