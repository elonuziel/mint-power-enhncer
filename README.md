# Mint Power Enhancer

A [Cinnamon](https://github.com/linuxmint/Cinnamon) panel applet for Linux Mint that gives you fine-grained control over your laptop's power profile directly from the taskbar.

## Features

| Feature | Description |
|---|---|
| **Auto Battery Saver** | Automatically switches to *Battery Saver* mode when charge drops below a configurable percentage |
| **Manual Battery Saver** | One-click toggle in the panel menu to force battery-saver mode on at any time |
| **Performance Mode on AC** | Automatically switches to *Performance* mode whenever the laptop is plugged into AC power |
| **Show Battery % toggle** | Quick on/off switch in the panel menu to show or hide the battery percentage label |
| **Green charging indicator** | Battery icon and percentage label turn green while the battery is charging or fully charged |
| **Instant AC detection** | Reacts within ~100 ms when you plug or unplug the power adapter |
| **Live panel indicator** | Shows current battery percentage and a context-aware icon in the taskbar |
| **Desktop notifications** | Optional pop-up alerts when the power mode changes automatically |
| **Persistent settings** | All settings survive reboots — stored by Cinnamon's built-in settings system |
| **Standalone app** | A dedicated desktop app window is installed so you can manage power modes without opening the panel applet |
| **Desktop launcher** | A `.desktop` shortcut is placed on your Desktop during installation for one-double-click access to the standalone app |

---

## Requirements

| Component | Version / Notes |
|---|---|
| Linux Mint | 20, 21, or 22 (any edition) |
| Cinnamon | 4.0 or later |
| `python3-gi` | Required for the standalone GTK app (`sudo apt install python3-gi gir1.2-gtk-3.0`) |
| `power-profiles-daemon` | *Recommended* — enables clean profile switching without root. Install with `sudo apt install power-profiles-daemon` |

> **Without `power-profiles-daemon`**: the applet falls back to writing the CPU scaling governor directly via `/sys`. This may require write permissions to sysfs and does not control other power consumers (e.g. disk, Wi-Fi). Installing the daemon is strongly recommended.

---

## Step-by-step Installation

### Step 1 — Download the repository

Open a terminal (`Ctrl + Alt + T`) and run:

```bash
# If you have git installed:
git clone https://github.com/elonuziel/mint-power-enhncer.git
cd mint-power-enhncer

# — OR — download a ZIP archive from GitHub and extract it:
# https://github.com/elonuziel/mint-power-enhncer/archive/refs/heads/main.zip
```

### Step 2 — (Recommended) Install power-profiles-daemon

```bash
sudo apt update
sudo apt install power-profiles-daemon
```

Verify it is running:

```bash
systemctl status power-profiles-daemon
# Expected: "active (running)"
```

If the service is not active, start and enable it:

```bash
sudo systemctl enable --now power-profiles-daemon
```

### Step 3 — Run the installer

From inside the cloned repository directory:

```bash
bash install.sh
```

The script will:

1. Copy the applet files to `~/.local/share/cinnamon/applets/mint-power-enhancer@applet/`
2. Install the standalone app executable at `~/.local/bin/mint-power-enhancer-app`
3. Place launchers in:
   - `~/.local/share/applications/mint-power-enhancer.desktop`
   - `~/Desktop/mint-power-enhancer.desktop`
4. Add the applet to your Cinnamon panel via `gsettings`
5. Reload Cinnamon automatically

### Step 4 — Add the applet to the panel (if not added automatically)

If the applet does not appear after running the installer:

1. **Right-click** anywhere on the Cinnamon panel
2. Select **"Add applets to the panel"**
3. In the search box type **`Mint Power Enhancer`**
4. Click the **`+`** (plus) button next to the applet name
5. Click **"Close"** — the battery icon with a percentage label will appear in the panel

### Step 5 — Configure the applet

1. **Click** the battery icon in the panel to open the menu
2. Click **"⚙ Open Settings"** to open the settings dialog, **or**
   right-click the icon and choose **"Configure…"**
3. On the **Battery Saver** tab you can:
   - Enable / disable automatic battery saver
   - Set the battery percentage threshold (default: 20 %)
   - Enable / disable desktop notifications
4. On the **Performance** tab you can:
   - Enable / disable automatic performance mode on AC

All changes take effect immediately and persist across reboots.

---

## Usage

### Standalone app (double-click)

- Double-click **mint-power-enhancer.desktop** on your Desktop, or launch **Mint Power Enhancer** from the app menu.
- The standalone app shows live battery/power status and lets you control:
   - Battery Saver
   - Performance Mode (AC only)
   - Auto Battery Saver
   - Notifications
   - Auto-saver threshold
- It also includes an **Open Cinnamon Applet Settings** button when you need full applet configuration.

### Panel icon

The icon changes to reflect the current state:

| State | Icon |
|---|---|
| On battery, charge > 80 % | Full battery |
| On battery, charge 50–80 % | Good battery |
| On battery, charge 20–50 % | Low battery |
| On battery, charge < 20 % | Caution / battery saver active |
| Charging (AC connected) | Charging variant of the above |
| No battery detected | Missing-battery icon |

The percentage label is shown or hidden based on the **Show Battery %** toggle in the panel menu (default: on).

### Panel menu

Click the icon to open the quick-action menu:

```
Battery: 45% (Discharging)
Power source: on battery
Mode: Balanced
──────────────────────────
[●] Battery Saver
[ ] Performance Mode (AC only)
[●] Show Battery %
──────────────────────────
Auto-saver threshold: 20%
──────────────────────────
⚙  Open Settings
```

- **Battery Saver** toggle — forces battery-saver mode on/off regardless of charge level
- **Performance Mode** toggle — enables performance mode; greyed out when on battery
- **Show Battery %** toggle — instantly shows or hides the percentage label in the panel
- **Open Settings** — opens the full settings dialog

---

## How settings persist between reboots

The applet uses Cinnamon's built-in **AppletSettings API**, which stores all values in:

```
~/.config/cinnamon/spices/mint-power-enhancer@applet/
```

Because Cinnamon applets are loaded automatically at login (they are part of the desktop session), the applet re-applies the correct power profile on every login — no extra `systemd` service or `cron` job is needed.

---

## Uninstall

```bash
bash install.sh --uninstall
```

Then remove it from the panel:

1. Right-click the panel → **"Add applets to the panel"**
2. Select **"Mint Power Enhancer"** in the *Installed* list
3. Click the **`-`** (minus) button

---

## Troubleshooting

### The applet panel label shows `⚡` instead of a percentage

Your system's battery is not detected at the expected sysfs path. Check:

```bash
ls /sys/class/power_supply/
```

You should see at least one entry of type `Battery` (e.g. `BAT0`, `BAT1`).

### Battery saver / performance mode doesn't seem to change anything

Check whether `power-profiles-daemon` is installed and running:

```bash
systemctl status power-profiles-daemon
powerprofilesctl   # should list available profiles
```

If neither is available, the applet writes to the CPU scaling governor. Verify the current governor:

```bash
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
```

### The applet is not visible in "Add applets to the panel"

Make sure the files were copied correctly:

```bash
ls ~/.local/share/cinnamon/applets/mint-power-enhancer@applet/
# Expected: applet.js  metadata.json  settings-schema.json  stylesheet.css
```

If missing, re-run `bash install.sh` from the repository root.

---

## License

MIT — see [LICENSE](LICENSE) for details.
