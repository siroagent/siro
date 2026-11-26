import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { FREE_TOOLS, PASS_MAX_SECONDS, TIERS, discounted, passMessage, tierFor } from "../shared/holder";
import { byId, toUnits } from "../shared/catalog";

describe("holder tiers", () => {
  it("are ordered highest first, so the first match is the best tier", () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i - 1].min).toBeGreaterThan(TIERS[i].min);
      expect(TIERS[i - 1].discountPct).toBeGreaterThan(TIERS[i].discountPct);
    }
  });

  it("gives no tier below the lowest threshold", () => {
    expect(tierFor(0)).toBeNull();
    expect(tierFor(TIERS[TIERS.length - 1].min - 1)).toBeNull();
  });

  it("gives each tier from its threshold up", () => {
    for (const t of TIERS) expect(tierFor(t.min)?.name).toBe(t.name);
    expect(tierFor(TIERS[0].min * 100)?.name).toBe(TIERS[0].name);
  });

  it("never discounts a price to zero or below", () => {
    for (const t of TIERS) {
      expect(t.discountPct).toBeGreaterThan(0);
      expect(t.discountPct).toBeLessThan(100);
    }
  });
});

describe("discounted", () => {
  it("cuts base units by the tier percentage", () => {
    expect(discounted(20000n, 25)).toBe(15000n);
    expect(discounted(20000n, 50)).toBe(10000n);
    expect(discounted(1000n, 25)).toBe(750n);
  });

  it("rounds down, so a holder never pays more than the cut", () => {
    expect(discounted(1001n, 50)).toBe(500n);
    expect(discounted(3n, 25)).toBe(2n);
  });

  it("keeps every catalog price above zero at every tier", () => {
    for (const t of TIERS) for (const id of ["gas-now", "claude-haiku-4-5"]) expect(discounted(toUnits(byId(id)!.price), t.discountPct)).toBeGreaterThan(0n);
  });
});

describe("free tools", () => {
  it("are all real catalog tools", () => {
    for (const id of FREE_TOOLS) expect(byId(id), id).toBeDefined();
  });
});

describe("holder pass", () => {
  // A fresh key for every run; it never holds anything.
  const account = privateKeyToAccount(generatePrivateKey());

  it("signs a message bound to the lowercase address and the expiry", async () => {
    const expires = 1_800_000_000;
    const message = passMessage(account.address, expires);
    expect(message).toBe(`Siro holder pass\nAddress: ${account.address.toLowerCase()}\nExpires: ${expires}`);
    const signature = await account.signMessage({ message });
    expect(await verifyMessage({ address: account.address, message, signature })).toBe(true);
    expect(await verifyMessage({ address: account.address, message: passMessage(account.address, expires + 1), signature })).toBe(false);
  });

  it("lasts a day at most", () => {
    expect(PASS_MAX_SECONDS).toBe(86_400);
  });
});
