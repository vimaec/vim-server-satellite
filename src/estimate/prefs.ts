/**
 * Per-user view settings, kept in this browser's localStorage: the language,
 * the active sheet of each project, the grouping, the Display mode and its
 * shuffle seed, the Show filter. They are one person's way of looking at the
 * estimate, so they never go to the shared VIM Server store.
 *
 * Every storage access is wrapped: storage can be full, disabled (private
 * mode, a policy) or hold someone's hand-edited junk, and none of that may
 * stop the estimate from opening. A bad value reads as the default.
 */
import { DEFAULT_NESTING, GROUPABLE } from './grouping'
import type { GroupLevel, ShowFilter } from './grouping'
import type { Lang } from './types'

const PREFIX = 'vimSatellite.estimate.'

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? undefined : (JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or disabled: the setting lasts for this page only.
  }
}

/** The UI language; English unless the user picked Japanese. */
export function loadLang(): Lang {
  return read('lang') === 'ja' ? 'ja' : 'en'
}

export function saveLang(lang: Lang): void {
  write('lang', lang)
}

/** The sheet this user last had open in a project, or null. */
export function loadActiveSheet(projectId: string): string | null {
  const value = read(`sheet.${projectId}`)
  return typeof value === 'string' && value ? value : null
}

export function saveActiveSheet(projectId: string, sheetId: string): void {
  write(`sheet.${projectId}`, sheetId)
}

/** "Display": no colours, colours by cost, or a palette over one grouping level. */
export type DisplayMode = 'none' | 'cost' | `level:${GroupLevel}`

/** The Elements tab's view settings. */
export type ViewPrefs = {
  /** Group-by levels, outermost first. */
  nesting: GroupLevel[]
  display: DisplayMode
  /** The palette shuffle seed (0 = the stable default palette). */
  seed: number
  show: ShowFilter
}

export function defaultViewPrefs(): ViewPrefs {
  return { nesting: [...DEFAULT_NESTING], display: 'none', seed: 0, show: 'all' }
}

function isLevel(value: unknown): value is GroupLevel {
  return typeof value === 'string' && (GROUPABLE as string[]).includes(value)
}

/**
 * The stored view, each field validated on its own. A colour by a level that
 * is no longer in the grouping falls back to none, as the original does.
 */
export function loadViewPrefs(): ViewPrefs {
  const fallback = defaultViewPrefs()
  const stored = read('view')
  if (!stored || typeof stored !== 'object') return fallback
  const value = stored as Partial<Record<keyof ViewPrefs, unknown>>
  const nesting =
    Array.isArray(value.nesting) && value.nesting.every(isLevel)
      ? [...new Set(value.nesting as GroupLevel[])]
      : fallback.nesting
  let display: DisplayMode = fallback.display
  if (value.display === 'none' || value.display === 'cost') display = value.display
  else if (typeof value.display === 'string' && value.display.startsWith('level:')) {
    const level = value.display.slice(6)
    if (isLevel(level) && nesting.includes(level)) display = `level:${level}`
  }
  const seed = Number.isFinite(value.seed) ? Number(value.seed) : fallback.seed
  const show =
    value.show === 'included' || value.show === 'excluded' || value.show === 'all'
      ? value.show
      : fallback.show
  return { nesting, display, seed, show }
}

/**
 * Merges `patch` into the stored view and returns the result. A colour by a
 * level that just left the grouping goes with it.
 */
export function saveViewPrefs(patch: Partial<ViewPrefs>): ViewPrefs {
  const next = { ...loadViewPrefs(), ...patch }
  if (next.display.startsWith('level:') && !next.nesting.includes(next.display.slice(6) as GroupLevel)) {
    next.display = 'none'
  }
  write('view', next)
  return next
}
