"""Orchestrate discovery + writing."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .discover import discover_events_from_module
from .writer import write_event_folder


@dataclass
class ExtractResult:
    events_written: int
    errors: list[str] = field(default_factory=list)


def run_extract(*, modules: list[str], out: Path) -> ExtractResult:
    written = 0
    errors: list[str] = []
    for module_name in modules:
        try:
            events = discover_events_from_module(module_name)
        # Deliberately broad: discovery imports and executes arbitrary user
        # modules, so the raisable set is unbounded. One bad module must not
        # abort the others; it is reported and extraction continues.
        except Exception as err:  # noqa: BLE001
            errors.append(f"{module_name}: {type(err).__name__}: {err}")
            continue
        for event in events:
            try:
                write_event_folder(event, out)
                written += 1
            # Same boundary: a single unwritable event must not lose the batch.
            except Exception as err:  # noqa: BLE001
                errors.append(f"{event.id}@{event.version}: {type(err).__name__}: {err}")
    return ExtractResult(events_written=written, errors=errors)
