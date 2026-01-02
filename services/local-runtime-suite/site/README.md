# Local Runtime Suite Site

React + Vite site deployed via Cloudflare Worker static assets.

## Development

```bash
npm install
npm run dev
```

Models catalog is generated at build time from Python specs:

```bash
python ../tools/gen_models_json.py
```

Releases are published into `public/releases.json` during CI release.
