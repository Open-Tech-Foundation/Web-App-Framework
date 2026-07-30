#!/usr/bin/env python3
"""Run a build command and report its peak memory and wall time.

    python3 measure.py <label> <outdir> -- <command...>
    -> {"label": "otfw-1x", "exit": 0, "peak_mb": 267.5, "wall_s": 0.51}

Peak RSS is summed over the whole **process tree**, not just the launched
process: every tool here forks (Next.js prerenders with a worker pool, otfw runs
the compiler as a subprocess), so measuring one PID would miss most of the
memory. The result is also written to `<outdir>/<label>.json` and the command's
own output to `<outdir>/<label>.log`.
"""

import collections
import json
import os
import subprocess
import sys
import time

SAMPLE_INTERVAL_S = 0.02  # 50 Hz — fine enough to catch a bundler's short peak


def tree_rss(root_pid):
    """Total RSS in bytes of `root_pid` and every descendant, from /proc."""
    children = collections.defaultdict(list)
    rss = {}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        pid = int(entry)
        try:
            with open(f"/proc/{pid}/stat") as f:
                stat = f.read()
            # Skip past the comm field, which may itself contain spaces or ')'.
            ppid = int(stat[stat.rindex(")") + 2:].split()[1])
            with open(f"/proc/{pid}/statm") as f:
                rss[pid] = int(f.read().split()[1]) * 4096
        except (OSError, ValueError, IndexError):
            continue  # process exited mid-read
        children[ppid].append(pid)

    total, stack = 0, [root_pid]
    while stack:
        pid = stack.pop()
        total += rss.get(pid, 0)
        stack.extend(children.get(pid, []))
    return total


def main():
    if "--" not in sys.argv or len(sys.argv) < 4:
        sys.exit(__doc__)
    label, outdir = sys.argv[1], sys.argv[2]
    command = sys.argv[sys.argv.index("--") + 1:]

    with open(f"{outdir}/{label}.log", "w") as log:
        started = time.time()
        proc = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        peak = 0
        while proc.poll() is None:
            peak = max(peak, tree_rss(proc.pid))
            time.sleep(SAMPLE_INTERVAL_S)
        wall = time.time() - started

    # A negative/139 exit is the point of the benchmark, not an error to raise on:
    # a SIGSEGV from the bundler is a real result worth recording.
    result = {
        "label": label,
        "exit": proc.returncode,
        "peak_mb": round(peak / 1048576, 1),
        "wall_s": round(wall, 2),
    }
    with open(f"{outdir}/{label}.json", "w") as f:
        json.dump(result, f)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
