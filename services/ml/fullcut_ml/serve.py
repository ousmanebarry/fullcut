"""No-show scoring service.

    ML_SHARED_SECRET=... uv run uvicorn fullcut_ml.serve:create_app --factory --reload

Not public: every call except /health needs `Authorization: Bearer <ML_SHARED_SECRET>`.
"""

import hmac
import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from fullcut_ml.factors import describe
from fullcut_ml.features import Features, build_features, to_model_dtypes
from fullcut_ml.heuristic import HEURISTIC_VERSION, heuristic_score
from fullcut_ml.model import ScoringModel
from fullcut_ml.schema import BookingRecord

logger = logging.getLogger("fullcut_ml.serve")

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"
# Typical salon no-show rate, used until a shop has its own.
DEFAULT_BASE_RATE = 0.10
MAX_HISTORY = 500
MIN_SECRET_LENGTH = 32

Tier = Literal["low", "medium", "high", "unknown"]


@dataclass(frozen=True)
class Settings:
    shared_secret: str
    model_path: Path | None = None
    # Off by default: the Kaggle prototype must never be served to shops as a real model.
    model_enabled: bool = False
    min_shop_history: int = 200

    def __post_init__(self) -> None:
        if len(self.shared_secret) < MIN_SECRET_LENGTH:
            raise ValueError(f"ML_SHARED_SECRET must be at least {MIN_SECRET_LENGTH} characters")

    @classmethod
    def from_env(cls) -> "Settings":
        model_path = os.environ.get("ML_MODEL_PATH")
        current = ARTIFACTS / "current.txt"
        if not model_path and current.exists():
            model_path = str(ARTIFACTS / current.read_text().strip() / "model.joblib")
        return cls(
            shared_secret=os.environ.get("ML_SHARED_SECRET", ""),
            model_path=Path(model_path) if model_path else None,
            model_enabled=os.environ.get("ML_MODEL_ENABLED", "false").lower() == "true",
            min_shop_history=int(os.environ.get("ML_MIN_SHOP_HISTORY", "200")),
        )


class Thresholds(BaseModel):
    model_config = ConfigDict(extra="forbid")

    medium: float = Field(default=0.15, gt=0, lt=1)
    high: float = Field(default=0.35, gt=0, lt=1)

    @model_validator(mode="after")
    def _ordered(self) -> "Thresholds":
        if self.medium >= self.high:
            raise ValueError("medium threshold must be below high threshold")
        return self

    def tier(self, score: float) -> Tier:
        if score >= self.high:
            return "high"
        return "medium" if score >= self.medium else "low"


class ShopContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_rate: float | None = Field(default=None, ge=0, le=1)
    labelled_bookings: int = Field(default=0, ge=0)


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    booking_id: str
    shop_id: str
    booking: BookingRecord
    history: list[BookingRecord] = Field(default_factory=list, max_length=MAX_HISTORY)
    shop: ShopContext = Field(default_factory=ShopContext)
    thresholds: Thresholds = Field(default_factory=Thresholds)
    # Defaults to booking time; re-scoring closer to the appointment passes "now".
    as_of: AwareDatetime | None = None

    @model_validator(mode="after")
    def _consistent(self) -> "ScoreRequest":
        b = self.booking
        if b.booking_id != self.booking_id or b.shop_id != self.shop_id:
            raise ValueError("booking must match booking_id and shop_id")
        if any(h.shop_id != b.shop_id or h.client_id != b.client_id for h in self.history):
            raise ValueError("history must belong to the same shop and client")
        return self


class ScoreResponse(BaseModel):
    booking_id: str
    risk_score: float | None
    tier: Tier
    method: Literal["model", "heuristic"]
    model_version: str
    top_factors: list[str]


def request_features(req: ScoreRequest) -> Features:
    base_rate = req.shop.base_rate if req.shop.base_rate is not None else DEFAULT_BASE_RATE
    return build_features(req.booking, req.history, shop_base_rate=base_rate, as_of=req.as_of)


def score_request(
    req: ScoreRequest, settings: Settings, model: ScoringModel | None
) -> ScoreResponse:
    features = request_features(req)
    if (
        model is not None
        and settings.model_enabled
        and req.shop.labelled_bookings >= settings.min_shop_history
    ):
        try:
            frame = to_model_dtypes(pd.DataFrame([features]))
            score = float(model.predict(frame)[0])
            return ScoreResponse(
                booking_id=req.booking_id,
                risk_score=score,
                tier=req.thresholds.tier(score),
                method="model",
                model_version=model.version,
                top_factors=describe(features, model.contributions(frame)),
            )
        except Exception:
            logger.exception("model scoring failed; using heuristic")

    score, contributions = heuristic_score(features)
    return ScoreResponse(
        booking_id=req.booking_id,
        risk_score=score,
        tier=req.thresholds.tier(score),
        method="heuristic",
        model_version=HEURISTIC_VERSION,
        top_factors=describe(features, contributions),
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.model = None
        if settings.model_path is not None:
            try:
                app.state.model = ScoringModel.load(settings.model_path)
                logger.info("loaded model %s", app.state.model.version)
            except Exception:
                logger.exception("could not load %s; serving heuristic only", settings.model_path)
        yield

    app = FastAPI(
        title="Fullcut scoring", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None
    )

    def require_secret(authorization: Annotated[str | None, Header()] = None) -> None:
        expected = f"Bearer {settings.shared_secret}".encode()
        if authorization is None or not hmac.compare_digest(authorization.encode(), expected):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")

    @app.get("/health")
    def health(request: Request) -> dict[str, str | bool]:
        model: ScoringModel | None = request.app.state.model
        return {
            "status": "ok",
            "model_loaded": model is not None,
            "model_enabled": settings.model_enabled,
            "model_version": model.version if model else HEURISTIC_VERSION,
        }

    @app.post("/score", dependencies=[Depends(require_secret)])
    def score(req: ScoreRequest, request: Request) -> ScoreResponse:
        return score_request(req, settings, request.app.state.model)

    return app
