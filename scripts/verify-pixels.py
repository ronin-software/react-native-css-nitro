#!/usr/bin/env python3
"""Device pixel-regression gate for the showcase app.

Drives the app through its states (light, dark, group press) via Maestro +
agent-device, samples fixed points over solid backgrounds, and compares to
verification/golden-pixels.json exactly.

The perf guarantee is structural: the "styled renders" counter is plain text,
so its pixels change iff a React render happened. In shadow-write mode the
counter region must be pixel-identical before/during/after a group press
(0 renders) while the pill still turns red (the write happened).

Usage: yarn verify:device  (app must be built + installed; simulator booted)
"""

import json
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = json.loads((ROOT / "verification/golden-pixels.json").read_text())
UDID = "A00E2E3A-1453-4BFE-86DB-9F83CC452925"
APP_ID = "cssnitro.example"
TMP = Path("/tmp/rn-css-verify")
TMP.mkdir(exist_ok=True)


def sh(*cmd, timeout=120):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def screenshot(name: str) -> Image.Image:
    out = TMP / f"{name}.png"
    sh("xcrun", "simctl", "io", UDID, "screenshot", str(out))
    return Image.open(out).convert("RGB")


def sample(img: Image.Image, fx: float, fy: float):
    w, h = img.size
    return img.getpixel((int(w * fx), int(h * fy)))


def check(img: Image.Image, state: str) -> list[str]:
    failures = []
    for point, (fx, fy, expected) in GOLDEN[state]["points"].items():
        got = sample(img, fx, fy)
        if list(got) != expected:
            failures.append(
                f"{state}/{point}: expected {expected}, got {list(got)}")
    return failures


def pixels_identical(a: Image.Image, b: Image.Image, fx0, fy0, fx1, fy1) -> bool:
    aw, ah = a.size
    box = (int(aw * fx0), int(ah * fy0), int(aw * fx1), int(ah * fy1))
    return a.crop(box).tobytes() == b.crop(box).tobytes()


def main() -> int:
    print("── launching app (default mode: shadow write on)")
    sh("xcrun", "simctl", "terminate", UDID, APP_ID)
    sh("xcrun", "simctl", "launch", UDID, APP_ID)
    time.sleep(7)

    failures = []

    # – Light state –
    light = screenshot("light")
    failures += check(light, "light")

    # – Dark state (class selectors) –
    sh("maestro", "test", str(ROOT / "example/.e2e/dark-on.yaml"), timeout=120)
    time.sleep(1)
    dark = screenshot("dark")
    failures += check(dark, "dark")

    # back to light for the press test
    sh("maestro", "test", str(ROOT / "example/.e2e/dark-off.yaml"), timeout=120)
    time.sleep(1)

    # – Perf gate: group press must cause 0 React renders (counter region
    # pixel-identical across the press) while the pill turns red –
    before = screenshot("press-before")
    p = subprocess.Popen(
        ["agent-device", "longpress", "201", "460", "3000"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    mid = screenshot("press-mid")
    p.wait()
    time.sleep(1)
    after = screenshot("press-after")

    failures += check(mid, "press")

    for name, a, b in [("before→mid", before, mid), ("mid→after", mid, after)]:
        if not pixels_identical(a, b, 0.0, 0.395, 0.6, 0.44):
            failures.append(
                f"perf/renders: counter region changed across {name} — "
                f"a React render ran for a style-only update")

    # – Report –
    if failures:
        print(f"\n✗ {len(failures)} pixel/perf regressions:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\n✓ all pixel + perf assertions pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
