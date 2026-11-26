// $SIRO token slot. Written only by tools/fill_after_launch.py after it reads the contract on
// Robinhood Chain; null means no token, and the site and agent then say nothing about one.
export type Token = { ticker: string; chain: string; ca: string; explorer: string; chart: string | null; added: string };

export const TOKEN: Token | null = {
  "ticker": "SIRO",
  "chain": "Robinhood Chain",
  "ca": "0x4471866fee3309c542386ff2a2ffa755e8298497",
  "explorer": "https://robinhoodchain.blockscout.com/token/0x4471866fee3309c542386ff2a2ffa755e8298497",
  "chart": null,
  "added": "2026-11-25T15:46:48Z"
};
