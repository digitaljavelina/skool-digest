#!/usr/bin/env bash
#
# package-macos.sh — Reproducible Developer ID build + notarization + DMG for the
# macOS Safari extension app, for distribution OUTSIDE the Mac App Store.
#
# Pipeline:
#   archive -> export (Developer ID) -> notarize app -> staple app
#          -> build DMG -> sign DMG -> notarize DMG -> staple DMG -> verify
#
# Both the .app and the .dmg get their own stapled notarization ticket, so each
# passes Gatekeeper offline on first launch. (Stapling the DMG does NOT staple
# the app inside it — they need separate tickets.)
#
# One-time setup (stores notary credentials in a named keychain profile):
#   xcrun notarytool store-credentials "$NOTARY_PROFILE" \
#     --key   /path/to/AuthKey_XXXXXXXXXX.p8 \
#     --key-id   XXXXXXXXXX \
#     --issuer   xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#   (App Store Connect API key: Users and Access -> Integrations -> App Store Connect API)
#
# Usage:
#   ./scripts/package-macos.sh                 # uses defaults below
#   NOTARY_PROFILE=my-profile ./scripts/package-macos.sh
#
set -euo pipefail

# ----------------------------------------------------------------------------
# Configuration (override via environment variables)
# ----------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${PROJECT:-$REPO_ROOT/Skool Daily Digest/Skool Daily Digest.xcodeproj}"
SCHEME="${SCHEME:-Skool Daily Digest (macOS)}"
CONFIGURATION="${CONFIGURATION:-Release}"
TEAM_ID="${TEAM_ID:-YHWHU4634V}"
APP_NAME="${APP_NAME:-Skool Daily Digest}"
DEV_ID_IDENTITY="${DEV_ID_IDENTITY:-Developer ID Application: Digital Javelina, LLC ($TEAM_ID)}"
NOTARY_PROFILE="${NOTARY_PROFILE:-skool-digest-notary}"
EXPORT_PLIST="${EXPORT_PLIST:-$REPO_ROOT/scripts/ExportOptions-developer-id.plist}"

# Output layout
DIST_DIR="${DIST_DIR:-$REPO_ROOT/dist/mac}"
ARCHIVE_PATH="$DIST_DIR/$APP_NAME.xcarchive"
EXPORT_DIR="$DIST_DIR/export"
APP_PATH="$EXPORT_DIR/$APP_NAME.app"

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ -e "$PROJECT" ] || die "Project not found: $PROJECT"
[ -e "$EXPORT_PLIST" ] || die "Export options not found: $EXPORT_PLIST"

# Read the marketing version straight from the project so the DMG name matches.
VERSION="$(xcodebuild -project "$PROJECT" -scheme "$SCHEME" -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/ MARKETING_VERSION / {print $2; exit}')"
VERSION="${VERSION:-1.0}"
ZIP_PATH="$DIST_DIR/$APP_NAME-$VERSION-macOS.zip"   # primary distribution artifact
DMG_PATH="$DIST_DIR/$APP_NAME-$VERSION-macOS.dmg"   # built only if the DMG can be signed

# Confirm notary credentials exist before doing expensive work.
step "Checking notary keychain profile: $NOTARY_PROFILE"
if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  die "No notary credentials for profile '$NOTARY_PROFILE'.
     Create them once with:
       xcrun notarytool store-credentials \"$NOTARY_PROFILE\" \\
         --key /path/to/AuthKey_XXXX.p8 --key-id XXXX --issuer <issuer-uuid>"
fi

mkdir -p "$DIST_DIR"

# ----------------------------------------------------------------------------
# 1. Archive
# ----------------------------------------------------------------------------
step "Archiving $SCHEME ($CONFIGURATION)"
rm -rf "$ARCHIVE_PATH"
xcodebuild archive \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -archivePath "$ARCHIVE_PATH" \
  -destination 'generic/platform=macOS' \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic

# ----------------------------------------------------------------------------
# 2. Export with the Developer ID certificate
# ----------------------------------------------------------------------------
step "Exporting Developer ID build"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_PLIST" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates

[ -d "$APP_PATH" ] || die "Exported app not found: $APP_PATH"

# Strip extended-attribute "detritus" (com.apple.FinderInfo, resource forks,
# fileprovider/quarantine xattrs). iCloud Drive / Desktop & Documents sync stamps
# freshly-built bundles with these, and the notary service rejects them. This does
# not break the signature: those xattrs were added after signing, not sealed by it.
step "Stripping extended attributes from exported app"
xattr -cr "$APP_PATH"

# Sanity: must be Developer ID + hardened runtime, or notarization will be rejected.
# Capture codesign output into a variable and test with bash string matching. Do NOT
# pipe into `awk ... exit` / `grep -q`: those close the pipe early, codesign dies with
# SIGPIPE, and under `set -o pipefail` that aborts the whole script with no message.
step "Verifying signature on exported app"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
SIGINFO="$(codesign -dvv "$APP_PATH" 2>&1)"
[[ "$SIGINFO" == *"Authority=Developer ID Application"* ]] \
  || die "App is not signed with a Developer ID Application certificate."
[[ "$SIGINFO" == *"flags="*"runtime"* ]] \
  || die "App is missing the hardened runtime (ENABLE_HARDENED_RUNTIME=YES). Notarization will fail."
