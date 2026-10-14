# Adding a track

A track is one small file in this folder plus one line in `index.js`. No game code changes: the track picker, online lobby, bots, minimap, offline app and tests all pick it up.

## 1. Copy a track file

```bash
cp shared/arenas/grove.js shared/arenas/coast.js
```

Change `id` (lowercase, used in links and saved settings) and `name` (shown in the picker).

## 2. Shape the road

`control` is the road's centre line: a loop of `[x, z]` points in driving order, in metres. The first point is the start/finish line. The game smooths a curve through them, so 15 to 20 points is plenty.

- `x` is east/west, `z` is north/south. Keep everything within about ±90.
- Points 20 to 40 m apart give smooth corners. Points close together make tight ones.
- Corners need a radius over 12 m, and separate parts of the road need about 20 m between their centre lines.

Preview it as you go:

```bash
npm run track coast       # prints length, tightest corner, closest pass; writes track-coast.svg
```

Open `track-coast.svg` in a browser. Problems are circled in red.

## 3. Register it

In `index.js`:

```js
import coast from './coast.js';
export const TRACKS = [circuit, grove, coast];
```

## 4. Test and play

```bash
npm test      # every track: road clear, no overlaps, corners, grid, pickups, and a 4-bot race to the finish
npm start
```

Pick it with the arrows on the title screen, or with the track buttons in the online lobby. Push to `main` and it is live.

## Everything a track can set

Only `id`, `name` and `control` are required.

| Setting | Default | What it does |
|---|---|---|
| `laps` | 3 | Laps per race (`LAPS=5 npm start` overrides every track) |
| `width` | 16 | Road width in metres. 14 is tight, 18 is roomy |
| `gates` | 16 | Timing gates per lap. More gates catch shortcuts sooner |
| `half` | fits the track | Half the width of the square world |
| `crates` | `[0.25, 0.5, 0.75]` | Rows of crates across the road, as fractions of a lap |
| `cratesPerRow` | 4 | Crates in each row |
| `mangoes` | none | Trails: `{ from: 0.1, to: 0.2, count: 6, lateral: -3 }`. `from`/`to` are fractions of a lap. `lateral` is metres left (+) or right (-) of centre |
| `hazards` | none | Things to steer round: `{ kind: 'rock' \| 'pillar', at: 0.5, lateral: 3 }` |
| `landmarks` | none | Hand-placed scenery: `{ kind: 'temple', x, z, scale }`, `{ kind: 'ruin', x, z, hw, hd }`, `{ kind: 'pillar' \| 'rock', x, z, r }`, `{ kind: 'palm', x, z }` |
| `scenery` | none | Scattered off the road: `{ kind: 'palm' \| 'rock' \| 'pillar', count: 40, seed: 3, gap: 6, r }`. Change `seed` for a different arrangement |
| `keepClear` | none | Circles that scattered scenery avoids: `{ x, z, r }` |

Fractions of a lap: 0 is the start line, 0.5 is halfway round. The numbers on the preview picture show where they fall.

Scenery kinds share the game's art, so `.glb` models listed in `client/models/manifest.js` replace them on every track.

## Starting the server on a track

`TRACK=grove npm start` makes the room start on that track. Players can still switch in the lobby. The first player into an empty room brings the track they picked on the title screen.
