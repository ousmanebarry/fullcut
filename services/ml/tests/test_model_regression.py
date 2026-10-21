"""The saved model must keep its AUC on the fixed test period. Needs the Kaggle CSV and a trained
artifact (`uv run python -m fullcut_ml.train`), so it is skipped in CI."""

import json

import pytest
from sklearn.metrics import average_precision_score, roc_auc_score

from fullcut_ml.adapters.kaggle import load_kaggle_csv
from fullcut_ml.features import FEATURE_NAMES
from fullcut_ml.model import ScoringModel
from fullcut_ml.train import ARTIFACTS, DEFAULT_CSV, DOCS, prepare_dataset

TOLERANCE = 0.01
CURRENT = ARTIFACTS / "current.txt"

pytestmark = pytest.mark.skipif(
    not DEFAULT_CSV.exists() or not CURRENT.exists(),
    reason="needs services/ml/data/raw CSV and a trained artifact",
)


def test_saved_model_keeps_reported_auc():
    version = CURRENT.read_text().strip()
    model = ScoringModel.load(ARTIFACTS / version / "model.joblib")
    reported = json.loads((DOCS / "noshow-prototype-metrics.json").read_text())
    expected = reported["models"][reported["selected_model"]]["test"]

    data = prepare_dataset(load_kaggle_csv(DEFAULT_CSV).records)
    test = data.frame[data.test]
    scores = model.predict(test[FEATURE_NAMES])

    assert data.shop_base_rate == pytest.approx(model.shop_base_rate)
    assert roc_auc_score(test["label"], scores) == pytest.approx(expected["roc_auc"], abs=TOLERANCE)
    assert average_precision_score(test["label"], scores) == pytest.approx(
        expected["pr_auc"], abs=TOLERANCE
    )
