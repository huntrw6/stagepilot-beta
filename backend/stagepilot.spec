"""PyInstaller recipe for the self-contained StagePilot backend sidecar."""

from PyInstaller.utils.hooks import collect_all, collect_submodules


datas: list[tuple[str, str]] = []
binaries: list[tuple[str, str]] = []
hiddenimports: list[str] = []

for package in ("keyring", "mido", "tzdata", "uvicorn"):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas.extend(package_datas)
    binaries.extend(package_binaries)
    hiddenimports.extend(package_hiddenimports)

hiddenimports.extend(collect_submodules("mido.backends"))
hiddenimports.extend(collect_submodules("keyring.backends"))

analysis = Analysis(
    ["src/stagepilot/__main__.py"],
    pathex=["src"],
    binaries=binaries,
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
    noarchive=False,
)
python_archive = PYZ(analysis.pure)

executable = EXE(
    python_archive,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="stagepilot-backend",
    console=False,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
)
