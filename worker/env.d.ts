interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
  /** Comma-separated origins allowed to use the free agent endpoint. */
  ALLOWED_ORIGINS: string;
  /** Where EVM x402 payments land (USDG on Robinhood Chain; USDC on Base, Arbitrum, Polygon). Empty = payments off. */
  TREASURY: string;
  /** Where Solana USDC payments land (a base58 wallet address). Empty = Solana is not offered. */
  SOLANA_TREASURY?: string;
  /** x402 facilitator (verify + settle). */
  FACILITATOR_URL: string;
  /** Optional RPC overrides. */
  RPC_URL?: string;
  BASE_RPC_URL?: string;
  IP_SALT: string;
  /** Optional Solana RPC tried first by /api/solana. */
  SOLANA_RPC_URL?: string;
  /** Secret, optional: CoinGecko API key (Demo "CG-…" or Pro) for GeckoTerminal data from Workers. */
  CG_API_KEY?: string;
  /** Secrets, optional: Coinbase CDP API key. When set, Base payments settle through the CDP
   *  facilitator (which lists the resources in the x402 Bazaar), and Arbitrum, Polygon and Solana
   *  are offered, since only CDP settles those. */
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  /** Optional: base64 ed25519 public key behind /.well-known/mcp-registry-auth. */
  MCP_REGISTRY_PUBKEY?: string;
  /** Optional: Glama ownership claim behind /.well-known/glama.json. */
  GLAMA_CLAIM?: string;
  /** R2 bucket where Replicate outputs are kept (Replicate deletes its own copy after an hour). Optional. */
  MEDIA?: R2Bucket;
  /** Secret, optional: Replicate API token. Premium LLM, image, video and audio resources are offered only when set. */
  REPLICATE_API_TOKEN?: string;
  /** .dev.vars only: lets localhost run resources without paying (header x-dev-free: 1). */
  DEV_FREE?: string;
}
