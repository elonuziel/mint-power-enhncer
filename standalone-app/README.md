# Standalone Mint Power Enhancer App

This folder contains the double-clickable GTK desktop app version of Mint Power Enhancer.

## What it does
- Shows live battery and AC status
- Lets you toggle Battery Saver and Performance Mode
- Persists settings in `~/.config/mint-power-enhancer/app-config.json`
- Refreshes quickly when AC power changes

## Requirements
See [DEPENDENCIES.md](DEPENDENCIES.md).

## Run locally
From the repository root:

```bash
python3 standalone-app/mint-power-enhancer-app.py
```

## Install
From inside this folder:

```bash
bash install.sh
```

That installs the executable to `~/.local/bin/mint-power-enhancer-app` and places launchers on your Desktop and in the applications menu.

To remove only the standalone app later:

```bash
bash install.sh --uninstall
```
