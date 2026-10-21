import copy
import math
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from fastapi.testclient import TestClient

from fullcut_ml.factors import NO_SIGNAL
from fullcut_ml.features import FEATURE_NAMES, build_feature_frame
from fullcut_ml.heuristic import HEURISTIC_VERSION
from fullcut_ml.model import PlattCalibrator, ScoringModel
from fullcut_ml.schema import BookingRecord
from fullcut_ml.serve import ScoreRequest, Settings, create_app, request_features
from fullcut_ml.train import lightgbm_model, logistic_pipeline

SECRET = "s" * 40
AUTH = {"Authorization": f"Bearer {SECRET}"}
NOW = datetime(2026, 10, 20, 15, 0, tzinfo=UTC)


def record(
    booking_id: str,
    *,
    starts: timedelta,
    created: timedelta,
    status: str = "confirmed",
    client_id: str = "c1",
    **extra,
) -> dict:
    return BookingRecord(
        **{
            "booking_id": booking_id,
            "shop_id": "shop-1",
            "client_id": client_id,
            "created_at": NOW + created,
            "starts_at": NOW + starts,
            "status": status,
            "shop_timezone": "America/Toronto",
            "duration_minutes": 30,
            "price_cents": 3500,
            "source": "direct",
            **extra,
        }
    ).model_dump(mode="json")


def request_body(booking: dict, history: list[dict] | None = None, **extra) -> dict:
    return copy.deepcopy(
        {
            "booking_id": booking["booking_id"],
            "shop_id": booking["shop_id"],
            "booking": booking,
            "history": history or [],
            **extra,
        }
    )


NEW_BOOKING = record("b1", starts=timedelta(days=21), created=timedelta())
NO_SHOW_HISTORY = [
    record(f"h{i}", starts=timedelta(days=-30 * i), created=timedelta(days=-30 * i - 7), status=s)
    for i, s in enumerate(["no_show", "no_show", "completed", "no_show"], start=1)
]
RELIABLE_HISTORY = [
    record(
        f"r{i}",
        starts=timedelta(days=-30 * i),
        created=timedelta(days=-30 * i - 7),
        status="completed",
    )
    for i in range(1, 7)
]


def client(**settings) -> TestClient:
    return TestClient(create_app(Settings(shared_secret=SECRET, **settings)))


def synthetic_model(kind: str) -> ScoringModel:
    rng = np.random.default_rng(0)
    records = []
    for c in range(300):
        flaky = c % 4 == 0
        for v in range(6):
            lead = float(rng.integers(0, 40))
            p = 0.05 + (0.45 if flaky else 0) + lead / 200
            starts = timedelta(days=-400 + 60 * v)
            records.append(
                BookingRecord(
                    booking_id=f"{c}-{v}",
                    shop_id="shop-1",
                    client_id=f"c{c}",
                    created_at=NOW + starts - timedelta(days=lead),
                    starts_at=NOW + starts,
                    status="no_show" if rng.random() < p else "completed",
                    shop_timezone="America/Toronto",
                    duration_minutes=30,
                    price_cents=3500,
                    source="direct",
                )
            )
    frame = build_feature_frame(records, shop_base_rate=0.2)
    estimator = logistic_pipeline() if kind == "logreg" else lightgbm_model()
    estimator.fit(frame[FEATURE_NAMES], frame["label"].astype(int))
    raw = estimator.predict_proba(frame[FEATURE_NAMES])[:, 1]
    calibrator = PlattCalibrator().fit(raw, frame["label"].astype(int))
    return ScoringModel(f"test-{kind}-1", kind, estimator, calibrator, 0.2)


@pytest.fixture(scope="module", params=["logreg", "lgbm"])
def model_path(request, tmp_path_factory):
    path = tmp_path_factory.mktemp(request.param) / "model.joblib"
    synthetic_model(request.param).save(path)
    return path


def test_health_needs_no_secret_and_reports_heuristic_without_a_model():
    with client() as c:
        res = c.get("/health")
    assert res.status_code == 200
    assert res.json() == {
        "status": "ok",
        "model_loaded": False,
        "model_enabled": False,
        "model_version": HEURISTIC_VERSION,
    }


@pytest.mark.parametrize(
    "headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": SECRET}]
)
def test_score_rejects_missing_or_wrong_secret(headers):
    with client() as c:
        res = c.post("/score", json=request_body(NEW_BOOKING), headers=headers)
    assert res.status_code == 401


def test_auth_is_checked_before_the_body():
    with client() as c:
        res = c.post("/score", json={"nonsense": True})
    assert res.status_code == 401


def test_settings_reject_a_short_secret():
    with pytest.raises(ValueError):
        Settings(shared_secret="short")


