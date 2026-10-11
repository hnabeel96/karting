# Karting

A phone-first kart racer to play with friends: Smash Karts-style chunky low-poly look, Crash Team Racing-style hop-drifts and pump-boosts. Runs in the phone's browser, nothing to install.

## Race your brother (same wifi)

On a laptop on the same wifi as both phones:

```bash
npm start
```

It prints an address like `http://192.168.1.20:3000`. Open it on both phones, turn them sideways, and tap **Race a friend**. You both land in the lobby: pick a name and colour, add bots if you want a fuller grid, and either of you taps **Start race**. Three laps of the Temple Circuit; the results screen has **Race again**.

No `npm install` needed: three.js is vendored in `client/vendor/` and the server uses only Node built-ins (Node 20+).

To race from different places, put the same server on a droplet: see [deploy/README.md](deploy/README.md).

**Install it like an app.** Open the game in Chrome on Android and tap **Install on this phone** on the title screen (or the browser menu's *Install app* / *Add to Home screen*; on iPhone, Safari's Share → *Add to Home Screen*). It then opens fullscreen and sideways from its own icon, and *Race bots* and free drive work offline. Online play needs the server, as always.

## Modes

| Title screen | What it is | Needs the server? |
|---|---|---|
| **Race a friend** | online race, up to 8 karts (friends + bots) | yes |
| **Race bots** | 3-lap race against 3 bots, all on your phone | no |
| Free drive in the courtyard | the original Temple Courtyard arena, no race | no |

## Controls

| Phone | Keyboard | Does |
|---|---|---|
| Drag left/right anywhere on the left half | `←` `→` or `A` `D` | Steer |
| Hold anywhere on the right half | `Space` / `Shift` | Hop. Keep holding while steering to drift |
| While drifting: let go and press again ("pump") when the ring glows | same | Boost. Up to 3 per drift, each one bigger |

The kart always accelerates; there is no gas pedal.

**Pump-boost.** While you drift, a charge fills the ring around the drift button. Its last stretch is the window: the button turns the colour of the next boost, the sparks match, and you hear a *ting*. Let go and press again inside the window to fire a boost and keep drifting. Too early or too late gives black smoke. Letting go inside the window without pressing again ends the drift with a boost.

**Mangoes** raise your top speed a little each (10 = Juiced). A hard crash knocks one loose. **Crates** slow you slightly when smashed; they will hold weapons later. Stuck against a wall for 3 seconds? You are put back on the road.

## The Temple Circuit

A 590 m loop round the old temple: long start straight, fast sweeper, chicane, a tight hairpin at the top, and a twisty run home. The track is just 18 control points in `shared/arenas/circuit.js`; `shared/track.js` turns them into a smooth road with walls, kerbs, timing gates and an 8-kart grid. Move a point and the whole track (walls, gates, minimap, bot racing line) follows. `npm test` checks the road never pinches or overlaps itself.

## How multiplayer works

```
phone ──inputs (60/s)──▶  server: the referee  ──snapshots (30/s)──▶ every phone
                          runs shared/race.js + sim.js
```

- The **server** runs the exact same rules as the phones (`shared/`), consumes each phone's `{ steer, drift }` inputs at 60 ticks a second, drives the bots, and sends everyone the state 30 times a second.
- **Your own kart** is predicted on your phone the moment you touch the screen, then quietly corrected when the server's answer arrives (unconfirmed inputs are replayed on top). Measured against the real server with 80 ms of round-trip lag, corrections were under 15 cm.
- **Everyone else** is drawn about 110 ms in the past, sliding smoothly between snapshots.

## How the code is laid out

```
shared/   the rules: identical on phones and the server
  sim.js          kart physics, hop/drift/boost, walls, bumps, pickups
  race.js         grid, countdown, gates, laps, positions, rescue, results
  track.js        control points -> road, walls, gates, grid
  bot.js          bots: courtyard circler and track racer
  net.js          snapshot packing
  arenas/         circuit.js (race), temple.js (courtyard)
client/   what the phone runs
  index.html      HUD, touch controls, title, lobby and results screens
  src/main.js     frame loop, camera, events -> effects, HUD
  src/session-local.js  games simulated on the phone
  src/session-net.js    online races: prediction and interpolation
  src/arena3d.js  draws an arena: track, walls, kerbs, scenery
  src/kartModel.js  the kart and its driver, Pip
  src/fx.js, input.js, audio.js, models.js
client/models/   optional .glb files that replace the built-in art (see its README)
server/
  index.js        serves the game, /ws for races, /health
  room.js         the race room: lobby, bots, inputs, snapshots
  ws.js           a small dependency-free WebSocket server
deploy/           systemd unit, Caddy and nginx setup for a droplet
tests/            node --test: sim, race, track geometry, server end to end
```

## Tuning

Feel numbers live in `TUNING` at the top of `shared/sim.js`; race rules in `RACE` in `shared/race.js`. Change, refresh, `npm test`.

Debug helpers in the browser console: `karting.autopilot = true` lets the bot drive your kart; `karting.colliders = true` outlines every collision shape.

## Swapping in 3D models

The kart, crates, mangoes and every prop can be replaced with `.glb` files by listing them in `client/models/manifest.js`. Add `#examples` to the address to see a swap. Rules, including the part names a kart model needs, are in [client/models/README.md](client/models/README.md).

## Roadmap

1. ~~Solo drift feel~~
2. ~~Race circuit and multiplayer~~
3. Crates hand out weapons: rocket, mine, homing missile, shockwave, shield; Juiced weapons
4. Battle mode in the courtyard, room codes for several groups at once
5. More tracks, bounce pads, explosive crates

## Credits

three.js r170 and its GLTFLoader (MIT), vendored in `client/vendor/`. Everything else, including models, textures and sounds, is generated in code.
