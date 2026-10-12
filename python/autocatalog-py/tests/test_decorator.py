import sys
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"
sys.path.insert(0, str(FIXTURES))

from autocatalog_py.decorator import AUTOCATALOG_META_ATTR, autocatalog_event
from autocatalog_py.discover import discover_events_from_module


def test_decorator_attaches_metadata():
    from sample_decorated.models import PaymentCompleted
    meta = getattr(PaymentCompleted, AUTOCATALOG_META_ATTR)
    assert meta["id"] == "payment.completed"
    assert meta["version"] == "1.0.0"


def test_discover_finds_decorated_models():
    found = discover_events_from_module("sample_decorated")
    assert len(found) == 1
    assert found[0].id == "payment.completed"
    assert found[0].name == "Payment Completed"


def test_discover_finds_markered_models():
    found = discover_events_from_module("sample_markered")
    assert len(found) == 1
    assert found[0].id == "kyc.submitted"


def test_autocatalog_event_rejects_missing_required():
    with pytest.raises(TypeError):
        autocatalog_event(id="x")  # missing version, name, summary
