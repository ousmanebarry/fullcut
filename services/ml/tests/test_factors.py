import math

import pytest

from fullcut_ml.factors import NO_SIGNAL, describe

BASE = {
    "prior_bookings": 0.0,
    "prior_no_shows": 0.0,
    "last_visit_no_show": math.nan,
    "lead_time_days": 2.0,
    "same_day": 0.0,
    "prior_late_cancellations": 0.0,
    "days_since_last_visit": math.nan,
    "reminder_replied": 0.0,
    "confirm_requested": 0.0,
    "weekday": "4",
}


@pytest.mark.parametrize(
    ("changes", "contributions", "expected"),
    [
        ({}, {"first_visit": 0.2}, ["First visit"]),
        (
            {"prior_bookings": 1.0, "prior_no_shows": 1.0, "last_visit_no_show": 1.0},
            {"prior_no_shows": 1.0, "last_visit_no_show": 0.5},
            ["Missed their only past visit"],
        ),
        (
            {"prior_bookings": 6.0, "prior_no_shows": 3.0, "last_visit_no_show": 1.0},
            {"smoothed_no_show_rate": 1.0, "last_visit_no_show": 0.5},
            ["3 no-shows in last 6 visits", "Missed their last appointment"],
        ),
        ({"lead_time_days": 35.0}, {"lead_time_days": 0.6}, ["Booked 5 weeks ahead"]),
        ({"lead_time_days": 0.2, "same_day": 1.0}, {"same_day": -1.2}, ["Booked for the same day"]),
        (
            {"prior_late_cancellations": 2.0},
            {"prior_late_cancellations": 0.4},
            ["2 late cancellations"],
        ),
        (
            {"days_since_last_visit": 95.0},
            {"days_since_last_visit": 0.3},
            ["Last visit 3 months ago"],
        ),
        (
            {"confirm_requested": 1.0},
            {"confirm_requested": 0.3},
            ["Hasn't replied to the confirmation request"],
        ),
        ({}, {"weekday": 0.2}, ["Friday appointments are missed more often"]),
        ({}, {"weekday": -0.2}, [NO_SIGNAL]),
        ({}, {"price_cents": 2.0, "shop_base_rate": 1.0}, [NO_SIGNAL]),
    ],
)
def test_describe(changes, contributions, expected):
    assert describe({**BASE, **changes}, contributions) == expected


def test_orders_by_impact_and_caps_at_three():
    features = {
        **BASE,
        "prior_bookings": 4.0,
        "prior_no_shows": 2.0,
        "last_visit_no_show": 1.0,
        "lead_time_days": 20.0,
        "prior_late_cancellations": 1.0,
    }
    contributions = {
        "prior_late_cancellations": 0.1,
        "lead_time_days": 0.9,
        "smoothed_no_show_rate": 0.5,
        "last_visit_no_show": 0.3,
    }
    assert describe(features, contributions) == [
        "Booked 3 weeks ahead",
        "2 no-shows in last 4 visits",
        "Missed their last appointment",
    ]
