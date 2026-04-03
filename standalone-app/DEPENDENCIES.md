# Standalone App Dependencies

This folder contains the standalone GTK app.

## Required
- `python3`
- `python3-gi`
- `gir1.2-gtk-3.0`

## Recommended
- `power-profiles-daemon` for reliable power profile switching
- `libnotify-bin` for desktop notifications via `notify-send`

## Notes
- The app falls back to writing CPU governor values under `/sys` if `powerprofilesctl` is unavailable.
- The desktop launcher is intended to point at the installed executable in `~/.local/bin/mint-power-enhancer-app`.
