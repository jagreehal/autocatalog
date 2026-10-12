"""Write a DiscoveredEvent to disk as an Autocatalog event folder."""
from __future__ import annotations

import json
import re
from pathlib import Path

from .discover import DiscoveredEvent
from .ir import EventFrontmatter, Provenance

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _pascal(input_str: str) -> str:
    parts = [p for p in _NON_ALNUM.split(input_str.lower()) if p]
    return "".join(p[0].upper() + p[1:] for p in parts)


def _safe_segment(value: str, label: str) -> str:
    windows_reserved = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$", re.IGNORECASE)
    if (
        not value
        or value in {".", ".."}
        or "/" in value
        or "\\" in value
        or any(ord(char) < 32 or char in '<>:"|?*' for char in value)
        or value.endswith((".", " "))
        or windows_reserved.match(value)
    ):
        raise ValueError(f"Unsafe {label} path segment: {value!r}")
    return value


def write_event_folder(event: DiscoveredEvent, out_root: Path) -> Path:
    """Write an event folder; returns the absolute folder path."""
    domain = _safe_segment(event.domain or event.id.split(".")[0], "domain")
    folder_name = _safe_segment(_pascal(event.id), "folder name")
    folder = Path(out_root) / domain / folder_name
    examples_dir = folder / "examples"
    examples_dir.mkdir(parents=True, exist_ok=True)

    manifest = EventFrontmatter(
        id=event.id,
        version=event.version,
        name=event.name,
        summary=event.summary,
        domain=domain,
        owner=event.owner,
        status=event.status,
        producers=event.producers,
        consumers=event.consumers,
        consumerFields=event.consumer_fields,
        delivery=event.delivery,
        tags=event.tags,
        badges=event.badges,
        schema="./schema.json",
        examples=[],
        provenance=Provenance(default="extracted"),
    )
    (folder / "autocatalog.json").write_text(
        json.dumps(manifest.model_dump(mode="json", by_alias=True, exclude_none=True), indent=2)
        + "\n"
    )

    # index.mdx is optional human-authored narrative; preserve it on reruns.
    mdx_path = folder / "index.mdx"
    if not mdx_path.exists():
        mdx_path.write_text(event.summary + "\n")

    # schema.json — always overwrite from the Pydantic model
    schema = event.model.model_json_schema()
    (folder / "schema.json").write_text(json.dumps(schema, indent=2) + "\n")

    # No examples are extracted from Pydantic; preserve any existing example files
    # (the user may add example payloads by hand under examples/*.json).

    return folder
