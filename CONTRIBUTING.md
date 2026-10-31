# Contributing

Thanks for helping! Homeslice is young, so issues with ideas, bugs and screenshots are as
welcome as pull requests. `AGENTS.md` describes the code, the rules and step-by-step
recipes (it's written for coding assistants, and works just as well for people).

## Setup

```sh
npm ci
npx playwright-core install chromium        # for the browser tests and pictures
uv venv .venv --python 3.14                 # Python tests (Home Assistant's test framework)
uv pip install --python .venv/bin/python pytest-homeassistant-custom-component home-assistant-frontend
```

`npm run check` runs everything CI runs. To try the card and editor without Home
Assistant, run `npm run dev` and open `http://localhost:8123/dev/harness.html?demo=card`
(or `?demo=editor`): a fake Home Assistant (`dev/fake-hass.js`) with a demo house.

To try your change in your own Home Assistant, copy `custom_components/homeslice` there
after `npm run build` (or set up `.deploy.env` and use `npm run deploy`), then restart
Home Assistant.

## Pull requests

- One topic per pull request, with tests (see `AGENTS.md`).
- Texts in English and German (a rough German translation is fine; say so).
- Furniture: CI posts pictures of added and changed pieces on the pull request.
- Never include a real home, photos or floor plans.

By contributing you agree that your contribution is licensed under the MIT license.
