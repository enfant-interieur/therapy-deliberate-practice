# Local Runtime Desktop Launcher

This Tauri + React app starts/stops the local runtime gateway and surfaces model defaults, logs, and doctor checks.

## Development

```bash
npm install
npm run dev
```

For desktop development with the embedded gateway sidecar:

```bash
pip install pyinstaller
npm run sidecar:build
npm run tauri:dev
```

## Build

```bash
npm run build
npm run sidecar:build
npm run tauri:build
```

`npm run tauri:build` uses `src-tauri/tauri.sidecar.conf.json` to bundle the gateway sidecar binary.
