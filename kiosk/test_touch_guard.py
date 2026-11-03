import importlib.machinery
import importlib.util
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path

loader = importlib.machinery.SourceFileLoader("touch_guard", str(Path(__file__).with_name("touch-guard")))
spec = importlib.util.spec_from_loader("touch_guard", loader)
assert spec is not None
guard_module = importlib.util.module_from_spec(spec)
loader.exec_module(guard_module)

VID, PID = "27c6", "0529"


def fake_panel(root, touch_driver: "str | None" = "hid-multitouch"):
    """A sysfs and /dev tree shaped like the reference Pi: interfaces 0 (multitouch), 1, 2 (mouse mode)."""
    sys_root, dev_root = Path(root, "sys"), Path(root, "dev")
    devices, drivers = sys_root / "bus/hid/devices", sys_root / "bus/hid/drivers"
    devices.mkdir(parents=True)
    dev_root.mkdir()
    for name in ("hid-multitouch", "hid-generic"):
        (drivers / name).mkdir(parents=True)
        (drivers / name / "bind").write_text("")
        (drivers / name / "unbind").write_text("")
    for number, interface, hidraw, driver in ((5, 0, "hidraw0", touch_driver), (6, 1, "hidraw4", "hid-generic"), (7, 2, "hidraw6", "hid-generic")):
        hid_id = f"0003:{VID.upper()}:{PID.upper()}.{number:04X}"
        usb_interface = sys_root / f"devices/usb1/1-2:1.{interface}"
        real = usb_interface / hid_id
        (real / "hidraw" / hidraw).mkdir(parents=True)
        (usb_interface / "bInterfaceNumber").write_text(f"{interface:02x}\n")
        if driver:
            (real / "driver").symlink_to(drivers / driver)
        (devices / hid_id).symlink_to(real)
        os.mkfifo(dev_root / hidraw)
    return sys_root, dev_root


class GuardTest(unittest.TestCase):
    def test_fallback_report_after_quiet_multitouch_rebinds_once_per_cooldown(self):
        guard = guard_module.Guard(quiet_s=2, cooldown_s=30)
        guard.touch_report(100)
        self.assertFalse(guard.fallback_report(101))  # multitouch is live
        self.assertEqual(guard.mode, "multitouch")
        self.assertTrue(guard.fallback_report(105))
        self.assertEqual(guard.mode, "fallback")
        guard.rebound(105)
        self.assertEqual(guard.mode, "unknown")
        self.assertFalse(guard.fallback_report(110))  # cooldown
        self.assertEqual(guard.mode, "fallback")
        self.assertTrue(guard.fallback_report(136))
        guard.rebound(136)
        guard.touch_report(140)
        state = guard.state(141, 1_000_000, "present")
        self.assertEqual(state["mode"], "multitouch")
        self.assertEqual(state["fallback_reports"], 4)
        self.assertEqual(state["rebinds"], 2)
        self.assertEqual(state["touch_idle_s"], 1)

    def test_fallback_report_with_no_touch_ever_seen_rebinds(self):
        guard = guard_module.Guard()
        self.assertTrue(guard.fallback_report(5))

    def test_absent_device_reports_unknown_mode(self):
        guard = guard_module.Guard()
        guard.fallback_report(5)
        self.assertEqual(guard.state(6, 0, "absent")["mode"], "unknown")


