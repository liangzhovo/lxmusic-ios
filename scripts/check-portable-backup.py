#!/usr/bin/env python3
"""Real Apple CryptoKit/CommonCrypto + production restore transaction tests."""
import hashlib, pathlib, platform, subprocess
ROOT = pathlib.Path(__file__).resolve().parent.parent
if platform.system() != 'Darwin':
    raise SystemExit('Apple SDK is required: this test is NOT a pass on non-Apple hosts.')
binary = ROOT/'build/checks/portable-backup-tests'; binary.parent.mkdir(parents=True, exist_ok=True)
sources = ['LXWebDAVCore.swift','LXLibrarySupport.swift','LXResumableTransfer.swift','LXPortableBackup.swift','LXStorageSnapshot.swift','LXRestoreCoordinator.swift','LXLibraryWorker.swift']
subprocess.run(['xcrun','swiftc','-swift-version','5',*[str(ROOT/'ios/LxMusicMobile'/name) for name in sources],str(ROOT/'scripts/tests/PortableBackupTests.swift'),'-o',str(binary)],check=True)
vector = hashlib.pbkdf2_hmac('sha256', b'local-test-password-88', bytes([7])*32, 600000, 32).hex()
subprocess.run([str(binary), vector], check=True, timeout=180)
