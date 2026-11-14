import json
from pathlib import Path
import pytest
from pipeline.lln.metrics import compute_metrics, sun_fraction, horizon_at


def test_shared_metrics_fixture():
    case = json.loads((Path(__file__).parent / 'fixtures/metrics_case.json').read_text())
    result = compute_metrics(case['site'], case['startUtc'], case['hours'])
    for key, expected in case['expected'].items():
        if isinstance(expected, (int, float)):
            assert result[key] == pytest.approx(expected, abs=0.1 if key.endswith('Pct') else 1e-6)
        else:
            assert result[key] == expected


def test_coverage_and_events():
    case = json.loads((Path(__file__).parent / 'fixtures/metrics_case.json').read_text())
    result = compute_metrics(case['site'], '2026-11-01T06:00:00Z', 8)
    assert result['hours'] == 2
    assert result['hoursToSunset'] is None
    assert result['hoursToEarthset'] is None
    assert result['nextEarthWindow'] is None
    assert compute_metrics(case['site'], '2026-10-31T22:00:00Z', 4)['hours'] == 2


def test_disk_and_circular_horizon():
    assert sun_fraction(0, 0) == 0.5
    assert sun_fraction(-1, 0) == 0
    assert sun_fraction(1, 0) == 1
    mask = [0] * 720
    mask[-1] = 200
    assert horizon_at(mask, 359.75) == 1
