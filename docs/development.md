# Development

See [CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md) (the code, its
rules and step-by-step recipes; coding assistants read it on their own).

```sh
npm install
npm test             # unit tests (vitest)
npm run typecheck
npm run build        # bundles → custom_components/homeslice/frontend/ (card and editor)
npm run deploy       # build and copy to Home Assistant over SSH (settings in .deploy.env)
```

The repository itself doesn't contain the built frontend; `npm run build` builds it.

Private house files go into `houses/` (ignored by git); `npm test` validates them too.

## Browser tests

```sh
npm run test:browser   # build, then click through the card in headless Chromium (fake hass, Playwright)
HOMESLICE_HA_URL=ws://host:8123/api/websocket node scripts/snapshot-hass.mjs houses/home.yaml
                       # private fixture from a real HA, used by test:browser
HOMESLICE_HA_HTTP=http://host:8123 HOMESLICE_DASHBOARD=/dashboard-x/house node scripts/e2e-ha.mjs
                       # read-only check against a real HA dashboard
```

Screenshots land in `test-results/`.

The README's pictures show the demo house (`npm run dev`) and are made by
`node scripts/showcase.mjs`.

## Integration tests

Python, Home Assistant's own test framework:

```sh
uv venv .venv --python 3.14
uv pip install --python .venv/bin/python pytest-homeassistant-custom-component home-assistant-frontend
.venv/bin/python -m pytest
```

## Adding furniture

Library pieces are checked automatically (`npm test`, `frontend/assets.test.ts`): each
built-in piece builds at several sizes, fits its box, stays under a triangle budget and
has its names, aliases and pictures; every type has a default piece. After adding or
changing a piece, run `node scripts/thumbnails.mjs` (pictures) and
`node scripts/library-sheet.mjs` for an overview page (`test-results/library.html`).

## Releasing

Publish a GitHub release with a tag like `v0.1.0`. The *Release* workflow builds the
frontend, sets that version in `manifest.json` and attaches `homeslice.zip`, which HACS
installs and offers as an update.
