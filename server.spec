# -*- mode: python ; coding: utf-8 -*-
# PyInstaller 打包配置：把 static/ 和 replay/ 打进单文件可执行文件。

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('static', 'static'),
        ('replay', 'replay'),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='claude-trajectory-viewer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
