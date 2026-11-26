// What Siro keeps about a paid call, in one place for the worker, the site and the CLI.
// The payment row is public and stays. Generated media is served for RESULT_TTL_DAYS and then refused, and the
// R2 bucket deletes it on the same schedule. A payer can delete a result sooner by signing forgetMessage(tx).

export const RESULT_TTL_DAYS = 7;
export const RESULT_TTL_SECONDS = RESULT_TTL_DAYS * 86_400;

/** The text the paying wallet signs to delete the stored result of one paid call. */
export const forgetMessage = (tx: string) => `Delete my Siro result\nTransaction: ${tx.trim().toLowerCase()}`;
