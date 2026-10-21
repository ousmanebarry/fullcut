from datetime import UTC, datetime
from pathlib import Path

from fullcut_ml.adapters.kaggle import SHOP_ID, load_kaggle_csv

FIXTURE = Path(__file__).parent / "fixtures" / "kaggle_sample.csv"


def test_maps_rows_onto_booking_records():
    result = load_kaggle_csv(FIXTURE)

    assert result.rows_read == 4
    assert result.dropped_scheduled_after_appointment == 1
    assert [r.booking_id for r in result.records] == ["5642903", "5642904", "5642549"]

    first, second, third = result.records
    assert first.client_id == "29872499824296"
    assert first.shop_id == SHOP_ID
    assert first.created_at == datetime(2016, 4, 29, 18, 38, 8, tzinfo=UTC)
    # Appointment date only: local midnight in São Paulo (UTC-3).
    assert first.starts_at == datetime(2016, 4, 29, 3, 0, tzinfo=UTC)
    assert first.has_start_time is False
    assert first.status == "completed"
    assert first.sms_reminder_sent is False

    assert second.client_id == "29872499824300"
    assert second.status == "no_show"
    assert second.label == 1
    assert second.sms_reminder_sent is True

    assert third.status == "completed"
    assert third.label == 0


def test_never_exposes_demographic_or_health_columns():
    record = load_kaggle_csv(FIXTURE).records[0]
    fields = {name.lower() for name in type(record).model_fields}
    for banned in ("age", "gender", "neighbourhood", "scholarship", "hipertension", "diabetes"):
        assert banned not in fields
