# Working on Homeslice (for coding assistants and people)

Homeslice is a Home Assistant integration (HACS) that draws a home as an exploded 3D
house: a Lovelace card, an editor (sidebar panel), and a small Python integration that
stores houses, serves the frontend and offers an API (also to AI assistants). Read this
before changing code; `CONTRIBUTING.md` has the setup.

## Map

| Where | What |
|---|---|
| `frontend/model/` | The house format: `types.ts` (input and expanded types, documented), `expand.ts` (input → expanded model, every rule with a fix-it message), geometry, walls, stairs, lights, furniture catalogue (`furniture.ts`, `modern.ts`), `catalog.ts` (what the integration gets) |
| `frontend/render/` | three.js: `scene.ts` (the house), `simple.ts` (built-in shapes), `modern.ts` (Modern furniture drawn in code), `models.ts` (glTF models), `textures.ts` |
| `frontend/card/` | The Lovelace card and its visual config editor |
| `frontend/editor/` | The editor panel (`homeslice-panel.ts`), its operations (`ops.ts`, pure functions on the model), libraries (`library.ts`, `kenney.ts`, `openings.ts`), checklist |
| `frontend/ha/` | Everything that touches Home Assistant's `hass` object (keep HA internals here) |
| `frontend/i18n/` | `en.json`, `de.json`: every user-visible text, same keys and placeholders |
| `custom_components/homeslice/` | The integration: `store.py` (houses, previous version), `validate.py` (the rules of `expand.ts`, ported), `llm.py` + `guide.md` (AI tools and the guide), `rest_api.py`, `websocket.py`, `assets.py` (Poly Haven and uploaded models), `repairs.py`, `catalog.json` (generated) |
| `assets/` | Bundled Kenney models, generated pictures (`thumbs/`, `plan/`) |
| `dev/` | Test harness with a fake `hass` (`fake-hass.js`, `harness.html`), fixtures, script entries |
| `scripts/` | Browser tests, thumbnails, catalogue, library sheet and preview, deploy |
| `tests/` | Python tests; `validation_cases.json` (generated, shared by both validators) |

## Commands

```sh
npm run check            # everything CI runs (below), before every pull request
npm run typecheck
npm test                 # vitest: model, editor ops, i18n, assets, validation cases
npm run test:browser     # build, then the card and editor in headless Chromium (fake hass)
.venv/bin/python -m pytest
node scripts/thumbnails.mjs   # after changing furniture: library pictures, Kenney sizes
node scripts/catalog.mjs      # after changing types, kinds, models: custom_components/homeslice/catalog.json
UPDATE_CASES=1 npx vitest run frontend/model/validation.test.ts   # after changing a rule
```

## Rules

- **Two copies of the rules.** `expand.ts` (editor, card) and `validate.py` (API, AI
  tools) must agree: same rules, order and messages. Change both, regenerate the cases
  (`UPDATE_CASES=1 …`), and `pytest tests/test_validate.py` proves the Python side.
- **Every text in English and German** (`frontend/i18n/*.json`, and
  `custom_components/homeslice/translations/` for the integration); `npm test` checks keys
  and placeholders.
- **Tests with every change**: a unit test for logic (`*.test.ts`, `tests/*.py`), a browser
  test for UI behaviour (`scripts/browser-test.mjs`). Look at the screenshots in
  `test-results/` when you change what is drawn.
- **Comments say why**, in plain sentences; code reads like its neighbours (lit
  templates, pure functions in `ops.ts`, `this.t()` for texts, `this.n()` for numbers).
- **Never commit a real home**: `houses/`, `test-results/`, `dev/fixtures/private/` are
  ignored; photos and floor plans never go into the repo or issues.
- **Generated files are committed** and checked: `assets/thumbs`, `assets/plan`,
  `frontend/editor/kenney-sizes.json`, `custom_components/homeslice/catalog.json`,
  `tests/validation_cases.json`.
- **Workflows with write rights never run pull-request code** (see
  `library-preview-comment.yml`).
- The house format is for people and language models: short, slug ids, defaults,
  room-relative positions. New fields get a default, a doc comment in `types.ts`, a line
  in `guide.md` and the README's format section.

## Recipes

**A Modern furniture piece.** Add the kind to `MODERN_GROUPS` in
`frontend/model/modern.ts` (type, default size, finishes, mount), its builder to
`BUILDERS` in `frontend/render/modern.ts` (build to the given `w`, `d`, `h`; centred, back
at −z, on y = 0), names `modern.<kind>` in both `i18n` files. Then
`node scripts/thumbnails.mjs`, `node scripts/catalog.mjs`, `npm test` (the asset checks
build it at several sizes, check its box, triangles and pictures).

**A Kenney model.** Put the `.glb` (CC0, from the Kenney kits) into `assets/models/`, list
it in `frontend/editor/kenney.ts` with its type, run the thumbnails and catalogue scripts.

**A door or window kind.** `OpeningStyle` in `types.ts`, the style lists in `expand.ts`,
`validate.py` and `catalog.ts`, the 3D look in `scene.ts` (walls around openings), the plan
symbol in the panel (`openingSymbol`), a preset with its icon in `editor/openings.ts`,
names in `i18n`, a line in `guide.md`.

**A rule in the house format.** `expand.ts` and `validate.py` (same message), a mutation
in `frontend/model/validation.test.ts`, `UPDATE_CASES=1 …`, both test suites.

**A card option.** `HomesliceCardConfig` in `homeslice-card.ts` (doc comment), its control
in `homeslice-card-editor.ts`, `cardeditor.*` texts, the README's card section.

**A websocket command.** `websocket.py` (admins only if it changes anything), a Python
test in `tests/test_init.py`, and the fake in `dev/fake-hass.js` if the frontend uses it.

## For assistants helping a user set up their home

Don't work from this repository: use the running Home Assistant. Read
`custom_components/homeslice/guide.md` or, better, `GET /api/homeslice/guide` (or the
`homeslice_get_guide` tool) which adds that installation's floors, areas and entities.
