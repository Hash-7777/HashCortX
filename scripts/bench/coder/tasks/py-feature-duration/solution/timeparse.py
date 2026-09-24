"""Reading times and durations written by people."""

import re


def parse_clock(text):
    """Minutes since midnight for a time written as HH:MM."""
    hours, minutes = text.strip().split(":")
    hours, minutes = int(hours), int(minutes)
    if not (0 <= hours < 24 and 0 <= minutes < 60):
        raise ValueError(f"not a time: {text!r}")
    return hours * 60 + minutes


_DURATION = re.compile(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$")


def parse_duration(text):
    """Seconds in a duration written like 1h30m, 45s or 2h."""
    match = _DURATION.match(text.strip()) if isinstance(text, str) else None
    if not match or not any(match.groups()):
        raise ValueError(f"not a duration: {text!r}")
    hours, minutes, seconds = (int(g) if g else 0 for g in match.groups())
    return hours * 3600 + minutes * 60 + seconds
