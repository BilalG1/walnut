#!/usr/bin/env bash
#
# Walnut CLI installer.
#
#   curl -fsSL https://walnut.sh/install | bash
#
# Downloads the right `walnut` binary for this machine, drops it in ~/.walnut/bin,
# and wires it onto your PATH. Re-run any time to upgrade; it's idempotent.
#
# Environment overrides:
#   WALNUT_VERSION    Pin a release, e.g. v0.2.0 (default: latest).
#   WALNUT_INSTALL    Install prefix (default: ~/.walnut). Binary lands in $WALNUT_INSTALL/bin.
#   WALNUT_REPO       GitHub repo serving the releases (default: walnut-cloud/walnut).
#   WALNUT_BASE_URL   Releases base, GitHub-layout (default: https://github.com/$REPO/releases).
#                     Override to self-host (e.g. https://dl.walnut.sh/releases).
#   WALNUT_NO_MODIFY_PATH=1   Don't touch any shell rc file.
#
set -euo pipefail

# --- pretty output (no-ops when stdout isn't a terminal) ---------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  bold=$(printf '\033[1m'); dim=$(printf '\033[2m'); red=$(printf '\033[31m')
  green=$(printf '\033[32m'); yellow=$(printf '\033[33m'); reset=$(printf '\033[0m')
else
  bold=; dim=; red=; green=; yellow=; reset=
fi

info()  { printf '%s\n' "$*"; }
step()  { printf '%s==>%s %s\n' "$green" "$reset" "$*"; }
warn()  { printf '%swarning:%s %s\n' "$yellow" "$reset" "$*" >&2; }
error() { printf '%serror:%s %s\n' "$red" "$reset" "$*" >&2; exit 1; }

# --- config ------------------------------------------------------------------
REPO="${WALNUT_REPO:-walnut-cloud/walnut}"
INSTALL_DIR="${WALNUT_INSTALL:-$HOME/.walnut}"
BIN_DIR="$INSTALL_DIR/bin"
EXE="$BIN_DIR/walnut"

# --- prerequisites -----------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
  dl() { curl -fSL "$1"; }            # to stdout
  dlf() { curl -fSL -o "$2" "$1"; }   # to file
elif command -v wget >/dev/null 2>&1; then
  dl() { wget -qO- "$1"; }
  dlf() { wget -qO "$2" "$1"; }
else
  error "need curl or wget to download Walnut."
fi
command -v tar >/dev/null 2>&1 || error "need tar to unpack the download."

# --- detect platform ---------------------------------------------------------
os=$(uname -s)
arch=$(uname -m)

case "$os" in
  Darwin) os=darwin ;;
  Linux)  os=linux ;;
  MINGW* | MSYS* | CYGWIN* | Windows_NT)
    error "Windows isn't supported by this script. Install via your package manager or grab a binary from https://github.com/$REPO/releases." ;;
  *) error "unsupported OS: $os" ;;
esac

case "$arch" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) error "unsupported architecture: $arch" ;;
esac

target="$os-$arch"
asset="walnut-$target.tar.gz"

# --- resolve the download URL ------------------------------------------------
# GitHub serves the newest release's asset at .../releases/latest/download/<asset>,
# so we never have to parse JSON to find the latest tag.
base="${WALNUT_BASE_URL:-https://github.com/$REPO/releases}"
if [ -n "${WALNUT_VERSION:-}" ]; then
  url="$base/download/$WALNUT_VERSION/$asset"
  label="$WALNUT_VERSION"
else
  url="$base/latest/download/$asset"
  label="latest"
fi

step "Installing the Walnut CLI ${dim}($target, $label)${reset}"

# --- download into a scratch dir we always clean up --------------------------
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

info "  downloading $asset"
dlf "$url" "$tmp/$asset" \
  || error "download failed: $url
Either that release/asset doesn't exist yet, or the network call was blocked."

# --- verify the checksum when the release publishes one ----------------------
if dlf "$url.sha256" "$tmp/$asset.sha256" 2>/dev/null; then
  info "  verifying checksum"
  expected=$(awk '{print $1}' "$tmp/$asset.sha256")
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$tmp/$asset" | awk '{print $1}')
  else
    actual=$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')
  fi
  [ "$expected" = "$actual" ] || error "checksum mismatch — refusing to install.
  expected $expected
  got      $actual"
else
  warn "no published checksum for $asset; skipping verification."
fi

# --- unpack and install ------------------------------------------------------
info "  unpacking"
tar -xzf "$tmp/$asset" -C "$tmp"
[ -f "$tmp/walnut" ] || error "archive didn't contain a 'walnut' binary."

mkdir -p "$BIN_DIR"
install -m 755 "$tmp/walnut" "$EXE" 2>/dev/null || { cp "$tmp/walnut" "$EXE" && chmod 755 "$EXE"; }

# Sanity-check the binary actually runs on this machine.
installed_version=$("$EXE" --version 2>/dev/null || true)
[ -n "$installed_version" ] || error "installed binary failed to run ($EXE)."

step "Installed ${bold}walnut $installed_version${reset} → $EXE"

# --- put it on PATH ----------------------------------------------------------
add_path_line() {
  # $1 = rc file, $2 = line to append
  local file="$1" line="$2"
  [ -f "$file" ] || touch "$file"
  if ! grep -qsF "$line" "$file"; then
    printf '\n# walnut\n%s\n' "$line" >>"$file"
    info "  added $BIN_DIR to PATH in ${dim}$file${reset}"
    return 0
  fi
  return 1
}

case ":$PATH:" in
  *":$BIN_DIR:"*)
    : ;; # already on PATH — nothing to do
  *)
    if [ "${WALNUT_NO_MODIFY_PATH:-}" = "1" ]; then
      warn "$BIN_DIR is not on your PATH; add it yourself:"
      info "    export PATH=\"$BIN_DIR:\$PATH\""
    else
      shell_name=$(basename "${SHELL:-}")
      changed=1
      case "$shell_name" in
        zsh)  add_path_line "${ZDOTDIR:-$HOME}/.zshrc" "export PATH=\"$BIN_DIR:\$PATH\"" && changed=0 ;;
        bash)
          # macOS bash reads .bash_profile for login shells; Linux uses .bashrc.
          if [ "$os" = darwin ]; then
            add_path_line "$HOME/.bash_profile" "export PATH=\"$BIN_DIR:\$PATH\"" && changed=0
          else
            add_path_line "$HOME/.bashrc" "export PATH=\"$BIN_DIR:\$PATH\"" && changed=0
          fi ;;
        fish)
          fish_cfg="$HOME/.config/fish/config.fish"
          mkdir -p "$(dirname "$fish_cfg")"
          add_path_line "$fish_cfg" "set -gx PATH \"$BIN_DIR\" \$PATH" && changed=0 ;;
        *)
          warn "couldn't detect your shell; add $BIN_DIR to your PATH manually."
          info "    export PATH=\"$BIN_DIR:\$PATH\"" ;;
      esac
      if [ "$changed" = 0 ]; then
        info ""
        info "  Restart your shell or run ${bold}export PATH=\"$BIN_DIR:\$PATH\"${reset} to use it now."
      fi
    fi ;;
esac

# --- next steps --------------------------------------------------------------
info ""
info "${bold}Walnut is ready.${reset} Next:"
info "  ${dim}# the dashboard mints an agent key — paste it here once${reset}"
info "  walnut login --api-key <key>"
info "  walnut whoami"
info ""
info "Docs: https://walnut.sh  ·  walnut --help"
