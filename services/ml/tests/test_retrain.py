import csv
import json
import random
from datetime import UTC, datetime, timedelta

import pytest

from fullcut_ml import retrain as retrain_module
from fullcut_ml import train as train_module
from fullcut_ml.retrain import EXPORT_COLUMNS, load_export, retrain, should_promote

START = datetime(2026, 1, 5, 15, 0, tzinfo=UTC)


def synthetic_export(path, *, clients: int = 120, visits: int = 10, seed: int = 0) -> None:
    """Shop data with a learnable pattern (habitual no-showers). For tests, never for metrics."""
    rng = random.Random(seed)
    rows = []
    for c in range(clients):
        habitual = c % 5 == 0
        for v in range(visits):
            starts = START + timedelta(days=21 * v + c % 20, hours=c % 6)
            lead = rng.choice([1, 2, 7, 21, 35])
            p = (0.5 if habitual else 0.05) + (0.1 if lead > 14 else 0)
            status = "no_show" if rng.random() < p else "completed"
            released = c % 17 == 0 and v == visits - 1
            rows.append(
                {
                    "booking_id": f"b-{c}-{v}",
                    "shop_id": "shop-1" if c % 2 else "shop-2",
                    "client_id": f"c-{c}",
                    "created_at": (starts - timedelta(days=lead)).isoformat(),
                    "starts_at": starts.isoformat(),
                    "ends_at": (starts + timedelta(minutes=30)).isoformat(),
                    "status": "cancelled" if released else status,
                    "source": "instagram" if v % 3 else "phone",
                    "price_cents": "3500",
                    "cancelled_at": (starts - timedelta(hours=20)).isoformat() if released else "",
                    "client_confirmed_at": "",
                    "confirmation_status": "released" if released else "not_required",
                    "release_reason": "unconfirmed" if released else "",
                    "risk_tier": "high" if habitual else "low",
                    "shop_timezone": "America/Toronto",
                }
            )
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=EXPORT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


@pytest.fixture
def artifacts(tmp_path, monkeypatch):
    path = tmp_path / "artifacts"
    monkeypatch.setattr(retrain_module, "ARTIFACTS", path)
    monkeypatch.setattr(train_module, "ARTIFACTS", path)
    return path


def test_export_leaves_released_bookings_out_of_the_labels(tmp_path):
    csv_path = tmp_path / "bookings.csv"
    synthetic_export(csv_path)
    export = load_export(csv_path)

    released = [r for r in export.records if r.status == "released"]
    assert export.released == len(released) == 8
    # Clients 0 and 85 are both released and habitual (high risk).
    assert export.released_high_risk == 2
    assert all(r.label is None for r in released)
    assert {r.source for r in export.records} == {"direct", "phone"}


def test_promotes_the_first_model_and_logs_every_run(tmp_path, artifacts):
    csv_path = tmp_path / "bookings.csv"
    synthetic_export(csv_path)

    first = retrain(csv_path)
    assert first["promoted"] is True
    assert first["released"] == 8
    assert (artifacts / "current.txt").read_text() == first["candidate"]
    assert first["holdout"]["candidate"]["pr_auc"] > first["holdout"]["baseline"]["pr_auc"]

    second = retrain(csv_path)
    assert second["current"] == first["candidate"]
    assert second["promoted"] is True
    assert second["reason"] == "not worse than the current model"

    runs = [json.loads(line) for line in (artifacts / "runs.jsonl").read_text().splitlines()]
    assert [r["candidate"] for r in runs] == [first["candidate"], second["candidate"]]


def test_too_little_data_is_logged_and_never_promoted(tmp_path, artifacts):
    csv_path = tmp_path / "bookings.csv"
    synthetic_export(csv_path, clients=10, visits=3)
    run = retrain(csv_path)
    assert run["promoted"] is False
    assert "labelled bookings" in run["reason"]
    assert not (artifacts / "current.txt").exists()
    assert (artifacts / "runs.jsonl").exists()


@pytest.mark.parametrize(
    ("candidate", "current", "promoted"),
    [
        ({"pr_auc": 0.30, "brier": 0.14}, None, True),
        ({"pr_auc": 0.30, "brier": 0.14}, {"pr_auc": 0.30, "brier": 0.14}, True),
        ({"pr_auc": 0.297, "brier": 0.141}, {"pr_auc": 0.30, "brier": 0.14}, True),
        ({"pr_auc": 0.29, "brier": 0.14}, {"pr_auc": 0.30, "brier": 0.14}, False),
        ({"pr_auc": 0.31, "brier": 0.15}, {"pr_auc": 0.30, "brier": 0.14}, False),
    ],
)
def test_promotion_rule(candidate, current, promoted):
    assert should_promote(candidate, current)[0] is promoted
