import sys
from pathlib import Path

from click.testing import CliRunner

FIXTURES = Path(__file__).parent / "fixtures"
sys.path.insert(0, str(FIXTURES))

from autocatalog_py.cli import cli


def test_extract_subcommand(tmp_path: Path):
    runner = CliRunner()
    result = runner.invoke(
        cli,
        ["extract", "--module", "sample_decorated", "--out", str(tmp_path)],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "payment/PaymentCompleted/autocatalog.json").exists()


def test_extract_with_no_modules_warns(tmp_path: Path):
    runner = CliRunner()
    result = runner.invoke(cli, ["extract", "--out", str(tmp_path)])
    assert result.exit_code != 0
