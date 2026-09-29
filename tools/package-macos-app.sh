#!/usr/bin/env bash
set -euo pipefail

binary=${1:?Usage: package-macos-app.sh <atd-macos binary>}
version=$(node -p 'require("./package.json").version')
app=release/AnotherTodo.app
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/Resources/atd-macos"
chmod +x "$app/Contents/Resources/atd-macos"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>AnotherTodo</string>
  <key>CFBundleDisplayName</key><string>AnotherTodo</string>
  <key>CFBundleIdentifier</key><string>com.meredith2328.anothertodo</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleExecutable</key><string>AnotherTodo</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
PLIST

cat > "$app/Contents/MacOS/AnotherTodo" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
binary="$(cd "$(dirname "$0")/.." && pwd)/Resources/atd-macos"
osascript - "$binary" <<'APPLESCRIPT'
on run argv
  set binaryPath to item 1 of argv
  tell application "Terminal"
    activate
    do script quoted form of binaryPath
  end tell
end run
APPLESCRIPT
LAUNCHER
chmod +x "$app/Contents/MacOS/AnotherTodo"
plutil -lint "$app/Contents/Info.plist"
codesign --force --deep --sign - "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" AnotherTodo-macos-arm64.zip

# 磁盘映像：打开后把 AnotherTodo 拖到旁边的「应用程序」即可安装，是 Mac 上最常见的装法
staging=release/dmg
rm -rf "$staging"
mkdir -p "$staging"
cp -R "$app" "$staging/"
ln -s /Applications "$staging/Applications"
hdiutil create -quiet -volname AnotherTodo -srcfolder "$staging" -fs HFS+ -format UDZO -ov AnotherTodo-macos-arm64.dmg
