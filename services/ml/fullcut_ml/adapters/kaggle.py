"""Maps the Kaggle "Medical Appointment No Shows" CSV onto BookingRecords.

patient -> client, ScheduledDay -> created_at, AppointmentDay -> starts_at (date only).
Demographic and health columns are deliberately dropped here so nothing downstream can use them.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from fullcut_ml.schema import BookingRecord

SHOP_ID = "kaggle-vitoria"
# The clinics are in Vitória, Espírito Santo (Brazil).
SHOP_TIMEZONE = "America/Sao_Paulo"
USED_COLUMNS = [
    "PatientId",
    "AppointmentID",
    "ScheduledDay",
    "AppointmentDay",
    "SMS_received",
    "No-show",
]


@dataclass(frozen=True)
class AdapterResult:
    records: list[BookingRecord]
    rows_read: int
    dropped_scheduled_after_appointment: int


def _client_id(raw: str) -> str:
    # Some exports write the id in float notation ("2.98725e+13").
    return str(int(Decimal(raw.strip())))


def load_kaggle_csv(path: Path | str) -> AdapterResult:
    df = pd.read_csv(path, usecols=USED_COLUMNS, dtype=str).rename(columns={"No-show": "NoShow"})
    zone = ZoneInfo(SHOP_TIMEZONE)
    records: list[BookingRecord] = []
    dropped = 0
    for row in df.itertuples(index=False):
        created_at = datetime.fromisoformat(row.ScheduledDay.replace("Z", "+00:00")).astimezone(UTC)
        appointment_date = datetime.fromisoformat(row.AppointmentDay.replace("Z", "+00:00")).date()
        starts_at = datetime.combine(appointment_date, datetime.min.time(), zone).astimezone(UTC)
        if created_at.astimezone(zone).date() > appointment_date:
            dropped += 1
            continue
        records.append(
            BookingRecord(
                booking_id=str(row.AppointmentID).strip(),
                shop_id=SHOP_ID,
                client_id=_client_id(row.PatientId),
                created_at=created_at,
                starts_at=starts_at,
                status="no_show" if row.NoShow.strip() == "Yes" else "completed",
                shop_timezone=SHOP_TIMEZONE,
                has_start_time=False,
                sms_reminder_sent=row.SMS_received.strip() == "1",
            )
        )
    return AdapterResult(
        records=records, rows_read=len(df), dropped_scheduled_after_appointment=dropped
    )
