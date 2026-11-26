// Reads package/package.json out of an npm tarball in the browser, so the Docs panel can show the
// name and version people actually get from /cli/siro.tgz.

export type PackageJson = { name?: string; version?: string; bin?: string | Record<string, string>; engines?: { node?: string } };

export const canUnpack = () => typeof DecompressionStream !== "undefined";

export async function packageJsonOf(tgz: ArrayBuffer): Promise<PackageJson | null> {
  const bytes = new Uint8Array(tgz);
  // A gzip stream starts 1f 8b. Without it, something on the way already unzipped the file: read it as tar.
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (gzipped && !canUnpack()) return null;
  const tar = gzipped ? new Uint8Array(await new Response(new Response(tgz).body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()) : bytes;
  const field = (from: number, len: number) => new TextDecoder().decode(tar.subarray(from, from + len)).replace(/\0[\s\S]*$/, "");
  // A tar entry is a 512-byte header (name at 0, octal size at 124, ustar prefix at 345) and its
  // data padded to 512 bytes. An empty name means the end-of-archive blocks.
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = field(at, 100);
    if (!name) return null;
    const size = parseInt(field(at + 124, 12).trim() || "0", 8);
    const prefix = field(at + 345, 155);
    if ((prefix ? `${prefix}/${name}` : name) === "package/package.json") {
      return JSON.parse(new TextDecoder().decode(tar.subarray(at + 512, at + 512 + size))) as PackageJson;
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}
