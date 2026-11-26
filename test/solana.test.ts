import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { base58 } from "@scure/base";
import { generatePrivateKey } from "viem/accounts";
import { ataOf, isSolanaAddress, solanaKeyFromEvm } from "../shared/solana";

const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));

describe("solanaKeyFromEvm", () => {
  it("derives the seed as HMAC-SHA256(evmKey, 'siro/solana/v1'), as docs/solana-keys.md describes", () => {
    const evm = generatePrivateKey();
    const k = solanaKeyFromEvm(evm);
    const seed = hmac(sha256, hexBytes(evm), new TextEncoder().encode("siro/solana/v1"));
    expect(k.address).toBe(base58.encode(ed25519.getPublicKey(seed)));
    expect(base58.decode(k.secretKey)).toEqual(new Uint8Array([...seed, ...ed25519.getPublicKey(seed)]));
  });

  it("is deterministic, so one backup restores both keys", () => {
    const evm = generatePrivateKey();
    expect(solanaKeyFromEvm(evm).address).toBe(solanaKeyFromEvm(evm).address);
  });

  it("gives different addresses for different EVM keys", () => {
    const seen = new Set(Array.from({ length: 20 }, () => solanaKeyFromEvm(generatePrivateKey()).address));
    expect(seen.size).toBe(20);
  });

  it("produces a valid Solana address and a 64-byte secret key", () => {
    const k = solanaKeyFromEvm(generatePrivateKey());
    expect(isSolanaAddress(k.address)).toBe(true);
    expect(base58.decode(k.secretKey)).toHaveLength(64);
  });

  it("signs messages that verify against the address", () => {
    const k = solanaKeyFromEvm(generatePrivateKey());
    const msg = new TextEncoder().encode("transfer 0.001 USDC");
    const sig = k.sign(msg);
    expect(ed25519.verify(sig, msg, base58.decode(k.address))).toBe(true);
    expect(ed25519.verify(sig, new TextEncoder().encode("transfer 1 USDC"), base58.decode(k.address))).toBe(false);
  });
});

describe("ataOf", () => {
  it("returns an off-curve program address, deterministic per owner", () => {
    const owner = solanaKeyFromEvm(generatePrivateKey()).address;
    const ata = ataOf(owner);
    expect(ata).toBe(ataOf(owner));
    expect(isSolanaAddress(ata)).toBe(true);
    expect(() => ed25519.ExtendedPoint.fromHex(base58.decode(ata))).toThrow();
  });

  it("matches the USDC account the chain holds for Siro's Solana treasury", () => {
    // Read from Solana mainnet on 26 Nov 2026 with getTokenAccountsByOwner(owner, { mint: USDC }).
    expect(ataOf("97wP7Wk3Cctbi6WAWgV29NcBpbUBc34BFYDeXmMe6LFa")).toBe("DFhWLY8uqKqiXkcBfmycUXya7E65zgrUJwC99EGFbkgK");
  });
});

describe("isSolanaAddress", () => {
  it("accepts 32-byte base58 keys and refuses EVM addresses and junk", () => {
    expect(isSolanaAddress("11111111111111111111111111111111")).toBe(true);
    expect(isSolanaAddress("0x1111111111111111111111111111111111111111")).toBe(false);
    expect(isSolanaAddress("not-an-address")).toBe(false);
  });
});
