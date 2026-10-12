"""Click CLI for autocatalog-py."""
from __future__ import annotations

import sys
from pathlib import Path

import click

from .runner import run_extract


@click.group()
def cli() -> None:
    """Extract Autocatalog events from Pydantic models."""


@cli.command()
@click.option("-m", "--module", "modules", multiple=True, help="Python module path (repeatable)")
@click.option(
    "-o", "--out", required=True, type=click.Path(file_okay=False, path_type=Path),
    help="Output events directory",
)
def extract(modules: tuple[str, ...], out: Path) -> None:
    """Discover event models in MODULES and write event folders into OUT."""
    if not modules:
        click.echo("error: at least one --module is required", err=True)
        sys.exit(2)
    out.mkdir(parents=True, exist_ok=True)
    result = run_extract(modules=list(modules), out=out)
    for err in result.errors:
        click.echo(f"  ! {err}", err=True)
    click.echo(f"wrote {result.events_written} event(s) to {out}")
    sys.exit(1 if result.errors else 0)


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
