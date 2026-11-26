#!/usr/bin/env bash
# Bakes the white-backed renders onto the surface they sit on, so the site needs no blend modes.
# out = surface * min(1, luminance / 250): the exact result of `mix-blend-mode: multiply`,
# with near-white render noise (250..255) lifted to pure surface colour so no edge shows.
# Usage: bash tools/bake-images.sh   (needs ffmpeg + cwebp; sources in _assets-src/siro-iconic-monochrome)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=_assets-src/siro-iconic-monochrome
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# bake <source.png> <out.webp> <width> <r> <g> <b>
bake() {
  ffmpeg -loglevel error -y -i "$SRC/$1" -vf "scale=$3:-1:flags=lanczos,format=gray,lut=y='min(255,val*255/250)',format=rgb24,colorchannelmixer=rr=$4/255:gg=$5/255:bb=$6/255" "$TMP/o.png"
  cwebp -quiet -q 86 -m 6 -sharp_yuv "$TMP/o.png" -o "public/img/$2"
  echo "$2 $(wc -c <"public/img/$2")"
}

# Surfaces from DESIGN.md: --bench, --plate and the faceplate mid tone. Renders are shown no larger
# than their source, so each gets one 1x size and one 2x-capable size.
B="242 243 245"   # --bench
P="236 238 241"   # --plate
F="232 234 238"   # faceplate mid (knob, clipped to a circle)

bake siro-01-hero.png 01-hero-plate-900.webp 900 $P
bake siro-01-hero.png 01-hero-plate-1672.webp 1672 $P
# retired 15 Nov (S is engraved in CSS now): bake siro-02-route-top.png 02-route-bench-720.webp 720 $B
# retired 15 Nov (S is engraved in CSS now): bake siro-02-route-top.png 02-route-bench-1254.webp 1254 $B
bake siro-03-dial.png 03-dial-face-900.webp 900 $F
bake siro-04-catalog.png 04-catalog-bench-900.webp 900 $B
bake siro-04-catalog.png 04-catalog-bench-1536.webp 1536 $B
bake siro-05-wallet.png 05-wallet-plate-640.webp 640 $P
bake siro-05-wallet.png 05-wallet-plate-1122.webp 1122 $P
bake siro-06-macro.png 06-macro-plate-1000.webp 1000 $P
bake siro-06-macro.png 06-macro-plate-1916.webp 1916 $P
