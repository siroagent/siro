// Which tools the server takes payment for right now. A tool can be listed before its provider is
// switched on; GET /v1/resources marks those with live: false.

export type LiveRead = { flags: Map<string, boolean>; at: Date };

export async function readLive(): Promise<LiveRead> {
  const res = await fetch("/v1/resources");
  if (!res.ok) throw new Error(`GET /v1/resources answered ${res.status}`);
  const j = await res.json();
  const flags = new Map<string, boolean>();
  for (const d of Array.isArray(j?.data) ? j.data : []) if (typeof d?.id === "string") flags.set(d.id, d.live !== false);
  return { flags, at: new Date() };
}

/** One tool's flag, or null when the server could not be read. */
export async function readLiveOne(id: string): Promise<boolean | null> {
  try {
    const res = await fetch(`/v1/resources/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const j = await res.json();
    return j?.live !== false;
  } catch {
    return null;
  }
}
