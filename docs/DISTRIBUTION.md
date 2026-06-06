# Distributing Skool Daily Digest outside the App Store

This app ships two targets: a **macOS** Safari-extension app and an **iOS**
Safari-extension app. Only the macOS one can be distributed directly on GitHub.
The iOS reality is covered at the bottom.

The macOS app is distributed as a **notarized `.zip`** (the default). A `.dmg`
is also supported, but only when a Developer ID certificate is available to sign
it (see the DMG note below). The security comes from notarizing the app, not the
wrapper, so the zip is fully warning-free.

---

## macOS: notarized app on GitHub Releases

### Why each step exists

To run on someone else's Mac without the *"Apple cannot check it for malicious
software"* block, the app must be:

1. **Signed with a _Developer ID Application_ certificate** (not "Apple
   Distribution", which is App-Store-only).
2. **Built with the hardened runtime** (`ENABLE_HARDENED_RUNTIME=YES`) — already
   set on the macOS targets.
3. **Notarized** — uploaded to Apple, scanned, ticket issued.
4. **Stapled** — the ticket is attached to the app so it verifies offline.

A `.zip` needs no signature or notarization of its own: it is just an envelope.
The stapled ticket lives on the app inside, so once unzipped the app launches
cleanly. (A `.dmg`, by contrast, must itself be signed and notarized to avoid a
Gatekeeper warning on download — that's why the zip is the default.)

### One-time setup

Store App Store Connect API credentials in a named keychain profile so the
script never prompts:

```bash
# App Store Connect -> Users and Access -> Integrations -> App Store Connect API
# Create a key with the "Developer" role, download the AuthKey_XXXX.p8 once.
xcrun notarytool store-credentials "skool-digest-notary" \
  --key   ~/keys/AuthKey_XXXXXXXXXX.p8 \
  --key-id   XXXXXXXXXX \
  --issuer   xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

For signing the app, Xcode handles it during export. The **Developer ID
Application** certificate for team `YHWHU4634V` is cloud-managed, which is fine:
`xcodebuild` downloads it during the export step. You do not need it in the
command-line keychain to build the zip.

### Build a release

```bash
./scripts/package-macos.sh
```

This runs: archive -> export (Developer ID) -> strip detritus xattrs -> verify
signature -> notarize app -> staple app -> build distribution zip -> verify. The
result is `dist/mac/Skool Daily Digest-<version>-macOS.zip`.

If a signable Developer ID identity is present in your keychain, the script also
builds, signs, notarizes, and staples a `.dmg` as a bonus. Otherwise it skips the
DMG and ships the zip (see the DMG note below).

### Verify (the script does this, but to check by hand)

Unzip and assess the app the way a downloader's Mac will:

```bash
ditto -x -k "dist/mac/Skool Daily Digest-1.0-macOS.zip" /tmp/check
spctl -a -t exec -vv "/tmp/check/Skool Daily Digest.app"   # expect: accepted / Notarized Developer ID
xcrun stapler validate "/tmp/check/Skool Daily Digest.app"  # expect: The validate action worked!
```

### Publish to GitHub Releases

```bash
gh release create v1.0 \
  "dist/mac/Skool Daily Digest-1.0-macOS.zip" \
  --title "Skool Daily Digest 1.0" \
  --notes "macOS Safari extension. Unzip, move the app to Applications, then enable it in Safari > Settings > Extensions."
```

### Optional: a signed DMG instead of a zip

A `.dmg` gives the familiar drag-to-Applications window, but the disk image
itself must be signed with Developer ID and notarized, or a downloaded copy trips
Gatekeeper. The cloud-managed certificate used for the app is not reachable from
the command-line `codesign`, so the script can't sign a DMG with it. To enable
the DMG path, add a local **Developer ID Application** certificate in Xcode
(*Settings -> Accounts -> Manage Certificates -> + -> Developer ID Application*),
which installs a usable private key in your login keychain. On the next run the
script detects it and produces a signed, notarized, stapled `.dmg` automatically
alongside the zip.

After install, the user enables it in **Safari -> Settings -> Extensions**, and
once (in Safari's Develop menu) allows unsigned/third-party extensions if Safari
asks. Bump `MARKETING_VERSION` in the Xcode project for each new release so the
artifact name and tag don't collide.

---

## iOS: why it can't be posted on GitHub

The notarization + Gatekeeper model (whether the app ships as a zip or a dmg) is
a **macOS-only** distribution model. iOS has no equivalent for "download a file
from a website and install it." Your options for the iOS Safari-extension app
are:

| Method | Who can install | Notes |
|---|---|---|
| **App Store** | Anyone | Normal review. The standard path. |
| **TestFlight** | Up to 10,000 external testers via a link | Requires App Store Connect setup + a one-time Beta App Review. Closest thing to "public" without the full Store. |
| **Ad Hoc `.ipa`** | Only devices whose UDID you registered (≤100/year) | You *can* attach the `.ipa` to a GitHub release, but only your pre-registered devices can install it. Not useful for the public. |
| **Apple Developer Enterprise Program** | Internal employees only | $299/yr, in-house apps only, not for public distribution. |
| **EU alternative distribution** | EU users | Requires special entitlements + iOS notarization API + being an approved marketplace/web distributor. |

There is no "notarize an iOS app and post it on GitHub for anyone to install."
If you want the iOS extension in others' hands, **TestFlight** is the realistic
near-public route; the App Store is the real one.

---

## What was wrong with the previous attempt

The earlier hand-built artifacts in `dist/mac/` were:

- The `.app` itself: correct (Developer ID, hardened runtime, notarized, stapled).
- The `.dmg`: **not notarized/stapled**, and signed with the wrong cert
  (*Apple Distribution* instead of *Developer ID Application*). A downloaded copy
  would trip Gatekeeper when opened.
- Stale: the shipped bundle id was the placeholder `com.yourCompany.…`; the
  project has since been fixed to `com.digitaljavelina.…`, so a rebuild is needed.

Running `scripts/package-macos.sh` produces a correct artifact and replaces the
manual Xcode-Organizer process. `dist/` is now gitignored — build artifacts live
on GitHub Releases, not in the repo.
