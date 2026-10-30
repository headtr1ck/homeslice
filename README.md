# Homeslice

> **Early development — not ready for use.**

Model your house once — floors, rooms, walls, windows, devices — linked to Home Assistant's
own floors, areas and entities, and show it as an interactive, exploded isometric 3D view
on your dashboards.

## Status

Phase 0: a dashboard card renders walls, floors, openings and stairs from a hand-written
house file. No editor yet.

## Try it (development)

1. Copy `custom_components/homeslice` into your Home Assistant configuration (or use
   `scripts/deploy.sh`, see below) and restart Home Assistant.
2. Add the **Homeslice** integration under *Settings → Devices & services*.
3. Write your house to `<config>/homeslice/home.yaml` (format below).
4. Add a card:

   ```yaml
   type: custom:homeslice-card
   house: home            # file name without .yaml
   view:                  # optional
     azimuth: 210         # where the camera looks from: 0 north, 90 east, 180 south, 270 west
     elevation: 32        # degrees above the horizon
     explode: 1.6         # gap between floors in metres
   ```

## House file (short form)

Metres; `x` points east, `y` points south (north is up, as on a printed plan). Levels are
listed bottom to top. Walls are generated from the rooms: you never draw them.

```yaml
schema: 1
id: home
outline: { rect: [0, 0, 10, 8] }       # outer face of the exterior walls, shared by all levels
party_walls: [west]                     # walls shared with a neighbour, drawn cut down
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

## License

MIT