def test_heuristic_response_shape_and_ordering():
    with client() as c:
        flaky = c.post("/score", json=request_body(NEW_BOOKING, NO_SHOW_HISTORY), headers=AUTH)
        reliable = c.post("/score", json=request_body(NEW_BOOKING, RELIABLE_HISTORY), headers=AUTH)

    assert flaky.status_code == 200
    body = flaky.json()
    assert set(body) == {
        "booking_id",
        "risk_score",
        "tier",
        "method",
        "model_version",
        "top_factors",
    }
    assert body["booking_id"] == "b1"
    assert body["method"] == "heuristic"
    assert body["model_version"] == HEURISTIC_VERSION
    assert 0 <= body["risk_score"] <= 1
    assert body["tier"] == "high"
    assert "3 no-shows in last 4 visits" in body["top_factors"]
    assert "Booked 3 weeks ahead" in body["top_factors"]

    other = reliable.json()
    assert other["risk_score"] < body["risk_score"]
    assert other["tier"] == "low"
    assert "Showed up to all 6 past visits" in other["top_factors"]


def test_same_day_and_replied_bookings_score_low():
    booking = record("b2", starts=timedelta(hours=3), created=timedelta(), reminder_replied=True)
    with client() as c:
        body = c.post("/score", json=request_body(booking), headers=AUTH).json()
    assert body["tier"] == "low"
    assert body["top_factors"][:2] == ["Booked for the same day", "Replied to confirm"]


def test_no_signals_gives_a_fallback_reason():
    booking = record("b3", starts=timedelta(days=1), created=timedelta(), source="phone")
    with client() as c:
        body = c.post("/score", json=request_body(booking), headers=AUTH).json()
    assert body["top_factors"] == [NO_SIGNAL]


def test_custom_thresholds_change_the_tier():
    body = request_body(NEW_BOOKING, RELIABLE_HISTORY, thresholds={"medium": 0.01, "high": 0.02})
    with client() as c:
        res = c.post("/score", json=body, headers=AUTH).json()
    assert res["tier"] == "high"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b["booking"].update(created_at="2026-10-20T15:00:00"),  # naive datetime
        lambda b: b.update(booking_id="other"),
        lambda b: b["history"].append(
            record("x", starts=timedelta(days=-3), created=timedelta(days=-9), client_id="c2")
        ),
        lambda b: b.update(thresholds={"medium": 0.4, "high": 0.3}),
        lambda b: b.update(unexpected=True),
        lambda b: b["booking"].update(status="maybe"),
        lambda b: b.update(history=[NO_SHOW_HISTORY[0]] * 501),
    ],
)
def test_bad_input_fails_fast(mutate):
    body = request_body(NEW_BOOKING, list(NO_SHOW_HISTORY))
    mutate(body)
    with client() as c:
        res = c.post("/score", json=body, headers=AUTH)
    assert res.status_code == 422


def test_uses_the_model_only_when_enabled_and_the_shop_has_history(model_path):
    body = request_body(
        NEW_BOOKING, NO_SHOW_HISTORY, shop={"base_rate": 0.2, "labelled_bookings": 500}
    )
    with client(model_path=model_path, model_enabled=True) as c:
        assert c.get("/health").json()["model_loaded"] is True
        res = c.post("/score", json=body, headers=AUTH).json()
        small = c.post(
            "/score", json={**body, "shop": {"labelled_bookings": 10}}, headers=AUTH
        ).json()
    with client(model_path=model_path) as c:
        disabled = c.post("/score", json=body, headers=AUTH).json()

    assert res["method"] == "model"
    assert res["model_version"].startswith("test-")
    assert 0 <= res["risk_score"] <= 1
    assert "3 no-shows in last 4 visits" in res["top_factors"]
    assert small["method"] == "heuristic"
    assert disabled["method"] == "heuristic"


def test_falls_back_to_heuristic_when_the_model_breaks(model_path):
    body = request_body(NEW_BOOKING, shop={"labelled_bookings": 500})
    with client(model_path=model_path, model_enabled=True) as c:
        c.app.state.model.estimator = None
        res = c.post("/score", json=body, headers=AUTH).json()
    assert res["method"] == "heuristic"


def test_unreadable_model_file_still_serves(tmp_path):
    path = tmp_path / "model.joblib"
    path.write_bytes(b"not a model")
    with client(model_path=path, model_enabled=True) as c:
        assert c.get("/health").json()["model_loaded"] is False
        res = c.post("/score", json=request_body(NEW_BOOKING), headers=AUTH)
    assert res.json()["method"] == "heuristic"


def test_serving_features_match_training_features():
    history = [BookingRecord.model_validate(h) for h in NO_SHOW_HISTORY]
    booking = BookingRecord.model_validate(NEW_BOOKING)
    req = ScoreRequest.model_validate(
        request_body(NEW_BOOKING, NO_SHOW_HISTORY, shop={"base_rate": 0.2})
    )

    served = request_features(req)
    trained = (
        build_feature_frame([*history, booking], shop_base_rate=0.2)
        .set_index("booking_id")
        .loc["b1"]
    )
    for name in FEATURE_NAMES:
        if isinstance(served[name], float) and math.isnan(served[name]):
            assert math.isnan(trained[name]), name
        else:
            assert trained[name] == served[name], name
