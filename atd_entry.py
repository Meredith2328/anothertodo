"""atd exe 入口：PyInstaller 用（console 模式，进 cli.main）。"""
import os
import sys

# 冻结 exe 里没有 PYTHONUTF8 环境变量兜底，legacy 控制台默认 GBK，
# rich 打 ⏰/✓ 等 Unicode 会炸 —— 这里强制全链路 UTF-8
os.environ["PYTHONUTF8"] = "1"
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

if __name__ == "__main__":
    sys.argv[0] = "atd"
    from atd.cli import main
    raise SystemExit(main())
