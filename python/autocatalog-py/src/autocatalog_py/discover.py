"""Discover Autocatalog event models via decorator or marker export."""
from __future__ import annotations

import importlib
import pkgutil
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from .decorator import AUTOCATALOG_META_ATTR


@dataclass(frozen=True)
class DiscoveredEvent:
    id: str
    version: str
    name: str
    summary: str
    domain: str | None
    status: str
    producers: list[str]
    consumers: list[str]
    consumer_fields: dict[str, list[str]] | None
    tags: list[str]
    badges: list[dict[str, Any]]
    owner: dict[str, Any] | None
    model: type[BaseModel]
    delivery: dict[str, Any] | None = None


def _meta_from_json_schema_extra(cls: type[BaseModel]) -> dict[str, Any] | None:
    config = getattr(cls, "model_config", None)
    if not isinstance(config, dict):
        return None
    extra = config.get("json_schema_extra")
    if not isinstance(extra, dict):
        return None
    meta = extra.get("autocatalog")
    if not isinstance(meta, dict):
        return None
    if "team" in meta and "owner" not in meta:
        meta = dict(meta)
        meta["owner"] = {"team": meta.pop("team")}
    return meta


def _meta_from_class(cls: type[BaseModel]) -> dict[str, Any] | None:
    if hasattr(cls, AUTOCATALOG_META_ATTR):
        return getattr(cls, AUTOCATALOG_META_ATTR)
    eb = getattr(cls, "Autocatalog", None)
    if eb is None:
        return _meta_from_json_schema_extra(cls)
    meta: dict[str, Any] = {}
    for k in ("id", "version", "name", "summary", "domain", "status"):
        if hasattr(eb, k):
            meta[k] = getattr(eb, k)
    for k in ("producers", "consumers", "consumerFields", "tags", "badges", "owner", "delivery"):
        if hasattr(eb, k):
            meta[k] = getattr(eb, k)
    if "id" not in meta or "version" not in meta:
        return None
    return meta


def _build_event(cls: type[BaseModel], meta: dict[str, Any]) -> DiscoveredEvent:
    return DiscoveredEvent(
        id=meta["id"],
        version=meta["version"],
        name=meta["name"],
        summary=meta["summary"],
        domain=meta.get("domain"),
        status=meta.get("status", "active"),
        producers=meta.get("producers", []),
        consumers=meta.get("consumers", []),
        consumer_fields=meta.get("consumerFields"),
        tags=meta.get("tags", []),
        badges=meta.get("badges", []),
        owner=meta.get("owner"),
        model=cls,
        delivery=meta.get("delivery"),
    )


def discover_events_from_module(module_name: str) -> list[DiscoveredEvent]:
    """Recursively import a module (or package) and return all event models found."""
    root = importlib.import_module(module_name)
    visited: set[str] = set()
    found: list[DiscoveredEvent] = []
    seen_ids: set[tuple[str, str]] = set()

    def visit(mod: Any) -> None:
        if mod.__name__ in visited:
            return
        visited.add(mod.__name__)

        # Marker export
        markered = getattr(mod, "AUTOCATALOG_EVENTS", None)
        if isinstance(markered, list):
            for item in markered:
                if isinstance(item, type) and issubclass(item, BaseModel):
                    meta = _meta_from_class(item)
                    if meta is not None:
                        key = (meta["id"], meta["version"])
                        if key not in seen_ids:
                            seen_ids.add(key)
                            found.append(_build_event(item, meta))

        # Decorator
        for name in dir(mod):
            obj = getattr(mod, name)
            if isinstance(obj, type) and issubclass(obj, BaseModel):
                meta = _meta_from_class(obj)
                if meta is not None:
                    key = (meta["id"], meta["version"])
                    if key not in seen_ids:
                        seen_ids.add(key)
                        found.append(_build_event(obj, meta))

        # Walk subpackages
        if hasattr(mod, "__path__"):
            for sub in pkgutil.iter_modules(mod.__path__):
                child = importlib.import_module(f"{mod.__name__}.{sub.name}")
                visit(child)

    visit(root)
    return found
