# The Homeslice card

The card shows a house on a dashboard as an exploded isometric 3D model, a tilted plan or a
flat 2D floor plan, live with Home Assistant's states. Add a **Homeslice** card to a
dashboard; its visual editor shows a small preview: turn it into the angle you want, then
pick the look. Everything below can also be set in YAML.

The card needs no extra dashboard resource: the integration serves it.

- [What the card shows](#what-the-card-shows)
- [Using it](#using-it)
- [All options](#all-options)
- [Energy](#energy)
- [Show a room on request](#show-a-room-on-request)
- [Announce something](#announce-something)

## What the card shows

- **Live house:** lights glow in their colours (spots, strips, indirect light, light
  through the windows at night), blinds, shutters, awnings, curtains and garage doors move
  with their covers, doors swing and windows tilt with their contacts, devices show their
  state, people stand in their rooms, robot vacuums drive around with their dock's warnings
  (see [robots](robots.md)).
- **On the plan:** readings on the room labels, a heatmap (temperature, humidity, CO₂,
  PM2.5), presence, leak/smoke/gas alarms, a window open in the rain, notes for bin day,
  thirsty plants, post and an appliance's time left, cameras with what they see.
- **Energy:** solar, battery, grid and devices with animated power flows and their readings.
- **Around the house:** the real sun and its path today, weather (rain, snow, fog), a
  garden with trees and hedges, balconies and roof terraces.
- **3D, 2.5D and 2D from one house:** the same house is an exploded 3D model, a tilted
  plan, a flat floor plan or all floors side by side — switch per card, not per drawing.
- **Made for wall tablets:** it draws only when something changes, has a low-quality mode
  for old tablets, kiosk options (back to the start view, dim at night, a clock), and HA's
  own cards and actions everywhere you tap.
- **In seven languages**, with number formats as your HA settings say.

## Using it

Tap to switch, drag to dim, long press for details; a TV or speaker opens a media panel
(play, volume, sources); room panels with HA's own cards; shortcut buttons; layers viewers
switch; time travel through the last day; walk through the house at eye level; the card
flies to what happens (a doorbell) or to what you ask Assist for ("Show the kitchen").

Tap a room's lamp to switch its lights (on a picked floor, rooms with several lamps get
one toggle per lamp), tap a room for a popup with its devices (including the blinds and
contacts of its windows), pick a floor to lift the floors above away. Hovering a floor
highlights it and makes the floors above see-through.

## All options

```yaml
type: custom:homeslice-card
house: home                    # the house id
roof: toggle                   # the roof: show, hide, or a roof button for the viewer: toggle (shown at first) or
                               #   toggle_hidden (hidden at first); the choice stays on that device
interactive: false             # true: drag to turn, scroll/pinch to zoom, two fingers move, double-click to reset;
                               #   buttons turn, show from above or tilted, and keep a start view on this device
energy: false                  # true: energy overlay (shows the roof unless view.roof: false)
mode: 3d                       # or plan: a drawn floor plan from above (dark walls, door swings),
                               #   or tilted: a plan at an angle with low walls; both one floor at a time
floors: one                    # plan only: all shows every floor at once, side by side
sun: true                      # light from the real sun (sun.sun), darker at night
look: day                      # or night (dark, glowing outlines), auto (night after sunset),
                               #   white (a white model) or blueprint (dark blue, glowing edges)
accent: "#4fc3f7"              # the night look's outline colour
presence: true                 # mark rooms with motion/occupancy/presence; leak, smoke and gas alarms always show
lux: false                     # true: rooms as bright as their lux sensor reads (dark rooms look dark), with the reading
quality: auto                  # low: for weak wall tablets (no shadows, plain colours, simple furniture); high; auto picks
heatmap: temperature           # optional: tint rooms by temperature (blue cold … red hot), humidity, carbon_dioxide or pm25
heatmap_style: smooth          # rooms (default): one colour per room; smooth: blended across the floor between the
                               #   readings (room middles and placed sensor pieces)
values: [temperature, humidity, carbon_dioxide]   # readings on the room labels (default: temperature), a dot when out of range
thresholds:                    # optional: own colour steps (labels and heatmap)
  carbon_dioxide: [{ value: 800, color: orange }, { value: 1200, color: red }]
follow: [event.doorbell, binary_sensor.front_door]   # turn to where these go active (a note says what), then back
follow_alarms: false           # true: also turn to leak, smoke and gas alarms
follow_seconds: 30             # how long to stay; nothing moves while someone uses the card
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
room_panel: true               # a tap on a room opens its panel (false: rooms do nothing)
lamp_style: icon               # lamp buttons: a glowing bulb (icon) or a bulb in a dark disc (circle)
tooltips: true                 # desktop: hovering a linked piece shows its name, state and when that changed
feedback: true                 # a short note of what a tap or a drag did ("Kitchen: lights off"); false hides it
sensor_timeout: 24             # hours: a door or window contact that sent nothing that long is marked silent
                               #   (default: only when unavailable)
idle_return: 120               # wall tablets: back to the start view after 2 minutes without a touch
night: "22:00-06:00"           # dim the card at night (or: sun), night_brightness: 0.4
idle_orbit: true               # turn the house slowly while nobody uses it
clock: true                    # a clock in the corner
buttons:                       # shortcuts in the bottom right: scenes/scripts run, lights and switches toggle
  - entity: scene.movie_night
  - entity: script.good_night
    name: Good night
  - entity: light.terrace
    level: ground              # only while this floor is picked
rain: binary_sensor.rain       # warn about open windows while it rains (default: the weather entity)
power_outage: binary_sensor.grid_down   # a warning on the card while it is on
heating: true                  # underfloor heating loops glow while they heat (rooms with underfloor:)
warnings: true                 # a strip of what needs attention (alarms, leaks, jammed locks, silent sensors, robots);
                               #   a tap shows where
climate_hints: true            # humid rooms: "air the room" (when the air outside is drier, from weather:), mould risk from 70 %
badges: true                   # notes above linked pieces: bin pickup today/tomorrow, thirsty plants, post, time left
weather: weather.home          # its condition and temperature in a corner (tap: forecast); rain, snow and fog
weather_effects: true          #   around the house (false: only the badge)
sun_path: true                 # today's sun path as an arc around the house, sunrise and sunset times
time_travel: true              # a button to replay the last day from HA's history (lights, doors, blinds, devices)
walk: true                     # a button to walk through the house at eye level (keys, touch stick, drag to look)
layers: [energy, heating, heatmap, values, presence, climate]   # a layers button: viewers switch these (kept per device)
rules:                         # looks by state, no code: while it matches, a pulsing ring, the piece's colour,
  - entity: binary_sensor.doorbell   # an icon and a text where the entity is (its piece, door, lamp or room)
    state: "on"                #   or above: / below: (numbers), attribute: (read that instead)
    ring: "#ff3b30"
  - entity: sensor.office_co2
    above: 1000
    icon: mdi:molecule-co2
    text: "{state:0} {unit}"   #   {state}, {state:1} (decimals), {unit}, {name}, {attr:brightness}
  - entity: climate.bedroom
    state: heat
    color: "#ff8a3a"           #   tints its linked piece (an AC, a radiator)
overlays:                      # other cards on the house card, to use its empty corners
  - card: { type: weather-forecast, entity: weather.home }
    top: 8px
    right: 8px
    width: 300px
    layer: front               # or behind: under the house, just to look at
    levels: [overview]         # optional: only on these floors (overview: the whole house)
people:                        # people in the room they are in (Bermuda, ESPresense: a sensor naming the area)
  - { person: person.alex, room: sensor.alex_phone_area }
  - { person: device_tracker.bello_tag, room: sensor.bello_area, pet: true }   # a pet: small, with a paw
actions:                       # optional: own tap/hold actions for linked pieces and lamps (Lovelace actions)
  light.hall:
    tap_action: { action: more-info }
    hold_action: { action: perform-action, perform_action: script.night_light }
popups:                        # optional, by room id or area id
  living_room:
    mode: extend               # or replace
    cards:
      - type: weather-forecast
        entity: weather.home
```

## Energy

With `energy: true` (or `energy` in `layers:`) the card shows solar, battery, grid and
devices with animated power flows and their readings. Where they sit is part of the house:
place them in the editor (Energy tool, `E`) or list them under `energy:` in the
[house file](yaml.md#energy). Sensors default to Home Assistant's energy settings; any item
can show more readings in its callout (a heat pump's COP, hot water…).

## Show a room on request

The action `homeslice.show` (area, floor or entity, by id or name; optional `seconds`)
makes open cards fly there for a while, e.g. from an automation (the doorbell rings: show
the front door) or by voice. For Assist, import the blueprint
[`show_by_voice.yaml`](../blueprints/automation/homeslice/show_by_voice.yaml) ("Show the
kitchen", "Zeig die Küche"):

[![Import the blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fheadtr1ck%2Fhomeslice%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fhomeslice%2Fshow_by_voice.yaml)

## Announce something

`homeslice.announce` shows a message on every open card, at a room if you name one, and
speaks it on that room's speakers (text-to-speech; or the `media_player`s you list):

```yaml
action: homeslice.announce
data:
  message: Dinner is ready
  area: kitchen        # optional: without it every card shows it where it is, nobody speaks
```
