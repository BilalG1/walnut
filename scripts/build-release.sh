#!/usr/bin/env bash
#
# Cross-compile the walnut CLI into per-platform tarballs + checksums under
# apps/cli/dist/. `bun build --compile` cross-compiles, so every target is built
# from a single host. Asset names here MUST match what scripts/install.sh fetches.
#
#   VERSION=v0.2.0 scripts/build-release.sh     # the release workflow sets VERSION
#   scripts/build-release.sh                    # local smoke test (version from git)
#
set -euo pipefail
cd "$(dirname "$0")/.."

entry="apps/cli/src/index.ts"
out="apps/cli/dist"
version="${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"

# asset-suffix : bun --target
targets=(
  "darwin-arm64:bun-darwin-arm64"
  "darwin-x64:bun-darwin-x64"
  "linux-x64:bun-linux-x64"
  "linux-arm64:bun-linux-arm64"
)

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

rm -rf "$out"
mkdir -p "$out"

for pair in "${targets[@]}"; do
  name="${pair%%:*}"
  bun_target="${pair##*:}"
  echo "==> walnut-$name ($version)"
  work="$out/$name"
  mkdir -p "$work"
  bun build --compile --target="$bun_target" \
    --define "WALNUT_VERSION=\"$version\"" \
    --outfile "$work/walnut" \
    "$entry"
  tar -czf "$out/walnut-$name.tar.gz" -C "$work" walnut
  rm -rf "$work"
  ( cd "$out" && sha "walnut-$name.tar.gz" >"walnut-$name.tar.gz.sha256" )
done

echo "==> artifacts:"
ls -1 "$out"
