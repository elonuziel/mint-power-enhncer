/**
 * Mint Power Enhancer Applet
 *
 * Features:
 *  - Reads battery level and AC status from /sys/class/power_supply/
 *  - Automatically activates battery-saver mode when charge drops below a
 *    user-configurable percentage threshold
 *  - Manual battery-saver toggle
 *  - Performance mode toggle that activates when AC power is connected
 *  - All settings are persisted by Cinnamon's Settings API (survive reboots)
 *  - Power profiles are applied via power-profiles-daemon (powerprofilesctl)
 *    with a fallback to writing the CPU scaling governor directly
 *
 * Requires: Cinnamon desktop (Linux Mint 20+)
 * Optional: power-profiles-daemon package for best results
 */

const Applet = imports.ui.applet;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Main = imports.ui.main;
const Util = imports.misc.util;

const UUID = "mint-power-enhancer@applet";

// How often (in seconds) the applet re-checks battery state
const CHECK_INTERVAL = 10;

// Debounce rapid file-change events from power-supply sysfs files
const FAST_REFRESH_DELAY_MS = 250;

// ── Sysfs helpers ────────────────────────────────────────────────────────────

/**
 * Read a single-line text file from /sys.
 * Returns the trimmed string content, or null on error.
 */
function readSysfs(path) {
    try {
        let file = Gio.File.new_for_path(path);
        let [, contents] = file.load_contents(null);
        return _toString(contents).trim();
    } catch (_e) {
        return null;
    }
}

/** Convert a GLib byte-array / Uint8Array / string to a plain JS string. */
function _toString(data) {
    if (typeof data === "string") return data;
    if (typeof imports.byteArray !== "undefined") {
        return imports.byteArray.toString(data);
    }
    return String.fromCharCode.apply(null, data);
}

/**
 * Walk /sys/class/power_supply/ and return the first entry whose `type` file
 * matches the requested power-supply type string ("Battery" or "Mains").
 */
function findPowerSupplyPath(type) {
    const base = "/sys/class/power_supply/";
    try {
        let dir = Gio.File.new_for_path(base);
        let iter = dir.enumerate_children(
            "standard::name", Gio.FileQueryInfoFlags.NONE, null
        );
        let info;
        while ((info = iter.next_file(null)) !== null) {
            let name = info.get_name();
            let psType = readSysfs(base + name + "/type");
            if (psType === type) return base + name + "/";
        }
    } catch (_e) {}
    return null;
}

// ── Power-profile backend ────────────────────────────────────────────────────

/**
 * Try to apply a power profile using power-profiles-daemon (powerprofilesctl).
 * Falls back to writing the CPU scaling governor directly.
 *
 * @param {string} profile  "balanced" | "power-saver" | "performance"
 * @returns {boolean} true if the change was applied
 */
function applyProfile(profile) {
    // First choice: power-profiles-daemon
    if (GLib.find_program_in_path("powerprofilesctl")) {
        try {
            let [ok, , , status] = GLib.spawn_command_line_sync(
                "powerprofilesctl set " + profile
            );
            if (ok && status === 0) return true;
        } catch (_e) {}
    }

    // Fallback: write CPU scaling governor via sysfs
    let governor;
    if (profile === "power-saver") governor = "powersave";
    else if (profile === "performance") governor = "performance";
    else governor = "schedutil";  // "balanced" / default

    _writeCpuGovernor(governor);
    return true;
}

function _writeCpuGovernor(governor) {
    try {
        let cpuDir = Gio.File.new_for_path("/sys/devices/system/cpu/");
        let iter = cpuDir.enumerate_children(
            "standard::name", Gio.FileQueryInfoFlags.NONE, null
        );
        let info;
        while ((info = iter.next_file(null)) !== null) {
            let name = info.get_name();
            if (!/^cpu\d+$/.test(name)) continue;
            let govPath =
                "/sys/devices/system/cpu/" + name + "/cpufreq/scaling_governor";
            try {
                let f = Gio.File.new_for_path(govPath);
                if (!f.query_exists(null)) continue;
                let [, stream] = f.replace_async
                    ? [null, f.replace(null, false, Gio.FileCreateFlags.NONE, null)]
                    : [null, f.replace(null, false, Gio.FileCreateFlags.NONE, null)];
                let bytes = _toBytes(governor + "\n");
                stream.write_bytes(new GLib.Bytes(bytes), null);
                stream.close(null);
            } catch (_e) {}
        }
    } catch (_e) {}
}

