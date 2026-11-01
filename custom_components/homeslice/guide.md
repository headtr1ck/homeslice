# Writing a Homeslice house (guide for AI assistants)

Homeslice draws a Home Assistant home as a 3D house: levels are Home Assistant floors,
rooms are areas, windows carry their blinds and contact sensors, lights glow where they
are. A house is one YAML (or JSON) document in the format below. Write it, check it with
the validate tool, fix every error it reports, then save it. Home Assistant keeps the
previous version, so a save can be undone in the editor (⚙ → Restore previous version).

## Workflow

1. Read this guide and the **Home Assistant context** after it: the floors, areas and
   entities you can link, with their real ids. Never invent ids.
2. If a house exists, start from it (get-house tool) and change only what was asked.
3. Plan the levels (one per Home Assistant floor, bottom to top) and the outline, then
   one room per area. Use the user's floor plan or description for sizes; ask about
   missing dimensions rather than guessing wildly. Round to 5 cm.
4. Add doors and windows with their covers (`cover.*`) and contacts (`binary_sensor.*`).
5. Validate, fix every error (the messages say how), validate again, then save.
6. Tell the user what you assumed (sizes, which window is which) so they can correct it
   in the editor (sidebar → Homeslice), where walls and pieces can be dragged into place.

## Coordinates

- Metres. `x` points **east**, `y` points **south** (north is up, as on a printed plan),
  heights go up. These are the plan's directions: north is the plan's top, east its right,
  whichever way the house really faces (`north:` gives the real direction, for the sun). The origin is the outline's north-west corner, usually `[0, 0]`.
- `rect: [x, y, width, depth]` is the north-west corner plus size; `polygon:
  [[x, y], …]` for L-shapes (any order of points, at least 3).
- Rooms are measured on **wall centre lines**: neighbouring rooms share an edge exactly
  (no gaps for walls). Walls are generated from the rooms; you never draw them.
- `outline` is the outer face of the exterior walls; exterior walls grow inwards from it.
  Rooms along the outside go right up to the outline.
- Positions inside a room (lights, furniture) are metres east and south of the room's
  north-west corner (of its bounding box), not plan coordinates.

## Structure

```yaml
schema: 1                     # always 1
id: home                      # slug: a-z, 0-9, _
name: Home
outline: { rect: [0, 0, 10, 8] }
party_walls: [east]           # outside walls shared with a neighbour (terraced houses)
roof: { ridge: east_west, pitch: 35 }      # optional; ridge east_west or north_south
north: 0                      # optional: degrees the plan's north is turned east of true north
levels:                       # bottom to top
  - id: ground
    floor_id: ground_floor    # the Home Assistant floor (see the context)
    height: 2.6               # optional, storey height in metres (default 2.6)
    # outline: {rect: …}      # only if this level differs from the house outline
    # include_floors: [outside]  # more HA floors whose areas are on this level
    rooms:
      - id: living
        area_id: living_room  # the Home Assistant area
        rect: [0, 0, 6, 8]
        floor: wood           # wood, tile, carpet, concrete, paving, gravel, lawn
      - { id: kitchen, area_id: kitchen, rect: [6, 0, 4, 4], floor: tile }
      - { id: hall, area_id: hall, rect: [6, 4, 4, 4], floor: tile }
      - { id: garden, area_id: garden, kind: outdoor, rect: [0, 8, 10, 6] }   # outside the outline
    walls:
      - { between: [living, kitchen] }     # no wall there: open plan
    openings:
      - { room: living, side: south, at: 1, width: 2.4, cover: cover.living_room_blind }
      - { room: hall, side: north, at: 1.5, width: 1, type: door, style: entrance_panes }
      - { room: living, side: east, at: 5, width: 0.9, type: door }   # an inner door, to the hall
vertical:
  - { id: stairs, rect: [8, 5, 2, 3], from: ground, to: first }
```

### Rooms

- `kind`: `room` (default), `outdoor` (garden, terrace, balcony: no walls, lawn floor) or
  `void` (an empty gap, e.g. the air space of a gallery).
- Every area of a floor should get a room; the editor's checklist lists missing ones.
- `lights` are optional: the area's lights are placed automatically. List one only to
  place it (`at`), hide it (`hidden: true`) or add a light from another area. `type`
  says how it looks: `lamp` (default), `spot` (ceiling downlights; `spots: [[x, y], …]`
  adds more downlights on the same light), `strip` (an LED strip from `at` to `to`,
  optional `height` in metres) or `indirect` (light washing the room's walls).
- `awning: cover.…` on an outdoor room: an awning on the house wall over it.
- `underfloor: climate.…` on a room: underfloor heating, its loops glow in the floor while it heats, on cards with `heating: true` (also a valve, switch or binary sensor).
- `cameras: [{entity: camera.…, at: [x, y], direction: 180, fov: 90, range: 5, height: 2.3,
  motion: binary_sensor.…}]`: a camera where it hangs and what it sees; `direction` is
  degrees clockwise from the plan's top (0 up, 90 right). The view turns red while
  `motion` is on; a tap shows the camera.
- Finishes: `floor` (wood, oak_herringbone, tile_white, terrazzo, concrete, carpet…;
  outdoor: lawn, paving, gravel, decking), `wall` for the room's inside walls (paint_white,
  paint_sage, acoustic_oak, brick_red, tile_subway…) and `wall_sides: {north: acoustic_oak}`
  for one side in another finish. `facade` on the house is the outside of the exterior
  walls (render_white, brick_red, wood_cladding…). All finishes are in the catalogue; a
  Poly Haven texture is `polyhaven:<texture id>`.

