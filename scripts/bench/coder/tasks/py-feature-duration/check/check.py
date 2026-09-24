import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from timeparse import parse_duration, parse_clock  # noqa: E402

cases = {"1h30m": 5400, "45s": 45, "2h": 7200, "1h5s": 3605, "10m": 600, "1h1m1s": 3661, "0s": 0}
for text, want in cases.items():
    got = parse_duration(text)
    assert got == want and isinstance(got, int), f"{text}: expected {want}, got {got!r}"
for bad in ["", "abc", "5x", "30m1h", "h"]:
    try:
        parse_duration(bad)
    except ValueError:
        continue
    raise AssertionError(f"{bad!r} must raise ValueError")
assert parse_clock("09:30") == 570
print("check passed")
