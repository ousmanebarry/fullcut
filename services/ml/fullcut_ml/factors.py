"""Plain-language reasons for a score, shown to the shop owner."""

import math
from collections.abc import Callable

from fullcut_ml.features import Features

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
NO_SIGNAL = "No strong risk signals"


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _history(f: Features, _: bool) -> str:
    visits = int(f["prior_bookings"])
    no_shows = int(f["prior_no_shows"])
    if visits == 0:
        return "First visit"
    if no_shows == 0:
        return f"Showed up to all {_plural(visits, 'past visit')}"
    if no_shows == visits:
        return "Missed their only past visit" if visits == 1 else f"Missed all {visits} past visits"
    return f"{_plural(no_shows, 'no-show')} in last {_plural(visits, 'visit')}"


def _last_visit(f: Features, raises: bool) -> str:
    if f["last_visit_no_show"] == 1 and f["prior_no_shows"] < f["prior_bookings"]:
        return "Missed their last appointment"
    return _history(f, raises)


def _lead_time(f: Features, _: bool) -> str:
    if f["same_day"] == 1:
        return "Booked for the same day"
    days = float(f["lead_time_days"])
    if days >= 14:
        return f"Booked {round(days / 7)} weeks ahead"
    if days >= 1.5:
        return f"Booked {round(days)} days ahead"
    return "Booked a day ahead"


def _late_cancellations(f: Features, _: bool) -> str | None:
    n = int(f["prior_late_cancellations"])
    return _plural(n, "late cancellation") if n else None


def _days_since_last_visit(f: Features, _: bool) -> str | None:
    days = float(f["days_since_last_visit"])
    if math.isnan(days):
        return None
    if days >= 60:
        return f"Last visit {round(days / 30)} months ago"
    return f"Last visit {_plural(round(days), 'day')} ago"


def _confirmation(f: Features, _: bool) -> str | None:
    if f["reminder_replied"] == 1:
        return "Replied to confirm"
    if f["confirm_requested"] == 1:
        return "Hasn't replied to the confirmation request"
    return None


def _weekday(f: Features, raises: bool) -> str | None:
    day = WEEKDAYS[int(f["weekday"])]
    return f"{day} appointments are missed more often" if raises else None


TEMPLATES: dict[str, Callable[[Features, bool], str | None]] = {
    "prior_bookings": _history,
    "prior_no_shows": _history,
    "smoothed_no_show_rate": _history,
    "first_visit": _history,
    "last_visit_no_show": _last_visit,
    "lead_time_days": _lead_time,
    "same_day": _lead_time,
    "prior_late_cancellations": _late_cancellations,
    "days_since_last_visit": _days_since_last_visit,
    "reminder_replied": _confirmation,
    "confirm_requested": _confirmation,
    "weekday": _weekday,
}


def describe(features: Features, contributions: dict[str, float], limit: int = 3) -> list[str]:
    """Texts for the features that moved the score most, in either direction."""
    reasons: list[str] = []
    for name, value in sorted(contributions.items(), key=lambda kv: -abs(kv[1])):
        template = TEMPLATES.get(name)
        if template is None or abs(value) < 1e-6:
            continue
        text = template(features, value > 0)
        if text and text not in reasons:
            reasons.append(text)
        if len(reasons) == limit:
            break
    return reasons or [NO_SIGNAL]
