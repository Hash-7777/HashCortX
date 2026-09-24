import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cart import Cart  # noqa: E402


def refuses(fn):
    try:
        fn()
    except ValueError:
        return True
    return False


c = Cart()
c.add_item("tea", 3.5, 2)
c.add_item("tea", 3.5)
c.add_item("cup", 0, 1)
assert c.count() == 4 and c.total() == 10.5, (c.count(), c.total())
assert refuses(lambda: c.add_item("tea", 3.5, 0)), "quantity 0 is refused"
assert refuses(lambda: c.add_item("tea", 3.5, -2)), "a negative quantity is refused"
assert refuses(lambda: c.add_item("pen", -1, 1)), "a negative price is refused"
assert c.count() == 4, "a refused item changes nothing"
print("check passed")
