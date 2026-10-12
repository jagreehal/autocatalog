from pydantic import BaseModel

from autocatalog_py.decorator import autocatalog_event


@autocatalog_event(
    id="payment.completed",
    version="1.0.0",
    name="Payment Completed",
    summary="Fires when a payment completes",
)
class PaymentCompleted(BaseModel):
    id: str
    amount: int
    currency: str
