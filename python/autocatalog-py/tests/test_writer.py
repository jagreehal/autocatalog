import json
import sys
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
sys.path.insert(0, str(FIXTURES))

from autocatalog_py.discover import discover_events_from_module
from autocatalog_py.writer import write_event_folder


def test_writes_folder_structure(tmp_path: Path):
    events = discover_events_from_module("sample_decorated")
    assert len(events) == 1
    write_event_folder(events[0], tmp_path)
    folder = tmp_path / "payment" / "PaymentCompleted"
    manifest = json.loads((folder / "autocatalog.json").read_text())
    schema = json.loads((folder / "schema.json").read_text())
    assert manifest["spec"] == "autocatalog/v2"
    assert manifest["id"] == "payment.completed"
    assert manifest["version"] == "1.0.0"
    assert manifest["provenance"]["default"] == "extracted"
    assert schema["properties"]["amount"]["type"] == "integer"


def test_preserves_mdx_body_on_rerun(tmp_path: Path):
    events = discover_events_from_module("sample_decorated")
    write_event_folder(events[0], tmp_path)
    mdx_path = tmp_path / "payment" / "PaymentCompleted" / "index.mdx"
    mdx_path.write_text(mdx_path.read_text() + "\n\nHuman content\n")
    write_event_folder(events[0], tmp_path)
    assert "Human content" in mdx_path.read_text()


def test_writes_declared_consumer_fields(tmp_path: Path):
    from pydantic import BaseModel

    from autocatalog_py.decorator import autocatalog_event
    from autocatalog_py.discover import _build_event, _meta_from_class

    @autocatalog_event(
        id="order.placed", version="1.0.0", name="Order Placed", summary="s",
        consumers=["Billing", "Shipping"], consumer_fields={"Billing": ["total"]},
    )
    class OrderPlaced(BaseModel):
        total: int

    write_event_folder(_build_event(OrderPlaced, _meta_from_class(OrderPlaced)), tmp_path)
    manifest = json.loads((tmp_path / "order" / "OrderPlaced" / "autocatalog.json").read_text())
    assert manifest["consumerFields"] == {"Billing": ["total"]}
    # Nothing declared stays absent, as in the TS writer.
    assert "transport" not in manifest



def test_writes_declared_delivery(tmp_path: Path):
    from pydantic import BaseModel

    from autocatalog_py.decorator import autocatalog_event
    from autocatalog_py.discover import _build_event, _meta_from_class

    delivery = {
        "guarantee": "at-least-once",
        "orderingKey": "orderId",
        "idempotencyKey": "orderId",
        "maxLateness": "PT5M",
    }

    @autocatalog_event(
        id="order.placed", version="1.0.0", name="Order Placed", summary="s", delivery=delivery,
    )
    class OrderPlaced(BaseModel):
        orderId: str

    write_event_folder(_build_event(OrderPlaced, _meta_from_class(OrderPlaced)), tmp_path)
    manifest = json.loads((tmp_path / "order" / "OrderPlaced" / "autocatalog.json").read_text())
    assert manifest["delivery"] == delivery


def test_reads_delivery_from_an_autocatalog_inner_class():
    from pydantic import BaseModel

    from autocatalog_py.discover import _build_event, _meta_from_class

    class OrderPlaced(BaseModel):
        orderId: str

        class Autocatalog:
            id = "order.placed"
            version = "1.0.0"
            name = "Order Placed"
            summary = "s"
            delivery = {"orderingKey": "orderId"}

    assert _build_event(OrderPlaced, _meta_from_class(OrderPlaced)).delivery == {
        "orderingKey": "orderId"
    }
