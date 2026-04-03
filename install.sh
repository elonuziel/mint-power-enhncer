#!/usr/bin/env bash
# install.sh – Installer for the Mint Power Enhancer Cinnamon applet
# Usage: bash install.sh [--uninstall]

set -euo pipefail

APPLET_UUID="mint-power-enhancer@applet"
APPLET_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/${APPLET_UUID}"
APPLET_DEST="${HOME}/.local/share/cinnamon/applets/${APPLET_UUID}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SCRIPT_SRC="${APP_DIR}/mint-power-enhancer-app.py"
APP_SCRIPT_DEST="${HOME}/.local/bin/mint-power-enhancer-app"
DESKTOP_SRC="${APP_DIR}/mint-power-enhancer.desktop"
DESKTOP_DEST="${HOME}/Desktop/mint-power-enhancer.desktop"
APPLICATIONS_DEST="${HOME}/.local/share/applications/mint-power-enhancer.desktop"

# ── Helpers ───────────────────────────────────────────────────────────────────

ok()   { echo "[  OK  ] $*"; }
info() { echo "[ INFO ] $*"; }
warn() { echo "[ WARN ] $*"; }
err()  { echo "[ ERR  ] $*" >&2; }

# ── Uninstall ─────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--uninstall" ]]; then
    info "Removing applet from ${APPLET_DEST} …"
    rm -rf "${APPLET_DEST}"
    ok "Applet removed."

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

    info "You may also want to run:"
    echo "   gsettings set org.cinnamon next-applet-id 0"
    echo "   (Cinnamon will remove it from the panel on next login)"
    exit 0
fi

# ── Pre-flight checks ─────────────────────────────────────────────────────────

if [[ ! -d "${APPLET_SRC}" ]]; then
    err "Applet source directory not found: ${APPLET_SRC}"
    err "Please run this script from the root of the repository."
    exit 1
fi

# ── Optional dependency: power-profiles-daemon ────────────────────────────────

info "Checking optional dependency: power-profiles-daemon …"
if command -v powerprofilesctl &>/dev/null; then
    ok "powerprofilesctl found – full power-profile support enabled."
else
    warn "powerprofilesctl not found."
    warn "The applet will fall back to writing the CPU scaling governor"
    warn "directly (requires write access to /sys). To install the daemon:"
    echo ""
    echo "   sudo apt install power-profiles-daemon"
    echo ""
fi

# ── Install ───────────────────────────────────────────────────────────────────

info "Installing applet to ${APPLET_DEST} …"
mkdir -p "${APPLET_DEST}"
cp -r "${APPLET_SRC}/." "${APPLET_DEST}/"
ok "Files copied."

# ── Desktop launcher ──────────────────────────────────────────────────────────

info "Installing standalone app executable …"
if [[ -f "${APP_SCRIPT_SRC}" ]]; then
    mkdir -p "$(dirname "${APP_SCRIPT_DEST}")"
    cp "${APP_SCRIPT_SRC}" "${APP_SCRIPT_DEST}"
    chmod +x "${APP_SCRIPT_DEST}"
    ok "Standalone app installed at ${APP_SCRIPT_DEST}."
else
    warn "mint-power-enhancer-app.py not found in repository – skipping standalone app executable."
fi

info "Installing desktop launchers …"

if [[ -f "${DESKTOP_SRC}" ]]; then
    mkdir -p "$(dirname "${APPLICATIONS_DEST}")"

    # Use an absolute Exec path so launch works even if ~/.local/bin is not in GUI PATH.
    sed "s|^Exec=.*|Exec=${APP_SCRIPT_DEST}|" "${DESKTOP_SRC}" > "${APPLICATIONS_DEST}"

    mkdir -p "$(dirname "${DESKTOP_DEST}")"
    sed "s|^Exec=.*|Exec=${APP_SCRIPT_DEST}|" "${DESKTOP_SRC}" > "${DESKTOP_DEST}"
    chmod +x "${DESKTOP_DEST}"

    # Mark as trusted so Cinnamon/Nemo allows double-click execution
    if command -v gio &>/dev/null; then
        gio set "${DESKTOP_DEST}" metadata::trusted true 2>/dev/null || \
            warn "Could not mark desktop launcher as trusted. You may need to right-click it and choose 'Allow Launching'."
    fi
    ok "Desktop launcher created at ${DESKTOP_DEST}."
    ok "Applications launcher created at ${APPLICATIONS_DEST}."
else
    warn "mint-power-enhancer.desktop not found in repository – skipping desktop launcher."
fi

# ── Enable via gsettings ──────────────────────────────────────────────────────

if command -v gsettings &>/dev/null && \
   gsettings list-schemas 2>/dev/null | grep -q "org.cinnamon"; then

    info "Enabling applet in Cinnamon panel …"

    # Read current enabled-applets list
    CURRENT=$(gsettings get org.cinnamon enabled-applets 2>/dev/null || echo "[]")

    # Check if already present
    if echo "${CURRENT}" | grep -q "${APPLET_UUID}"; then
        ok "Applet is already in the enabled list – skipping gsettings update."
    else
        # Append new entry: "panel1:right:0:<uuid>:<instance-id>"
        NEW_ENTRY="'panel1:right:0:${APPLET_UUID}:0'"

        # Strip trailing ] and append
        UPDATED="${CURRENT%]}, ${NEW_ENTRY}]"
        # Handle empty list edge case
        UPDATED="${UPDATED/\[\], /[}"

        gsettings set org.cinnamon enabled-applets "${UPDATED}" && \
            ok "Applet added to the panel (panel1, right side, slot 0)." || \
            warn "Could not update gsettings automatically. See manual steps below."
    fi
else
    warn "gsettings / org.cinnamon schema not available in this session."
fi

# ── Reload Cinnamon ───────────────────────────────────────────────────────────

info "Reloading Cinnamon …"
if pgrep -x cinnamon &>/dev/null; then
    DISPLAY="${DISPLAY:-:0}" cinnamon --replace &>/dev/null &
    sleep 2
    ok "Cinnamon reloaded."
else
    warn "Cinnamon process not detected – skipping auto-reload."
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
ok "Installation complete!"
echo ""
echo "If the applet does not appear on the panel automatically:"
echo "  1. Right-click the Cinnamon panel"
echo "  2. Choose 'Add applets to the panel'"
echo "  3. Search for 'Mint Power Enhancer'"
echo "  4. Click the '+' button to add it"
echo ""
echo "To uninstall later, run:  bash install.sh --uninstall"
