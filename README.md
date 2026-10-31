# Homeslice

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories)
[![GitHub release](https://img.shields.io/github/v/release/headtr1ck/homeslice)](https://github.com/headtr1ck/homeslice/releases)
[![CI](https://github.com/headtr1ck/homeslice/actions/workflows/ci.yml/badge.svg)](https://github.com/headtr1ck/homeslice/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> [!WARNING]
> **Early alpha.** Homeslice is young and changes quickly: the house format, the card's
> options and the editor may change between versions without migration, and there will be
> bugs. Keep a copy of your house (editor → ⚙ → *Download* YAML) and expect to adjust it
> after updates. Feedback and issues are very welcome.

Model your house once — floors, rooms, walls, windows, devices — linked to Home Assistant's
own floors, areas and entities, and show it as an interactive, exploded isometric 3D view
on your dashboards.

## Status

Alpha: card and editor work and are used daily on one house, but nothing is stable yet.

- **Card:** exploded 3D view with live lights (a pool of light per lamp), blinds, window
  contacts, temperatures and awnings; floor focus and hover; room popups (a bottom sheet
  on phones); optional roof and energy overlay (solar, battery, grid and devices with
  animated power flows).
- **Editor** (admin sidebar page *Homeslice*): start a house from Home Assistant's floors
  and areas, trace rooms over a floor plan image, drag walls and corners with snapping,
  doors and windows with their blinds, stairs, lights and energy devices; undo/redo;
  the whole house as YAML in and out.

## Installation

### HACS (recommended)

[![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=headtr1ck&repository=homeslice&category=integration)

1. Click the button above, or in HACS: *⋮ → Custom repositories*, add
   `https://github.com/headtr1ck/homeslice` with the type *Integration*.
2. Download **Homeslice** and restart Home Assistant.
3. Add the integration:

   [![Open your Home Assistant instance and start setting up Homeslice.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=homeslice)

New versions show up under *Settings → Updates* like any other update; after updating,
restart Home Assistant and reload the browser. The card needs no extra dashboard resource:
the integration serves it.

### Manually

Download `homeslice.zip` from the [latest release](https://github.com/headtr1ck/homeslice/releases/latest),
unpack it into `<config>/custom_components/homeslice/` and restart Home Assistant. (The
repository itself doesn't contain the built frontend; build it with `npm run build`.)

## Getting started

1. Install Homeslice (above).
2. Add the **Homeslice** integration under *Settings → Devices & services*.
3. Open **Homeslice** in the sidebar and create a house: pick its floors, give rough outside
   dimensions, and each floor starts with a placeholder room per area.
   - **1. Rooms & walls:** drag rooms into shape, or upload the floor plan (level
     inspector), set its scale with two points of a known length, and draw rooms over
     it (`R`). Walls appear by themselves; a wall between two rooms can be dragged on its
     own or switched to *open* (e.g. an open kitchen). Stairs: `S`.
   - **2. Doors & windows:** click a wall to add a window, link its blind and contact.
   - **3. Objects & entities:** lights are placed automatically and can be dragged;
     drag furniture from the library (wall pieces go against a wall; `R` to turn); place solar, battery, grid and power-measured
     devices for the energy overlay.
   - Save (`Ctrl+S`). Cards update at once.
4. Add a **Homeslice** card to a dashboard. Its visual editor shows a small preview: turn
   it into the angle you want, then pick the look.

Alternatively, write the house as YAML (format below): paste it in the editor's
*House settings*, or put it in `<config>/homeslice/<house>.yaml` and call the action
`homeslice.import_files` (files never overwrite a house edited in the editor unless
`force: true`). Broken links (deleted areas, floors, entities) show up under
*Settings → Repairs*.

## Card

```yaml
type: custom:homeslice-card
house: home                    # the house id
interactive: false             # true: drag to turn, scroll/pinch to zoom, double-click to reset
energy: false                  # true: energy overlay (shows the roof unless view.roof: false)
mode: 3d                       # or plan: a flat floor plan from above, one floor at a time
sun: true                      # light from the real sun (sun.sun), darker at night
level: ground                  # optional: the floor shown first (plan: default the entrance floor)
view:                          # all optional
  azimuth: 250                 # overview camera: 0 north, 90 east, 180 south, 270 west
  elevation: 38                # degrees above the horizon
  projection: isometric        # or perspective
  explode: 2.6                 # gap between floors in metres
  roof: false                  # draw the roof in the overview
  furniture: detailed          # or simple: boxes instead of models
  cut_height: 0.4              # outer walls facing a low camera are cut to this height…
  cut_below: 60                # …while the camera is lower than this (degrees)
  show_outdoor: true           # garden, terrace etc. (drawn see-through)
  focus:                       # camera when a floor is picked
    azimuth: 180
    elevation: 65
    projection: perspective
  levels:                      # per-floor cameras, by level id
    ground: { elevation: 90, projection: isometric }
popups:                        # optional, by room id or area id
  living_room:
    mode: extend               # or replace
    cards:
      - type: weather-forecast
        entity: weather.home
```

Tap a room's lamp to switch its lights (on a picked floor, rooms with several lamps get
one toggle per lamp), tap a room for a popup with its devices (including the blinds and
contacts of its windows), pick a floor to lift the floors above away. Hovering a floor
highlights it and makes the floors above see-through.

## House format (short form)

Metres; `x` points east, `y` points south (north is up, as on a printed plan). Levels are
listed bottom to top. Walls are generated from the rooms: you never draw them. Rooms are
stored on wall centre lines; outside walls grow inwards from the outline.

```yaml
schema: 1
id: home
name: Home
outline: { rect: [0, 0, 10, 8] }       # outer face of the exterior walls, shared by all levels
party_walls: [west]                     # walls shared with a neighbour
roof: { ridge: east_west, pitch: 35 }   # optional; drawn by cards with view.roof
north: 0                                # optional: degrees the plan's north side is turned east of true north
inverted_covers: [cover.awning]         # optional: covers that report open/closed the other way round
robots:                                 # optional: robot vacuums and lawn mowers
  - { entity: vacuum.robo, level: ground, dock: [0.8, 3.3] }   # live position: see the editor
opening_defaults:                       # optional, house-wide per opening type
  window: { sill: 0, height: 2.2 }      # e.g. floor-to-ceiling windows
facade_openings:                        # windows stacked on several floors, defined once
  - side: south
    at: 1                               # metres from the outline's west (or north) end
    width: 2.4
    levels: [ground, first]             # each lands in the room behind it on that floor
    covers: { ground: cover.living_room, first: cover.bedroom }
vertical:
  - id: stairs
    rect: [6, 3, 3, 1.2]
    from: ground
    to: first
    shape: straight                     # or u_turn (two flights joined by winders)
    up: east                            # direction the first flight climbs
    entry: 0                            # floor before the first step (stairs that start further in)
energy:                                 # optional, for the card's energy overlay
  - { kind: solar, roof: south }        # sensors default to HA's energy settings
  - { kind: battery, level: ground, at: [8.5, 1] }
  - { kind: grid, level: ground, at: [9, 1] }
  - { kind: device, power: sensor.heat_pump_power, level: ground, at: [9.5, 7.5] }
levels:
  - id: ground
    floor_id: ground_floor              # Home Assistant floor
    # include_floors: [outside]        # optional: areas of more HA floors on this level
    height: 2.6                         # optional storey height
    rooms:
      - id: living
        area_id: living_room            # Home Assistant area
        rect: [0, 0, 6, 8]              # x, y, width, depth (or polygon: [[x, y], …])
        lights:                         # optional: the area's lights are placed automatically
          - { entity: light.reading_lamp, at: [1, 2] }   # metres from the room's north-west corner
        furniture:                      # optional; the editor's library shows every type
          - { type: sofa, at: [3, 6.5] }
          - { type: table, at: [3, 2], rotation: 90 }
          - { type: tv, at: [3, 7.8], rotation: 180, mount: wall, elevation: 1 }  # wall, ceiling
          - { type: sofa_corner, at: [2, 3], mirror: true }                    # flipped left to right
      - { id: kitchen, area_id: kitchen, rect: [6, 0, 4, 8], floor: tile }
      - { id: garden, area_id: garden, kind: outdoor, rect: [0, 8, 10, 6], awning: cover.awning }
    walls:
      - { between: [living, kitchen] }  # no wall here (open plan); side: north opens one side only
    openings:
      # at = metres from the room's west end (north/south sides) or north end (east/west sides)
      - { room: living, side: south, at: 1, width: 2.4, cover: cover.living_room }
      - { room: kitchen, side: north, at: 1.5, width: 1, type: door }
  - id: first
    floor_id: first_floor
    rooms:
      - { id: bedroom, area_id: bedroom, rect: [0, 0, 10, 8] }
```

## Development

```sh
npm install
npm test             # unit tests (vitest)
npm run typecheck
npm run build        # bundles → custom_components/homeslice/frontend/ (card and editor)
npm run deploy       # build and copy to Home Assistant over SSH (settings in .deploy.env)
```

Releasing: publish a GitHub release with a tag like `v0.1.0`. The *Release* workflow builds
the frontend, sets that version in `manifest.json` and attaches `homeslice.zip`, which HACS
installs and offers as an update.

Private house files go into `houses/` (ignored by git); `npm test` validates them too.

```sh
npm run test:browser   # build, then click through the card in headless Chromium (fake hass)
HOMESLICE_HA_URL=ws://host:8123/api/websocket node scripts/snapshot-hass.mjs houses/home.yaml
                       # private fixture from a real HA, used by test:browser
HOMESLICE_HA_HTTP=http://host:8123 HOMESLICE_DASHBOARD=/dashboard-x/house node scripts/e2e-ha.mjs
                       # read-only check against a real HA dashboard
```

Screenshots land in `test-results/`.

Integration tests (Python, Home Assistant's own test framework):

```sh
uv venv .venv --python 3.14
uv pip install --python .venv/bin/python pytest-homeassistant-custom-component home-assistant-frontend
.venv/bin/python -m pytest
```

## License

MIT. The furniture models in `assets/models/` are by [Kenney](https://kenney.nl)
(Furniture Kit and Car Kit, CC0). A card loads only the models its house uses.
