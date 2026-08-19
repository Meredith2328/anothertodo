# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec：atd 单文件二进制（Windows .exe / macOS / Linux 通用）
# 构建：python -m PyInstaller atd.spec --noconfirm --clean
# 说明：PyInstaller 不能交叉编译——各平台必须在本平台构建。
#       三平台构建矩阵见 .github/workflows/build.yml。

import pathlib
import sys

from PyInstaller.utils.hooks import collect_data_files

block_cipher = None

IS_WIN = sys.platform == "win32"

hiddenimports = [
    "atd.cli",
    "atd.tui",
    "atd.sync",
    "atd.remind.watcher",
    "atd.remind.hooks",
]

# windows-toasts 只装 Windows；其 winrt 依赖链需显式收集
if IS_WIN:
    hiddenimports += [
        "winrt",
        "winrt.windows.ui.notifications",
        "winrt.windows.data.xml.dom",
        "winrt.windows.foundation",
        "winrt.windows.foundation.collections",
    ]

# conda 环境的 _ctypes 依赖 ffi-8.dll（Library/bin 下，PyInstaller 默认不收）
ffi_binaries = []
if IS_WIN:
    ffi = pathlib.Path(sys.base_prefix, "Library", "bin", "ffi-8.dll")
    if ffi.exists():
        ffi_binaries = [(str(ffi), ".")]

datas = collect_data_files("textual")
if IS_WIN:
    datas += collect_data_files("windows_toasts")

a = Analysis(
    ["atd_entry.py"],
    pathex=["."],
    binaries=ffi_binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "pydoc_data"],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="atd",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,          # TUI 需要控制台/终端
    disable_windowed_traceback=False,
    icon=None,              # 有图标后放 docs/atd.ico
)
