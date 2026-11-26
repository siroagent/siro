# The Solana key of a Siro wallet

A Siro wallet (the CLI keystore or the browser Budget) holds one secret: an EVM private key. It pays on Solana too, with a key derived from that one, so a single backup restores both.

## Derivation

```
seed       = HMAC-SHA256(key = EVM private key (32 bytes), message = "siro/solana/v1")
public key = Ed25519 public key of seed
address    = base58(public key)
secret key = base58(seed ‖ public key)     // the 64-byte format Phantom and Solflare import
```

The code is `solanaKeyFromEvm` in [`shared/solana.ts`](../shared/solana.ts), using `@noble/hashes` and `@noble/curves`. Signing is plain Ed25519 over the transaction message with `seed` as the private key.

## Properties

- **Deterministic.** The same EVM key always gives the same Solana key, so restoring the EVM key restores the Solana address and its funds. Tested in `test/solana.test.ts`.
- **One-way.** HMAC-SHA256 is a pseudorandom function keyed by the EVM key. Knowing the Solana seed or address reveals nothing about the EVM key, and the two keys cannot be linked from the outside unless the owner shows both addresses.
- **Domain separated.** The message `siro/solana/v1` binds the derived key to this purpose and version. A future scheme would use a new label and leave existing addresses unchanged.
- **Uniform seed.** Ed25519 accepts any 32 bytes as a seed and hashes it internally (RFC 8032), so no rejection sampling or clamping is needed on our side.

## What this does not cover

- It is not BIP-39 / SLIP-0010. A Siro Solana address will not appear in another wallet from the same mnemonic, because there is no mnemonic: the export command prints the 64-byte secret key to import directly (`siro export-key --solana`).
- Anyone holding the EVM private key can derive the Solana key. Protect the EVM key as the one secret it is.
