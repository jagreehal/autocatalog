"""@autocatalog_event decorator for marking Pydantic models as Autocatalog events."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

AUTOCATALOG_META_ATTR = "__autocatalog_meta__"

T = TypeVar("T")

_REQUIRED = ("id", "version", "name", "summary")


def autocatalog_event(
    *,
    id: str,
    version: str,
    name: str,
    summary: str,
    domain: str | None = None,
    status: str = "active",
    producers: list[str] | None = None,
    consumers: list[str] | None = None,
    consumer_fields: dict[str, list[str]] | None = None,
    tags: list[str] | None = None,
    badges: list[dict[str, Any]] | None = None,
    owner: dict[str, Any] | None = None,
    delivery: dict[str, Any] | None = None,
) -> Callable[[T], T]:
    """Attach Autocatalog IR metadata to a Pydantic model class."""
    for field in _REQUIRED:
        if locals()[field] is None:
            raise TypeError(f"autocatalog_event missing required keyword: {field}")

    meta: dict[str, Any] = {
        "id": id, "version": version, "name": name, "summary": summary,
        "status": status,
    }
    if domain is not None:
        meta["domain"] = domain
    if producers is not None:
        meta["producers"] = producers
    if consumers is not None:
        meta["consumers"] = consumers
    if consumer_fields is not None:
        meta["consumerFields"] = consumer_fields
    if tags is not None:
        meta["tags"] = tags
    if badges is not None:
        meta["badges"] = badges
    if owner is not None:
        meta["owner"] = owner
    if delivery is not None:
        meta["delivery"] = delivery

    def wrap(cls: T) -> T:
        setattr(cls, AUTOCATALOG_META_ATTR, meta)
        return cls

    return wrap
