"""Optional pipeline steps run offline with mocked subprocesses."""
from types import SimpleNamespace

import pytest

import run_all


@pytest.mark.parametrize("module", ["terrain", "pano", "uncertainty"])
def test_optional_command(monkeypatch, module):
    monkeypatch.setattr(run_all.importlib.util, "find_spec", lambda name: object())
    calls = []
    monkeypatch.setattr(run_all.subprocess, "run",
                        lambda cmd, **kw: calls.append((cmd, kw)) or SimpleNamespace(returncode=0))
    run_all.run_optional(module, "aa,bb")
    sel = ["--site", "aa", "--site", "bb"] if module == "uncertainty" else ["--only", "aa,bb"]
    assert calls == [([run_all.sys.executable, "-m", f"lln.{module}", *sel],
                      {"cwd": run_all.PIPELINE_DIR})]


def test_optional_missing(monkeypatch):
    monkeypatch.setattr(run_all.importlib.util, "find_spec", lambda name: None)
    warnings = []
    monkeypatch.setattr(run_all.export, "warn", warnings.append)
    monkeypatch.setattr(run_all.subprocess, "run", lambda *a, **k: pytest.fail("must skip"))
    run_all.run_optional("uncertainty")
    assert "not present" in warnings[0]


@pytest.mark.parametrize("raises", [False, True])
def test_optional_failure_continues(monkeypatch, raises):
    monkeypatch.setattr(run_all.importlib.util, "find_spec", lambda name: object())
    def fail(*args, **kwargs):
        if raises:
            raise OSError("cannot launch")
        return SimpleNamespace(returncode=1)
    monkeypatch.setattr(run_all.subprocess, "run", fail)
    warnings = []
    monkeypatch.setattr(run_all.export, "warn", warnings.append)
    run_all.run_optional("uncertainty")
    assert "continuing" in warnings[0]


@pytest.mark.parametrize("enabled", [False, True])
def test_optional_order_and_defaults(monkeypatch, enabled):
    calls = []
    monkeypatch.setattr(run_all.export, "load_sites", lambda p: [])
    monkeypatch.setattr(run_all, "run_horizons", lambda *a: None)
    monkeypatch.setattr(run_all.export, "export", lambda *a: calls.append("export"))
    monkeypatch.setattr(run_all, "run_optional", lambda module, only: calls.append((module, only)))
    args = ["--skip-ephem", "--skip-validate", "--only", "aa,bb"]
    if enabled:
        args += ["--terrain", "--pano", "--uncertainty"]
    run_all.main(args)
    assert calls == ([("uncertainty", "aa,bb"), "export", ("terrain", "aa,bb"),
                      ("pano", "aa,bb")] if enabled else ["export"])