function _toBytes(str) {
    if (typeof imports.byteArray !== "undefined") {
        return imports.byteArray.fromString(str);
    }
    let arr = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
    return arr;
}

// ── Applet class ─────────────────────────────────────────────────────────────

class MintPowerEnhancerApplet extends Applet.TextIconApplet {

    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.metadata = metadata;
        this.instanceId = instanceId;
        this.orientation = orientation;

        // Runtime state
        this._batteryLevel = -1;
        this._batteryState = "Unknown";
        this._onAC = false;
        this._currentProfile = "balanced";
        this._autoSaverActive = false;
        this._timerId = null;
        this._pendingRefreshId = null;
        this._fileMonitors = [];

        // Discover power-supply sysfs paths once at startup
        this._batteryPath = findPowerSupplyPath("Battery");
        this._acPath = findPowerSupplyPath("Mains");

        // Set initial panel appearance
        this.set_applet_icon_symbolic_name("battery");
        this.set_applet_label("");
        this.set_applet_tooltip("Mint Power Enhancer – loading…");

        // Bind settings (values are automatically persisted by Cinnamon)
        this._settings = new Settings.AppletSettings(this, UUID, instanceId);
        this._bindSettings();

        // Build popup menu
        this._buildMenu();

        // React quickly to AC/battery status file changes
        this._setupPowerFileMonitors();

        // First status check, then start repeating timer
        this._tick();
        this._timerId = Mainloop.timeout_add_seconds(CHECK_INTERVAL, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // ── Settings ──────────────────────────────────────────────────────────

    _bindSettings() {
        const BD = Settings.BindingDirection.BIDIRECTIONAL;

        this._settings.bindProperty(BD,
            "auto-battery-saver-enabled", "autoBatterySaverEnabled",
            this._onSettingChanged.bind(this), null);

        this._settings.bindProperty(BD,
            "battery-saver-threshold", "batterySaverThreshold",
            this._onSettingChanged.bind(this), null);

        this._settings.bindProperty(BD,
            "show-notifications", "showNotifications",
            null, null);

        this._settings.bindProperty(BD,
            "manual-battery-saver", "manualBatterySaver",
            this._onSettingChanged.bind(this), null);

        this._settings.bindProperty(BD,
            "performance-mode-on-ac", "performanceModeOnAc",
            this._onSettingChanged.bind(this), null);

        this._settings.bindProperty(BD,
            "show-battery-percentage", "showBatteryPercentage",
            this._onSettingChanged.bind(this), null);
    }

    _onSettingChanged() {
        this._applyPolicy();
        this._refreshMenu();
    }

    // ── Menu ──────────────────────────────────────────────────────────────

    _buildMenu() {
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, this.orientation);
        this.menuManager.addMenu(this.menu);

        // --- Status items (read-only) ---
        this._itemBattery = new PopupMenu.PopupMenuItem("Battery: --",
            { reactive: false });
        this.menu.addMenuItem(this._itemBattery);

        this._itemPowerSource = new PopupMenu.PopupMenuItem("Power source: --",
            { reactive: false });
        this.menu.addMenuItem(this._itemPowerSource);

        this._itemMode = new PopupMenu.PopupMenuItem("Mode: Balanced",
            { reactive: false });
        this.menu.addMenuItem(this._itemMode);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Battery saver toggle ---
        this._toggleBatterySaver = new PopupMenu.PopupSwitchMenuItem(
            "Battery Saver", false);
        this._toggleBatterySaver.connect("toggled", (_item, state) => {
            // Persist the manual setting
            this.manualBatterySaver = state;
            this._settings.setValue("manual-battery-saver", state);
            this._applyPolicy();
            this._refreshMenu();
        });
        this.menu.addMenuItem(this._toggleBatterySaver);

        // --- Performance mode toggle ---
        this._togglePerformance = new PopupMenu.PopupSwitchMenuItem(
            "Performance Mode (AC only)", false);
        this._togglePerformance.connect("toggled", (_item, state) => {
            if (state && !this._onAC) {
                // Revert – performance mode only makes sense on AC
                Main.notify("Mint Power Enhancer",
                    "Performance mode is only available when connected to AC power.");
                this._togglePerformance.setToggleState(false);
                return;
            }
            this.performanceModeOnAc = state;
            this._settings.setValue("performance-mode-on-ac", state);
            this._applyPolicy();
            this._refreshMenu();
        });
        this.menu.addMenuItem(this._togglePerformance);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Threshold info ---
        this._itemThreshold = new PopupMenu.PopupMenuItem(
            "Auto-saver threshold: --", { reactive: false });
        this.menu.addMenuItem(this._itemThreshold);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Open settings ---
        let openSettings = new PopupMenu.PopupMenuItem("⚙  Open Settings");
        openSettings.connect("activate", () => {
            try {
                if (GLib.find_program_in_path("xlet-settings")) {
                    Util.spawnCommandLine(
                        "xlet-settings applet " + UUID + " -i " + this.instanceId
                    );
                } else {
                    Util.spawnCommandLine("cinnamon-settings applets");
                }
            } catch (_e) {
                Main.notify("Mint Power Enhancer",
                    "Could not open applet settings.");
            }
        });
        this.menu.addMenuItem(openSettings);
    }

