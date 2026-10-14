// Every race track in the game. To add one: put its file in this folder
// (see README.md here) and add it to the list below. The first is the default.
// Order here is the order in the track pickers.

import circuit from './circuit.js';
import grove from './grove.js';

export const TRACKS = [circuit, grove];

export const DEFAULT_TRACK = TRACKS[0].id;

/** the track with this id, or the default one if there is no such track */
export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}

const ids = new Set();
for (const t of TRACKS) {
  if (ids.has(t.id)) throw new Error(`two tracks share the id "${t.id}"`);
  ids.add(t.id);
}
