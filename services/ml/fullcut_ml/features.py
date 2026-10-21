"""Feature building shared by training and serving.

`build_features` is the only place features are defined. Training calls it once per booking via
`build_feature_frame`; the scoring service calls it directly, so the two can't drift apart.
"""

from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from datetime import datetime, timedelta
from typing import get_args
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from fullcut_ml.schema import BookingRecord, BookingSource

SMOOTHING_STRENGTH = 5.0
LATE_CANCEL_WINDOW = timedelta(hours=24)

NUMERIC_FEATURES = [
    "lead_time_days",
    "same_day",
    "prior_bookings",
    "prior_no_shows",
    "prior_late_cancellations",
    "smoothed_no_show_rate",
    "last_visit_no_show",
    "days_since_last_visit",
    "first_visit",
    "local_hour",
    "price_cents",
    "duration_minutes",
    "sms_reminder_sent",
    "confirm_requested",
    "reminder_replied",
    "shop_base_rate",
]
CATEGORICAL_FEATURES = ["weekday", "source"]
FEATURE_NAMES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

Features = dict[str, float | str]


def outcome_known_at(record: BookingRecord) -> datetime:
    """When the booking's show/no-show outcome could first be known."""
    if not record.has_start_time:
        zone = ZoneInfo(record.shop_timezone)
        local_day = record.starts_at.astimezone(zone).date()
        return datetime.combine(local_day + timedelta(days=1), datetime.min.time(), zone)
    return record.starts_at + timedelta(minutes=record.duration_minutes or 0)


def build_features(
    target: BookingRecord,
    history: Iterable[BookingRecord],
    *,
    shop_base_rate: float,
    as_of: datetime | None = None,
) -> Features:
    """Features for `target` as they were at `as_of` (default: when it was booked).

    Only history whose outcome was known by `as_of` is used, so adding later bookings never
    changes the result.
    """
    as_of = as_of or target.created_at
    finished: list[BookingRecord] = []
    late_cancellations = 0
    for h in history:
        if (
            h.booking_id == target.booking_id
            or h.client_id != target.client_id
            or h.shop_id != target.shop_id
        ):
            continue
        if h.label is not None and outcome_known_at(h) <= as_of:
            finished.append(h)
        elif (
            h.status == "cancelled"
            and h.cancelled_at is not None
            and h.cancelled_at <= as_of
            and h.starts_at - h.cancelled_at < LATE_CANCEL_WINDOW
        ):
            late_cancellations += 1

    finished.sort(key=lambda h: h.starts_at)
    prior_bookings = len(finished)
    prior_no_shows = sum(h.label for h in finished)
    completed = [h for h in finished if h.label == 0]
    days_since_last_visit = (
        (as_of - completed[-1].starts_at).total_seconds() / 86400 if completed else np.nan
    )

    zone = ZoneInfo(target.shop_timezone)
    local_start = target.starts_at.astimezone(zone)
    lead_time_days = max((target.starts_at - target.created_at).total_seconds() / 86400, 0.0)

    return {
        "lead_time_days": lead_time_days,
        "same_day": float(local_start.date() == target.created_at.astimezone(zone).date()),
        "prior_bookings": float(prior_bookings),
        "prior_no_shows": float(prior_no_shows),
        "prior_late_cancellations": float(late_cancellations),
        "smoothed_no_show_rate": (prior_no_shows + SMOOTHING_STRENGTH * shop_base_rate)
        / (prior_bookings + SMOOTHING_STRENGTH),
        "last_visit_no_show": float(finished[-1].label) if finished else np.nan,
        "days_since_last_visit": days_since_last_visit,
        "first_visit": float(prior_bookings == 0),
        "local_hour": float(local_start.hour) if target.has_start_time else np.nan,
        "price_cents": _or_nan(target.price_cents),
        "duration_minutes": _or_nan(target.duration_minutes),
        "sms_reminder_sent": float(target.sms_reminder_sent),
        "confirm_requested": float(target.confirm_requested),
        "reminder_replied": float(target.reminder_replied),
        "shop_base_rate": shop_base_rate,
        "weekday": str(local_start.weekday()),
        "source": target.source,
    }


def build_feature_frame(
    records: Sequence[BookingRecord], *, shop_base_rate: float | Callable[[str], float]
) -> pd.DataFrame:
    """One row per record: booking_id, client_id, starts_at, label, then FEATURE_NAMES.

    `shop_base_rate` is one rate for every shop or a lookup by shop_id.
    """
    rate_for = shop_base_rate if callable(shop_base_rate) else (lambda _shop: shop_base_rate)
    by_client: dict[tuple[str, str], list[BookingRecord]] = defaultdict(list)
    for r in records:
        by_client[(r.shop_id, r.client_id)].append(r)

    rows = []
    for r in records:
        features = build_features(
            r, by_client[(r.shop_id, r.client_id)], shop_base_rate=rate_for(r.shop_id)
        )
        rows.append(
            {
                "booking_id": r.booking_id,
                "client_id": r.client_id,
                "starts_at": r.starts_at,
                "label": r.label,
                **features,
            }
        )
    frame = pd.DataFrame(
        rows, columns=["booking_id", "client_id", "starts_at", "label", *FEATURE_NAMES]
    )
    return to_model_dtypes(frame)


def to_model_dtypes(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame[NUMERIC_FEATURES] = frame[NUMERIC_FEATURES].astype("float64")
    frame["weekday"] = pd.Categorical(frame["weekday"], categories=[str(d) for d in range(7)])
    frame["source"] = pd.Categorical(frame["source"], categories=list(get_args(BookingSource)))
    return frame


def _or_nan(value: int | None) -> float:
    return np.nan if value is None else float(value)