### Openings (doors and windows)

- `room` and `side` (north, south, east, west) pick the wall; `at` is metres from the
  room's **west** end (north and south walls) or **north** end (east and west walls);
  `width` in metres. An inner door is listed once, on either room.
- `type`: `window` (default), `door`, `garage_door`, `opening` (a gap without a door).
- `sill` and `height` default by type (windows 0.9 and 1.3, doors 0 and 2.1).
- `style` (see the catalogue in the context): windows `single`, `double`, `triple`,
  `fixed`, `split` (double window over a fixed pane), `split_single`; doors `single`,
  `double`, `sliding`, `sliding_glass`, `glass`, `glass_double`, `entrance_strip`,
  `entrance_panes`, `entrance_sidelight`; openings `square`, `arch`. Default: double when
  wider than 1.3 m (windows) or 1.4 m (doors), else single.
- `hinge: left|right` (seen from the room), `swing: in|out`.
- `cover: cover.…` (blind, shutter, garage door: drawn as far open as it reports) and
  `contact: binary_sensor.…` (window or door sensor: the door swings open, the window tilts;
  a garage door with only a contact opens with it).
- Windows stacked on several floors at the same place can be written once as
  `facade_openings` on the house: `{side, at, width, levels: [ground, first], covers:
  {ground: cover.a, first: cover.b}}` with `at` from the outline's west or north end.

### Walls

Generated from the rooms. Entries under a level's `walls` only change them:
`{between: [a, b]}` removes the wall between two rooms (open plan; `side: north` limits
it to one side of the first room); `{between: [a, b], type: wall, thickness: 0.2}` gives
that wall its own thickness; `{line: [[x, y], [x, y]]}` adds a free-standing wall. House
defaults: `walls: {exterior: 0.36, interior: 0.12, party: 0.24}`.

### Stairs

`vertical: [{id, rect, from: <level id>, to: <level id>}]` on the house. The stairwell's
rectangle is where the stairs stand; the floor above gets a hole there. `shape:
straight|u_turn`, `up: east|west|north|south` (the direction the first flight climbs;
default along the longer side), `start` (u_turn: the side the first flight runs along),
`entry` (metres of floor before the first step).

### Furniture

Optional, per room: `furniture: [{type, at, rotation, size, height, mount, model, finish,
accent, entity, readings}]`.

- `type`: one of the furniture types in the catalogue (decides the plan symbol and
  defaults). `at` is the piece's centre (room coordinates). `rotation` in degrees
  clockwise; 0 means the piece's back is to the **north** (a sofa at 0 faces south).
- `size: [width, depth]` and `height` in metres (default by type or model).
- `mount`: `floor`, `wall` (back against a wall, `elevation` above the floor) or `ceiling`.
- `model` picks how it looks: `modern:<kind>` (a built-in piece drawn to its size, with
  `finish` and, for pieces with a second colour, `accent`: legs, frame, shade),
  `polyhaven:<id>`, `custom:<id>` or `builtin` (simple shapes). Without one, the type's
  default piece. Use `modern:` pieces; kinds, sizes, finishes and accents are in the
  catalogue.
- `entity`: what the piece is in Home Assistant, and the card shows its state: a lamp's
  `light.…` glows, a TV's `media_player.…` lights its screen, a fireplace's `switch.…`
  burns, a fan's `fan.…` or an air conditioner's `climate.…` turns and shows heating or
  cooling, a washer's power `sensor.…` runs its drum, curtains follow a `cover.…`.
  What a piece does follows its catalogue `tags` (each kind lists them): `screen` shows
  the cover art of what plays, `speaker` pulses with the music, `vehicle` is drawn only
  while its `device_tracker.…`/`person.…` is home, `bin` tells its pickup day (a days
  sensor), `plant` a `plant.…` problem, `mailbox` post (a binary sensor), `appliance` its
  time left (a duration sensor).
- `readings: [sensor.…]`: values in a note above the piece, e.g. a car's charge and range.

### Energy and robots (optional)

`energy: [{kind: solar, roof: south}, {kind: battery, level: ground, at: [x, y]}, {kind:
grid, …}, {kind: device, name, power: sensor.…, level, at}]` (plan coordinates; sensors
default to Home Assistant's energy settings). Any item can add `details: [sensor.…, {entity:
sensor.…, name: Hot water}]`: more readings in its callout (a heat pump's COP, hot water…). `robots: [{entity: vacuum.…, level, dock:
[x, y]}]`. A live position needs `position: {attribute: …}` (map coordinates in an
attribute), `{service: roborock.get_vacuum_current_position}` (Roborock) or GPS, and two
calibration `points` set in the editor.

## Common mistakes

- Rooms that overlap or leave gaps: neighbours must share edges exactly.
- `at` for openings measured from the wrong end (it is the west or north end).
- Furniture `at` in plan coordinates instead of room coordinates.
- Inventing entity, area or floor ids: use only those in the context.
- Levels in the wrong order (bottom first) or a level per area instead of per floor.
- Forgetting `schema: 1`.
