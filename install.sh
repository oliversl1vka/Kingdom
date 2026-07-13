#!/bin/sh
# KingdomOS installer — installs the `kingdom` CLI from the public GitHub repo.
#
#   curl -fsSL https://raw.githubusercontent.com/oliversl1vka/Kingdom/main/install.sh | sh
#
# Clones (or updates) the repo, builds the workspace, and links the `kingdom`
# binary onto your PATH. Override any of these with environment variables:
#   KINGDOM_HOME  install location   (default: ~/.kingdomos)
#   BIN_DIR       where to link       (default: ~/.local/bin)
#   KINGDOM_REPO  git URL             (default: the public repo below)
#   KINGDOM_REF   branch/tag          (default: main)
set -eu

REPO="${KINGDOM_REPO:-https://github.com/oliversl1vka/Kingdom.git}"
REF="${KINGDOM_REF:-main}"
KINGDOM_HOME="${KINGDOM_HOME:-$HOME/.kingdomos}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

info() { printf '  \033[36m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; }
err()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

printf '\n  K I N G D O M   O S  —  installer\n\n'

# --- Prerequisites --------------------------------------------------------
command -v git  >/dev/null 2>&1 || err "git is required but not found."
command -v node >/dev/null 2>&1 || err "Node.js is required but not found. Install Node >= 20 from https://nodejs.org."

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || err "Node.js >= 20 is required (found $(node -v)). Please upgrade."

# pnpm: use it if present, otherwise fall back to the corepack shim (ships with Node).
if command -v pnpm >/dev/null 2>&1; then
  pnpm_run() { pnpm "$@"; }
elif command -v corepack >/dev/null 2>&1; then
  info "pnpm not found — using corepack to provision it."
  pnpm_run() { corepack pnpm "$@"; }
else
  err "pnpm not found and corepack is unavailable. Install pnpm (https://pnpm.io/installation) and re-run."
fi

# --- Fetch the repo -------------------------------------------------------
if [ -d "$KINGDOM_HOME/.git" ]; then
  info "Updating existing checkout at $KINGDOM_HOME"
  git -C "$KINGDOM_HOME" fetch --depth 1 origin "$REF" >/dev/null 2>&1 || err "git fetch failed."
  git -C "$KINGDOM_HOME" checkout -q "$REF" 2>/dev/null || true
  git -C "$KINGDOM_HOME" reset --hard "origin/$REF" >/dev/null 2>&1 || err "git reset failed."
else
  info "Cloning $REPO ($REF) into $KINGDOM_HOME"
  rm -rf "$KINGDOM_HOME"
  git clone --depth 1 --branch "$REF" "$REPO" "$KINGDOM_HOME" >/dev/null 2>&1 \
    || err "git clone failed — check the URL/branch and your network."
fi
ok "Source ready"

# --- Build ----------------------------------------------------------------
cd "$KINGDOM_HOME"
info "Installing dependencies (pnpm)…"
pnpm_run install --frozen-lockfile >/dev/null 2>&1 || err "dependency install failed."
info "Building the workspace…"
pnpm_run build >/dev/null 2>&1 || err "build failed."

CLI_ENTRY="$KINGDOM_HOME/packages/cli/dist/index.js"
[ -f "$CLI_ENTRY" ] || err "build did not produce $CLI_ENTRY"
chmod +x "$CLI_ENTRY"
ok "Built the kingdom CLI"

# --- Link onto PATH -------------------------------------------------------
mkdir -p "$BIN_DIR"
ln -sf "$CLI_ENTRY" "$BIN_DIR/kingdom"
ok "Linked $BIN_DIR/kingdom"

VERSION=$("$BIN_DIR/kingdom" --version 2>/dev/null || echo "unknown")
ok "kingdom v$VERSION ready"

# --- PATH hint ------------------------------------------------------------
case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *) printf '\n  Note: %s is not on your PATH. Add it, e.g.:\n    export PATH="%s:$PATH"\n' "$BIN_DIR" "$BIN_DIR" ;;
esac

printf '\n  Next: \033[36mkingdom setup camelot\033[0m  then  \033[36mkingdom decree "…"\033[0m\n\n'
