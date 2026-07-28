#!/usr/bin/env bash
# Regenerate every derived brand asset from the source SVGs.
#
#   ./assets/brand/build.sh
#
# Colour variants are produced by token substitution so a colour is only ever
# edited in one place. PNGs are rasterised with headless Chrome (transparent
# background) because the repo ships no native SVG rasteriser.
set -euo pipefail

cd "$(dirname "$0")"

INK="#0B0D12"
SIGNAL="#FF4A1E"
PAPER="#FFFFFF"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME (override with CHROME=…)" >&2; exit 1; }

mkdir -p png

SOURCES=(moxxy-mark moxxy-wordmark moxxy-lockup moxxy-lockup-stacked)

# -dark: ink → paper, for dark backgrounds.
for f in "${SOURCES[@]}"; do
  sed "s/$INK/$PAPER/g" "$f.svg" > "$f-dark.svg"
done

# One colour is a different construction, not a recolour: with a single ink the
# weave has to be carried by gaps, so moxxy-mark-mono.svg is its own source and
# only its inverse is derived.
sed "s/$INK/$PAPER/g" moxxy-mark-mono.svg > moxxy-mark-mono-white.svg
# Signal on its own reads against both a white page and a dark one, so surfaces
# that ship a single raster for both themes (mobile) use this one.
sed "s/$INK/$SIGNAL/g" moxxy-mark-mono.svg > moxxy-mark-signal.svg
sed "s/$INK/$PAPER/g" alternates/v5-borromean.svg > alternates/v5-borromean-dark.svg
sed "s/$INK/$PAPER/g" alternates/v8-solomon.svg > alternates/v8-solomon-dark.svg

shot() { # shot <svg> <width> <height> <out>
  local tmp; tmp="$(mktemp -d)"
  cat > "$tmp/p.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}img{display:block}</style>
<img src="file://$PWD/$1" width="$2" height="$3">
HTML
  "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --default-background-color=00000000 --force-device-scale-factor=1 \
    --window-size="$2,$3" --screenshot="$4" "$tmp/p.html" >/dev/null 2>&1
  rm -rf "$tmp"
}

for s in 1024 512 256 128 64 48 32 16; do
  shot moxxy-mark.svg      "$s" "$s" "png/moxxy-mark-$s.png"
  shot moxxy-mark-dark.svg "$s" "$s" "png/moxxy-mark-dark-$s.png"
done
shot moxxy-mark-mono.svg 1024 1024 png/moxxy-mark-mono-1024.png
shot moxxy-mark-signal.svg 512 512 png/moxxy-mark-signal-512.png
shot moxxy-mark-gradient.svg 1024 1024 png/moxxy-mark-gradient-1024.png
shot moxxy-mark-gradient.svg 256 256 png/moxxy-mark-gradient-256.png
for s in 1024 512 256 128; do
  shot moxxy-icon.svg "$s" "$s" "png/moxxy-icon-$s.png"
done
for w in 1600 800 400; do
  shot moxxy-lockup.svg      "$w" "$(( w * 141 / 655 ))" "png/moxxy-lockup-$w.png"
  shot moxxy-lockup-dark.svg "$w" "$(( w * 141 / 655 ))" "png/moxxy-lockup-dark-$w.png"
done
for w in 1200 600; do
  shot moxxy-lockup-stacked.svg      "$w" "$(( w * 298 / 400 ))" "png/moxxy-lockup-stacked-$w.png"
  shot moxxy-lockup-stacked-dark.svg "$w" "$(( w * 298 / 400 ))" "png/moxxy-lockup-stacked-dark-$w.png"
done

# Product icons. iOS refuses an alpha channel and apps/mobile tests the IHDR
# colour type, so the square icon is flattened onto ink after rasterising.
shot moxxy-icon-square.svg 1024 1024 png/.icon-square-rgba.png
python3 flatten-png.py png/.icon-square-rgba.png png/moxxy-icon-square-1024.png "$INK" >/dev/null
rm -f png/.icon-square-rgba.png

# Social card: HTML source, so the raster is what ships.
"$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1200,630 \
  --screenshot=png/moxxy-og.png "$PWD/moxxy-og.html" >/dev/null 2>&1

echo "wrote $(ls png | wc -l | tr -d ' ') PNGs to assets/brand/png/"
