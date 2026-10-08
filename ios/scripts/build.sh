#!/bin/bash
set -euo pipefail
IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "${NARYADAI_XCODE_PATH:-}" ]]; then export DEVELOPER_DIR="${NARYADAI_XCODE_PATH}/Contents/Developer"; fi
if ! xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1; then
  echo 'Для сборки нужен полный Xcode с iOS SDK. Command Line Tools недостаточно.' >&2
  echo 'Откройте NaryadAI.xcodeproj в Xcode или задайте NARYADAI_XCODE_PATH=/Applications/Xcode.app.' >&2
  exit 2
fi
MODE="${1:-simulator}"
mkdir -p "$IOS_ROOT/build"
if [[ "$MODE" == simulator ]]; then
  xcodebuild -project "$IOS_ROOT/NaryadAI.xcodeproj" -scheme NaryadAI -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath "$IOS_ROOT/build/DerivedData" CODE_SIGNING_ALLOWED=NO build
elif [[ "$MODE" == archive || "$MODE" == ipa ]]; then
  : "${NARYADAI_APPLE_TEAM_ID:?Укажите NARYADAI_APPLE_TEAM_ID для подписи Apple}"
  xcodebuild -project "$IOS_ROOT/NaryadAI.xcodeproj" -scheme NaryadAI -configuration Release -destination 'generic/platform=iOS' -archivePath "$IOS_ROOT/build/NaryadAI.xcarchive" DEVELOPMENT_TEAM="$NARYADAI_APPLE_TEAM_ID" PRODUCT_BUNDLE_IDENTIFIER="${NARYADAI_BUNDLE_ID:-ai.naryad.ios}" -allowProvisioningUpdates archive
  if [[ "$MODE" == ipa ]]; then
    : "${NARYADAI_EXPORT_OPTIONS:?Укажите путь NARYADAI_EXPORT_OPTIONS к ExportOptions.plist из Xcode}"
    xcodebuild -exportArchive -archivePath "$IOS_ROOT/build/NaryadAI.xcarchive" -exportPath "$IOS_ROOT/build/ipa" -exportOptionsPlist "$NARYADAI_EXPORT_OPTIONS" -allowProvisioningUpdates
  fi
else
  echo 'Usage: build.sh simulator|archive|ipa' >&2; exit 2
fi
