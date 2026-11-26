-- Free calls $SIRO holders used, one row per wallet per UTC day.
CREATE TABLE holder_free (
  address TEXT    NOT NULL,   -- lowercase 0x…
  day     TEXT    NOT NULL,   -- YYYY-MM-DD, UTC
  n       INTEGER NOT NULL,
  PRIMARY KEY (address, day)
);
