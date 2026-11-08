#!/usr/bin/env bash
# Reproduce the claude-rea analysis on your own machine.
# Read-only with respect to the target: nothing here executes claude.exe except --version/--help.
# Requires: Node.js >= 24.22.1 (REA engine constraint), git, npm.
set -euo pipefail

VERSION="${1:-2.1.319}"
PLATFORM="${2:-win32-x64}"          # any @anthropic-ai/claude-code-<platform> package
WORK="${WORK:-$PWD/work}"
REA_SRC="${REA_SRC:-$WORK/rea-src}"
HERE="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$WORK/target" "$WORK/evidence"

# 1) Target package (separate directory; treat as untrusted data)
( cd "$WORK/target" && npm pack "@anthropic-ai/claude-code-${PLATFORM}@${VERSION}" >/dev/null \
  && mkdir -p pkg && tar -xzf ./*.tgz -C pkg )
BIN="$(ls "$WORK"/target/pkg/package/claude* | head -1)"
sha256sum "$BIN"

# 2) REA from source (Bun standalone reader landed after rea-agents 6.8.0)
if [ ! -d "$REA_SRC" ]; then
  git clone --depth 1 https://github.com/morluto/rea.git "$REA_SRC"
  ( cd "$REA_SRC" && npm ci --ignore-scripts )
  # On Windows, first copy native/windows/build/{manifest.json,rea-windows-x64.node}
  # from the rea-agents@6.8.0 tarball into $REA_SRC/native/windows/build/.
  ( cd "$REA_SRC" && git apply "$HERE/../evidence/rea-local-patch.diff" && npm run build:cached )
fi
REA="node $REA_SRC/scripts/rea.mjs"

# 3) Inspect and extract the embedded Bun module graph
$REA inspect-artifact "$BIN" --detail summary --evidence_output "$WORK/evidence/inspect.bundle" --format json \
  > "$WORK/evidence/inspect-summary.json"
$REA extract-artifact "$BIN" --format json > "$WORK/evidence/extract.json"
echo "output_root is recorded in $WORK/evidence/extract.json (parameters.output_root)"

# 4) Map bun-modules/<index> back to original module names
#    Find the .bun section raw pointer / virtual size from the PE (or Mach-O/ELF) section table first.
echo "Next: node $HERE/bun-peek.mjs \"$BIN\" <bun_rawptr> <bun_vsize> 52 > module-table.txt"
echo "Then: node $HERE/tool-table.mjs <named-dir> Bash Read Edit Glob Grep ..."
