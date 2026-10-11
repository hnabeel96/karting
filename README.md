# Karting

A phone-first kart brawler to play with friends: Smash Karts-style arenas and chunky low-poly look, Crash Team Racing-style hop-drifts and boosts. Runs in the phone's browser, nothing to install.

**Status: step 1 of 5.** One kart, one arena, solo. The point of this step is to find out whether drifting feels good on a phone before anything else gets built.

## Play it

```bash
npm start
```

Then open the address it prints on your phone (same wifi), e.g. `http://192.168.1.20:3000`. Turn the phone sideways and tap **Play**.

No `npm install` needed: three.js is vendored in `client/vendor/`, and the dev server uses only Node built-ins. Node 20+.

## Controls

| Phone | Keyboard | Does |
|---|---|---|
| Drag left/right anywhere on the left half | `←` `→` or `A` `D` | Steer |
| Hold anywhere on the right half | `Space` / `Shift` | Hop. Keep holding while steering to drift |
| While drifting: let go and press again ("pump") when the ring glows | same | Boost. Up to 3 per drift, each one bigger |

The kart always accelerates; there is no gas pedal.

**The pump-boost.** While you drift, a charge fills the ring around the drift button. Its last stretch is the window: the button turns the colour of the next boost, the sparks match, and you hear a *ting*. Let go and press again inside the window to fire a boost and keep drifting. Too early or too late gives a puff of black smoke and resets the charge. Letting go inside the window and not pressing again ends the drift with a boost.

**Pickups.** Crates smash (weapons come later). Collect 10 mangoes to get **Juiced**, which will power up weapons later.

## How the code is laid out

```
shared/   the rulebook: runs the same on phones and, later, on the server
  sim.js          kart physics, hop/drift/boost state machine, collisions, pickups
  bot.js          a driver that produces inputs (title-screen demo, later fills empty seats)
  arenas/         arenas as plain data: obstacles, crates, mango lines, spawns
client/   what the phone runs
  index.html      HUD, touch controls, title screen
  src/main.js     fixed-step loop (60 ticks/s), camera, events -> effects
  src/arena3d.js  draws an arena from its data file
  src/kartModel.js  the kart and its driver, Pip
  src/fx.js       particles, skid marks, splinters, shockwave rings
  src/input.js    touch + keyboard
  src/audio.js    every sound, synthesised with WebAudio
client/models/   optional .glb files that replace the built-in art (see its README)
server/
  dev.js          static file server for local wifi play (grows into the referee)
tests/            node --test suite for the sim
```

Rules that keep multiplayer easy later:

- `shared/` never touches the DOM, three.js or `Math.random`. Same inputs, same result.
- The client only sends `{ steer, drift }` into `stepWorld()` at a fixed tick and draws what comes out. A server can run the exact same function.
- Anything cosmetic (squash, sparks, camera shake, sounds) lives in `client/` and reacts to sim events.

## Tuning

All the feel numbers are in `TUNING` at the top of `shared/sim.js`: speeds, turn rates, drift grip, the boost window, boost strength. Change a number, refresh the phone. Run `npm test` after.

Debug helpers in the browser console: `karting.autopilot = true` lets the bot drive; `karting.colliders = true` outlines every collision shape.

## Swapping in 3D models

The kart, crates, mangoes and every arena prop can be replaced with `.glb` model files (from Blender, Kenney, Quaternius...) by listing them in `client/models/manifest.js`. Anything not listed keeps its built-in look. Add `#examples` to the game's address to see a swap. Full rules, including the part names a kart model needs, are in [client/models/README.md](client/models/README.md).

## Roadmap

1. **Solo drift feel** (this step)
2. Crates hand out weapons: rocket, mine, homing missile, shockwave, shield. Juiced weapons.
3. Multiplayer over wifi: WebSocket referee in `server/`, client prediction for your own kart
4. Deploy to the Bangalore droplet with rooms, room codes and HTTPS
5. More arenas, bounce pads, explosive crates, polish

## Credits

three.js r170 and its GLTFLoader (MIT), vendored in `client/vendor/`. Everything else, including models, textures and sounds, is generated in code.
