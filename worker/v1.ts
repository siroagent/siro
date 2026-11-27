// The paid API. Every resource is POST /v1/<id>; without a payment it answers 402 with a quote
// for every network it can be paid on (USDG on Robinhood Chain; USDC on Solana, Base, Arbitrum, Polygon). The work runs after the facilitator verifies the
// signature and settles only when the work succeeded, so a failed call is never charged.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { CATEGORIES, RESOURCES, ROUTER, byId, toUnits } from "../shared/catalog";
import { bazaarExtension } from "./bazaar";
import { Fail } from "./fail";
import { premiumReady, SLOW_PAYMENT_SECONDS } from "./premium";
import { resultReceipt, settlementStatements } from "./proof";
import { forgetMessage } from "../shared/privacy";
import { client } from "./onchain";
import { getAddress, type Hex } from "viem";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { giveBackFree, holderTier, readPass, takeFree } from "./holder";
import { FREE_TOOLS, discounted } from "../shared/holder";
import { execute, prepare, routerPick } from "./run";
import { pickSummary } from "../shared/router";
import { callListing, describeListing } from "./sell";
import {
  allRequirements,
  chainFor,
  isPayerAddress,
  lockNonce,
  normPayer,
  paymentError,
  paymentRequired,
  paymentResponseHeader,
  pickRequirements,
  readPayment,
  releaseNonce,
  resourceInfo,
  settlePayment,
  treasury,
  verifyPayment,
} from "./x402";

export const v1 = new Hono<{ Bindings: Env }>();

v1.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type", "payment-signature", "x-payment", "x-siro-holder", "x-siro-pass"],
    exposeHeaders: ["payment-required", "payment-response"],
  }),
);

const describe = (env: Env, origin: string, networks: string[]) => (r: (typeof RESOURCES)[number]) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  categoryLabel: CATEGORIES[r.category],
  price: r.price,
  currency: "USD",
  summary: r.summary,
  provider: r.provider,
  method: "POST",
  url: `${origin}/v1/${r.id}`,
  x402Version: 2,
  // Slow renders are quoted on EVM chains only: a signed Solana transaction expires before they finish.
  networks: r.slow ? networks.filter((n) => n.startsWith("eip155:")) : networks,
  input: r.fields,
  returns: r.returns,
  live: premiumReady(env, r),
});

const liveNetworks = async (env: Env) => (await allRequirements(env, 1000n)).map((r) => r.network);

v1.get("/resources", async (c) => {
  c.header("Cache-Control", "public, max-age=300");
  const d = describe(c.env, new URL(c.req.url).origin, await liveNetworks(c.env));
  // The router is listed apart: it is not a tool of its own but picks one of the language models above.
  return c.json({ data: RESOURCES.map(d), count: RESOURCES.length, routers: [{ ...d(ROUTER), priceFrom: true }] });
});

v1.get("/resources/:id", async (c) => {
  const r = byId(c.req.param("id"));
  if (!r) return c.json({ error: { code: "not_found", message: "No such resource" } }, 404);
  return c.json(describe(c.env, new URL(c.req.url).origin, await liveNetworks(c.env))(r));
});

/** Settled payments for one payer. These are public on-chain transfers anyway. */
v1.get("/payments", async (c) => {
  const payer = normPayer((c.req.query("payer") ?? "").trim());
  if (!isPayerAddress(payer)) return c.json({ error: { code: "invalid_payer", message: "payer must be a 0x or Solana address" } }, 400);
  const rows = await c.env.DB.prepare("SELECT resource, network, amount, tx, at FROM settlements WHERE payer = ?1 ORDER BY at DESC LIMIT 200").bind(payer).all();
  return c.json({
    payer,
    data: rows.results.map((r: any) => ({ resource: r.resource, network: r.network, amountUsd: Number(r.amount) / 1e6, tx: r.tx, at: r.at })),
  });
});

const err = (c: any, status: number, code: string, message: string) => c.json({ error: { code, message } }, status);

