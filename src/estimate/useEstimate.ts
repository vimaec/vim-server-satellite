/**
 * All estimate state for one project and one loaded VIM: the shared lists
 * (work packages, cost codes, sheets), the active sheet's assignments, the
 * per-element facts of the model, and what is derived from them (priced rows,
 * totals). The actions change the data; the UI never talks to the store.
 *
 * Writes are optimistic: the state changes first, the server follows. A user
 * action that touches 5,000 elements must not wait on a round trip, and the
 * tree must answer every click at once. When the server refuses, the action is
 * taken back, `failure` says why, and everything is re-read from the server,
 * which is the truth.
 *
 * Writes run one after the other through a single queue, so the server sees
 * them in the order the user made them (a cost code is created before the
 * elements that use it; a sheet before its assignments). Assignment changes
 * made within a few milliseconds of each other go out as one batch.
 *
 * Browsing never writes. A project with no sheet shows a virtual "Estimate 1";
 * the first write creates it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as VIM from 'vim-web'
import { useAuth } from '../auth/AuthProvider'
import { DEFAULT_CURRENCY, makeT, money as formatMoney } from './i18n'
import type { Translator } from './i18n'
import { loadActiveSheet, loadLang, saveActiveSheet, saveLang } from './prefs'
import { codeUsage, computeTotals, priceRows } from './pricing'
import type { CodeUsage } from './pricing'
import { BuildCancelled, buildFacts } from './quantities'
import * as store from './store'
import { applyPatch, newId } from './types'
import type {
  Assignment,
  AssignmentPatch,
  CostCode,
  ElementFacts,
  Lang,
  Markup,
  PricedRow,
  Sheet,
  Totals,
  WorkPackage,
} from './types'

type IWebglVim = VIM.Core.Webgl.IWebglVim

/** The editable fields of a cost code. */
export type CostCodeField = Exclude<keyof CostCode, 'id'>

/** A message for a toast, from an action that wants to tell the user something. */
export type Feedback = { tone: 'good' | 'warn'; text: string }

export type Estimate = {
  /** The first read of the project's estimate data. */
  status: 'loading' | 'ready' | 'error'
  /** Why the first read failed (status 'error'). */
  error?: string
  /**
   * Whether the actions write. False until the data and the role are known,
   * and for the Viewer role (the store refuses its writes with 403). When
   * false, every write action is a no-op.
   */
  canEdit: boolean
  /** Read everything again (after a failed load). */
  retry: () => void
  /** Writes are on their way to the server. */
  saving: boolean
  /**
   * The last write the server refused, already rolled back and followed by a
   * re-read. `seq` grows with each failure, so the UI can toast each one once.
   */
  failure: { seq: number; message: string } | null

  /** The UI language (localStorage). */
  lang: Lang
  setLang: (lang: Lang) => void
  /** Translator bound to `lang` and the active sheet's currency (¥ labels show its symbol). */
  t: Translator
  /** An amount with the active sheet's currency symbol: "$ 1,234". */
  money: (value: number | null | undefined) => string

  /** The sheets in display order; never empty (a virtual "Estimate 1" when none is stored). */
  sheets: Sheet[]
  /** The active sheet. */
  sheet: Sheet
  /** True while the active sheet's assignments are being read (after a switch). Writes wait. */
  sheetLoading: boolean
  /** Open another sheet (remembered per project in localStorage). */
  switchSheet: (id: string) => void
  /**
   * A new sheet, made active: empty, or (`fromId`) a copy of that sheet's
   * assignments, markups and currency. Returns its id, or null when read-only.
   */
  addSheet: (name: string, fromId?: string) => string | null
  renameSheet: (id: string, name: string) => void
  /** False (and nothing happens) for the last sheet, which cannot be deleted, or when read-only. */
  deleteSheet: (id: string) => boolean
  /** The active sheet's currency (ISO code, see CURRENCIES). */
  setCurrency: (currency: string) => void
  /** Replace the active sheet's markups. */
  setMarkups: (markups: Markup[]) => void

  /** Shared by every sheet, by id. */
  workPackages: Map<string, WorkPackage>
  /** Returns the new id (or the id of an existing package with that name); null when read-only or blank. */
  addWorkPackage: (name: string) => string | null
  /** Renames in the current UI language only (the other name stays). */
  renameWorkPackage: (id: string, name: string) => void
  /** Its elements keep their cost codes and lose the package, in every sheet. */
  deleteWorkPackage: (id: string) => void

  /** Shared by every sheet, by id. */
  costCodes: Map<string, CostCode>
  /**
   * Create a code, or update one: the one with `id`, else the one whose
   * `code` text matches. A new code without `code` gets "USER-<n>". Returns
   * the id, or null when read-only.
   */
  upsertCode: (code: Partial<CostCode>) => string | null
  updateCode: <K extends CostCodeField>(id: string, field: K, value: CostCode[K]) => void
  /** Its elements lose the code, in every sheet. */
  deleteCode: (id: string) => void
  /** How each code is used in the active sheet (count, Σ qty, Σ amount, elements). */
  usage: Map<string, CodeUsage>

  /** Per element index: what the estimate reads of the model. Empty until the build finishes. */
  facts: Map<number, ElementFacts>
  /** The facts build of the current VIM. */
  factsStatus: 'idle' | 'building' | 'ready' | 'error'
  /** Element key -> element index, for the elements of the loaded model. */
  indexByKey: Map<string, number>
  /** The active sheet's assignments, by element key (may include elements not in this model). */
  assignments: Map<string, Assignment>
  /** Per element index: the element priced in the active sheet. Every element in `facts` has one. */
  priced: Map<number, PricedRow>
  /** The active sheet's sums, markups and total. */
  totals: Totals
  /** Excluded element indices in the active sheet (hide them in 3D). */
  hidden: Set<number>

  /** Set fields on elements in the active sheet; `null` clears a field. */
  assign: (elements: readonly number[], patch: AssignmentPatch) => void
  /** Include (true) or exclude (false) elements. */
  setIncluded: (elements: readonly number[], included: boolean) => void
  /** Ctrl+X: included when every one of them is excluded, else excluded. */
  toggleIncluded: (elements: readonly number[]) => void

  /** The cost code id Copy Cost Code holds, or null. */
  copiedCode: string | null
  /** Copy the code of ONE element. The feedback is for a toast. */
  copyCode: (elements: readonly number[]) => Feedback
  /** Put the copied code on elements, in place of theirs. The feedback is for a toast. */
  pasteCode: (elements: readonly number[]) => Feedback
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The write failed.'
}

