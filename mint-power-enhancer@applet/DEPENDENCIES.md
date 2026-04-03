# Cinnamon Applet Dependencies

This folder contains the Cinnamon panel applet.

## Required
- Cinnamon desktop environment
- Cinnamon applet runtime support

## Recommended
- `power-profiles-daemon` for reliable profile switching

## Notes
- The applet uses Cinnamon's built-in settings API for persistence.
- It can fall back to direct sysfs governor writes when `powerprofilesctl` is unavailable.
