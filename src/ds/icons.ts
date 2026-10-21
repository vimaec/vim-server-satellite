/**
 * The icon vocabulary of vim-html-ds, copied from its `atoms/ds-icon-button.ts`.
 *
 * Components name an icon; the code point lives here once. Glyphs are drawn by
 * the FluentUI System Icons fonts that ds.css loads (`--font-icon`, or
 * `--font-icon-filled` for a name in FILLED_GLYPHS). A few shapes no icon font
 * carries are drawn as one SVG path instead (SVG_PATHS), and the chevrons are
 * drawn by CSS classes on the icon button.
 */

/** Named icon-font characters (FluentUI System Icons code points). */
export const ICON_GLYPHS = {
  add: '', // add_16_regular
  more: '', // more_horizontal_16_regular
  back: '', // arrow_left_16_regular
  copy: '', // copy_16_regular
  download: '', // arrow_download_16_regular
  filter: '', // data_funnel_20_regular
  eye: '\u{F0AF1}', // eye_circle_16_filled
  'eye-off': '', // eye_off_16_regular
  // A lookalike the font does not carry (× U+00D7) renders in a text font and lands low.
  clear: '', // dismiss_16_regular
  play: '', // play_16_regular
  pause: '', // pause_16_regular
  eraser: '', // eraser_20_regular: "back to the default value"
  eyedropper: '', // eyedropper_16_regular: "take what is already there"
  lock: '', // lock_closed_16_regular
  unlock: '', // lock_open_16_regular
  'chevron-down-glyph': '', // chevron_down_12_regular
  // delete_16_regular: a trash can. Not in the DS map; the Estimate workflow's markup rows use it.
  trash: '',
  // arrow_clockwise_16_regular: read again from the server. Not in the DS map; the estimate panel
  // head uses it. Code point read from the cmap of fonts/FluentSystemIcons-Regular.woff2.
  refresh: '\uE0AA',
} as const

export type IconGlyphName = keyof typeof ICON_GLYPHS

/**
 * The names whose glyph is in the Filled font. The two Fluent fonts reuse the
 * same code points, so the character alone does not say which drawing it is.
 */
export const FILLED_GLYPHS: ReadonlySet<IconGlyphName> = new Set<IconGlyphName>(['eye'])

/**
 * Drawn SVG icons: one filled path in a 24-unit box, painted with currentColor
 * so hover / active / disabled states carry into the icon.
 */
export const SVG_PATHS = {
  // Painter's palette with its four wells knocked out (evenodd).
  palette: {
    evenodd: true,
    d:
      'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01' +
      '-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z' +
      'M5 11.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z M8 7.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z' +
      'M13 7.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z M16 11.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z',
  },
  // A pencil: the rename / edit gesture.
  edit: {
    d:
      'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z' +
      'M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  },
  // Two crossing arrows: the re-roll gesture.
  shuffle: {
    d:
      'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46' +
      ' 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  },
  // Arrows with a shaft: a step up or down a hierarchy (as against chevrons, which open one thing).
  'arrow-up': { d: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z' },
  'arrow-down': { d: 'M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z' },
  // How many views a comparison shows.
  'views-two': { d: 'M4 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0z M14 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0z' },
  'views-one': { d: 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0z' },
  // Three bars: the "configure / more" trigger.
  menu: { d: 'M3 6h18v2H3zM3 11h18v2H3zM3 16h18v2H3z' },
  // A camera body with its lens knocked out (evenodd): "frame it in the 3D view".
  // Added for the estimate's Cost Details pane; vim-html-ds draws it as a glyph of the host font.
  camera: {
    evenodd: true,
    d:
      'M9 4 7.17 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.17L15 4H9z' +
      'M12 8.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z',
  },
} as const satisfies Record<string, { d: string; evenodd?: boolean }>

export type SvgIconName = keyof typeof SVG_PATHS

/** Chevrons are drawn by a class on `.ds-iconbtn` (a rotated border corner), not a glyph. */
export const CHEVRON_CLASS = {
  'chevron-up': 'ds-iconbtn--chev-up',
  'chevron-down': 'ds-iconbtn--chev-down',
  'chevron-left': 'ds-iconbtn--chev-left',
  'chevron-right': 'ds-iconbtn--chev-right',
} as const

export type ChevronName = keyof typeof CHEVRON_CLASS

/** Every name an IconButton understands. Any other string is shown as literal glyph text. */
export type IconName = IconGlyphName | SvgIconName | ChevronName | 'browse' | 'folder'

export function isGlyphName(name: string): name is IconGlyphName {
  return Object.prototype.hasOwnProperty.call(ICON_GLYPHS, name)
}

export function isSvgName(name: string): name is SvgIconName {
  return Object.prototype.hasOwnProperty.call(SVG_PATHS, name)
}

export function isChevronName(name: string): name is ChevronName {
  return Object.prototype.hasOwnProperty.call(CHEVRON_CLASS, name)
}

/** The text to show for a glyph name, or the string itself when it is not a name. */
export function glyphText(icon: string): string {
  return isGlyphName(icon) ? ICON_GLYPHS[icon] : icon
}