class PanelTest(unittest.TestCase):
    def test_finds_interfaces_by_number_and_rebinds_multitouch(self):
        with tempfile.TemporaryDirectory() as root:
            sys_root, _ = fake_panel(root)
            panel = guard_module.find_panel(sys_root, VID, PID, 0, 2)
            self.assertEqual((panel.hid_id, panel.touch_hidraw, panel.fallback_hidraw, panel.touch_driver),
                             ("0003:27C6:0529.0005", "hidraw0", "hidraw6", "hid-multitouch"))
            guard_module.rebind(sys_root, panel)
            drivers = sys_root / "bus/hid/drivers/hid-multitouch"
            self.assertEqual((drivers / "unbind").read_text(), panel.hid_id)
            self.assertEqual((drivers / "bind").read_text(), panel.hid_id)
            self.assertIsNone(guard_module.find_panel(sys_root, "1234", PID, 0, 2))

    def test_unbound_multitouch_interface_is_bound_without_unbind(self):
        with tempfile.TemporaryDirectory() as root:
            sys_root, _ = fake_panel(root, touch_driver=None)
            panel = guard_module.find_panel(sys_root, VID, PID, 0, 2)
            self.assertIsNone(panel.touch_driver)
            guard_module.rebind(sys_root, panel)
            drivers = sys_root / "bus/hid/drivers/hid-multitouch"
            self.assertEqual((drivers / "unbind").read_text(), "")
            self.assertEqual((drivers / "bind").read_text(), panel.hid_id)

    def test_failed_open_closes_the_node_that_did_open(self):
        with tempfile.TemporaryDirectory() as root:
            sys_root, dev_root = fake_panel(root)
            panel = guard_module.find_panel(sys_root, VID, PID, 0, 2)
            (dev_root / panel.fallback_hidraw).unlink()
            before = len(os.listdir("/proc/self/fd"))
            for _ in range(5):
                with self.assertRaises(OSError):
                    guard_module.open_nodes(str(dev_root), panel)
            self.assertEqual(len(os.listdir("/proc/self/fd")), before)

    def test_check_reports_panel(self):
        with tempfile.TemporaryDirectory() as root:
            sys_root, _ = fake_panel(root)
            self.assertEqual(guard_module.main(["--check", "--sys-root", str(sys_root)]), 0)
            self.assertEqual(guard_module.main(["--check", "--sys-root", str(Path(root, "missing"))]), 1)


class RunTest(unittest.TestCase):
    def test_mouse_mode_reports_trigger_rebind_and_state_is_published_without_report_data(self):
        with tempfile.TemporaryDirectory() as root:
            sys_root, dev_root = fake_panel(root)
            state_path = Path(root, "run/state.json")
            args = guard_module.argparse.Namespace(
                vid=VID, pid=PID, touch_interface=0, fallback_interface=2, state=str(state_path),
                sys_root=str(sys_root), dev_root=str(dev_root), quiet=0.2, cooldown=30, poll=0.05)
            done = threading.Event()
            thread = threading.Thread(target=guard_module.run, args=(args,), kwargs={"stop": done.is_set}, daemon=True)
            thread.start()
            unbind = sys_root / "bus/hid/drivers/hid-multitouch/unbind"

            def wait_for(condition):
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    if condition():
                        return True
                    time.sleep(0.02)
                return False

            def writer(name):
                deadline = time.monotonic() + 3
                while True:
                    try:
                        return os.open(dev_root / name, os.O_WRONLY | os.O_NONBLOCK)
                    except OSError:  # guard has not opened its end yet
                        if time.monotonic() > deadline:
                            raise
                        time.sleep(0.02)

            try:
                touch, fallback = writer("hidraw0"), writer("hidraw6")
                os.write(touch, b"\x01SECRET-TOUCH")
                os.write(fallback, b"\x05SECRET-MOUSE")  # within quiet window: no re-bind
                time.sleep(0.4)
                self.assertEqual(unbind.read_text(), "")
                os.write(fallback, b"\x05SECRET-MOUSE")  # multitouch quiet: fell back
                self.assertTrue(wait_for(lambda: unbind.read_text() == "0003:27C6:0529.0005"))
                os.close(touch)
                os.close(fallback)
                self.assertTrue(wait_for(lambda: state_path.exists() and json.loads(state_path.read_text())["rebinds"] == 1))
                raw = state_path.read_text()
                state = json.loads(raw)
                self.assertEqual(state["fallback_reports"], 2)
                self.assertEqual(state["device"], "present")
                self.assertNotIn("SECRET", raw)
                self.assertEqual(state_path.stat().st_mode & 0o777, 0o644)
            finally:
                done.set()
                thread.join(3)
            self.assertFalse(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
