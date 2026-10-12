---
title: Events from Pydantic
owner: Maintainers
summary: The same catalog, extracted from Python models.
tags:
  - events
  - python
related:
  - docs/events/zod
  - docs/events/json-schema
---

Python models produce the same on-disk interchange as TypeScript ones. A polyglot
estate ends up with one catalog, not two.

```bash
pip install autocatalog-py
```

## Inline metadata

```python
# myapp/events.py
from pydantic import BaseModel, ConfigDict

class PaymentCompleted(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "autocatalog": {
                "id": "payment.completed",
                "version": "1.0.0",
                "name": "Payment Completed",
                "summary": "Fires when a payment completes",
                "domain": "payments",
                "team": "Billing",
                "producers": ["PaymentService"],
                "consumers": ["LedgerService"],
                "tags": ["pci"],
                "delivery": {"guarantee": "at-least-once", "idempotencyKey": "id"},
            }
        }
    )
    id: str
    amount: float
    currency: str
```

`delivery` says what consumers may rely on about arrival; see
[Delivery](/docs/events/json-schema#delivery). The decorator takes it as
`delivery=`.

## Three ways to be discovered

**Decorator** — explicit and readable:

```python
from autocatalog_py.decorator import autocatalog_event

@autocatalog_event(
    id="payment.completed",
    version="1.0.0",
    name="Payment Completed",
    summary="Fires when a payment completes",
)
class PaymentCompleted(BaseModel):
    id: str
    amount: float
```

**Inner class** — no import required:

```python
class PaymentCompleted(BaseModel):
    id: str
    amount: float

    class Autocatalog:
        id = "payment.completed"
        version = "1.0.0"
        name = "Payment Completed"
        summary = "Fires when a payment completes"
```

**Marker export** — point at the models from module level:

```python
class PaymentCompleted(BaseModel):
    id: str
    amount: float

AUTOCATALOG_EVENTS = [PaymentCompleted]
```

## Extract

```bash
autocatalog-py extract --module myapp.events --out ./events
```

The extractor imports the module, finds marked or decorated models, calls
`model.model_json_schema()` for the schema file, and writes the same event folder
structure the TypeScript path writes.

Because extraction imports your module, run it where importing that module is
safe — the same rule the [production](/docs/production) page sets out for runtime
adapters.