    _refreshMenu() {
        if (!this._itemBattery) return;

        let batteryText = this._batteryLevel >= 0
            ? "Battery: " + this._batteryLevel + "% (" + this._batteryState + ")"
            : "Battery: not detected";
        this._itemBattery.label.text = batteryText;

        this._itemPowerSource.label.text = this._onAC
            ? "Power source: AC connected"
            : "Power source: on battery";

        let modeLabel = _profileLabel(this._currentProfile);
        this._itemMode.label.text = "Mode: " + modeLabel;

        this._itemThreshold.label.text =
            "Auto-saver threshold: " + this.batterySaverThreshold + "%";

        // Reflect the effective battery-saver state (manual OR auto)
        let saverOn = !!(this.manualBatterySaver || this._autoSaverActive);
        this._toggleBatterySaver.setToggleState(saverOn);

        // Reflect performance toggle
        this._togglePerformance.setToggleState(
            !!(this.performanceModeOnAc && this._onAC));

        // Grey out performance toggle when not on AC
        this._togglePerformance.actor.reactive = this._onAC;
        this._togglePerformance.actor.opacity = this._onAC ? 255 : 128;
    }

    // ── Core polling loop ─────────────────────────────────────────────────

    _tick() {
        this._batteryLevel = this._readBatteryLevel();
        this._batteryState = this._batteryStatus();
        this._onAC = this._readOnAC(this._batteryState);

        this._applyPolicy();
        this._updatePanel();
        this._refreshMenu();
    }

    // ── Policy logic ──────────────────────────────────────────────────────

    /**
     * Determine the correct power profile and apply it if it has changed.
     *
     * Priority (highest first):
     *   1. Battery saver (manual override or auto-threshold)
     *   2. Performance mode (only when on AC)
     *   3. Balanced (default)
     */
    _applyPolicy() {
        let wantSaver = !!this.manualBatterySaver;

        // Auto battery saver: only when on battery and enabled
        if (this.autoBatterySaverEnabled && !this._onAC &&
                this._batteryLevel >= 0 &&
                this._batteryLevel <= this.batterySaverThreshold) {

            wantSaver = true;

            if (!this._autoSaverActive) {
                this._autoSaverActive = true;
                if (this.showNotifications) {
                    Main.notify("Mint Power Enhancer",
                        "Battery at " + this._batteryLevel +
                        "% — battery saver activated.");
                }
            }
        } else {
            // Battery is above threshold or we are on AC — clear auto-saver flag
            if (this._autoSaverActive && !this.manualBatterySaver) {
                this._autoSaverActive = false;
                if (this.showNotifications && this._onAC) {
                    Main.notify("Mint Power Enhancer",
                        "AC power connected — switching to balanced mode.");
                }
            }
        }

        let wantPerformance = !!(this.performanceModeOnAc && this._onAC && !wantSaver);

        let target;
        if (wantSaver)            target = "power-saver";
        else if (wantPerformance) target = "performance";
        else                      target = "balanced";

        if (target !== this._currentProfile) {
            applyProfile(target);
            this._currentProfile = target;
        }
    }

