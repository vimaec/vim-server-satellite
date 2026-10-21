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

/** What can change on one markup. */
export type MarkupPatch = { name?: string; pct?: number }

/**
 * The project roles that may write the estimate (the store answers anything
 * else with 403). An allow-list, so a role this app does not know, or one not
 * known yet (''), reads only.
 */
export function canWriteRole(role: string): boolean {
  return role === 'Manager' || role === 'Admin'
}

export type Estimate = {
  /** The first read of the project's estimate data. */
  status: 'loading' | 'ready' | 'error'
  /** Why the first read failed (status 'error'). */
  error?: string
  /**
   * Whether the UI may offer writes right now: the data and a writing role
   * (see `canWriteRole`) are known, the active sheet's assignments are here,
   * and the model's facts are built. When false, every input is disabled and
   * the write actions refuse.
   */
  canEdit: boolean
  /** The project role ('' until known). */
  role: string
  /** The role is known and may not write: the panel says the estimate is read-only, and why. */
  readOnly: boolean
  /** Read again what failed: the active sheet's assignments (sheetStatus 'error'), else everything. */
  retry: () => void
  /**
   * The last write the server refused, already rolled back and followed by a
   * re-read. `seq` grows with each failure, so the UI can toast each one once.
   */
  failure: { seq: number; message: string } | null
  /** How many whole reads of the estimate were taken in (project open, Retry, the re-read after a failure). */
  loads: number

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
  /**
   * The active sheet's assignments: being read after a switch ('loading'), here
   * ('ready'), or the read failed ('error', see `sheetError` and `retry`).
   */
  sheetStatus: 'loading' | 'ready' | 'error'
  /** Why the active sheet's assignments could not be read (sheetStatus 'error'). */
  sheetError?: string
  /** Open another sheet (remembered per project in localStorage). */
  switchSheet: (id: string) => void
  /**
   * A new sheet, made active: empty, or (`fromId`) a copy of that sheet's
   * assignments, markups and currency. Returns its id, or null when refused.
   */
  addSheet: (name: string, fromId?: string) => string | null
  renameSheet: (id: string, name: string) => void
  /** False (and nothing happens) for the last sheet, which cannot be deleted, or when read-only. */
  deleteSheet: (id: string) => boolean
  /** The active sheet's currency (ISO code, see CURRENCIES). */
  setCurrency: (currency: string) => void
  /**
   * The active sheet's markups, one at a time and by id. Each is applied to
   * the stored list when it is written, so markups other people added,
   * changed or deleted meanwhile are kept.
   */
  addMarkup: (name: string, pct?: number) => void
  updateMarkup: (id: string, patch: MarkupPatch) => void
  deleteMarkup: (id: string) => void

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
  /**
   * The active sheet's assignments, by element key (may include elements not
   * in this model). Empty while sheetStatus is not 'ready'.
   */
  assignments: Map<string, Assignment>
  /** Per element index: the element priced in the active sheet. Every element in `facts` has one. */
  priced: Map<number, PricedRow>
  /** The active sheet's sums, markups and total. */
  totals: Totals
  /** Excluded element indices in the active sheet (hide them in 3D). */
  hidden: Set<number>

  /**
   * Set fields on elements in the active sheet; `null` clears a field. False
   * when refused (no elements, read-only, the sheet or the facts not here yet).
   */
  assign: (elements: readonly number[], patch: AssignmentPatch) => boolean
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

/**
 * The active sheet and its assignments, held as ONE value so the two cannot
 * drift apart.
 *
 * Invariant: `assignments` is the assignment map of sheet `id`, or null while
 * that map is not here (a switch is reading it, or the read failed). Every
 * change of sheet replaces the whole value, so a switch drops the previous
 * sheet's map in the same step that names the new sheet; and assignment
 * writes (assign, Duplicate) are only accepted while the map is not null. An
 * edit therefore always lands in the sheet its data was read from.
 */
type ActiveSheet = {
  id: string
  assignments: Map<string, Assignment> | null
  /** Why the read of the assignments failed (they are then null). */
  error?: string
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

/** How many times the re-read after a failure tries again when edits keep arriving while it reads. */
const RELOAD_ATTEMPTS = 5

const EMPTY_FACTS = new Map<number, ElementFacts>()
const EMPTY_ASSIGNMENTS = new Map<string, Assignment>()

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
  const [loads, setLoads] = useState(0)
  const [failure, setFailure] = useState<{ seq: number; message: string } | null>(null)
  const [lang, setLangState] = useState<Lang>(loadLang)
  const [sheets, setSheets] = useState<Sheet[]>(() => [virtualSheet(makeT(loadLang(), DEFAULT_CURRENCY))])
  const [active, setActiveState] = useState<ActiveSheet>(() => ({
    id: store.FIRST_SHEET_ID,
    assignments: new Map(),
  }))
  const [workPackages, setWorkPackages] = useState<Map<string, WorkPackage>>(() => new Map())
  const [costCodes, setCostCodes] = useState<Map<string, CostCode>>(() => new Map())
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
  const createdRef = useRef(new Map<string, Promise<boolean>>())
  const failureSeq = useRef(0)
  /**
   * Bumped whenever the active sheet is replaced (a switch, or a whole read
   * taken in). A sheet read that lands after a newer one started is dropped.
   */
  const switchSeq = useRef(0)
  /**
   * Bumped by every local edit that will be written (when it is made, before
   * its write goes out). A re-read that saw it move while it was out is older
   * than the screen and must not replace it.
   */
  const writeGenRef = useRef(0)
  /** Per sheet id: how many edits of its document were made, so only the newest adopts the server's copy. */
  const sheetEditsRef = useRef(new Map<string, number>())
  /** The latest `flush`, for the project-change cleanup (declared before `flush` exists). */
  const flushRef = useRef<() => void>(() => undefined)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  // Actions read the latest state through refs: two actions in one event must
  // see each other's changes, and stable callbacks keep a 20k-row tree from
  // re-rendering on every keystroke. `activeRef` is only ever set together
  // with the state (setActive), never from a render.
  const activeRef = useRef(active)
  const sheetsRef = useRef(sheets)
  const workPackagesRef = useRef(workPackages)
  const costCodesRef = useRef(costCodes)
  const factsRef = useRef(facts)
  const langRef = useRef(lang)
  const copiedRef = useRef(copiedCode)
  const statusRef = useRef(status)
  sheetsRef.current = sheets
  workPackagesRef.current = workPackages
  costCodesRef.current = costCodes
  factsRef.current = facts
  langRef.current = lang
  copiedRef.current = copiedCode
  statusRef.current = status

  const roleCanWrite = canWriteRole(role)
  const readOnly = role !== '' && !roleCanWrite
  /** The data is read and the role may write: what the sheet, code and package actions need. */
  const mayWrite = status === 'ready' && roleCanWrite
  const canEdit = mayWrite && active.assignments !== null && facts.size > 0
  const mayWriteRef = useRef(mayWrite)
  mayWriteRef.current = mayWrite
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const roleRef = useRef(role)
  roleRef.current = role
  const byRef = useRef(by)
  byRef.current = by

  const setActive = useCallback((next: ActiveSheet) => {
    activeRef.current = next
    setActiveState(next)
  }, [])

  const setSheetsNow = useCallback((next: Sheet[]) => {
    sheetsRef.current = next
    setSheets(next)
  }, [])

  const tNow = useCallback((): Translator => {
    const sheet = sheetsRef.current.find((entry) => entry.id === activeRef.current.id)
    return makeT(langRef.current, sheet?.currency ?? DEFAULT_CURRENCY)
  }, [])

  /** Take the shared lists of a fresh read: sheets, work packages, cost codes. */
  const adoptLists = useCallback(
    (load: store.EstimateLoad) => {
      setSheetsNow(load.sheets.length ? load.sheets : [virtualSheet(tNow())])
      workPackagesRef.current = load.workPackages
      setWorkPackages(load.workPackages)
      costCodesRef.current = load.costCodes
      setCostCodes(load.costCodes)
      setLoads((count) => count + 1)
    },
    [setSheetsNow, tNow],
  )

  /** Take everything from a fresh read, the active sheet included; a sheet read still out is dropped. */
  const adopt = useCallback(
    (load: store.EstimateLoad) => {
      adoptLists(load)
      switchSeq.current++
      setActive({ id: load.sheetId, assignments: load.assignments })
    },
    [adoptLists, setActive],
  )

  // ---- load on project open ------------------------------------------------------------------

  useEffect(() => {
    const epoch = ++epochRef.current
    setStatus('loading')
    setError(undefined)
    setFailure(null)
    setCopiedCode(null)

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

  /**
   * Re-reads everything once the queue is idle, keeping the active sheet. The
   * read is only taken in when no edit was made while it was out: such an edit
   * is on screen and its write lands after the read, so the read would take it
   * off the screen, and the next edit of that element would be built from the
   * stale entry and write it back whole. The read then runs again, after that
   * write.
   */
  const reloadQuietly = useCallback(() => {
    const epoch = epochRef.current
    void (async () => {
      for (let attempt = 0; attempt < RELOAD_ATTEMPTS; attempt++) {
        flushRef.current()
        await chainRef.current.catch(() => undefined)
        if (epoch !== epochRef.current) return
        const writes = writeGenRef.current
        const switches = switchSeq.current
        let load: store.EstimateLoad
        try {
          load = await store.loadEstimate(projectId, activeRef.current.id)
        } catch {
          // The failure is already on screen; the next action or Retry tries again.
          return
        }
        if (epoch !== epochRef.current) return
        if (writes !== writeGenRef.current) continue
        // The user opened another sheet meanwhile: its own read fills it.
        if (switches !== switchSeq.current) adoptLists(load)
        else adopt(load)
        return
      }
    })()
  }, [adopt, adoptLists, projectId])

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
      writeGenRef.current++
      chainRef.current = chainRef.current.then(task).catch((cause: unknown) => {
        if (epoch !== epochRef.current) return
        onError?.()
        fail(cause)
      })
    },
    [fail],
  )

  /**
   * Makes sure a sheet exists on the server before anything is written to or
   * about it. A virtual sheet is created (create-only) the first time; the
   * promise is shared so concurrent writers create it once. True when THIS
   * call created it, with the content it was given.
   */
  const ensureStored = useCallback(async (project: string, sheet: Sheet): Promise<boolean> => {
    if (!sheet.virtual) return false
    const id = `${project}/${sheet.id}`
    let created = createdRef.current.get(id)
    const mine = !created
    if (!created) {
      created = store.createSheet(project, { ...sheet, virtual: undefined })
      createdRef.current.set(id, created)
      created.catch(() => createdRef.current.delete(id))
    }
    const stored = await created
    if (project === projectIdRef.current) {
      const current = sheetsRef.current
      if (current.some((entry) => entry.id === sheet.id && entry.virtual)) {
        setSheetsNow(current.map((entry) => (entry.id === sheet.id ? { ...entry, virtual: undefined } : entry)))
      }
    }
    return mine && stored
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
        const current = activeRef.current
        if (current.id !== batch.sheet.id || !current.assignments) return
        const map = current.assignments
        const next = new Map(map)
        let changed = false
        for (const [key, value] of batch.next) {
          if ((map.get(key) ?? null) !== value) continue
          const before = batch.before.get(key)
          if (before) next.set(key, before)
          else next.delete(key)
          changed = true
        }
        if (changed) setActive({ id: current.id, assignments: next })
      },
    )
  }, [enqueue, ensureStored, setActive])

  flushRef.current = flush

  /** Whether the active sheet takes assignment writes right now (see ActiveSheet). */
  const writable = useCallback(
    () => mayWriteRef.current && activeRef.current.assignments !== null && factsRef.current.size > 0,
    [],
  )

  // ---- assignments ---------------------------------------------------------------------------

  const assign = useCallback(
    (elements: readonly number[], patch: AssignmentPatch): boolean => {
      if (!writable() || elements.length === 0) return false
      const current = activeRef.current
      const map = current.assignments
      const sheet = sheetsRef.current.find((entry) => entry.id === current.id)
      if (!map || !sheet) return false
      const at = new Date().toISOString()
      let next: Map<string, Assignment> | null = null
      const changes: [string, Assignment | null, Assignment | undefined][] = []
      for (const index of new Set(elements)) {
        const fact = factsRef.current.get(index)
        if (!fact) continue
        const before = map.get(fact.key)
        const after = applyPatch(before, patch, { elementId: fact.elementId, by: byRef.current, at })
        if (after === undefined) continue
        next ??= new Map(map)
        if (after) next.set(fact.key, after)
        else next.delete(fact.key)
        changes.push([fact.key, after, before])
      }
      // Nothing to change: the elements already say so.
      if (!next) return true
      writeGenRef.current++
      setActive({ id: current.id, assignments: next })

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
      return true
    },
    [flush, projectId, setActive, writable],
  )

  const setIncluded = useCallback(
    (elements: readonly number[], included: boolean) => {
      assign(elements, { hidden: !included })
    },
    [assign],
  )

  const toggleIncluded = useCallback(
    (elements: readonly number[]) => {
      const map = activeRef.current.assignments
      if (elements.length === 0 || !map) return
      const allExcluded = elements.every((index) => {
        const fact = factsRef.current.get(index)
        return fact ? map.get(fact.key)?.hidden === true : true
      })
      assign(elements, { hidden: !allExcluded })
    },
    [assign],
  )

  // ---- sheets --------------------------------------------------------------------------------

  /**
   * Makes a sheet the active one. `known` is its assignments when the caller
   * has them (a new or duplicated sheet); else they are read, and until they
   * land the active sheet has no map, so nothing can be written to it.
   */
  const openSheet = useCallback(
    (id: string, known?: Map<string, Assignment>) => {
      flush()
      const seq = ++switchSeq.current
      saveActiveSheet(projectId, id)
      const sheet = sheetsRef.current.find((entry) => entry.id === id)
      if (known || sheet?.virtual) {
        setActive({ id, assignments: known ?? new Map() })
        return
      }
      setActive({ id, assignments: null })
      const epoch = epochRef.current
      void (async () => {
        try {
          // After the queue: the sheet may have writes (or its creation) in flight.
          await chainRef.current.catch(() => undefined)
          const loaded = await store.loadAssignments(projectId, id)
          if (epoch !== epochRef.current || seq !== switchSeq.current) return
          setActive({ id, assignments: loaded })
        } catch (cause: unknown) {
          if (epoch !== epochRef.current || seq !== switchSeq.current) return
          setActive({ id, assignments: null, error: messageOf(cause) })
        }
      })()
    },
    [flush, projectId, setActive],
  )

  const switchSheet = useCallback(
    (id: string) => {
      if (id === activeRef.current.id) return
      if (!sheetsRef.current.some((entry) => entry.id === id)) return
      openSheet(id)
    },
    [openSheet],
  )

  const retry = useCallback(() => {
    const current = activeRef.current
    if (statusRef.current === 'ready' && current.error !== undefined) openSheet(current.id)
    else setReload((count) => count + 1)
  }, [openSheet])

  /** Applies a change to one sheet document, locally now and on the server (read-modify-write). */
  const changeSheet = useCallback(
    (id: string, mutate: (sheet: Sheet) => Sheet) => {
      if (!mayWriteRef.current) return
      const before = sheetsRef.current.find((entry) => entry.id === id)
      if (!before) return
      setSheetsNow(sheetsRef.current.map((entry) => (entry.id === id ? mutate(entry) : entry)))
      const seq = (sheetEditsRef.current.get(id) ?? 0) + 1
      sheetEditsRef.current.set(id, seq)
      const project = projectId
      enqueue(async () => {
        const local = sheetsRef.current.find((entry) => entry.id === id)
        // A virtual sheet created here is stored with this change already in it: nothing more to write.
        if (await ensureStored(project, local ?? mutate(before))) return
        const stored = await store.updateSheet(project, id, mutate)
        // After a 412 the stored sheet also holds someone else's change: show it. Not when a
        // newer edit of this sheet is queued, which would flash back; that one adopts its own.
        if (project !== projectIdRef.current || sheetEditsRef.current.get(id) !== seq) return
        setSheetsNow(sheetsRef.current.map((entry) => (entry.id === id ? stored : entry)))
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
    (currency: string) => changeSheet(activeRef.current.id, (sheet) => ({ ...sheet, currency })),
    [changeSheet],
  )

  /** A change of the active sheet's markup list, applied to whatever list it meets (local, then stored). */
  const changeMarkups = useCallback(
    (change: (markups: Markup[]) => Markup[]) =>
      changeSheet(activeRef.current.id, (sheet) => ({ ...sheet, markups: change(sheet.markups) })),
    [changeSheet],
  )

  const addMarkup = useCallback(
    (name: string, pct = 0) => {
      const markup: Markup = { id: newId('markup'), name: name.trim(), pct: Number(pct) || 0 }
      // A retry after a 412 applies this again: the id keeps it from being added twice.
      changeMarkups((markups) => (markups.some((entry) => entry.id === markup.id) ? markups : [...markups, markup]))
    },
    [changeMarkups],
  )

  const updateMarkup = useCallback(
    (id: string, patch: MarkupPatch) => {
      const name = patch.name?.trim()
      const pct = patch.pct === undefined ? undefined : Number(patch.pct) || 0
      changeMarkups((markups) =>
        markups.map((entry) =>
          entry.id === id ? { ...entry, ...(name ? { name } : {}), ...(pct === undefined ? {} : { pct }) } : entry,
        ),
      )
    },
    [changeMarkups],
  )

  const deleteMarkup = useCallback(
    (id: string) => changeMarkups((markups) => markups.filter((entry) => entry.id !== id)),
    [changeMarkups],
  )

  const addSheet = useCallback(
    (name: string, fromId?: string): string | null => {
      // A copy of the active sheet copies the map on screen, which must be that sheet's.
      if (!writable()) return null
      const trimmed = name.trim()
      if (!trimmed) return null
      flush()
      const list = sheetsRef.current
      const current = activeRef.current
      const map = current.assignments
      if (!map) return null
      const active = list.find((entry) => entry.id === current.id) ?? list[0]
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
      const copied = from && from.id === current.id ? new Map(map) : undefined
      setSheetsNow([...list, sheet])
      const project = projectId
      enqueue(
        async () => {
          for (const entry of virtuals) await ensureStored(project, entry)
          await store.createSheet(project, sheet)
          if (!from) return
          const source = copied ?? (await store.loadAssignments(project, from.id))
          await store.copyAssignments(project, sheet.id, source)
        },
        () => {
          const rest = sheetsRef.current.filter((entry) => entry.id !== sheet.id)
          setSheetsNow(rest)
          // The page must not stay on a sheet that was never made: its edits would go nowhere.
          if (activeRef.current.id === sheet.id && rest.length) openSheet(rest[0].id)
        },
      )
      // A copy of another sheet is read back once the queue has made it.
      if (from && !copied) openSheet(sheet.id)
      else openSheet(sheet.id, copied ?? new Map())
      return sheet.id
    },
    [enqueue, ensureStored, flush, openSheet, projectId, setSheetsNow, tNow, writable],
  )

  const deleteSheet = useCallback(
    (id: string): boolean => {
      if (!mayWriteRef.current) return false
      const list = sheetsRef.current
      const sheet = list.find((entry) => entry.id === id)
      if (!sheet || list.length < 2) return false
      flush()
      const rest = list.filter((entry) => entry.id !== id)
      setSheetsNow(rest)
      if (activeRef.current.id === id) openSheet(rest[0].id)
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
      const current = activeRef.current
      const map = current.assignments
      if (!map) return
      let next: Map<string, Assignment> | null = null
      for (const [key, assignment] of map) {
        if (assignment[field] !== id) continue
        next ??= new Map(map)
        const changed = { ...assignment }
        delete changed[field]
        if (changed.wp || changed.code || changed.extra !== undefined || changed.note || changed.hidden) {
          next.set(key, changed)
        } else next.delete(key)
      }
      if (next) setActive({ id: current.id, assignments: next })
    },
    [setActive],
  )

  const addWorkPackage = useCallback(
    (name: string): string | null => {
      if (!mayWriteRef.current) return null
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
      if (!mayWriteRef.current) return
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
      if (!mayWriteRef.current || !workPackagesRef.current.has(id)) return
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
      if (!mayWriteRef.current) return null
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
      if (!mayWriteRef.current) return
      const code = costCodesRef.current.get(id)
      if (!code || code[field] === value) return
      saveCode({ ...code, [field]: value })
    },
    [saveCode],
  )

  const deleteCode = useCallback(
    (id: string) => {
      if (!mayWriteRef.current || !costCodesRef.current.has(id)) return
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
      const id = fact ? activeRef.current.assignments?.get(fact.key)?.code : undefined
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
      if (!assign(elements, { code: code.id })) {
        const text = readOnlyRef.current
          ? t('Read only: your project role is {role}.', { role: roleRef.current })
          : t('The sheet is not ready yet. Try again in a moment.')
        return { tone: 'warn', text }
      }
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

  const assignments = active.assignments ?? EMPTY_ASSIGNMENTS
  const sheetStatus: Estimate['sheetStatus'] = active.assignments
    ? 'ready'
    : active.error !== undefined
      ? 'error'
      : 'loading'
  const sheetError = active.error
  const sheet = useMemo(
    () => sheets.find((entry) => entry.id === active.id) ?? sheets[0],
    [active.id, sheets],
  )
  const t = useMemo(() => makeT(lang, sheet.currency), [lang, sheet.currency])
  const money = useCallback(
    (value: number | null | undefined) => formatMoney(value, sheet.currency),
    [sheet.currency],
  )
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
      role,
      readOnly,
      retry,
      failure,
      loads,
      lang,
      setLang,
      t,
      money,
      sheets,
      sheet,
      sheetStatus,
      sheetError,
      switchSheet,
      addSheet,
      renameSheet,
      deleteSheet,
      setCurrency,
      addMarkup,
      updateMarkup,
      deleteMarkup,
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
      addMarkup,
      addSheet,
      addWorkPackage,
      assign,
      assignments,
      canEdit,
      copiedCode,
      copyCode,
      costCodes,
      deleteCode,
      deleteMarkup,
      deleteSheet,
      deleteWorkPackage,
      error,
      facts,
      factsStatus,
      failure,
      hidden,
      lang,
      loads,
      money,
      pasteCode,
      priced,
      readOnly,
      renameSheet,
      renameWorkPackage,
      retry,
      role,
      setCurrency,
      setIncluded,
      setLang,
      sheet,
      sheetError,
      sheetStatus,
      sheets,
      status,
      switchSheet,
      t,
      toggleIncluded,
      totals,
      updateCode,
      updateMarkup,
      upsertCode,
      usage,
      workPackages,
    ],
  )
}
