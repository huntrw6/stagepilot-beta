import tempfile
import unittest
from pathlib import Path

try:
    from scripts.beta_release_acceptance import CHECKS, PLATFORMS, record_check, record_installer, verify
except ModuleNotFoundError:
    from beta_release_acceptance import CHECKS, PLATFORMS, record_check, record_installer, verify


class AcceptanceReportTests(unittest.TestCase):
    def test_complete_matrix_passes_and_hashes_installers(self):
        report = {"schema": 1, "platforms": {}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for platform in PLATFORMS:
                for version in ("1.1.103-beta.1", "1.1.103-beta.2"):
                    suffix = {
                        "windows-x86_64": "x64-setup.exe",
                        "darwin-aarch64": "aarch64.dmg",
                        "darwin-x86_64": "x64.dmg",
                    }[platform]
                    installer = root / f"StagePilot_{version}_{suffix}"
                    installer.write_bytes(f"{platform}-{version}".encode())
                    record_installer(report, platform, version, installer)
                for check in CHECKS:
                    record_check(report, platform, check, f"local receipt for {check}")
        self.assertEqual(verify(report, "1.1.103-beta.1", "1.1.103-beta.2"), [])
        self.assertEqual(len(report["platforms"][PLATFORMS[0]]["installers"][0]["sha256"]), 64)

    def test_incomplete_matrix_fails_and_sensitive_evidence_is_rejected(self):
        report = {"schema": 1, "platforms": {}}
        self.assertTrue(verify(report, "1.1.103-beta.1", "1.1.103-beta.2"))
        with self.assertRaises(ValueError):
            record_check(report, PLATFORMS[0], CHECKS[0], "Bearer should-not-be-recorded")

    def test_invalid_schema_and_forged_receipts_fail(self):
        report = {"schema": 999, "platforms": {}}
        for platform in PLATFORMS:
            report["platforms"][platform] = {
                "installers": [
                    {"version": version, "filename": "wrong.bin", "size": 0, "sha256": "not-a-hash"}
                    for version in ("1.1.103-beta.1", "1.1.103-beta.2")
                ],
                "checks": {check: {"passed": True, "evidence": "token=leaked"} for check in CHECKS},
            }
        failures = verify(report, "1.1.103-beta.1", "1.1.103-beta.2")
        self.assertIn("unsupported report schema", failures)
        self.assertTrue(any("invalid installer hash" in failure for failure in failures))
        self.assertTrue(any("invalid evidence" in failure for failure in failures))

    def test_boolean_installer_size_is_rejected(self):
        report = {"schema": 1, "platforms": {}}
        for platform in PLATFORMS:
            suffix = {
                "windows-x86_64": "x64-setup.exe",
                "darwin-aarch64": "aarch64.dmg",
                "darwin-x86_64": "x64.dmg",
            }[platform]
            report["platforms"][platform] = {
                "installers": [
                    {
                        "version": version,
                        "filename": f"StagePilot_{version}_{suffix}",
                        "size": True,
                        "sha256": "a" * 64,
                    }
                    for version in ("1.1.103-beta.1", "1.1.103-beta.2")
                ],
                "checks": {check: {"passed": True, "evidence": "local receipt"} for check in CHECKS},
            }
        failures = verify(report, "1.1.103-beta.1", "1.1.103-beta.2")
        self.assertTrue(any("invalid installer size" in failure for failure in failures))


if __name__ == "__main__":
    unittest.main()