/** The sheet a project shows before anyone wrote one. */
function virtualSheet(t: Translator): Sheet {
  return {
    id: store.FIRST_SHEET_ID,
    name: t('Estimate {n}', { n: 1 }),
    sort: 1,
    currency: DEFAULT_CURRENCY,
    markups: defaultMarkups(t),
    virtual: true,
  }
}

function defaultMarkups(t: Translator): Markup[] {
  return store.DEFAULT_MARKUPS.map((markup) => ({ ...markup, name: t(markup.name) }))
}

/** Assignment changes waiting to go out as one batch. */
type Pending = {
  projectId: string
  /** A snapshot of the sheet, so a virtual one can still be created after the page moved on. */
  sheet: Sheet
  /** key -> new value (null = delete). */
  next: Map<string, Assignment | null>
  /** key -> value before the first change in this batch (for the rollback). */
  before: Map<string, Assignment | undefined>
}

/** Assignment changes made within this window go out together. */
const BATCH_DELAY_MS = 40

const EMPTY_FACTS = new Map<number, ElementFacts>()

export function useEstimate(
  projectId: string,
  role: string,
  vim: IWebglVim | undefined,
): Estimate {
  const auth = useAuth()
  const by = auth.session?.upn || auth.session?.name || undefined

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | undefined>(undefined)
  const [reload, setReload] = useState(0)
  const [savingCount, setSavingCount] = useState(0)
  const [failure, setFailure] = useState<{ seq: number; message: string } | null>(null)
  const [lang, setLangState] = useState<Lang>(loadLang)
  const [sheets, setSheets] = useState<Sheet[]>(() => [virtualSheet(makeT(loadLang(), DEFAULT_CURRENCY))])
  const [activeId, setActiveId] = useState<string>(store.FIRST_SHEET_ID)
  const [sheetLoading, setSheetLoading] = useState(false)
  const [workPackages, setWorkPackages] = useState<Map<string, WorkPackage>>(() => new Map())
  const [costCodes, setCostCodes] = useState<Map<string, CostCode>>(() => new Map())
  const [assignments, setAssignmentsState] = useState<Map<string, Assignment>>(() => new Map())
  const [facts, setFacts] = useState<Map<number, ElementFacts>>(EMPTY_FACTS)
  const [factsStatus, setFactsStatus] = useState<Estimate['factsStatus']>('idle')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  /**
   * Bumped when the project changes, the data is re-read, or the hook goes
   * away. Async work compares it after every await and drops its result if it
   * moved: the result belongs to data no longer on screen.
   */
  const epochRef = useRef(0)
  /** The serial write queue. */
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const pendingRef = useRef<Pending | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Sheets created on the server by this page (project/sheet), so a virtual one is created once. */
  const createdRef = useRef(new Map<string, Promise<void>>())
  const failureSeq = useRef(0)
  /** Bumped on every sheet switch; a slower read of an older switch is dropped. */
  const switchSeq = useRef(0)
  /** The latest `flush`, for the project-change cleanup (declared before `flush` exists). */
  const flushRef = useRef<() => void>(() => undefined)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  // Actions read the latest state through refs: two actions in one event must
  // see each other's changes, and stable callbacks keep a 20k-row tree from
  // re-rendering on every keystroke.
  const assignmentsRef = useRef(assignments)
  const sheetsRef = useRef(sheets)
  const activeIdRef = useRef(activeId)
  const workPackagesRef = useRef(workPackages)
  const costCodesRef = useRef(costCodes)
  const factsRef = useRef(facts)
  const langRef = useRef(lang)
  const copiedRef = useRef(copiedCode)
  sheetsRef.current = sheets
  activeIdRef.current = activeId
  workPackagesRef.current = workPackages
  costCodesRef.current = costCodes
  factsRef.current = facts
  langRef.current = lang
  copiedRef.current = copiedCode

  // An empty role means GET /project/{id}/role has not answered yet: not a writer yet.
  const canEdit = status === 'ready' && role !== '' && role !== 'Viewer'
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit
  const sheetLoadingRef = useRef(sheetLoading)
  sheetLoadingRef.current = sheetLoading
  const byRef = useRef(by)
  byRef.current = by

  const setAssignments = useCallback((next: Map<string, Assignment>) => {
    assignmentsRef.current = next
    setAssignmentsState(next)
  }, [])

  const setSheetsNow = useCallback((next: Sheet[]) => {
    sheetsRef.current = next
    setSheets(next)
  }, [])

  const tNow = useCallback((): Translator => {
    const sheet = sheetsRef.current.find((entry) => entry.id === activeIdRef.current)
    return makeT(langRef.current, sheet?.currency ?? DEFAULT_CURRENCY)
  }, [])

  /** Take everything from a fresh read. */
  const adopt = useCallback(
    (load: store.EstimateLoad) => {
      const nextSheets = load.sheets.length ? load.sheets : [virtualSheet(tNow())]
      setSheetsNow(nextSheets)
      activeIdRef.current = load.sheetId
      setActiveId(load.sheetId)
      setWorkPackages(load.workPackages)
      setCostCodes(load.costCodes)
      setAssignments(load.assignments)
      setSheetLoading(false)
    },
    [setAssignments, setSheetsNow, tNow],
  )

  // ---- load on project open ------------------------------------------------------------------

  useEffect(() => {
    const epoch = ++epochRef.current
    setStatus('loading')
    setError(undefined)
    setFailure(null)
    setSavingCount(0)
    setCopiedCode(null)
    setSheetLoading(false)

    void (async () => {
      try {
        const load = await store.loadEstimate(projectId, loadActiveSheet(projectId))
        if (epoch !== epochRef.current) return
        adopt(load)
        setStatus('ready')
      } catch (cause: unknown) {
        if (epoch !== epochRef.current) return
        setStatus('error')
        setError(messageOf(cause))
      }
    })()

    return () => {
      // Edits made just before leaving still go out; their outcome no longer shows.
      flushRef.current()
      epochRef.current++
    }
  }, [adopt, projectId, reload])

  const retry = useCallback(() => setReload((count) => count + 1), [])

  // ---- facts: once per loaded vim ------------------------------------------------------------

  useEffect(() => {
    if (!vim) {
      setFacts(EMPTY_FACTS)
      setFactsStatus('idle')
      return
    }
    let cancelled = false
    setFacts(EMPTY_FACTS)
    setFactsStatus('building')
    buildFacts(vim, () => cancelled).then(
      (built) => {
        if (cancelled) return
        setFacts(built)
        setFactsStatus('ready')
      },
      (cause: unknown) => {
        if (cancelled || cause instanceof BuildCancelled) return
        console.error('Could not read the model quantities', cause)
        setFactsStatus('error')
      },
    )
    return () => {
      cancelled = true
    }
  }, [vim])

  // ---- the write queue -----------------------------------------------------------------------

  /** Re-read everything once the queue is idle, keeping the active sheet. */
  const reloadQuietly = useCallback(() => {
    const epoch = epochRef.current
    void (async () => {
      await chainRef.current.catch(() => undefined)
      if (epoch !== epochRef.current) return
      try {
        const load = await store.loadEstimate(projectId, activeIdRef.current)
        if (epoch !== epochRef.current) return
        adopt(load)
      } catch {
        // The failure is already on screen; the next action or Retry tries again.
      }
    })()
  }, [adopt, projectId])

  const fail = useCallback(
    (cause: unknown) => {
      setFailure({ seq: ++failureSeq.current, message: messageOf(cause) })
      reloadQuietly()
    },
    [reloadQuietly],
  )

  /** Appends a task to the serial queue. `onError` takes back the optimistic change. */
  const enqueue = useCallback(
    (task: () => Promise<void>, onError?: () => void) => {
      const epoch = epochRef.current
      setSavingCount((count) => count + 1)
      chainRef.current = chainRef.current
        .then(task)
        .catch((cause: unknown) => {
          if (epoch !== epochRef.current) return
          onError?.()
          fail(cause)
        })
        .finally(() => {
          if (epoch === epochRef.current) setSavingCount((count) => Math.max(0, count - 1))
        })
    },
    [fail],
  )

  /**
   * Makes sure a sheet exists on the server before anything is written to or
   * about it. A virtual sheet is created (create-only) the first time; the
   * promise is shared so concurrent writers create it once.
   */
  const ensureStored = useCallback(async (project: string, sheet: Sheet): Promise<void> => {
    if (!sheet.virtual) return
    const id = `${project}/${sheet.id}`
    let created = createdRef.current.get(id)
    if (!created) {
      created = store.createSheet(project, { ...sheet, virtual: undefined }).then(() => undefined)
      createdRef.current.set(id, created)
      created.catch(() => createdRef.current.delete(id))
    }
    await created
    if (project !== projectIdRef.current) return
    const current = sheetsRef.current
    if (current.some((entry) => entry.id === sheet.id && entry.virtual)) {
      setSheetsNow(current.map((entry) => (entry.id === sheet.id ? { ...entry, virtual: undefined } : entry)))
    }
  }, [setSheetsNow])

  /** Sends the pending assignment batch now. */
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const batch = pendingRef.current
    pendingRef.current = null
    if (!batch || batch.next.size === 0) return
    const puts: { key: string; value: Assignment }[] = []
    const deletes: string[] = []
    for (const [key, value] of batch.next) {
      if (value) puts.push({ key, value })
      else deletes.push(key)
    }
    enqueue(
      async () => {
        await ensureStored(batch.projectId, batch.sheet)
        await store.writeAssignments(batch.projectId, batch.sheet.id, puts, deletes)
      },
      () => {
        // Take back only what this batch changed and nothing changed since.
        if (activeIdRef.current !== batch.sheet.id) return
        const current = assignmentsRef.current
        const next = new Map(current)
        let changed = false
        for (const [key, value] of batch.next) {
          if ((current.get(key) ?? null) !== value) continue
          const before = batch.before.get(key)
          if (before) next.set(key, before)
          else next.delete(key)
          changed = true
        }
        if (changed) setAssignments(next)
      },
    )
  }, [enqueue, ensureStored, setAssignments])

  flushRef.current = flush

  /** Whether the active sheet takes assignment writes right now. */
  const writable = useCallback(
    () => canEditRef.current && !sheetLoadingRef.current && factsRef.current.size > 0,
    [],
  )

  // ---- assignments ---------------------------------------------------------------------------

  const assign = useCallback(
    (elements: readonly number[], patch: AssignmentPatch) => {
      if (!writable() || elements.length === 0) return
      const sheet = sheetsRef.current.find((entry) => entry.id === activeIdRef.current)
      if (!sheet) return
      const at = new Date().toISOString()
      const current = assignmentsRef.current
      let next: Map<string, Assignment> | null = null
      const changes: [string, Assignment | null, Assignment | undefined][] = []
      for (const index of new Set(elements)) {
        const fact = factsRef.current.get(index)
        if (!fact) continue
        const before = current.get(fact.key)
        const after = applyPatch(before, patch, { elementId: fact.elementId, by: byRef.current, at })
        if (after === undefined) continue
        next ??= new Map(current)
        if (after) next.set(fact.key, after)
        else next.delete(fact.key)
        changes.push([fact.key, after, before])
      }
      if (!next) return
      setAssignments(next)

      let pending = pendingRef.current
      if (pending && (pending.sheet.id !== sheet.id || pending.projectId !== projectId)) {
        flush()
        pending = null
      }
      if (!pending) {
        pending = { projectId, sheet, next: new Map(), before: new Map() }
        pendingRef.current = pending
      }
      for (const [key, after, before] of changes) {
        if (!pending.before.has(key)) pending.before.set(key, before)
        pending.next.set(key, after)
      }
      if (!timerRef.current) timerRef.current = setTimeout(() => flushRef.current(), BATCH_DELAY_MS)
    },
    [flush, projectId, setAssignments, writable],
  )

  const setIncluded = useCallback(
    (elements: readonly number[], included: boolean) => assign(elements, { hidden: !included }),
    [assign],
  )

  const toggleIncluded = useCallback(
    (elements: readonly number[]) => {
      if (elements.length === 0) return
      const current = assignmentsRef.current
      const allExcluded = elements.every((index) => {
        const fact = factsRef.current.get(index)
        return fact ? current.get(fact.key)?.hidden === true : true
      })
      assign(elements, { hidden: !allExcluded })
    },
    [assign],
  )

  // ---- sheets --------------------------------------------------------------------------------

  /** Reads a sheet's assignments and makes it the active one. */
  const openSheet = useCallback(
    (id: string, known?: Map<string, Assignment>) => {
      flush()
      const seq = ++switchSeq.current
      activeIdRef.current = id
      setActiveId(id)
      saveActiveSheet(projectId, id)
      const sheet = sheetsRef.current.find((entry) => entry.id === id)
      if (known || sheet?.virtual) {
        setAssignments(known ?? new Map())
        setSheetLoading(false)
        sheetLoadingRef.current = false
        return
      }
      setSheetLoading(true)
      sheetLoadingRef.current = true
      const epoch = epochRef.current
      void (async () => {
        try {
          // After the queue: the sheet may have writes (or its creation) in flight.
          await chainRef.current.catch(() => undefined)
          const loaded = await store.loadAssignments(projectId, id)
          if (epoch !== epochRef.current || seq !== switchSeq.current) return
          setAssignments(loaded)
          setSheetLoading(false)
        } catch (cause: unknown) {
          if (epoch !== epochRef.current || seq !== switchSeq.current) return
          setSheetLoading(false)
          fail(cause)
        }
      })()
    },
    [fail, flush, projectId, setAssignments],
  )

  const switchSheet = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return
      if (!sheetsRef.current.some((entry) => entry.id === id)) return
      openSheet(id)
    },
    [openSheet],
  )

  /** Applies a change to one sheet document, locally now and on the server (read-modify-write). */
  const changeSheet = useCallback(
    (id: string, mutate: (sheet: Sheet) => Sheet) => {
      if (!canEditRef.current) return
      const before = sheetsRef.current.find((entry) => entry.id === id)
      if (!before) return
      setSheetsNow(sheetsRef.current.map((entry) => (entry.id === id ? mutate(entry) : entry)))
      const project = projectId
      enqueue(async () => {
        const local = sheetsRef.current.find((entry) => entry.id === id)
        // A virtual sheet is created with the change already in it; the update below is then a no-op.
        await ensureStored(project, local ?? mutate(before))
        await store.updateSheet(project, id, mutate)
      })
    },
    [enqueue, ensureStored, projectId, setSheetsNow],
  )

  const renameSheet = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim()
      if (trimmed) changeSheet(id, (sheet) => ({ ...sheet, name: trimmed }))
    },
    [changeSheet],
  )

  const setCurrency = useCallback(
    (currency: string) => changeSheet(activeIdRef.current, (sheet) => ({ ...sheet, currency })),
    [changeSheet],
  )

  const setMarkups = useCallback(
    (markups: Markup[]) =>
      changeSheet(activeIdRef.current, (sheet) => ({
        ...sheet,
        markups: markups.map((markup) => ({ ...markup, pct: Number(markup.pct) || 0 })),
      })),
    [changeSheet],
  )

  const addSheet = useCallback(
    (name: string, fromId?: string): string | null => {
      if (!canEditRef.current) return null
      const trimmed = name.trim()
      if (!trimmed) return null
      flush()
      const list = sheetsRef.current
      const active = list.find((entry) => entry.id === activeIdRef.current) ?? list[0]
      const from = fromId ? list.find((entry) => entry.id === fromId) : undefined
      const sheet: Sheet = {
        id: newId('sheet'),
        name: trimmed,
        sort: list.reduce((max, entry) => Math.max(max, entry.sort), 0) + 1,
        currency: (from ?? active).currency,
        markups: from ? from.markups.map((markup) => ({ ...markup })) : defaultMarkups(tNow()),
      }
      // A virtual sheet next to a stored one would vanish on the next read: store it too.
      const virtuals = list.filter((entry) => entry.virtual)
      const copied =
        from && from.id === activeIdRef.current ? new Map(assignmentsRef.current) : undefined
      setSheetsNow([...list, sheet])
      const project = projectId
      enqueue(
        async () => {
          for (const entry of virtuals) await ensureStored(project, entry)
          await store.createSheet(project, sheet)
          if (!from) return
          const source = copied ?? (await store.loadAssignments(project, from.id))
          await store.copyAssignments(project, sheet.id, source)
          if (!copied && activeIdRef.current === sheet.id && project === projectIdRef.current) {
            setAssignments(new Map(source))
          }
        },
        () => {
          setSheetsNow(sheetsRef.current.filter((entry) => entry.id !== sheet.id))
        },
      )
      openSheet(sheet.id, copied ?? new Map())
      return sheet.id
    },
    [enqueue, ensureStored, flush, openSheet, projectId, setAssignments, setSheetsNow, tNow],
  )

  const deleteSheet = useCallback(
    (id: string): boolean => {
      if (!canEditRef.current) return false
      const list = sheetsRef.current
      const sheet = list.find((entry) => entry.id === id)
      if (!sheet || list.length < 2) return false
      flush()
      const rest = list.filter((entry) => entry.id !== id)
      setSheetsNow(rest)
      if (activeIdRef.current === id) openSheet(rest[0].id)
      if (!sheet.virtual) {
        const project = projectId
        enqueue(() => store.deleteSheet(project, id))
      }
      return true
    },
    [enqueue, flush, openSheet, projectId, setSheetsNow],
  )

  // ---- work packages -------------------------------------------------------------------------

  /** Drops an id from the active sheet's local assignments (the server side is done by the store). */
  const clearLocally = useCallback(
    (field: 'wp' | 'code', id: string) => {
      const current = assignmentsRef.current
      let next: Map<string, Assignment> | null = null
      for (const [key, assignment] of current) {
        if (assignment[field] !== id) continue
        next ??= new Map(current)
        const changed = { ...assignment }
        delete changed[field]
        if (changed.wp || changed.code || changed.extra !== undefined || changed.note || changed.hidden) {
          next.set(key, changed)
        } else next.delete(key)
      }
      if (next) setAssignments(next)
    },
    [setAssignments],
  )

  const addWorkPackage = useCallback(
    (name: string): string | null => {
      if (!canEditRef.current) return null
      const trimmed = name.trim()
      if (!trimmed) return null
      const list = [...workPackagesRef.current.values()]
      // A typed name that spells an existing package is that package.
      const lower = trimmed.toLowerCase()
      const hit = list.find((wp) => wp.en.toLowerCase() === lower || wp.ja.toLowerCase() === lower)
      if (hit) return hit.id
      const wp: WorkPackage = {
        id: newId('wp'),
        en: trimmed,
        ja: trimmed,
        sort: list.reduce((max, entry) => Math.max(max, entry.sort), 0) + 1,
      }
      const next = new Map(workPackagesRef.current).set(wp.id, wp)
      workPackagesRef.current = next
      setWorkPackages(next)
      const project = projectId
      enqueue(() => store.putWorkPackage(project, wp))
      return wp.id
    },
    [enqueue, projectId],
  )

  const renameWorkPackage = useCallback(
    (id: string, name: string) => {
      if (!canEditRef.current) return
      const trimmed = name.trim()
      const wp = workPackagesRef.current.get(id)
      if (!wp || !trimmed) return
      const renamed = langRef.current === 'ja' ? { ...wp, ja: trimmed } : { ...wp, en: trimmed }
      const next = new Map(workPackagesRef.current).set(id, renamed)
      workPackagesRef.current = next
      setWorkPackages(next)
      const project = projectId
      enqueue(() => store.putWorkPackage(project, renamed))
    },
    [enqueue, projectId],
  )

  const deleteWorkPackage = useCallback(
    (id: string) => {
      if (!canEditRef.current || !workPackagesRef.current.has(id)) return
      // Queued edits that set this package must reach the server before the clean-up runs.
      flush()
      const next = new Map(workPackagesRef.current)
      next.delete(id)
      workPackagesRef.current = next
      setWorkPackages(next)
      clearLocally('wp', id)
      const project = projectId
      enqueue(() => store.deleteWorkPackage(project, id))
    },
    [clearLocally, enqueue, flush, projectId],
  )

  // ---- cost codes ----------------------------------------------------------------------------

  /** "USER-<n>", one above the highest such code: readable, and unlikely to collide. */
  const nextUserCode = useCallback((): string => {
    let max = 0
    for (const code of costCodesRef.current.values()) {
      const match = /^USER-(\d+)$/.exec(code.code)
      if (match) max = Math.max(max, Number(match[1]))
    }
    return `USER-${Math.max(max, costCodesRef.current.size) + 1}`
  }, [])

  const saveCode = useCallback(
    (code: CostCode) => {
      const next = new Map(costCodesRef.current).set(code.id, code)
      costCodesRef.current = next
      setCostCodes(next)
      const project = projectId
      enqueue(() => store.putCostCode(project, code))
    },
    [enqueue, projectId],
  )

  const upsertCode = useCallback(
    (input: Partial<CostCode>): string | null => {
      if (!canEditRef.current) return null
      const codes = costCodesRef.current
      const typed = input.code?.trim()
      const existing =
        (input.id ? codes.get(input.id) : undefined) ??
        (typed ? [...codes.values()].find((code) => code.code === typed) : undefined)
      // id and code text are settled above; the rest are plain field values.
      const { id: _id, code: _code, ...fields } = input
      const code: CostCode = existing
        ? { ...existing, ...fields, id: existing.id, code: typed || existing.code }
        : {
            name: '',
            descr: '',
            discipline: '',
            grp: '',
            unit: '',
            basis: 'count',
            price: 0,
            laborDays: 0,
            laborRate: 0,
            matAdd: 0,
            labAdd: 0,
            ...fields,
            id: input.id || newId('code'),
            code: typed || nextUserCode(),
          }
      saveCode(code)
      return code.id
    },
    [nextUserCode, saveCode],
  )

  const updateCode = useCallback(
    <K extends CostCodeField>(id: string, field: K, value: CostCode[K]) => {
      if (!canEditRef.current) return
      const code = costCodesRef.current.get(id)
      if (!code || code[field] === value) return
      saveCode({ ...code, [field]: value })
    },
    [saveCode],
  )

  const deleteCode = useCallback(
    (id: string) => {
      if (!canEditRef.current || !costCodesRef.current.has(id)) return
      flush()
      const next = new Map(costCodesRef.current)
      next.delete(id)
      costCodesRef.current = next
      setCostCodes(next)
      clearLocally('code', id)
      if (copiedRef.current === id) setCopiedCode(null)
      const project = projectId
      enqueue(() => store.deleteCostCode(project, id))
    },
    [clearLocally, enqueue, flush, projectId],
  )

  // ---- copy / paste cost code ----------------------------------------------------------------

  const copyCode = useCallback(
    (elements: readonly number[]): Feedback => {
      const t = tNow()
      if (elements.length !== 1) return { tone: 'warn', text: t('Select one element to copy its cost code.') }
      const fact = factsRef.current.get(elements[0])
      const id = fact ? assignmentsRef.current.get(fact.key)?.code : undefined
      const code = id ? costCodesRef.current.get(id) : undefined
      if (!code) return { tone: 'warn', text: t('This element has no cost code.') }
      copiedRef.current = code.id
      setCopiedCode(code.id)
      return { tone: 'good', text: t('Cost code {code} copied.', { code: code.code }) }
    },
    [tNow],
  )

  const pasteCode = useCallback(
    (elements: readonly number[]): Feedback => {
      const t = tNow()
      const code = copiedRef.current ? costCodesRef.current.get(copiedRef.current) : undefined
      if (!code) return { tone: 'warn', text: t('Copy a cost code first: select one element and press Ctrl+C.') }
      if (elements.length === 0) {
        return { tone: 'warn', text: t('Select elements in the 3D view or the Elements tab first.') }
      }
      if (!canEditRef.current) return { tone: 'warn', text: t('Read only: your project role is Viewer.') }
      assign(elements, { code: code.id })
      return {
        tone: 'good',
        text: t('Cost code {code} pasted on {n} elements.', {
          code: code.code,
          n: elements.length.toLocaleString(),
        }),
      }
    },
    [assign, tNow],
  )

  // ---- language ------------------------------------------------------------------------------

  const setLang = useCallback(
    (next: Lang) => {
      saveLang(next)
      langRef.current = next
      setLangState(next)
      // A virtual sheet was never edited (an edit stores it), so its name and markups are still
      // the defaults: show them in the new language, and store them that way on the first write.
      if (sheetsRef.current.some((entry) => entry.virtual)) {
        setSheetsNow(
          sheetsRef.current.map((entry) => {
            if (!entry.virtual) return entry
            const fresh = virtualSheet(makeT(next, entry.currency))
            return { ...fresh, id: entry.id, currency: entry.currency }
          }),
        )
      }
    },
    [setSheetsNow],
  )

  // ---- derived -------------------------------------------------------------------------------

  const sheet = useMemo(
    () => sheets.find((entry) => entry.id === activeId) ?? sheets[0],
    [activeId, sheets],
  )
  const t = useMemo(() => makeT(lang, sheet.currency), [lang, sheet.currency])
  const money = useCallback(
    (value: number | null | undefined) => formatMoney(value, sheet.currency),
    [sheet.currency],
  )
  const indexByKey = useMemo(() => {
    const out = new Map<string, number>()
    for (const fact of facts.values()) out.set(fact.key, fact.index)
    return out
  }, [facts])
  const priced = useMemo(
    () => priceRows(facts, assignments, costCodes, workPackages),
    [assignments, costCodes, facts, workPackages],
  )
  const totals = useMemo(() => computeTotals(priced, sheet.markups), [priced, sheet.markups])
  const usage = useMemo(() => codeUsage(priced), [priced])
  const hidden = useMemo(() => {
    const out = new Set<number>()
    for (const row of priced.values()) if (row.hidden) out.add(row.index)
    return out
  }, [priced])

  return useMemo(
    () => ({
      status,
      error,
      canEdit,
      retry,
      saving: savingCount > 0,
      failure,
      lang,
      setLang,
      t,
      money,
      sheets,
      sheet,
      sheetLoading,
      switchSheet,
      addSheet,
      renameSheet,
      deleteSheet,
      setCurrency,
      setMarkups,
      workPackages,
      addWorkPackage,
      renameWorkPackage,
      deleteWorkPackage,
      costCodes,
      upsertCode,
      updateCode,
      deleteCode,
      usage,
      facts,
      factsStatus,
      indexByKey,
      assignments,
      priced,
      totals,
      hidden,
      assign,
      setIncluded,
      toggleIncluded,
      copiedCode,
      copyCode,
      pasteCode,
    }),
    [
      addSheet,
      addWorkPackage,
      assign,
      assignments,
      canEdit,
      copiedCode,
      copyCode,
      costCodes,
      deleteCode,
      deleteSheet,
      deleteWorkPackage,
      error,
      facts,
      factsStatus,
      failure,
      hidden,
      indexByKey,
      lang,
      money,
      pasteCode,
      priced,
      renameSheet,
      renameWorkPackage,
      retry,
      savingCount,
      setCurrency,
      setIncluded,
      setLang,
      setMarkups,
      sheet,
      sheetLoading,
      sheets,
      status,
      switchSheet,
      t,
      toggleIncluded,
      totals,
      updateCode,
      upsertCode,
      usage,
      workPackages,
    ],
  )
}
