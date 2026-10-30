# Homeslice

> **Early development — not ready for use.**

Model your house once — floors, rooms, walls, windows, devices — linked to Home Assistant's
own floors, areas and entities, and show it as an interactive, exploded isometric 3D view
on your dashboards.

## Status

Phase 1: a dashboard card renders the house from a hand-written file, with live lights,
covers, window contacts and temperatures, floor focus and room popups. No editor yet.

## Try it (development)

1. Copy `custom_components/homeslice` into your Home Assistant configuration (or use
   `scripts/deploy.sh`, see below) and restart Home Assistant.
2. Add the **Homeslice** integration under *Settings → Devices & services*.
3. Write your house to `<config>/homeslice/home.yaml` (format below).
4. Add a card:

   ```yaml
   type: custom:homeslice-card
   house: home                    # file name without .yaml
   interactive: true              # drag to turn, scroll/pinch to zoom, double-click to reset
   view:                          # all optional
     azimuth: 250                 # overview camera: 0 north, 90 east, 180 south, 270 west
     elevation: 38                # degrees above the horizon
     projection: isometric        # or perspective
     explode: 2.6                 # gap between floors in metres
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

   Tap a lamp to switch a room's lights, tap a room (or its name) for a popup with its
   devices, pick a floor on the left to lift the floors above away. Hovering a floor
   (mouse) highlights it and makes the floors above see-through. While turning, the
   current angle is shown, so good values can be copied into `view`.

## House file (short form)

Metres; `x` points east, `y` points south (north is up, as on a printed plan). Levels are
listed bottom to top. Walls are generated from the rooms: you never draw them.

```yaml
schema: 1
id: home
outline: { rect: [0, 0, 10, 8] }       # outer face of the exterior walls, shared by all levels
party_walls: [west]                     # walls shared with a neighbour
opening_defaults:                       # optional, house-wide per opening type
  window: { sill: 0, height: 2.2 }      # e.g. floor-to-ceiling windows
facade_openings:                        # windows stacked on several floors, defined once
  - side: south
    at: 1                               # metres from the outline's west (or north) end
    width: 2.4
    levels: [ground, first]             # each lands in the room behind it on that floor
    covers: { ground: cover.living_room, first: cover.bedroom }
vertical:
  - { id: stairs, rect: [6, 3, 3, 1.2], from: ground, to: first }
levels:
  - id: ground
    floor_id: ground_floor              # Home Assistant floor
    rooms:
      - { id: living, area_id: living_room, rect: [0, 0, 6, 8] }
      - { id: kitchen, area_id: kitchen, rect: [6, 0, 4, 8], floor: tile }
      - { id: garden, area_id: garden, kind: outdoor, rect: [0, 8, 10, 6] }
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
npm run build        # bundle → custom_components/homeslice/frontend/homeslice.js
npm run deploy       # build and copy to Home Assistant over SSH (settings in .deploy.env)
```

Private house files go into `houses/` (ignored by git); `npm test` validates them too.

```sh
npm run test:browser   # build, then click through the card in headless Chromium (fake hass)
HOMESLICE_HA_URL=ws://host:8123/api/websocket node scripts/snapshot-hass.mjs houses/home.yaml
                       # private fixture from a real HA, used by test:browser
HOMESLICE_HA_HTTP=http://host:8123 HOMESLICE_DASHBOARD=/dashboard-x/house node scripts/e2e-ha.mjs
                       # read-only check against a real HA dashboard
```

Screenshots land in `test-results/`.

## License

MIT
