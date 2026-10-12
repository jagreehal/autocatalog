"""Autocatalog IR — Python mirror of the TS Zod schema in autocatalog-core."""
from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, BaseModel, Field, field_validator

AUTOCATALOG_SPEC_VERSION = "autocatalog/v2"


class Owner(BaseModel):
    team: str
    name: str | None = None
    contact: AnyHttpUrl | None = None


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

    model_config = {"populate_by_name": True}


class Transport(BaseModel):
    """Where the event travels; context for a reader, not part of the contract."""

    address: str | None = None
    protocols: list[str] = Field(default_factory=list)
    deliveryMode: Literal["push", "pull", "push-pull"] | None = None


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


class Provenance(BaseModel):
    default: Literal["declared", "extracted", "inferred"] = "declared"
    fields: dict[str, Literal["declared", "extracted", "inferred"]] = Field(
        default_factory=dict
    )


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
    producers: list[str] = Field(default_factory=list)
    consumers: list[str] = Field(default_factory=list)
    # Payload paths each consumer reads (`items[].sku`); a consumer absent here has not said.
    consumerFields: dict[str, list[str]] | None = None
    tags: list[str] = Field(default_factory=list)
    badges: list[Badge] = Field(default_factory=list)
    schema_path: str = Field(default="./schema.json", alias="schema")
    examples: list[str] = Field(default_factory=list)
    deprecation: Deprecation | None = None
    source: Source | None = None
    transport: list[Transport] | None = None
    delivery: Delivery | None = None
    envelope: CloudEventsEnvelope | None = None
    provenance: Provenance = Field(default_factory=Provenance)
    confidence: Annotated[float, Field(ge=0, le=1)] | None = None
    needsReview: bool = False

    model_config = {
        "populate_by_name": True,
    }