// Private results: the payer deletes what Siro stored for one of their paid calls. The wallet that paid signs
// forgetMessage(tx); the stored media file is deleted, a team proof is removed, and the row is marked. The payment
// itself (tool, payer, amount, tx and the result's sha256) stays on the public ledger, as it does on-chain.
v1.post("/results/:tx/forget", async (c) => {
  const tx = c.req.param("tx").trim();
  if (!/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{60,100})$/.test(tx)) return err(c, 400, "invalid_tx", "tx must be the transaction hash from the receipt.");
  const body = (await c.req.json().catch(() => ({}))) as { signature?: unknown };
  const sig = typeof body.signature === "string" ? body.signature.trim() : "";
  if (!sig) return err(c, 400, "missing_signature", `Sign the text "${forgetMessage(tx).replace("\n", "\\n")}" with the wallet that paid, and send it as { "signature": "…" }.`);
  const row = await c.env.DB.prepare("SELECT payer, network, media_key AS mediaKey, forgotten_at AS forgottenAt FROM settlements WHERE lower(tx) = lower(?1)")
    .bind(tx)
    .first<{ payer: string; network: string; mediaKey: string | null; forgottenAt: number | null }>();
  if (!row) return err(c, 404, "not_found", "No paid call with this transaction hash.");
  const message = forgetMessage(tx);
  let ok = false;
  if (row.network.startsWith("eip155:")) {
    ok = /^0x[0-9a-fA-F]+$/.test(sig) && (await client(c.env, "robinhood").verifyMessage({ address: getAddress(row.payer), message, signature: sig as Hex }).catch(() => false));
  } else {
    try {
      ok = ed25519.verify(base58.decode(sig), new TextEncoder().encode(message), base58.decode(row.payer));
    } catch {
      ok = false;
    }
  }
  if (!ok) return err(c, 403, "not_payer", "The signature is not from the wallet that paid for this call.");
  if (row.forgottenAt) return c.json({ tx, forgotten: true, at: row.forgottenAt, media: "already deleted" });
  if (row.mediaKey && c.env.MEDIA) await c.env.MEDIA.delete(row.mediaKey);
  const at = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE settlements SET media_key = NULL, forgotten_at = ?1 WHERE lower(tx) = lower(?2)").bind(at, tx),
    c.env.DB.prepare("DELETE FROM proofs WHERE lower(tx) = lower(?1)").bind(tx),
  ]);
  return c.json({ tx, forgotten: true, at, media: row.mediaKey ? "deleted" : "none stored", kept: "The payment row and the result's sha256 stay on the public ledger." });
});

// Seller listings (Sell a tool): paid to the seller's own address, settled only on a result.
v1.get("/s/:id", describeListing);
v1.post("/s/:id", callListing);

