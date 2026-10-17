#!/bin/sh
# Builds bin/darwin/octopus-overlay (a universal binary, ad-hoc signed) from the Swift sources.
# Run from anywhere:  sh native/macos/build.sh
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
python3 -I "$here/make_sprites.py"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos11" "$here/main.swift" "$here/Sprites.swift" -o "$tmp/overlay-$arch"
done
mkdir -p "$root/bin/darwin"
lipo -create "$tmp/overlay-arm64" "$tmp/overlay-x86_64" -output "$root/bin/darwin/octopus-overlay"
codesign --force -s - "$root/bin/darwin/octopus-overlay"
echo "built $root/bin/darwin/octopus-overlay"
