"""Canonical booking record. Mirrors Fullcut's `bookings` table so features never depend on a
specific data source."""

from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

BookingStatus = Literal["pending", "confirmed", "completed", "no_show", "cancelled", "released"]
BookingSource = Literal["direct", "phone", "walk_in", "import", "demo", "unknown"]

LABELLED_STATUSES: frozenset[str] = frozenset({"completed", "no_show"})


class BookingRecord(BaseModel):
    model_config = ConfigDict(frozen=True)

    booking_id: str
    shop_id: str
    client_id: str
    created_at: AwareDatetime
    starts_at: AwareDatetime
    status: BookingStatus
    shop_timezone: str = "UTC"
    # False when the source only knows the appointment date (Kaggle); hour features are then null.
    has_start_time: bool = True
    duration_minutes: int | None = Field(default=None, ge=0)
    price_cents: int | None = Field(default=None, ge=0)
    source: BookingSource = "unknown"
    cancelled_at: AwareDatetime | None = None
    sms_reminder_sent: bool = False
    confirm_requested: bool = False
    reminder_replied: bool = False

    @property
    def label(self) -> int | None:
        if self.status == "no_show":
            return 1
        if self.status == "completed":
            return 0
        return None
