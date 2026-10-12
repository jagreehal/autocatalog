from pydantic import BaseModel, ConfigDict


class OrderPlaced(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "autocatalog": {
                "id": "orders.placed",
                "version": "1.0.0",
                "name": "Order Placed",
                "summary": "Fires when an order is placed",
                "domain": "orders",
                "team": "Fulfillment",
                "producers": ["CheckoutService"],
                "consumers": ["ShippingService", "InvoiceService"],
                "tags": ["critical", "pci"],
            }
        }
    )
    orderId: str
    amount: float


class InventoryAdjusted(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "autocatalog": {
                "id": "inventory.adjusted",
                "version": "1.0.0",
                "name": "Inventory Adjusted",
                "summary": "Fires when inventory levels change",
                "team": "Warehouse",
                "producers": ["InventoryManager"],
            }
        }
    )
    sku: str
    delta: int


AUTOCATALOG_EVENTS = [OrderPlaced, InventoryAdjusted]
