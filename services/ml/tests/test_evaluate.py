import numpy as np
import pytest

from fullcut_ml.evaluate import compute_metrics, top_fraction_precision_recall


def test_top_fraction_hand_computed():
    y = np.array([1, 0, 1, 0, 0, 0, 0, 0, 0, 1])
    scores = np.array([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05])
    # Top 20% of 10 = the 2 riskiest: one no-show out of three in total.
    precision, recall = top_fraction_precision_recall(y, scores)
    assert precision == pytest.approx(0.5)
    assert recall == pytest.approx(1 / 3)


def test_metrics_hand_computed():
    y = np.array([0, 0, 1, 1])
    scores = np.array([0.1, 0.4, 0.35, 0.8])
    m = compute_metrics(y, scores)
    # 3 of the 4 positive/negative pairs are ranked correctly.
    assert m["roc_auc"] == pytest.approx(0.75)
    # Ranked: 0.8 (hit), 0.4 (miss), 0.35 (hit) -> AP = (1/1 + 2/3) / 2
    assert m["pr_auc"] == pytest.approx((1 + 2 / 3) / 2)
    assert m["brier"] == pytest.approx((0.01 + 0.16 + 0.65**2 + 0.04) / 4)
    assert m["base_rate"] == 0.5
    assert m["top20_precision"] == 1.0
    assert m["top20_recall"] == 0.5


def test_single_class_slice_has_no_auc():
    m = compute_metrics(np.array([0, 0, 0]), np.array([0.1, 0.2, 0.3]))
    assert m["roc_auc"] is None
    assert m["pr_auc"] is None
