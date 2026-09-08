#!/usr/bin/env python3
"""Perf-regression gate: runs the benchmark suite and compares ops/s against
verification/bench-baseline.json. Fails if any workload drops below
baseline * tolerance. Usage: yarn bench:check  (or --bless to re-record)."""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = json.loads((ROOT / "verification/bench-baseline.json").read_text())
TOLERANCE = BASELINE["tolerance"]
PATTERN = re.compile(r"BENCH (\w+): \d+ iters in [\d.]+ms → ([\d,]+) ops/s")


def run_once(suite: str) -> dict[str, int] | None:
    out = subprocess.run(["corepack", "yarn", f"bench:{suite}"], cwd=ROOT,
                         capture_output=True, text=True, timeout=1800)
    text = out.stdout + out.stderr
    results = {m.group(1): int(m.group(2).replace(",", ""))
               for m in PATTERN.finditer(text)}
    return results or None


def run(suite: str, rounds: int = 3) -> dict[str, int]:
    # Best-of-N: noise only ever slows a run down, so the max is the honest
    # number and single-run variance (30-50% under machine load) stops
    # producing false regressions
    best: dict[str, int] = {}
    for i in range(rounds):
        results = run_once(suite)
        if results is None:
            continue
        print(f"  {suite} round {i + 1}/{rounds}")
        for name, ops in results.items():
            best[name] = max(best.get(name, 0), ops)
    if not best:
        print(f"no bench results parsed from {suite}")
        sys.exit(2)
    return best


def main() -> int:
    if "--bless" in sys.argv:
        baseline = {"comment": BASELINE["comment"], "tolerance": TOLERANCE}
        for suite in ["cpp", "js"]:
            baseline[suite] = run(suite)
        (ROOT / "verification/bench-baseline.json").write_text(
            json.dumps(baseline, indent=2) + "\n")
        print("baseline re-recorded")
        return 0

    failures = []
    for suite in ["cpp", "js"]:
        results = run(suite)
        for name, baseline_ops in BASELINE[suite].items():
            got = results.get(name)
            if got is None:
                failures.append(f"{suite}/{name}: missing from bench output")
                continue
            floor = baseline_ops * TOLERANCE
            status = "ok" if got >= floor else "REGRESSION"
            ratio = got / baseline_ops
            print(f"{suite}/{name:<16} {got:>12,} ops/s  "
                  f"baseline {baseline_ops:>12,}  ({ratio:.2f}×)  {status}")
            if got < floor:
                failures.append(
                    f"{suite}/{name}: {got:,} ops/s < floor "
                    f"{floor:,.0f} (baseline {baseline_ops:,} × {TOLERANCE})")

    if failures:
        print(f"\n✗ {len(failures)} perf regressions:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\n✓ no perf regressions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
