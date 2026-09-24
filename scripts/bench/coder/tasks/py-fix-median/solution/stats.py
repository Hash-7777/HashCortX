"""Small statistics helpers for the monthly sales report."""


def mean(values):
    """The average of the values."""
    if not values:
        raise ValueError("mean of nothing")
    return sum(values) / len(values)


def median(values):
    """The middle value; for an even count, the average of the two middle values."""
    if not values:
        raise ValueError("median of nothing")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 0:
        return (ordered[middle - 1] + ordered[middle]) / 2
    return ordered[middle]


def spread(values):
    """The largest value minus the smallest."""
    return max(values) - min(values)
