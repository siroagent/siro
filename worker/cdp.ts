// Coinbase CDP x402 facilitator: JWT auth exactly like @coinbase/cdp-sdk generateJwt, done with
// WebCrypto. Ed25519 keys (base64, 64 bytes = seed + public key) sign EdDSA; PEM EC keys sign ES256.
// Payments on Base go through CDP when CDP_API_KEY_ID / CDP_API_KEY_SECRET are set, which is what
// gets Siro's resources indexed in the x402 Bazaar.

export const CDP_FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";

const b64url = (bytes: Uint8Array | string) => {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/\s+/g, "")), (c) => c.charCodeAt(0));

async function signingKey(secret: string): Promise<{ key: CryptoKey; alg: "EdDSA" | "ES256" }> {
  const s = secret.trim().replace(/\\n/g, "\n");
  if (s.includes("BEGIN")) {
    const der = fromB64(s.replace(/-----[^-]+-----/g, ""));
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    return { key, alg: "ES256" };
  }
  const raw = fromB64(s);
  if (raw.length !== 64) throw new Error("CDP_API_KEY_SECRET must be a base64 Ed25519 key (64 bytes) or a PEM EC key");
  const jwk = { kty: "OKP", crv: "Ed25519", d: b64url(raw.subarray(0, 32)), x: b64url(raw.subarray(32)) };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
  return { key, alg: "EdDSA" };
}

export async function cdpJwt(env: Env, method: string, path: string): Promise<string> {
  const { key, alg } = await signingKey(env.CDP_API_KEY_SECRET!);
  const now = Math.floor(Date.now() / 1000);
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const header = { alg, kid: env.CDP_API_KEY_ID, typ: "JWT", nonce };
  const claims = { sub: env.CDP_API_KEY_ID, iss: "cdp", uris: [`${method} ${new URL(CDP_FACILITATOR).host}${path}`], iat: now, nbf: now, exp: now + 120 };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign(alg === "EdDSA" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

export const cdpEnabled = (env: Env) => !!(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET);

export async function cdpFetch(env: Env, op: "verify" | "settle" | "supported", body?: unknown) {
  const path = `${new URL(CDP_FACILITATOR).pathname}/${op}`;
  const method = op === "supported" ? "GET" : "POST";
  return fetch(`${CDP_FACILITATOR}/${op}`, {
    method,
    headers: { authorization: `Bearer ${await cdpJwt(env, method, path)}`, "content-type": "application/json", "correlation-context": "source=siro" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
