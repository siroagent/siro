/** A failure the caller should see as-is. Thrown before settlement, so nothing is charged. */
export class Fail extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503 | 504, public code: string, message: string) {
    super(message);
  }
}
