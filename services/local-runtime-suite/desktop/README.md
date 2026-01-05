# Local Runtime Desktop Launcher

This Tauri + React app starts/stops the local runtime gateway and surfaces model defaults, logs, and doctor checks.

## Development

```bash
npm install
npm run dev
```

For desktop development with the embedded gateway sidecar:

```bash
npm run tauri:dev
```

## Build

```bash
npm run build
npm run sidecar:build
npm run tauri:build
```

`npm run tauri:build` uses `src-tauri/tauri.sidecar.conf.json` to bundle the gateway sidecar binary.

## App Store builds (macOS + iOS)

### macOS App Store

1. Create an App Store provisioning profile for the macOS app identifier (`com.therapy.localruntime`).
2. Place the profile at `services/local-runtime-suite/desktop/src-tauri/embedded.provisionprofile`.
3. Ensure the signing identity is available in your keychain (Apple Distribution).
4. Build the App Store bundle:

```bash
npm run tauri:appstore
```

The App Store-specific configuration lives in `src-tauri/tauri.appstore.conf.json` and
enables hardened runtime plus embedding the provisioning profile.

### iOS App Store (Tauri Mobile)

Tauri's iOS targets are configured via `src-tauri/tauri.ios.conf.json`. Set the
Apple Team ID (or export `APPLE_DEVELOPMENT_TEAM`) before building the iOS archive.

On a macOS host with Xcode installed:

```bash
tauri ios init --config src-tauri/tauri.conf.json --config src-tauri/tauri.ios.conf.json
tauri ios build --export-method app-store --config src-tauri/tauri.conf.json --config src-tauri/tauri.ios.conf.json
```

Keep any iOS-specific Info.plist overrides in `src-tauri/Info.ios.plist` (if needed for
privacy strings or background modes).
