"""The saved model artifact. Training writes it; the scoring service loads it."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression

from fullcut_ml.features import CATEGORICAL_FEATURES, FEATURE_NAMES


class PlattCalibrator:
    """Logistic fit on the logit of the raw score: monotonic, so ranking metrics are unchanged."""

    def __init__(self) -> None:
        self._model = LogisticRegression()

    @staticmethod
    def _logit(scores: np.ndarray) -> np.ndarray:
        p = np.clip(np.asarray(scores, dtype=float), 1e-6, 1 - 1e-6)
        return np.log(p / (1 - p)).reshape(-1, 1)

    def fit(self, scores: np.ndarray, y: np.ndarray) -> "PlattCalibrator":
        self._model.fit(self._logit(scores), y)
        return self

    def predict(self, scores: np.ndarray) -> np.ndarray:
        return self._model.predict_proba(self._logit(scores))[:, 1]


@dataclass
class ScoringModel:
    version: str
    kind: str
    estimator: Any
    calibrator: PlattCalibrator | None
    shop_base_rate: float

    def predict_raw(self, frame: pd.DataFrame) -> np.ndarray:
        return self.estimator.predict_proba(frame[FEATURE_NAMES])[:, 1]

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        raw = self.predict_raw(frame)
        return self.calibrator.predict(raw) if self.calibrator is not None else raw

    def contributions(self, frame: pd.DataFrame) -> dict[str, float]:
        """Log-odds contribution of each feature to the first row's raw score."""
        x = frame[FEATURE_NAMES].iloc[:1]
        if isinstance(self.estimator, LGBMClassifier):
            values = self.estimator.predict(x, pred_contrib=True)[0][: len(FEATURE_NAMES)]
            return dict(zip(FEATURE_NAMES, map(float, values), strict=True))

        # Numeric columns are standardised, so coef * value is relative to the training average.
        transform, logistic = self.estimator[:-1], self.estimator[-1]
        values = np.asarray(transform.transform(x))[0] * logistic.coef_[0]
        out = dict.fromkeys(FEATURE_NAMES, 0.0)
        for column, value in zip(transform.get_feature_names_out(), values, strict=True):
            out[_source_feature(column)] += float(value)
        return out

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, path)

    @staticmethod
    def load(path: Path) -> "ScoringModel":
        model = joblib.load(path)
        if not isinstance(model, ScoringModel):
            raise TypeError(f"{path} is not a ScoringModel artifact")
        return model


def _source_feature(column: str) -> str:
    """'num__missingindicator_local_hour' -> 'local_hour', 'cat__weekday_3' -> 'weekday'."""
    name = column.split("__", 1)[-1].removeprefix("missingindicator_")
    if name in FEATURE_NAMES:
        return name
    return next(f for f in CATEGORICAL_FEATURES if name.startswith(f"{f}_"))
