import sys
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
sys.path.insert(0, str(FIXTURES))

from autocatalog_py.runner import run_extract


def test_extract_writes_both_fixtures(tmp_path: Path):
    result = run_extract(
        modules=["sample_decorated", "sample_markered"],
        out=tmp_path,
    )
    assert result.events_written == 2
    assert (tmp_path / "payment/PaymentCompleted/autocatalog.json").exists()
    assert (tmp_path / "kyc/KycSubmitted/autocatalog.json").exists()


def test_extract_returns_zero_for_empty_input(tmp_path: Path):
    result = run_extract(modules=[], out=tmp_path)
    assert result.events_written == 0


def test_extract_reports_a_broken_module_and_keeps_going(tmp_path: Path):
    result = run_extract(
        modules=["sample_broken", "sample_decorated"],
        out=tmp_path,
    )
    # The healthy module is still extracted: one bad module must not lose the batch.
    assert result.events_written == 1
    assert (tmp_path / "payment/PaymentCompleted/autocatalog.json").exists()
    # The failure is reported with its exception type, not just a bare message.
    assert len(result.errors) == 1
    assert result.errors[0].startswith("sample_broken: ValueError:")
