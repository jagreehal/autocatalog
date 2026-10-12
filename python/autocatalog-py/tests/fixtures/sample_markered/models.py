from pydantic import BaseModel


class KycSubmitted(BaseModel):
    applicantId: str

    class Autocatalog:
        id = "kyc.submitted"
        version = "1.0.0"
        name = "KYC Submitted"
        summary = "Fires when a KYC submission is received"


AUTOCATALOG_EVENTS = [KycSubmitted]