v1.post("/:id", async (c) => {
  const r = byId(c.req.param("id"));
  if (!r) return err(c, 404, "not_found", `No resource ${c.req.param("id")}. See GET /v1/resources.`);
  if (Number(c.req.header("content-length") ?? 0) > 200_000) return err(c, 413, "body_too_large", "Body is larger than 200 KB.");

  // Input is checked before any payment is verified, so a bad request is never charged. Without a
  // payment the answer is always the 402 quote (crawlers and directories probe with empty bodies);
  // the input problem rides along as a hint.
  let input: Record<string, unknown> | undefined;
  let inputError: Fail | undefined;
  try {
    const raw = await c.req.json().catch(() => {
      throw new Fail(400, "invalid_json", "Body must be JSON.");
    });
    input = prepare(r, raw);
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    inputError = e;
  }
  const paying = !!(c.req.header("payment-signature") ?? c.req.header("x-payment"));
  if (inputError && (paying || !treasury(c.env) || c.req.header("x-dev-free") === "1")) return err(c, inputError.status, inputError.code, inputError.message);

  // Local development only: run without paying when DEV_FREE=1 is set in .dev.vars and the request is to localhost.
  if (c.env.DEV_FREE === "1" && new URL(c.req.url).hostname === "localhost" && c.req.header("x-dev-free") === "1") {
    try {
      return c.json({ resource: r.id, result: await execute(c.env, r, input!), receipt: null });
    } catch (e) {
      if (e instanceof Fail) return err(c, e.status, e.code, e.message);
      throw e;
    }
  }
  if (!treasury(c.env)) return err(c, 503, "payments_not_configured", "Payments are not switched on yet.");
  if (!premiumReady(c.env, r)) return err(c, 503, "not_live", `${r.name} is listed but not switched on yet. Nothing was charged.`);

  // $SIRO holders: a signed holder pass runs Siro's own data tools free a few times a day.
  const passHeader = c.req.header("x-siro-pass");
  if (passHeader && !paying) {
    if (!FREE_TOOLS.includes(r.id)) return err(c, 403, "not_free", `${r.name} is not one of the free holder tools (${FREE_TOOLS.join(", ")}). Pay for it as usual; holders get their discount.`);
    if (inputError) return err(c, inputError.status, inputError.code, inputError.message);
    let pass;
    try {
      pass = await readPass(c.env, passHeader);
    } catch (e) {
      return err(c, 403, "invalid_pass", (e as Error).message);
    }
    const left = await takeFree(c.env, pass.address, pass.tier.freePerDay);
    if (left === null) return err(c, 429, "free_used", `Today's ${pass.tier.freePerDay} free calls are used. Pay for this call (at the holder price), or wait until 00:00 UTC.`);
    try {
      const result = await execute(c.env, r, input!);
      return c.json({ resource: r.id, result, receipt: null, free: { holder: pass.address, tier: pass.tier.name, leftToday: left } });
    } catch (e) {
      await giveBackFree(c.env, pass.address);
      if (e instanceof Fail) return err(c, e.status, e.code, e.message);
      throw e;
    }
  }

  // A wallet holding $SIRO gets its tier's discount. The quote is made for the address in x-siro-holder, and the
  // payment must then come from that same address, so the discount follows the coins on Robinhood Chain.
  const holder = await holderTier(c.env, c.req.header("x-siro-holder"));
  // The router is priced at the model it picks, which the quote names; an input the pick refuses is an input error.
  let picked: ReturnType<typeof pickSummary> | null = null;
  if (r.id === ROUTER.id && input && !inputError) {
    try {
      picked = pickSummary(routerPick(c.env, input));
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      inputError = e;
      if (paying) return err(c, e.status, e.code, e.message);
    }
  }
  const full = picked ? toUnits(String(picked.priceUsd)) : toUnits(r.price);
  const amount = holder ? discounted(full, holder.tier.discountPct) : full;
  // A signed Solana transaction expires in about a minute, so slow renders are offered on EVM chains only.
  // A holder price is offered on EVM chains only, where the payer is the holder address itself.
  const evmOnly = r.slow || !!holder;
  const reqs = evmOnly ? (await allRequirements(c.env, amount, r.slow ? SLOW_PAYMENT_SECONDS : undefined)).filter((q) => q.network.startsWith("eip155:")) : await allRequirements(c.env, amount);
  const payment = readPayment(c);
  const description = `${r.name}: ${r.summary}`;
  const ctx = { resource: resourceInfo(c, description), extensions: { bazaar: bazaarExtension(r) } };
  const holderInfo = holder ? { holder: { address: holder.address, siro: Math.floor(holder.siro), tier: holder.tier.name, discountPct: holder.tier.discountPct, fullPriceUsd: Number(full) / 1e6, priceUsd: Number(amount) / 1e6 } } : {};
  if (payment === null) return paymentRequired(c, reqs, description, { extensions: ctx.extensions, ...holderInfo, ...(picked ? { picked } : {}), ...(inputError ? { inputError: { code: inputError.code, message: inputError.message } } : {}) });
  if (payment === "bad") return paymentError(c, "invalid_payment", "PAYMENT-SIGNATURE could not be read");
  const req = pickRequirements(payment, reqs);
  if (typeof req === "string") return paymentError(c, "invalid_payment", req);

  if (!(await lockNonce(c.env.DB, payment))) return paymentError(c, "nonce_used", "This payment authorization was already used. Sign a new one.");
  const verified = await verifyPayment(c.env, payment, req, ctx);
  if (!verified.ok) {
    await releaseNonce(c.env.DB, payment);
    return paymentError(c, verified.code, verified.message);
  }
  if (holder && verified.payer.toLowerCase() !== holder.address.toLowerCase()) {
    await releaseNonce(c.env.DB, payment);
    return paymentError(c, "holder_mismatch", "The holder price is for payments from the $SIRO wallet itself. Pay from that wallet, or leave out x-siro-holder to pay the full price.");
  }

  const started = Date.now();
  let result: unknown;
  try {
    result = await execute(c.env, r, input!);
  } catch (e) {
    await releaseNonce(c.env.DB, payment);
    if (e instanceof Fail) return err(c, e.status, e.code, e.message);
    console.error(JSON.stringify({ event: "execute_crashed", resource: r.id, err: String((e as any)?.stack ?? e).slice(0, 500) }));
    return err(c, 502, "resource_failed", "Something broke while running this resource. You were not charged.");
  }
  const ms = Date.now() - started;

  const settled = await settlePayment(c.env, payment, req, ctx);
  // A transfer that was broadcast but not yet confirmed is on its way to the treasury. Holding the result back
  // would charge without delivering, so the result goes out with the receipt marked pending.
  const pending = !settled.ok && settled.code === "settle_unconfirmed" && !!settled.tx;
  if (!settled.ok) {
    console.error(JSON.stringify({ event: "settle_failed", resource: r.id, code: settled.code, message: settled.message, tx: settled.tx }));
    if (!pending) {
      if (settled.code === "settle_failed") await releaseNonce(c.env.DB, payment);
      return paymentError(c, settled.code, `Payment did not settle: ${settled.message}`);
    }
  }
  const tx = settled.ok ? settled.tx : settled.tx!;
  const payer = settled.ok ? settled.payer : verified.payer;

  const rr = await resultReceipt(result);
  await c.env.DB.batch(settlementStatements(c.env.DB, { resource: r.id, network: req.network, payer, amount: Number(amount), tx, ms }, rr))
    .catch((e) => console.error(JSON.stringify({ event: "settlement_log_failed", err: String(e) })));

  paymentResponseHeader(c, { tx, payer }, req.network);
  const chain = chainFor(req.network);
  return c.json({
    resource: r.id,
    result,
    receipt: { network: req.network, asset: chain.symbol, amountUsd: Number(amount) / 1e6, payer, tx, ms, resultSha256: rr.sha, ...(picked ? { model: picked.model } : {}), ...(holder ? { holderDiscountPct: holder.tier.discountPct, fullPriceUsd: Number(full) / 1e6 } : {}), ...(pending ? { status: "pending" } : {}) },
  });
});
