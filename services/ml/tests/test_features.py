import math
from datetime import UTC, datetime, timedelta

import pytest

from fullcut_ml.features import SMOOTHING_STRENGTH, build_feature_frame, build_features
from fullcut_ml.schema import BookingRecord

BASE_RATE = 0.2
T0 = datetime(2026, 3, 2, 14, 0, tzinfo=UTC)  # a Monday


def booking(
    booking_id: str,
    *,
    starts: timedelta,
    created: timedelta,
    status: str = "completed",
    client_id: str = "c1",
    **extra,
) -> BookingRecord:
    return BookingRecord(
        booking_id=booking_id,
        shop_id="s1",
        client_id=client_id,
        created_at=T0 + created,
        starts_at=T0 + starts,
        status=status,
        shop_timezone="America/Toronto",
        duration_minutes=30,
        price_cents=3000,
        source="direct",
        **extra,
    )


def same(a: dict, b: dict) -> bool:
    return a.keys() == b.keys() and all(
        (isinstance(a[k], float) and math.isnan(a[k]) and math.isnan(b[k])) or a[k] == b[k]
        for k in a
    )


TARGET = booking("target", starts=timedelta(days=30), created=timedelta(days=0))
PAST = [
    booking("p1", starts=timedelta(days=-60), created=timedelta(days=-70)),
    booking("p2", starts=timedelta(days=-30), created=timedelta(days=-40), status="no_show"),
    booking("p3", starts=timedelta(days=-10), created=timedelta(days=-20)),
]


def test_counts_only_bookings_finished_before_scoring():
    f = build_features(TARGET, [*PAST, TARGET], shop_base_rate=BASE_RATE)

    assert f["prior_bookings"] == 3
    assert f["prior_no_shows"] == 1
    assert f["first_visit"] == 0
    assert f["last_visit_no_show"] == 0
    assert f["days_since_last_visit"] == pytest.approx(10)
    assert f["smoothed_no_show_rate"] == pytest.approx(
        (1 + SMOOTHING_STRENGTH * BASE_RATE) / (3 + SMOOTHING_STRENGTH)
    )
    assert f["lead_time_days"] == pytest.approx(30)
    assert f["weekday"] == "2"  # 30 days after Monday 2 March is Wednesday 1 April
    assert f["local_hour"] == 10  # 14:00 UTC is 10:00 in Toronto (EDT)


def test_adding_future_bookings_does_not_change_features():
    before = build_features(TARGET, [*PAST, TARGET], shop_base_rate=BASE_RATE)
    future = [
        # Booked before the target but its outcome came after the target was booked.
        booking("f1", starts=timedelta(hours=2), created=timedelta(days=-5), status="no_show"),
        # Entirely after.
        booking("f2", starts=timedelta(days=40), created=timedelta(days=5), status="no_show"),
        booking("f3", starts=timedelta(days=50), created=timedelta(days=6)),
        # Late cancellation recorded after scoring time.
        booking(
            "f4",
            starts=timedelta(days=3),
            created=timedelta(days=-2),
            status="cancelled",
            cancelled_at=T0 + timedelta(days=2, hours=20),
        ),
    ]
    after = build_features(TARGET, [*PAST, TARGET, *future], shop_base_rate=BASE_RATE)
    assert same(before, after)


def test_feature_frame_matches_single_booking_features():
    records = [
        *PAST,
        TARGET,
        booking("x", starts=timedelta(days=5), created=timedelta(), client_id="c2"),
    ]
    frame = build_feature_frame(records, shop_base_rate=BASE_RATE).set_index("booking_id")
    single = build_features(TARGET, records, shop_base_rate=BASE_RATE)
    row = frame.loc["target"]
    for name, value in single.items():
        if isinstance(value, float) and math.isnan(value):
            assert math.isnan(row[name])
        else:
            assert row[name] == value, name


def test_ignores_other_clients_and_counts_late_cancellations():
    other_client = booking(
        "o1",
        starts=timedelta(days=-5),
        created=timedelta(days=-9),
        client_id="c2",
        status="no_show",
    )
    late_cancel = booking(
        "lc",
        starts=timedelta(days=-3),
        created=timedelta(days=-8),
        status="cancelled",
        cancelled_at=T0 + timedelta(days=-3, hours=-2),
    )
    early_cancel = booking(
        "ec",
        starts=timedelta(days=-3),
        created=timedelta(days=-8),
        status="cancelled",
        cancelled_at=T0 + timedelta(days=-6),
    )
    f = build_features(
        TARGET, [other_client, late_cancel, early_cancel, TARGET], shop_base_rate=BASE_RATE
    )
    assert f["prior_bookings"] == 0
    assert f["first_visit"] == 1
    assert f["prior_late_cancellations"] == 1
    assert f["smoothed_no_show_rate"] == pytest.approx(BASE_RATE)
    assert math.isnan(f["days_since_last_visit"])


def test_date_only_records_have_no_hour_and_wait_for_end_of_day():
    target = booking(
        "t", starts=timedelta(days=1), created=timedelta(hours=1), has_start_time=False
    )
    # Same local day as the target's booking moment: outcome unknown until local midnight.
    same_day = booking(
        "sd",
        starts=timedelta(hours=-1),
        created=timedelta(days=-3),
        has_start_time=False,
        status="no_show",
    )
    f = build_features(target, [same_day, target], shop_base_rate=BASE_RATE)
    assert math.isnan(f["local_hour"])
    assert f["prior_bookings"] == 0