    // ── Panel display ─────────────────────────────────────────────────────

    _updatePanel() {
        if (this._batteryLevel < 0) {
            this.set_applet_icon_symbolic_name("battery-missing-symbolic");
            this.set_applet_label("⚡");
            this.set_applet_tooltip("Mint Power Enhancer – no battery detected");
            this.actor.remove_style_class_name("mpe-charging");
            return;
        }

        let pct = this._batteryLevel;

        // Choose icon
        let icon;
        if (this._onAC) {
            if (pct >= 100)       icon = "battery-full-charged";
            else if (pct >= 80)   icon = "battery-full-charging";
            else if (pct >= 50)   icon = "battery-good-charging";
            else if (pct >= 20)   icon = "battery-low-charging";
            else                  icon = "battery-caution-charging";
        } else {
            if (pct >= 80)        icon = "battery-full";
            else if (pct >= 50)   icon = "battery-good";
            else if (pct >= 20)   icon = "battery-low";
            else if (pct >= 5)    icon = "battery-caution";
            else                  icon = "battery-empty";
        }

        try {
            this.set_applet_icon_symbolic_name(icon);
        } catch (_e) {
            this.set_applet_icon_symbolic_name("battery");
        }

        this.set_applet_label(this.showBatteryPercentage ? (pct + "%") : "");

        if (this._batteryState === "Charging") {
            this.actor.add_style_class_name("mpe-charging");
        } else {
            this.actor.remove_style_class_name("mpe-charging");
        }

        let acStr   = this._onAC ? "AC" : "battery";
        let modeStr = _profileLabel(this._currentProfile);
        this.set_applet_tooltip(
            "Battery: " + pct + "% | " + acStr + " | " + modeStr);
    }

    // ── Sysfs readers ─────────────────────────────────────────────────────

    _readBatteryLevel() {
        if (!this._batteryPath) return -1;
        let v = readSysfs(this._batteryPath + "capacity");
        return v !== null ? parseInt(v, 10) : -1;
    }

    _batteryStatus() {
        if (!this._batteryPath) return "Unknown";
        return readSysfs(this._batteryPath + "status") || "Unknown";
    }

    _readOnAC(status) {
        // Primary: check AC adapter's `online` file
        if (this._acPath) {
            let online = readSysfs(this._acPath + "online");
            if (online !== null) return online === "1";
        }
        // Fallback: battery status tells us if it's charging
        return status === "Charging" || status === "Full";
    }

    _setupPowerFileMonitors() {
        let paths = [];

        if (this._acPath) {
            paths.push(this._acPath + "online");
        }
        if (this._batteryPath) {
            paths.push(this._batteryPath + "capacity");
            paths.push(this._batteryPath + "status");
        }

        for (let path of paths) {
            try {
                let file = Gio.File.new_for_path(path);
                if (!file.query_exists(null)) continue;

                let monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
                monitor.set_rate_limit(500);
                monitor.connect("changed", () => {
                    this._scheduleFastRefresh();
                });
                this._fileMonitors.push(monitor);
            } catch (_e) {}
        }
    }

    _scheduleFastRefresh() {
        if (this._pendingRefreshId !== null) return;

        this._pendingRefreshId = Mainloop.timeout_add(FAST_REFRESH_DELAY_MS, () => {
            this._pendingRefreshId = null;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ── Applet lifecycle ──────────────────────────────────────────────────

    on_applet_clicked(_event) {
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
        if (this._timerId !== null) {
            Mainloop.source_remove(this._timerId);
            this._timerId = null;
        }

        if (this._pendingRefreshId !== null) {
            Mainloop.source_remove(this._pendingRefreshId);
            this._pendingRefreshId = null;
        }

        for (let monitor of this._fileMonitors) {
            try {
                monitor.cancel();
            } catch (_e) {}
        }
        this._fileMonitors = [];

        this._settings.finalize();
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _profileLabel(profile) {
    switch (profile) {
        case "power-saver":   return "Battery Saver";
        case "performance":   return "Performance";
        default:              return "Balanced";
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

function main(metadata, orientation, panelHeight, instanceId) {
    return new MintPowerEnhancerApplet(metadata, orientation, panelHeight, instanceId);
}
