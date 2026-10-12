import json
import sys
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
sys.path.insert(0, str(FIXTURES))

from autocatalog_py.discover import discover_events_from_module
from autocatalog_py.writer import write_event_folder


def test_discovers_jsonextra_models():
    found = discover_events_from_module("sample_jsonextra")
    assert len(found) == 2
    found.sort(key=lambda e: e.id)
    inv_ev = found[0]
    ord_ev = found[1]

    assert inv_ev.id == "inventory.adjusted"
    assert inv_ev.producers == ["InventoryManager"]
    assert inv_ev.owner == {"team": "Warehouse"}

    assert ord_ev.id == "orders.placed"
    assert ord_ev.version == "1.0.0"
    assert ord_ev.name == "Order Placed"
    assert ord_ev.summary == "Fires when an order is placed"
    assert ord_ev.domain == "orders"
    assert ord_ev.producers == ["CheckoutService"]
    assert ord_ev.consumers == ["ShippingService", "InvoiceService"]
    assert ord_ev.tags == ["critical", "pci"]
    assert ord_ev.owner == {"team": "Fulfillment"}


def test_jsonextra_writes_canonical_manifest_with_metadata(tmp_path: Path):
    found = discover_events_from_module("sample_jsonextra")
    ord_ev = next(e for e in found if e.id == "orders.placed")
    write_event_folder(ord_ev, tmp_path)
    manifest = json.loads(
        (tmp_path / "orders" / "OrdersPlaced" / "autocatalog.json").read_text()
    )
    assert manifest["id"] == "orders.placed"
    assert manifest["version"] == "1.0.0"
    assert manifest["producers"] == ["CheckoutService"]
    assert manifest["consumers"] == ["ShippingService", "InvoiceService"]
    assert manifest["tags"] == ["critical", "pci"]
    assert manifest["owner"] == {"team": "Fulfillment"}


def test_jsonextra_schema_is_generated(tmp_path: Path):
    found = discover_events_from_module("sample_jsonextra")
    ord_ev = next(e for e in found if e.id == "orders.placed")
    write_event_folder(ord_ev, tmp_path)
    schema = json.loads((tmp_path / "orders" / "OrdersPlaced" / "schema.json").read_text())
    assert schema["properties"]["orderId"]["type"] == "string"
    assert schema["properties"]["amount"]["type"] == "number"
