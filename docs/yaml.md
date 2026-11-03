# The house format (YAML)

A Homeslice house is one short, readable YAML file. The editor reads and writes it, and you
(or an [AI assistant](llm.md)) can write it by hand. The full reference, written for AI
assistants but just as useful for people, is
[`guide.md`](../custom_components/homeslice/guide.md); this page is the short form.

- [Using a YAML house](#using-a-yaml-house)
- [Basics](#basics)
- [Example](#example)
- [Energy](#energy)
- [Robots](#robots)

## Using a YAML house

- **In the editor:** paste it under *House settings* (editor → ⚙ → *Replace the house with
  this YAML*); editor → ⚙ → *Download* gives you the current house as YAML.
- **As a file:** put it in `<config>/homeslice/<house>.yaml` and call the action
  `homeslice.import_files`. Files never overwrite a house edited in the editor unless
  `force: true`.

Broken links (deleted areas, floors, entities) show up under *Settings → Repairs*.

## Basics

Metres; `x` points east, `y` points south (north is up, as on a printed plan). Levels are
listed bottom to top. Walls are generated from the rooms: you never draw them. Every line is a wall centre
line: the rooms' and the outline's (outside walls are centred on it, half sticking out).
Older files with `schema: 1` had the outline on the walls' outer face; they load converted,
and the editor saves them as `schema: 2`.

## Example

```yaml
schema: 2
id: home
name: Home
outline: { rect: [0, 0, 10, 8] }       # centre line of the outside walls, shared by all levels
                                        # (or outline: auto: the outer edge of each level's rooms)
party_walls: [west]                     # walls shared with a neighbour
# the roof as a level of its own (instead of roof:): parts at any angle, a roof starting lower,
# pieces on it such as solar panels; in the editor: + Roof under the floors, then presets
#  - id: roof
#    kind: roof
#    roofs:
#      - { id: main, rect: [0, 0, 10, 8], shape: gable, ridge: left_right, pitch: 40, offset: -1.2,
#          finish: roof_slate, furniture: [{ type: item, model: modern:solar_panel, at: [3, 6] }] }
#      - { id: wing, rect: [10, 0, 3, 4], shape: shed, ridge: 30, pitch: 12 }   # ridge: up_down or degrees
roof:                                   # optional; drawn by cards with view.roof
  ridge: east_west
  pitch: 35
  shape: gable                  # or hip, shed (one slope, high: north) or flat
  finish: roof_clay             # roof_concrete, roof_slate, roof_shingles, roof_metal, roof_green…
  dormers: [{ side: south, at: 4, width: 1.6, shape: gable }]   # or shape: shed
  windows:                      # roof windows, with an outside shutter and a contact
    - { side: south, at: 2, up: 1.5, cover: cover.roof_window, contact: binary_sensor.roof_window }
north: 0                                # optional: degrees the plan's north side is turned east of true north
inverted_covers: [cover.awning]         # optional: covers that report open/closed the other way round
sections:                               # optional: cuts through the house, a card button each
  - { id: stairs, name: Through the stairs, line: [[-1, 5], [9, 5]], look: north }
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
    turns: 0                            # quarter turns: 0 straight, 1 an L, 2 a U, 3 round a well
    turn: landing                       # each turn: landing (flat) or winders (turning steps)
    # shape: spiral                     # instead of flights: spiral (round a post) or curved
    railing: metal                      # optional handrail on the open side: glass, metal, wood
                                        # (and upstairs round the well, where no wall is)
    treads: open                        # open (floating, gaps between) or solid (closed to the floor)
    stringers: sides                    # open steps: sides, centre (one under the middle) or none
    finish: wood                        # the steps: any floor finish (concrete, tile_white…)
    up: east                            # direction the first flight climbs
    entry: 0                            # floor before the first step (stairs that start further in)
facade: brick_red                       # optional: the outside of the exterior walls
energy:                                 # optional, for the card's energy overlay
  - { kind: solar, roof: south }        # sensors default to HA's energy settings
  - { kind: battery, level: ground, at: [8.5, 1] }
  - { kind: grid, level: ground, at: [9, 1] }
  - kind: device
    power: sensor.heat_pump_power
    level: ground
    at: [9.5, 7.5]
    details: [sensor.heat_pump_cop, { entity: sensor.hot_water_temperature, name: Hot water }]   # more readings in its callout
levels:
  - id: ground
    floor_id: ground_floor              # Home Assistant floor
    # include_floors: [outside]        # optional: areas of more HA floors on this level
    height: 2.6                         # optional storey height
    rooms:
      - id: living
        area_id: living_room            # Home Assistant area
        rect: [0, 0, 6, 8]              # x, y, width, depth (or polygon: [[x, y], …])
        floor: oak_herringbone          # optional finishes: floor, inside walls, one side
        wall: paint_sage
        wall_sides: { north: acoustic_oak }
        lights:                         # optional: the area's lights are placed automatically
          - { entity: light.reading_lamp, at: [1, 2] }   # metres from the room's north-west corner
          - { entity: light.downlights, type: spot, at: [1, 1], spots: [[2, 1], [3, 1]] }  # a row on one light
          - { entity: light.cove, type: strip, at: [0.2, 0.2], to: [4, 0.2], height: 2.4 }  # also: indirect
        cameras:                        # optional: what it sees, red while motion is on; a tap shows it
          - { entity: camera.hall, at: [0.3, 0.3], direction: 135, fov: 90, motion: binary_sensor.hall_motion }
        furniture:                      # optional; the editor's library shows every type
          - { type: sofa, at: [3, 6.5] }
          - { type: table, at: [3, 2], rotation: 90 }
          - { type: tv, at: [3, 7.8], rotation: 180, mount: wall, elevation: 1 }  # wall, ceiling
          - { type: sofa_corner, at: [2, 3], mirror: true }                    # flipped left to right
          - { type: sofa, at: [3, 4], model: polyhaven:Sofa_01, size: [1.57, 0.66], height: 0.8 }
          - { type: wardrobe, at: [5, 0.4], model: modern:wardrobe_sliding, finish: walnut, accent: black, size: [2, 0.65], height: 2.2 }
          - { type: kitchen, at: [7, 0.3], model: modern:kitchen_base, size: [0.8, 0.62], options: { top: sink, fronts: panel_drawer, handle: handleless } }
          # base units: top none|sink|hob_gas|hob_ceran|hob_electric|hob_downdraft; fronts drawer_door|door|drawers_2|drawers_3|panel_drawer|oven|shelves
          - { type: car, at: [2, 3], model: modern:car_estate, entity: device_tracker.car, readings: [sensor.car_battery, sensor.car_range] }  # only while home
          # model: modern:<kind> | polyhaven:<id> | custom:<id> | builtin (default: the card's style)
      - { id: kitchen, area_id: kitchen, rect: [6, 0, 4, 8], floor: terrazzo, wall: tile_subway }
      - { id: garden, area_id: garden, kind: outdoor, rect: [0, 8, 10, 6], awning: cover.awning }
    walls:
      - { between: [living, kitchen] }  # no wall here (open plan); side: north opens one side only
      # - { between: [living, kitchen], along: [[3, 4], [5, 4]] }   # or just the wall on this line
    openings:
      # at = metres from the room's west end (north/south sides) or north end (east/west sides)
      - { room: living, side: south, at: 1, width: 2.4, cover: cover.living_room, blind: cover.living_blind, blind_style: venetian }
      - { room: living, side: south, at: 5, width: 0.9, type: door, hinge: right, swing: out }  # style: double, sliding, lift_slide, fixed, arch
      - { room: kitchen, side: north, at: 1.5, width: 1, type: door, lock: lock.back_door }  # a smart lock: a tap locks
  - id: first
    floor_id: first_floor
    rooms:
      - { id: bedroom, area_id: bedroom, rect: [0, 0, 10, 8] }
```

## Energy

`energy:` lists solar (on a roof side), battery, grid and power-measured devices for the
card's [energy overlay](card.md#energy), at plan coordinates on a level. Sensors default to
Home Assistant's energy settings; `details:` adds more readings to an item's callout.

## Robots

A garden shed, a detached garage or a garden house: draw its rooms (kind `room`) apart from
the house, wholly outside the outline. Such a group of rooms is a building of its own, with
outside walls (never a party wall), a floor slab and a low shed roof. One of its rooms can
set the building's roof and walls (the editor shows them in that room's panel):

```yaml
      - id: shed
        rect: [15, 14.4, 3, 2.4]
        building:
          roof: gable                   # shed (default, 8°), gable, hip or flat
          pitch: 25                     # degrees
          roof_finish: roof_metal       # default: the house's roof
          thickness: 0.1                # outside walls, metres; default: the house's
          facade: wood_cladding         # outside walls' finish; default: the house's facade
      - id: carport
        rect: [15.2, -4.5, 3, 5.5]
        building: { open: true, roof: flat }   # a roof on posts, no walls
```

Such a building can have upper floors, like a garage with a loft: draw the loft as a room on
the next level over the garage, and stairs between them like the house's. Its settings, set on
a room of any of its floors, count for all of them, and the roof sits on its top floor.

`robots:` places robot vacuums and lawn mowers with their dock. A live position is set up
in the editor, and so is `map:` (the robot's map picture on the card while it cleans:
`{entity: image.…, size: [w, h], origin: [x, y], scale: 0.0125, rotation: 0}`); see
[robots](robots.md).
