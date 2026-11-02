# Robot vacuums and lawn mowers

Homeslice shows robot vacuums and lawn mowers on the house: at their dock, with what they
do, and driving around with their live position when Home Assistant knows it.

## On the card

- A robot drives to its new position at a robot's pace instead of jumping.
- A robot that is out without a fresh position stays faded at its last known spot (or its
  dock), marked *position not reported*.
- Its dock shows a warning when it needs something: water tank empty or full, bag full,
  cleaning fluid low, maintenance due, errors. These also appear in the card's
  `warnings:` strip (see the [card options](card.md#all-options)).

## In the editor

The Robots tool (`O`, together with Energy under one toolbar button) lists the robot vacuums
and lawn mowers in Home Assistant. Add a robot from the panel, click where its dock is,
then link its map; drag it to move its dock.

**Live position.** If Home Assistant knows where the robot is, the card shows it moving;
without that, the robot shows at its dock while docked. The position can come from:

- an **attribute** with map coordinates (e.g. from Valetudo or a map extractor),
- **Roborock**: Homeslice asks the robot (`roborock.get_vacuum_current_position`), every
  2 s while it is out,
- **GPS** (latitude and longitude), e.g. for mowers.

Map coordinates are calibrated with two spots: let the robot stand somewhere (at its dock
is fine), press *Record a spot* and click where it is on the plan; do it again with the
robot somewhere else, far away. For a mirrored map, add a third spot.

Some robots report their position only while cleaning, or only after their own app has
been opened (e.g. Roborock Q10): start a short clean, or open the app, then record.

**The robot's map as a floor plan.** A robot vacuum's map is true to scale (12.5 mm a
pixel): the editor can use it as the floor plan image, to drag into place over the house
and trace the rooms on it.

**Rooms from the robot's map.** Once the map lies in place, *Rooms from this map* reads the
rooms off its colours (the cleaning path, furniture and the robot drawn over them are
filled in, the outlines straightened) and adds them as rooms over the plan, each taking its
space from the rooms already there. With Roborock, the robot's room names come along
(`roborock.get_maps`, the map matching the picture's floor), and a Home Assistant area with
the same name is given at once; the others say *Unassigned room!*. The robot's map is never
perfect: check the rooms over it and move walls where it is rough. If the map has changed
since it was placed (the robot mapped more), use it as the floor plan image again first.

Older Xiaomi robots in the *Xiaomi Miio* integration report neither a position nor a map;
the *Xiaomi Cloud Map Extractor* (HACS) adds both: its camera's `vacuum_position` attribute
works as a live position source.

## In YAML

```yaml
robots:
  - { entity: vacuum.robo, level: ground, dock: [0.8, 3.3] }
```

A live position adds `position: {attribute: …}` (map coordinates in an attribute),
`{service: roborock.get_vacuum_current_position}` (Roborock) or GPS, and two calibration
`points` set in the editor. See the [house format](yaml.md).
