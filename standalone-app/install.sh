#!/usr/bin/env bash
# install.sh – Installer for the standalone Mint Power Enhancer app
# Usage: bash standalone-app/install.sh [--uninstall]

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SCRIPT_SRC="${APP_DIR}/mint-power-enhancer-app.py"
DESKTOP_SRC="${APP_DIR}/mint-power-enhancer.desktop"

APP_SCRIPT_DEST="${HOME}/.local/bin/mint-power-enhancer-app"
DESKTOP_DEST="${HOME}/Desktop/mint-power-enhancer.desktop"
APPLICATIONS_DEST="${HOME}/.local/share/applications/mint-power-enhancer.desktop"

# ── Helpers ───────────────────────────────────────────────────────────────────

ok()   { echo "[  OK  ] $*"; }
info() { echo "[ INFO ] $*"; }
warn() { echo "[ WARN ] $*"; }
err()  { echo "[ ERR  ] $*" >&2; }

# ── Uninstall ─────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--uninstall" ]]; then
    if [[ -f "${DESKTOP_DEST}" ]]; then
        rm -f "${DESKTOP_DEST}"
        ok "Desktop launcher removed."
    fi

    if [[ -f "${APPLICATIONS_DEST}" ]]; then
        rm -f "${APPLICATIONS_DEST}"
        ok "Applications launcher removed."
    fi

    if [[ -f "${APP_SCRIPT_DEST}" ]]; then
        rm -f "${APP_SCRIPT_DEST}"
        ok "Standalone app executable removed."
    fi

    echo ""
    ok "Standalone app uninstalled."
    exit 0
fi

# ── Pre-flight checks ─────────────────────────────────────────────────────────

if [[ ! -f "${APP_SCRIPT_SRC}" ]]; then
    err "Standalone app source file not found: ${APP_SCRIPT_SRC}"
    err "Please run this script from inside the standalone-app folder."
    exit 1
fi

if [[ ! -f "${DESKTOP_SRC}" ]]; then
    err "Desktop launcher source file not found: ${DESKTOP_SRC}"
    exit 1
fi

info "Checking required Python GTK dependency: python3-gi …"
if ! python3 - <<'PY' >/dev/null 2>&1; then
import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk  # noqa: F401
PY
    warn "python3-gi / GTK 3 is missing. Install it with: sudo apt install python3-gi gir1.2-gtk-3.0"
fi

if ! command -v powerprofilesctl &>/dev/null; then
    warn "powerprofilesctl not found. The app will fall back to writing the CPU scaling governor."
fi

# ── Install ───────────────────────────────────────────────────────────────────

info "Installing standalone app executable …"
mkdir -p "$(dirname "${APP_SCRIPT_DEST}")"
cp "${APP_SCRIPT_SRC}" "${APP_SCRIPT_DEST}"
chmod +x "${APP_SCRIPT_DEST}"
ok "Standalone app installed at ${APP_SCRIPT_DEST}."

info "Installing desktop launchers …"
mkdir -p "$(dirname "${APPLICATIONS_DEST}")"

# Use an absolute Exec path so launch works even if ~/.local/bin is not in GUI PATH.
sed "s|^Exec=.*|Exec=${APP_SCRIPT_DEST}|" "${DESKTOP_SRC}" > "${APPLICATIONS_DEST}"

mkdir -p "$(dirname "${DESKTOP_DEST}")"
sed "s|^Exec=.*|Exec=${APP_SCRIPT_DEST}|" "${DESKTOP_SRC}" > "${DESKTOP_DEST}"
chmod +x "${DESKTOP_DEST}"

if command -v gio &>/dev/null; then
    gio set "${DESKTOP_DEST}" metadata::trusted true 2>/dev/null || \
        warn "Could not mark desktop launcher as trusted. You may need to right-click it and choose 'Allow Launching'."
fi

ok "Desktop launcher created at ${DESKTOP_DEST}."
ok "Applications launcher created at ${APPLICATIONS_DEST}."

echo ""
ok "Standalone app installation complete!"
echo ""
echo "You can now double-click:"
echo "  - ${DESKTOP_DEST}"
echo ""
echo "Or open Mint Power Enhancer from the applications menu."
echo ""
echo "To uninstall later, run:  bash standalone-app/install.sh --uninstall"