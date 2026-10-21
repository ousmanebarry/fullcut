"""Transparent cold-start score, used when no model is loaded or the shop has too little history.

Starts from the client's smoothed no-show rate and adds fixed log-odds steps whose directions
match the prototype data (same-day bookings rarely missed, long lead times missed more).
"""

import math

from fullcut_ml.features import Features

HEURISTIC_VERSION = "heuristic-1"


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def heuristic_score(f: Features) -> tuple[float, dict[str, float]]:
    """Returns (score, per-feature log-odds contributions)."""
    base = float(f["shop_base_rate"])
    lead = float(f["lead_time_days"])
    c: dict[str, float] = {
        "smoothed_no_show_rate": _logit(float(f["smoothed_no_show_rate"])) - _logit(base)
    }
    if f["same_day"] == 1:
        c["same_day"] = -1.2
    elif lead >= 14:
        c["lead_time_days"] = 0.6
    elif lead >= 3:
        c["lead_time_days"] = 0.3
    if f["last_visit_no_show"] == 1:
        c["last_visit_no_show"] = 0.4
    if f["prior_late_cancellations"]:
        c["prior_late_cancellations"] = min(0.2 * float(f["prior_late_cancellations"]), 0.6)
    if f["reminder_replied"] == 1:
        c["reminder_replied"] = -1.0
    elif f["confirm_requested"] == 1:
        c["confirm_requested"] = 0.3
    if f["first_visit"] == 1 and f["source"] == "direct":
        c["first_visit"] = 0.2

    log_odds = _logit(base) + sum(c.values())
    return 1 / (1 + math.exp(-log_odds)), c
