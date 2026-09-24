import os
import subprocess
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, root)
from stats import median, mean  # noqa: E402

assert median([1, 2, 3, 4]) == 2.5
assert median([7]) == 7
assert median([10, 2, 38, 23, 38, 23]) == 23
assert median([1.5, 2.5]) == 2.0
assert mean([1, 2]) == 1.5
try:
    median([])
    raise AssertionError("median of nothing must raise")
except ValueError:
    pass
subprocess.run([sys.executable, "-m", "unittest", "-q"], cwd=root, check=True)
print("check passed")
