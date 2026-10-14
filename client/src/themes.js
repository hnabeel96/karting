// How a track looks. A track picks a preset by name and can override any value:
//   theme: 'grove'
//   theme: { preset: 'grove', road: '#8a5a3a', walls: 'stone' }
// Colours are CSS colours. Unknown keys are ignored.

export const THEMES = {
  // midday at the old temple: sandstone tiles, stone walls, blue sky
  temple: {
    sky: '#7cc8f2',
    skyTop: '#3a9ae0',
    haze: '#bfe6e8',
    clouds: '#ffffff',
    fogNear: 80,
    fogFar: 260,
    sunColor: '#fff0d4',
    sunStrength: 2.4,
    skyLight: '#dff4ff',
    groundLight: '#7a9a45',
    ambient: 1.55,

    ground: 'tiles', // inside the walls: 'tiles' or 'grass'
    grass: '#4f9a3a',
    sand: '#e8c48a',
    sandDark: '#cfa468',
    grout: '#a87e4b',
    road: '#b98a52',
    roadDark: 'rgba(140,98,55,0.5)',
    roadLight: 'rgba(214,174,120,0.5)',

    walls: 'stone', // track walls and the outer wall: 'stone' or 'hedge'
    stone: '#a59c88',
    stoneDark: '#7d7564',
    stoneLight: '#c6bea8',
    moss: '#5f8f34',
    hedge: '#3f8a35',
    hedgeDark: '#2e6e2c',
    flowers: ['#ff6fa0', '#ffd34a', '#ffffff'],

    kerbA: '#e8463c',
    kerbB: '#fff1d6',
    banner: '#d9620b',
    arch: 'stone', // start arch: 'stone' or 'wood'

    leaf: '#3f9a35',
    leafDark: '#2c7a2a',
    trunk: '#8a5a33',
    forest: ['#3f9a35', '#2c7a2a', '#4aa83c', '#2f8a3a', '#5aa63a'],
    mountains: ['#5b8a6a', '#6f9a72'],
  },

  // late afternoon in a mango orchard: red earth road, lawns, hedges, warm light
  grove: {
    sky: '#ffcf8f',
    skyTop: '#f0855d',
    haze: '#ffe3b5',
    clouds: '#fff0dc',
    fogNear: 70,
    fogFar: 240,
    sunColor: '#ffc88a',
    sunStrength: 2.6,
    skyLight: '#ffe6c4',
    groundLight: '#5f8a33',
    ambient: 1.35,

    ground: 'grass',
    grass: '#5aa53c',
    sand: '#d98a4e',
    road: '#b4532f',
    roadDark: 'rgba(130,48,25,0.5)',
    roadLight: 'rgba(222,128,80,0.45)',

    walls: 'hedge',
    stone: '#9a8f80',
    stoneDark: '#6f675c',
    stoneLight: '#bdb3a2',
    moss: '#4f8a2c',
    hedge: '#2f7d32',
    hedgeDark: '#22622a',
    flowers: ['#ffd34a', '#ff8a3d', '#ffffff'],

    kerbA: '#ffffff',
    kerbB: '#2f7d32',
    banner: '#2f7d32',
    arch: 'wood',

    leaf: '#2f8a35',
    leafDark: '#1f6a2c',
    trunk: '#6b4226',
    forest: ['#2f8a35', '#1f6a2c', '#3f9a3a', '#2a7a3a', '#4a8f2f'],
    mountains: ['#8a76a0', '#a08aa8'],
  },
};

/** the full theme for a track: its preset plus any overrides */
export function themeFor(arena) {
  const t = arena && arena.theme;
  const spec = typeof t === 'string' ? { preset: t } : t || {};
  return { ...THEMES.temple, ...(THEMES[spec.preset] || {}), ...spec };
}
