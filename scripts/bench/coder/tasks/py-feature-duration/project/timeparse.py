"""Reading times and durations written by people."""


def parse_clock(text):
    """Minutes since midnight for a time written as HH:MM."""
    hours, minutes = text.strip().split(":")
    hours, minutes = int(hours), int(minutes)
    if not (0 <= hours < 24 and 0 <= minutes < 60):
        raise ValueError(f"not a time: {text!r}")
    return hours * 60 + minutes
