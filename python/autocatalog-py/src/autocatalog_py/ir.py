"""Autocatalog IR — Python mirror of the TS Zod schema in autocatalog-core."""
from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import AnyUrl, BaseModel, Field, WithJsonSchema, field_validator

AUTOCATALOG_SPEC_VERSION = "autocatalog/v2"


class Owner(BaseModel):
    team: str
    name: Annotated[str, Field(min_length=1)] | None = None
    contact: Annotated[AnyUrl, WithJsonSchema({"type": "string", "format": "uri"})] | None = None


class Badge(BaseModel):
    content: str
    backgroundColor: str | None = None
    textColor: str | None = None


class ReplacedByRef(BaseModel):
    id: str
    version: str | None = None


class Deprecation(BaseModel):
    since: str
    replacedBy: ReplacedByRef | None = None
    notes: str | None = None


class Source(BaseModel):
    type: Literal["code", "github_clone", "url"] | None = None
    repo: str | None = None
    ref: str | None = None
    schema_path: str | None = Field(default=None, alias="schema")
    # Traceability back to the defining code (type: "code").
    file: str | None = None
    symbol: str | None = None
    line: Annotated[int, Field(gt=0)] | None = None

    model_config = {"populate_by_name": True}


class Transport(BaseModel):
    """Where the event travels; context for a reader, not part of the contract."""

    address: str | None = None
    protocols: list[str] = []
    deliveryMode: Literal["push", "pull", "push-pull"] | None = None
    routingKey: str | None = None
    headers: list[str] | None = None
    identity: str | None = None
    source: str | None = None
    detailType: str | None = None


# Days and smaller only, as durationSeconds in autocatalog-core: a month has no fixed length.
_DURATION = re.compile(
    r"^P(?:\d+(?:\.\d+)?D)?(?:T(?:\d+(?:\.\d+)?H)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?S)?)?$"
)


class Delivery(BaseModel):
    """What consumers may rely on about arrival; keys are payload paths."""

    guarantee: Literal["at-least-once", "at-most-once", "exactly-once"] | None = None
    orderingKey: Annotated[str, Field(min_length=1)] | None = None
    idempotencyKey: Annotated[str, Field(min_length=1)] | None = None
    correlationKey: Annotated[str, Field(min_length=1)] | None = None
    maxLateness: str | None = None

    @field_validator("maxLateness")
    @classmethod
    def _iso_duration(cls, value: str | None) -> str | None:
        if value is not None and (
            not _DURATION.match(value) or value == "P" or value.endswith("T")
        ):
            raise ValueError("must be an ISO 8601 duration in days or less, such as PT5M")
        return value


ProvenanceValue = Literal["declared", "extracted", "inferred", "overridden", "observed"]

Count = Annotated[int, Field(ge=0)]


class Provenance(BaseModel):
    default: ProvenanceValue = "declared"
    fields: dict[str, ProvenanceValue] = {}


class ObservationSource(BaseModel):
    producer: str | None = None
    channel: str | None = None
    count: Count
    firstSeen: str
    lastSeen: str


class DeadLetterReason(BaseModel):
    reason: Annotated[str, Field(max_length=200)]
    category: str | None = None
    queue: str | None = None
    count: Count


class ConsumerOutcome(BaseModel):
    consumer: str
    channel: str | None = None
    count: Count
    failed: Count | None = None
    retried: Count | None = None
    deadLettered: Count | None = None
    replayed: Count | None = None
    deadLetterReasons: Annotated[list[DeadLetterReason], Field(max_length=10)] | None = None


class ObservationSnapshot(BaseModel):
    spec: str
    generatedAt: str


class Observed(BaseModel):
    """What the running system was seen to do, from a runtime snapshot."""

    count: Count
    firstSeen: str
    lastSeen: str
    consumers: list[str] = []
    producers: list[str] = []
    sampleTraceIds: (
        Annotated[
            list[Annotated[str, Field(min_length=1, max_length=128)]],
            Field(max_length=10),
        ]
        | None
    ) = None
    sources: list[ObservationSource] | None = None
    consumerOutcomes: list[ConsumerOutcome] | None = None
    fieldPaths: list[str] | None = None
    fieldTypes: dict[str, list[str]] | None = None
    declaredConsumers: list[str] | None = None
    consumerEvidence: Literal["reported", "observed", "unknown"] | None = None
    snapshot: ObservationSnapshot


class CloudEventsEnvelope(BaseModel):
    type: Literal["cloudevents"]
    mode: Literal["structured", "binary"] = "structured"
    specversion: Literal["1.0"] = "1.0"


class EventFrontmatter(BaseModel):
    spec: Literal["autocatalog/v2"] = AUTOCATALOG_SPEC_VERSION
    id: Annotated[str, Field(min_length=1)]
    version: Annotated[str, Field(min_length=1)]
    name: Annotated[str, Field(min_length=1)]
    summary: Annotated[str, Field(min_length=1)]
    domain: str | None = None
    owner: Owner | None = None
    status: Literal["active", "deprecated", "draft"] = "active"
    # Audience, narrowest to widest; see CLASSIFICATION_VALUES in autocatalog-core.
    classification: Literal["internal", "domain", "integration", "public"] | None = None
    producers: list[str] = []
    consumers: list[str] = []
    # Payload paths each consumer reads (`items[].sku`); a consumer absent here has not said.
    consumerFields: dict[str, list[str]] | None = None
    tags: list[str] = []
    badges: list[Badge] = []
    schema_path: str = Field(default="./schema.json", alias="schema")
    examples: list[str] = []
    deprecation: Deprecation | None = None
    source: Source | None = None
    transport: list[Transport] | None = None
    delivery: Delivery | None = None
    envelope: CloudEventsEnvelope | None = None
    provenance: Provenance = Provenance()
    observed: Observed | None = None
    confidence: Annotated[float, Field(ge=0, le=1)] | None = None
    needsReview: bool = False

    model_config = {
        "populate_by_name": True,
    }
