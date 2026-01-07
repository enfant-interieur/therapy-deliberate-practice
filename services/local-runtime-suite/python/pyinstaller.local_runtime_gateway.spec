# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

hiddenimports = []
hiddenimports += collect_submodules("local_runtime.models")
hiddenimports += collect_submodules("local_runtime.api")
hiddenimports += collect_submodules("local_runtime.core")
hiddenimports += collect_submodules("local_runtime.helpers")
hiddenimports += collect_submodules("local_runtime.workers")
hiddenimports += [
    "mlx",
    "mlx.core",
    "mlx.nn",
    "mlx.optimizers",
    "mlx.utils",
    "mlx_lm",
    "mlx_lm.models",
    "mlx_lm.utils",
    "parakeet_mlx",
]

datas = []
datas += collect_data_files("mlx_lm", include_py_files=False)
datas += collect_data_files("parakeet_mlx", include_py_files=False)

a = Analysis(
    ["local_runtime/main.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=["pyinstaller-hooks"],
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=True,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    name="local-runtime-gateway",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)
