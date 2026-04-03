#!/usr/bin/env python3
"""Standalone Mint Power Enhancer app.

A lightweight GTK window that provides power profile controls and live battery
status without requiring interaction with the Cinnamon panel applet.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

try:
    import gi
    gi.require_version("Gtk", "3.0")
    from gi.repository import Gio, GLib, Gtk  # type: ignore
except Exception as exc:  # pragma: no cover
    print("This app requires python3-gi and GTK 3.")
    print(f"Import error: {exc}")
    sys.exit(1)

APP_NAME = "Mint Power Enhancer"
CONFIG_DIR = Path.home() / ".config" / "mint-power-enhancer"
CONFIG_PATH = CONFIG_DIR / "app-config.json"
CHECK_INTERVAL_SECONDS = 5
FAST_REFRESH_DELAY_MS = 250

DEFAULT_CONFIG = {
    "auto_battery_saver_enabled": True,
    "battery_saver_threshold": 20,
    "show_notifications": True,
    "manual_battery_saver": False,
    "performance_mode_on_ac": False,
}


def read_sysfs(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return None


def find_power_supply_path(power_type: str):
    base = "/sys/class/power_supply"
    try:
        for name in os.listdir(base):
            candidate = os.path.join(base, name)
            type_path = os.path.join(candidate, "type")
            if read_sysfs(type_path) == power_type:
                return candidate
    except Exception:
        return None
    return None


def apply_profile(profile: str):
    if shutil_which("powerprofilesctl"):
        result = subprocess.run(
            ["powerprofilesctl", "set", profile],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if result.returncode == 0:
            return True

    governor = "schedutil"
    if profile == "power-saver":
        governor = "powersave"
    elif profile == "performance":
        governor = "performance"

    cpu_root = Path("/sys/devices/system/cpu")
    wrote_any = False
    for cpu in cpu_root.glob("cpu[0-9]*"):
        gov_path = cpu / "cpufreq" / "scaling_governor"
        if not gov_path.exists():
            continue
        try:
            gov_path.write_text(governor + "\n", encoding="utf-8")
            wrote_any = True
        except Exception:
            pass

    return wrote_any


def shutil_which(name: str):
    result = subprocess.run(["which", name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return result.returncode == 0


def profile_label(profile: str):
    if profile == "power-saver":
        return "Battery Saver"
    if profile == "performance":
        return "Performance"
    return "Balanced"


class MintPowerEnhancerApp(Gtk.Window):
    def __init__(self):
        super().__init__(title=APP_NAME)
        self.set_border_width(14)
        self.set_default_size(420, 360)

        self._battery_path = find_power_supply_path("Battery")
        self._ac_path = find_power_supply_path("Mains")

        self._battery_level = -1
        self._battery_state = "Unknown"
        self._on_ac = False
        self._current_profile = "balanced"
        self._auto_saver_active = False
        self._pending_refresh_id = 0
        self._monitors = []

        self.config = self._load_config()

        self._build_ui()
        self._bind_events()
        self._setup_file_monitors()

        self._tick()
        GLib.timeout_add_seconds(CHECK_INTERVAL_SECONDS, self._on_interval)

    def _load_config(self):
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        if not CONFIG_PATH.exists():
            self._save_config(DEFAULT_CONFIG.copy())
            return DEFAULT_CONFIG.copy()

        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            merged = DEFAULT_CONFIG.copy()
            merged.update(data)
            return merged
        except Exception:
            return DEFAULT_CONFIG.copy()

    def _save_config(self, data=None):
        if data is None:
            data = self.config
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def _build_ui(self):
        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        self.add(root)

        title = Gtk.Label()
        title.set_markup("<b>Mint Power Enhancer</b>")
        title.set_xalign(0)
        root.pack_start(title, False, False, 0)

        self.status_label = Gtk.Label(label="Battery: --")
        self.status_label.set_xalign(0)
        root.pack_start(self.status_label, False, False, 0)

        self.power_label = Gtk.Label(label="Power source: --")
        self.power_label.set_xalign(0)
        root.pack_start(self.power_label, False, False, 0)

        self.mode_label = Gtk.Label(label="Mode: Balanced")
        self.mode_label.set_xalign(0)
        root.pack_start(self.mode_label, False, False, 0)

        root.pack_start(Gtk.Separator(orientation=Gtk.Orientation.HORIZONTAL), False, False, 4)

        self.switch_manual = Gtk.Switch(active=bool(self.config["manual_battery_saver"]))
        root.pack_start(self._row_with_switch("Battery Saver", self.switch_manual), False, False, 0)

        self.switch_perf = Gtk.Switch(active=bool(self.config["performance_mode_on_ac"]))
        root.pack_start(self._row_with_switch("Performance Mode (AC only)", self.switch_perf), False, False, 0)

        self.switch_auto = Gtk.Switch(active=bool(self.config["auto_battery_saver_enabled"]))
        root.pack_start(self._row_with_switch("Auto Battery Saver", self.switch_auto), False, False, 0)

        self.switch_notify = Gtk.Switch(active=bool(self.config["show_notifications"]))
        root.pack_start(self._row_with_switch("Show Notifications", self.switch_notify), False, False, 0)

        threshold_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        threshold_label = Gtk.Label(label="Auto-saver threshold (%)")
        threshold_label.set_xalign(0)
        self.threshold_spin = Gtk.SpinButton.new_with_range(5, 95, 5)
        self.threshold_spin.set_value(float(self.config["battery_saver_threshold"]))
        threshold_row.pack_start(threshold_label, True, True, 0)
        threshold_row.pack_end(self.threshold_spin, False, False, 0)
        root.pack_start(threshold_row, False, False, 0)

        root.pack_start(Gtk.Separator(orientation=Gtk.Orientation.HORIZONTAL), False, False, 4)

        actions = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)

        apply_btn = Gtk.Button(label="Apply Now")
        apply_btn.connect("clicked", self._on_apply_now)
        actions.pack_start(apply_btn, False, False, 0)

        settings_btn = Gtk.Button(label="Open Cinnamon Applet Settings")
        settings_btn.connect("clicked", self._open_cinnamon_settings)
        actions.pack_start(settings_btn, False, False, 0)

        close_btn = Gtk.Button(label="Close")
        close_btn.connect("clicked", lambda *_: self.close())
        actions.pack_end(close_btn, False, False, 0)

        root.pack_end(actions, False, False, 0)

    def _row_with_switch(self, text, switch):
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        label = Gtk.Label(label=text)
        label.set_xalign(0)
        row.pack_start(label, True, True, 0)
        row.pack_end(switch, False, False, 0)
        return row

    def _bind_events(self):
        self.connect("destroy", self._on_destroy)

        self.switch_manual.connect("notify::active", self._on_controls_changed)
        self.switch_perf.connect("notify::active", self._on_controls_changed)
        self.switch_auto.connect("notify::active", self._on_controls_changed)
        self.switch_notify.connect("notify::active", self._on_controls_changed)
        self.threshold_spin.connect("value-changed", self._on_controls_changed)

    def _setup_file_monitors(self):
        paths = []
        if self._ac_path:
            paths.append(os.path.join(self._ac_path, "online"))
        if self._battery_path:
            paths.append(os.path.join(self._battery_path, "capacity"))
            paths.append(os.path.join(self._battery_path, "status"))

        for path in paths:
            try:
                f = Gio.File.new_for_path(path)
                if not f.query_exists(None):
                    continue
                monitor = f.monitor_file(Gio.FileMonitorFlags.NONE, None)
                monitor.set_rate_limit(500)
                monitor.connect("changed", lambda *_: self._schedule_refresh())
                self._monitors.append(monitor)
            except Exception:
                pass

    def _schedule_refresh(self):
        if self._pending_refresh_id:
            return

        def _refresh():
            self._pending_refresh_id = 0
            self._tick()
            return GLib.SOURCE_REMOVE

        self._pending_refresh_id = GLib.timeout_add(FAST_REFRESH_DELAY_MS, _refresh)

    def _notify(self, message):
        if not self.config["show_notifications"]:
            return

        if shutil_which("notify-send"):
            subprocess.run(
                ["notify-send", APP_NAME, message],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

    def _on_controls_changed(self, *_args):
        self.config["manual_battery_saver"] = bool(self.switch_manual.get_active())
        self.config["performance_mode_on_ac"] = bool(self.switch_perf.get_active())
        self.config["auto_battery_saver_enabled"] = bool(self.switch_auto.get_active())
        self.config["show_notifications"] = bool(self.switch_notify.get_active())
        self.config["battery_saver_threshold"] = int(self.threshold_spin.get_value())
        self._save_config()
        self._apply_policy(force_apply=True)
        self._refresh_labels()

    def _read_battery_level(self):
        if not self._battery_path:
            return -1
        v = read_sysfs(os.path.join(self._battery_path, "capacity"))
        try:
            return int(v) if v is not None else -1
        except Exception:
            return -1

    def _battery_status(self):
        if not self._battery_path:
            return "Unknown"
        return read_sysfs(os.path.join(self._battery_path, "status")) or "Unknown"

    def _read_on_ac(self, status):
        if self._ac_path:
            online = read_sysfs(os.path.join(self._ac_path, "online"))
            if online is not None:
                return online == "1"
        return status in ("Charging", "Full")

    def _apply_policy(self, force_apply=False):
        want_saver = bool(self.config["manual_battery_saver"])

        if (
            self.config["auto_battery_saver_enabled"]
            and not self._on_ac
            and self._battery_level >= 0
            and self._battery_level <= int(self.config["battery_saver_threshold"])
        ):
            want_saver = True
            if not self._auto_saver_active:
                self._auto_saver_active = True
                self._notify(f"Battery at {self._battery_level}% - battery saver activated.")
        else:
            if self._auto_saver_active and not self.config["manual_battery_saver"]:
                self._auto_saver_active = False
                if self._on_ac:
                    self._notify("AC power connected - switching to balanced mode.")

        want_perf = bool(self.config["performance_mode_on_ac"] and self._on_ac and not want_saver)

        target = "balanced"
        if want_saver:
            target = "power-saver"
        elif want_perf:
            target = "performance"

        if force_apply or target != self._current_profile:
            apply_profile(target)
            self._current_profile = target

        self.switch_perf.set_sensitive(self._on_ac)

    def _refresh_labels(self):
        if self._battery_level < 0:
            self.status_label.set_text("Battery: not detected")
        else:
            self.status_label.set_text(f"Battery: {self._battery_level}% ({self._battery_state})")

        self.power_label.set_text("Power source: AC connected" if self._on_ac else "Power source: on battery")
        self.mode_label.set_text(f"Mode: {profile_label(self._current_profile)}")

    def _tick(self):
        self._battery_level = self._read_battery_level()
        self._battery_state = self._battery_status()
        self._on_ac = self._read_on_ac(self._battery_state)
        self._apply_policy(force_apply=False)
        self._refresh_labels()

    def _on_interval(self):
        self._tick()
        return True

    def _on_apply_now(self, *_args):
        self._tick()

    def _open_cinnamon_settings(self, *_args):
        cmd = ["xlet-settings", "applet", "mint-power-enhancer@applet", "-i", "0"]
        fallback = ["cinnamon-settings", "applets"]

        run = cmd if shutil_which("xlet-settings") else fallback
        subprocess.Popen(run, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _on_destroy(self, *_args):
        if self._pending_refresh_id:
            GLib.source_remove(self._pending_refresh_id)
            self._pending_refresh_id = 0

        for monitor in self._monitors:
            try:
                monitor.cancel()
            except Exception:
                pass
        self._monitors = []
        Gtk.main_quit()


def main():
    win = MintPowerEnhancerApp()
    win.connect("delete-event", Gtk.main_quit)
    win.show_all()
    Gtk.main()


if __name__ == "__main__":
    main()
