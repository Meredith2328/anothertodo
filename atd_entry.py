"""atd exe 入口：PyInstaller 用（console 模式，进 cli.main）。"""
import sys
from atd.runtime import configure_utf8_output

configure_utf8_output()

if __name__ == "__main__":
    sys.argv[0] = "atd"
    from atd.cli import main
    raise SystemExit(main())