AUTH="$(printf '%s\n' "$SIGINFO" | awk -F'Authority=' '/Authority=Developer ID Application/{v=$2} END{print v}')"
echo "Signed by: $AUTH"

# ----------------------------------------------------------------------------
# 3. Notarize the app, then staple its ticket
# ----------------------------------------------------------------------------
step "Notarizing app (this waits for Apple to finish)"
APP_ZIP="$DIST_DIR/$APP_NAME-app.zip"
/usr/bin/ditto -c -k --keepParent "$APP_PATH" "$APP_ZIP"
xcrun notarytool submit "$APP_ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
rm -f "$APP_ZIP"

step "Stapling ticket to app"
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"

# ----------------------------------------------------------------------------
# 4. Build the distribution ZIP (the primary artifact)
# ----------------------------------------------------------------------------
# A zip is the canonical format for distributing a notarized app. It needs no
# signature of its own: the app inside is signed, notarized, and stapled, so it
# launches cleanly once unzipped. `ditto -c -k --keepParent` makes a standard zip.
#
# CRITICAL: stage in a NON-synced temp dir, not in place. If we strip xattrs
# inside the iCloud-synced repo, the file-provider re-stamps com.apple.FinderInfo
# onto the bundle in the moment before ditto zips it. That detritus on the .appex
# makes Safari reject the extension as "no longer valid" (Gatekeeper is looser and
# still passes, which hides the problem). /var/folders is local and safe.
step "Building distribution zip"
ZIP_STAGE="$(mktemp -d)"
/usr/bin/ditto "$APP_PATH" "$ZIP_STAGE/$APP_NAME.app"
xattr -cr "$ZIP_STAGE/$APP_NAME.app"
codesign --verify --deep --strict "$ZIP_STAGE/$APP_NAME.app" \
  || die "Strict signature verification failed on the staged app (leftover xattr detritus?)."
rm -f "$ZIP_PATH"
/usr/bin/ditto -c -k --keepParent "$ZIP_STAGE/$APP_NAME.app" "$ZIP_PATH"
rm -rf "$ZIP_STAGE"

# ----------------------------------------------------------------------------
# 5. Optionally build a signed + notarized DMG (only when it can be signed)
# ----------------------------------------------------------------------------
# A DMG must be signed with Developer ID to pass Gatekeeper when downloaded. If no
# Developer ID identity is reachable from the command line (e.g. the certificate is
# cloud-managed and usable only inside Xcode), skip the DMG rather than ship an
# unsigned one that Gatekeeper rejects. To enable a signed DMG, add a local
# Developer ID Application certificate in Xcode > Settings > Accounts > Manage
# Certificates, then re-run.
DMG_BUILT=""
IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null || true)"
if [[ "$IDENTITIES" == *"Developer ID Application"* ]]; then
  step "Building DMG"
  STAGING="$(mktemp -d)"
  /usr/bin/ditto "$APP_PATH" "$STAGING/$APP_NAME.app"
  xattr -cr "$STAGING/$APP_NAME.app"   # ditto carries xattrs from the synced source; clear again
  codesign --verify --deep --strict "$STAGING/$APP_NAME.app" \
    || die "Strict signature verification failed on the staged app for the DMG."
  ln -s /Applications "$STAGING/Applications"
  rm -f "$DMG_PATH"
  hdiutil create -volname "$APP_NAME" -srcfolder "$STAGING" -fs HFS+ -format UDZO -ov "$DMG_PATH"
  rm -rf "$STAGING"
  xattr -cr "$DMG_PATH"

  step "Signing DMG with Developer ID"
  codesign --force --sign "$DEV_ID_IDENTITY" --timestamp "$DMG_PATH"

  step "Notarizing DMG"
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait

  step "Stapling ticket to DMG"
  xcrun stapler staple "$DMG_PATH"
  DMG_BUILT="yes"
else
  step "Skipping DMG (no Developer ID identity available to codesign)"
  echo "  Shipping the notarized zip instead. To also produce a signed DMG, add a Developer ID"
  echo "  Application certificate in Xcode > Settings > Accounts > Manage Certificates, then re-run."
fi

# ----------------------------------------------------------------------------
# 6. Final verification (what a downloader's Mac will check)
# ----------------------------------------------------------------------------
step "Verifying final artifacts"
echo "--- app staple ---";       xcrun stapler validate "$APP_PATH"
echo "--- app Gatekeeper ---";   spctl -a -t exec -vv "$APP_PATH"
if [[ -n "$DMG_BUILT" ]]; then
  echo "--- DMG staple ---";     xcrun stapler validate "$DMG_PATH"
  echo "--- DMG Gatekeeper ---"; spctl -a -t open --context context:primary-signature -vv "$DMG_PATH"
fi

printf '\n\033[1;32mDone.\033[0m\n'
echo "Artifact (zip): $ZIP_PATH"
[[ -n "$DMG_BUILT" ]] && echo "Artifact (dmg): $DMG_PATH"
echo "Publish it with:"
if [[ -n "$DMG_BUILT" ]]; then
  echo "  gh release create v$VERSION \"$ZIP_PATH\" \"$DMG_PATH\" --title \"v$VERSION\" --notes \"...\""
else
  echo "  gh release create v$VERSION \"$ZIP_PATH\" --title \"v$VERSION\" --notes \"...\""
fi
