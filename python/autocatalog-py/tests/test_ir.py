import pytest
from pydantic import ValidationError

from autocatalog_py.ir import AUTOCATALOG_SPEC_VERSION, EventFrontmatter


def test_minimal_frontmatter_applies_defaults():
    fm = EventFrontmatter(
        id="payment.completed",
        version="1.0.0",
        name="Payment Completed",
        summary="Fires when a payment completes",
    )
    assert fm.spec == AUTOCATALOG_SPEC_VERSION
    assert fm.status == "active"
    assert fm.producers == []
    assert fm.consumers == []
    assert fm.tags == []
    assert fm.badges == []
    assert fm.schema_path == "./schema.json"


def test_missing_required_fields_raises():
    with pytest.raises(ValidationError):
        EventFrontmatter(id="x", version="1")  # type: ignore[call-arg]


def test_unknown_status_raises():
    with pytest.raises(ValidationError):
        EventFrontmatter(
            id="a", version="1", name="a", summary="s", status="wat"  # type: ignore[arg-type]
        )


def test_unsupported_spec_raises():
    with pytest.raises(ValidationError):
        EventFrontmatter(
            spec="autocatalog/v1",  # type: ignore[arg-type]
            id="a",
            version="1",
            name="a",
            summary="s",
        )


def test_owner_and_badges_accepted():
    fm = EventFrontmatter(
        id="a", version="1", name="a", summary="s",
        owner={"team": "Payments", "contact": "https://example.com"},
        badges=[{"content": "Webhook", "backgroundColor": "#eee", "textColor": "#111"}],
    )
    assert fm.owner is not None and fm.owner.team == "Payments"
    assert fm.badges[0].content == "Webhook"


def test_classification_is_optional_and_closed():
    fm = EventFrontmatter(id="a", version="1", name="a", summary="s")
    assert fm.classification is None
    assert EventFrontmatter(
        id="a", version="1", name="a", summary="s", classification="integration"
    ).classification == "integration"
    with pytest.raises(ValidationError):
        EventFrontmatter(
            id="a", version="1", name="a", summary="s", classification="secret"  # type: ignore[arg-type]
        )


def test_delivery_matches_the_typescript_contract():
    base = {"id": "a", "version": "1", "name": "n", "summary": "s"}

    def accepted(delivery: dict) -> bool:
        try:
            EventFrontmatter.model_validate({**base, "delivery": delivery})
        except ValidationError:
            return False
        return True

    assert accepted({"guarantee": "exactly-once", "orderingKey": "id", "maxLateness": "P1DT2H"})
    assert accepted({"maxLateness": "PT0.5S"})
    assert accepted({"correlationKey": "meta.traceId"})
    assert not accepted({"correlationKey": ""})
    assert not accepted({"guarantee": "twice"})
    # Months and years have no fixed length, as in autocatalog-core.
    for lateness in ("P1M", "P1Y", "PT", "P", "5 minutes"):
        assert not accepted({"maxLateness": lateness}), lateness
