# vim-server-satellite

A sample **"satellite" app** for [VIM Server](https://vimaec.com): a single-page app that signs the
user in with the VIM Server Microsoft Entra ID app registration, lists the projects they can reach,
loads a project's latest VIM snapshot in the [vim-web](https://www.npmjs.com/package/vim-web)
viewer, and keeps a cost **estimate** of the model's elements: cost codes, work packages,
estimation sheets and markups, attached to the elements of the loaded VIM and stored back on the
project — in the project's own custom data store, so the app needs no database and no server code
of its own. The estimate is a lean port of the VIM Flex "Estimate" workflow, styled with a copy of
the vim-html-ds design system. The sample exists to be copied: plain React 18 + TypeScript + Vite and
plain CSS, no router, no state library and no UI library dependency, so each piece lifts out on its
own.

Live build: <https://vimaec.github.io/vim-server-satellite/>

## What it demonstrates

| Feature | Where to read it |
|---|---|
| Entra ID authorization code + PKCE, written out with `fetch` (no MSAL, no CDN) | `src/auth/pkce.ts`, `src/auth/entra.ts` |
| Session storage, silent refresh, and a clean drop back to sign-in on a 401 | `src/auth/AuthProvider.tsx`, `src/api/http.ts` |
| Asking the server which Entra app registration to trust (`GET /api/v1/config`) | `src/config.ts` |
| Bearer header, `ProblemDetails` to `ApiError`, one allow-listed status (404) | `src/api/http.ts` |
| Typed wrappers for the REST endpoints, and the custom data store as app storage | `src/api/vimServer.ts`, `src/api/projectData.ts`, `src/api/types.ts` |
| Listing every reachable project (there is no "all projects" endpoint) | `src/pages/ProjectPickerPage.tsx` |
| Resolving a snapshot to a time-limited blob URL and loading it in the viewer | `src/pages/ProjectPage.tsx`, `src/viewer/` |
| Per-element quantities read in bulk from the VIM's own BIM tables | `src/estimate/quantities.ts` |
| Estimate data in the project data store: one namespace per kind, ETag read–modify–write for shared documents, batched last-write-wins for elements | `src/estimate/store.ts`, `src/estimate/useEstimate.ts` |
| Optimistic writes through one serial queue, rolled back and re-read when the server refuses; a reload that waits for them and keeps edits made while it reads | `src/estimate/useEstimate.ts` |
| Pricing, totals, the cost colour ramp and the palette by grouping level, as pure functions | `src/estimate/pricing.ts` |
| A virtualized, grouped element tree that drives and follows the 3D selection | `src/estimate/grouping.ts`, `src/estimate/ui/ElementTree.tsx`, `src/estimate/ui/VirtualTree.tsx` |
| Excluded elements hidden in 3D, data colours applied per element, a right-click menu over the viewer | `src/viewer/ViewerPane.tsx`, `src/estimate/ui/menus.ts` |
| Read-only mode for every project role but `Manager` and `Admin` | `src/estimate/useEstimate.ts`, `src/estimate/ui/` |
| The vim-html-ds design system as plain CSS plus React twins of its components | `src/ds/` |
| End-to-end tests against a full in-browser mock of VIM Server, then a Pages deploy | `tests/support/mockVimServer.ts`, `.github/workflows/pages.yml` |

## How it works

### Authentication

VIM Server accepts Microsoft Entra ID access tokens as `Authorization: Bearer <access_token>`. This
app runs the OAuth 2.0 **authorization code flow with PKCE** against the same Entra app registration
VIM Server itself uses. The flow is written by hand because it is about 60 lines of `fetch` calls,
and a sample that shows the actual HTTP exchange ports to another stack more easily than one hiding
it behind a library.

The values in play — all of them public identifiers, not secrets:

| Value | Setting |
|---|---|
| Tenant | `4e856586-7c87-4498-956e-ab21660251e1` |
| Client id | `f518716e-50bb-4c82-bbee-3c85da317f82` |
| Authority | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0` |
| API scope | `api://f518716e-50bb-4c82-bbee-3c85da317f82/Sync.ReadWrite` |
| Scopes requested | `openid profile offline_access api://<client>/Sync.ReadWrite` |
| Redirect URI | `location.origin` + the app base path + `signin-oidc` |

`offline_access` is what makes Entra issue a refresh token. The redirect URI is derived from where
the app is served, so one build works from the dev server and from GitHub Pages:
`http://localhost:5173/signin-oidc` and `https://vimaec.github.io/vim-server-satellite/signin-oidc`.
Both are registered (see [Prerequisites](#prerequisites)).

The tenant and client id are not hard-wired at build time. On startup the app calls the anonymous
route `GET {server}/api/v1/config` and uses the ids the server itself signs in with; the
`VITE_ENTRA_*` values are only the offline fallback. A satellite app then follows the server it is
pointed at, instead of needing a rebuild when the server changes tenant.

**Sign in.** `beginSignIn()` generates a 32-byte PKCE verifier and a 16-byte `state`, stores both in
`sessionStorage`, and redirects to `{authority}/authorize` with `response_mode=fragment`,
`code_challenge_method=S256` and, if a previous sign-in left one, a `login_hint`.

**Come back.** Entra returns to the redirect URI with `#code=...&state=...`, or with
`#error=...&error_description=...`. On GitHub Pages the extensionless path `/signin-oidc` is served
by `public/signin-oidc.html`, whose whole job is one line, `location.replace("./" + location.hash)`,
because the PKCE verifier lives in the app's own tab-scoped storage and not on the redirect page.
The Vite dev server does **not** serve files from `public/` for an extensionless path; its SPA
fallback answers `/signin-oidc` with `index.html`. So the app also finishes a sign-in that arrives
on that path: `completeSignInFromHash()` looks for the fragment on *any* path, then calls
`history.replaceState()` back to the app root so a reload cannot replay the reply.

**Exchange and store.** The code, the verifier and the redirect URI are posted to
`{authority}/token` as `application/x-www-form-urlencoded`, and the `state` must match what this tab
stored or the reply is refused. The session then goes into `localStorage` under `vimSatellite.auth`
as `{ access, refresh, exp, name, upn }`. `name` and `upn` are read out of the `id_token`
claims for display only — the app never verifies that signature, the server does.
`vimSatellite.hint` keeps the last `upn` for `login_hint`. The PKCE pair lives in `sessionStorage`
under `vimSatellite.pkce`, so only the tab that started a sign-in can complete it.

**Refresh.** Every API call goes through `getToken()`. With more than 60 s of life left, the current
access token is returned as is; otherwise a `grant_type=refresh_token` POST renews it, and parallel
calls share one in-flight promise so a page load does not start four refreshes at once. Refresh
tokens for single-page apps last 24 h. A refresh that Entra refuses drops the session and returns to
the sign-in page with a message; so does the first `401` from VIM Server.

**Sign out** removes the `localStorage` entry — there is no Entra end-session call, so the Microsoft
session in the browser survives and the next sign-in usually does not ask for a password.

### VIM Server API calls

Base URL `https://server-dev.vimaec.com`, everything under `/api/v1`. Every call carries
`Authorization: Bearer <token>` and `Accept: application/json`, and uses `mode: "cors"`. server-dev
allows any origin, allows the `Authorization`, `Content-Type` and `If-Match` request headers, and
exposes `ETag` and `X-Total-Count`. Requests are not credentialed — there are no cookies, so the
bearer token is always required.

| Method | Path | Purpose | Wrapper |
|---|---|---|---|
| GET | `/config` | Anonymous. `{ tenantId, clientId }`: the app registration the server trusts | `getConfig()` |
| GET | `/org` | Organisations the user belongs to, with their org role | `listOrgs()` |
| GET | `/org/{orgId}/project` | Projects in one org; each carries `latestVim` or `null` | `listProjects()` |
| GET | `/project/{id}` | Project detail: name, organisation, `latestVim` | `getProject()` |
| GET | `/project/{id}/role` | `Viewer`, `Manager` or `Admin` for this project | `getProjectRole()` |
| GET | `/project/{id}/vim` | `{ latest, history }`: the snapshot list | `getVimHistory()` |
| GET | `/project/{id}/vim/download?redirect=false` | `{ url, expiresAtUtc }`: a ~6 h Azure Blob SAS URL | `getVimDownloadUrl()` |
| GET | `/project/{id}/data/{ns}` | Every entry in a namespace | `listEntries()` |
| GET | `/project/{id}/data/{ns}/{key}` | One entry, plus the `ETag` response header; `404` when absent | `getEntry()` |
| PUT | `/project/{id}/data/{ns}/{key}` | Write one entry; optional `If-Match` or `If-None-Match: *`, either of which gives `412` when it does not hold | `putEntry()` |
| PUT | `/project/{id}/data/{ns}` | Batch upsert of `[{ key, value }]`, returns `{ created, updated }` | `putEntries()` |
| POST | `/project/{id}/data/{ns}/delete` | Batch delete of `["key", ...]`, returns `{ deleted }` | `deleteEntries()` |
| DELETE | `/project/{id}/data/{ns}` | Delete a whole namespace; the app treats `404` as done | `deleteNamespace()` |

Things worth knowing before you write your own client:

- There is no "all my projects" endpoint. `listAccessibleProjects()` reads `/org` and then fans out
  over `/org/{id}/project` in parallel; an org whose project list fails is shown empty rather than
  failing the whole page.
- A project you cannot see answers `404`, never `403`. A `403` is either the licence gate — whose
  body is `{ error, message }` rather than RFC 7807 `ProblemDetails`, and `http.ts` handles both
  shapes — or a write attempted with only the `Viewer` role, such as an estimate write to the data
  store.
- Data store reads need the `Viewer` project role and writes need `Manager`. Keys may not contain a
  slash.

### Loading the VIM

A VIM snapshot is a blob in Azure Storage, not a byte stream the API proxies. Loading it is two
steps:

```ts
const download = await getVimDownloadUrl(projectId)   // GET .../vim/download?redirect=false
viewer.load({ url: download.url }, { prewarmBim: true })
```

`redirect=false` asks for the SAS URL as JSON instead of a `302`. The default (`redirect=true`)
suits a consumer that can just follow a redirect, but the viewer needs the URL itself: it issues up
to ten concurrent HTTP **Range** GETs through `XMLHttpRequest`, so it has to own the request.

**No `Authorization` header must reach the SAS URL.** The signature is already in the query string;
blob storage would reject the extra header, and sending a VIM Server token to a storage endpoint
puts it outside its audience. That is why the app never fetches the .vim itself and hands the plain
URL to `viewer.load()`. Blob storage allows any origin and supports range GETs, which is what makes
streaming a large model into the browser possible. The URL expires after about six hours, so it is
resolved when the project page opens rather than cached. Omit `blobId` for the latest snapshot, or
pass one from `getVimHistory().history` to open an older one. A project whose `latestVim` is `null`
has no snapshot; the picker disables it and says so.

The 3D view's background is VIM navy, `#12293b` (`VIEWER_BACKGROUND` in
`src/viewer/ViewerPane.tsx`). It goes to vim-web as the core setting `background.color`, the third
argument of `React.Webgl.createViewer()`, and the pane under the canvas is painted with it too, so
the colour is there before the viewer exists and before a model loads. vim-web writes that colour
to the screen without a linear-to-sRGB step, so the `THREE.Color` is built with the hex values as
they are (`LinearSRGBColorSpace`); `new THREE.Color('#12293b')` would be drawn almost black. Nothing
in vim-web sets the background again, and the viewer is created with `canReadLocalStorage: false`,
so no setting saved by its settings panel applies either.

### Element identity

Three different ids show up around one element, and choosing the wrong one silently breaks
persistence:

| In the viewer | In the VIM | Stable across snapshots? | Used here for |
|---|---|---|---|
| `element` (`number`) | `Vim.Element._key` | **No** — it is a row index | selection, colour overrides, hiding, tree rows: all in memory |
| `elementUniqueId` (`string`) | Revit `Element.UniqueId` | **Yes** | the assignment key stored on the server |
| `elementId` (`bigint`) | Revit `ElementId` | per document (`-1` means none) | shown in the tree and in Cost Details, and stored in each assignment for a person who reads the store |

An element index is only meaningful for the model instance currently loaded — re-export the project
and the indices move. So assignments are keyed by **UniqueId** (`src/estimate/keys.ts`):

```ts
elementKey(e) = e.uniqueId || (e.elementId !== '-1' ? `id-${e.elementId}` : `index-${e.index}`)
```

`||`, not `??`: vim-web reports a missing UniqueId as an empty string. The `id-` fallback covers
source formats that have no UniqueId, and reads as the weaker thing it is. ElementId `-1` means "no
Revit id at all", so it cannot key anything — every such element would share one key, `id--1` — and
those fall back to the row index, which is **snapshot-local**: an assignment keyed that way does not
survive a re-export. On load the app reads the active sheet's assignments and maps each key back to
the element index of the loaded model.

### The estimate

What a user does in the panel left of the viewer (`src/estimate/ui/`):

- **Elements tab.** The model's elements in a tree grouped by work package › cost code › category ›
  family and type. The grouping is configurable (work package, cost code, category, family, type,
  family and type, level, system, BIM document). Each row shows count, amount and quantity, and
  takes a work package, a cost code, an extra amount and a note; on a group row the choice applies
  to every member. The include box excludes an element from the sheet and hides it in 3D. A search
  (on Enter), a Show filter (All, Included, Excluded), and Display: no colours, colours by cost with
  a legend, or colours by one grouping level with a shuffle.
- **Cost Codes tab.** The cost codes grouped by discipline and group, with basis, unit, unit price,
  labor and adders edited in place, an Edit… dialog and Delete. A click on a code selects its
  elements in 3D.
- **Sheets.** New, Duplicate, Rename and Delete in the sheet select; a currency and a list of markups
  per sheet. The footer shows the markups, the TOTAL, the direct cost, how many elements have a cost
  code, and how many have a code but no quantity for it.
- **Selection.** A row click selects in 3D (Ctrl / Cmd toggles, Shift selects a range); a pick in 3D
  marks the rows. The right-click menu on a row or in the 3D view has Set Cost Code…, Copy / Paste
  Cost Code, Set Work Package…, Include, Exclude and Clear. Outside text fields, Ctrl+C copies the
  cost code of the one selected element, Ctrl+V pastes it on the selection, and Ctrl+X switches the
  selection between included and excluded.
- **Cost Details.** A pane right of the viewer: a summary of the selection, and a navigator that
  steps through the selected elements one at a time without changing the selection. The camera can
  follow the element shown.
- **EN / 日本語.** The language switch in the panel head. It also translates the project page's top
  bar and the viewer's status line; the sign-in and project picker pages stay in English.
- **Reload.** The button next to the Estimate title (`estimate-refresh`) reads the work packages,
  cost codes, sheets (names, currency, markups) and the active sheet's assignments again from VIM
  Server, to show what other people changed. Viewers can use it too: it only reads. While it runs
  the button is disabled and the head says "Reloading…"; a read that fails shows a toast and leaves
  the screen as it was. See **Concurrency** below for how it treats edits that are not stored yet.

Per-user view settings stay in this browser's `localStorage`, under `vimSatellite.estimate.*`: the
language, the active sheet per project, the grouping, the Display mode and its shuffle seed, and the
Show filter (`src/estimate/prefs.ts`). They are one person's way of looking at the estimate, so they
never go to the shared store.

### Estimate data in the store

Four kinds of namespace in the project's custom data store (`src/estimate/store.ts`). Nothing is
stored anywhere else. Ids are short random strings that the client makes, with a type prefix
(`code-1a2b3c4d`), never "max + 1": several people may add a cost code at the same moment.

| Namespace | Key | Value |
|---|---|---|
| `estimate.workPackages` | work package id | `{ en, ja, sort }` |
| `estimate.costCodes` | cost code id | `{ code, name, descr, discipline, grp, unit, basis, price, laborDays, laborRate, matAdd, labAdd }` |
| `estimate.sheets` | sheet id | `{ name, sort, currency, markups: [{ id, name, pct }] }` |
| `estimate.sheet.<sheetId>` | element key: UniqueId, else `id-<elementId>`, else `index-<row>` | `{ wp?, code?, extra?, note?, hidden?, elementId, by?, at }` |

`basis` is `count`, `length`, `area`, `volume` or `lump`. `matAdd` and `labAdd` are fractions
(`0.1` is 10 %); the UI shows them as percent. A markup `pct` is a percent. `currency` is an ISO code
and only sets the symbol shown with amounts: nothing is converted. Work packages and cost codes are
shared by every sheet. An assignment refers to them by id, so a renamed code or a new unit price
applies to every element that carries it. `by` and `at` record who wrote an assignment, and when.

An assignment that says nothing — no work package, cost code, extra or note, and not excluded — is
**deleted**, not stored, so "no entry" means exactly "nothing". To include an element again
therefore deletes its entry, unless the entry holds something else.

**Browsing never writes.** A project with no stored sheet shows a virtual sheet "Estimate 1" (USD,
three markups at 0 %) with the fixed id `sheet-1`. The first write that needs it creates it with
`If-None-Match: *` (create-only). The id is fixed, not random, so that two people who start to
estimate an empty project at the same time create the same sheet: the second create gets `412`, and
the app takes that as "it exists" and writes into it.

**Concurrency.**

- A **sheet document** is shared and edited as a whole (its markup list), so every change to it is a
  read–modify–write (`updateSheet()`): read the entry with its `ETag` — a quoted integer
  write-version, for example `"3"` — apply the change to what is *stored*, and write it back with
  `If-Match`. A `412` means somebody else wrote first: the cycle runs again over their version, up
  to three times, and the app then shows the sheet as stored, other people's changes included.
  The change itself is one operation, never "this page's copy of the list": rename, set the
  currency, add a markup, change one markup (by id), delete one markup (by id). So one user who
  changes Risk while another adds an Insurance markup or renames the sheet undoes neither.
- **Cost codes, work packages and assignments** are one entry per thing and last-write-wins: one user
  who prices a wall does not conflict with another who prices a door. Assignment changes made within
  40 ms of each other go out as one batch (`PUT /data/{ns}` for upserts, `POST /data/{ns}/delete`
  for deletes, at most 1,000 keys per request), so an action on 5,000 elements is a handful of
  requests.
- All writes go through **one serial queue**, in the order the user made them: a new cost code
  reaches the server before the assignments that use it, a new sheet before its assignments.
- Writes are **optimistic**: the screen changes first. When the server refuses a write, the change is
  taken back, a toast says why, and the whole estimate is read again from the server. That read is
  only taken in when no edit was made while it was out; otherwise it runs again after that edit's
  write, so an older read never takes a newer edit off the screen (the next edit of that element
  would then write the stale entry back). There is no polling: the data is read when the project
  opens, after a failed write, on Retry, and on **Reload** (`reload()` in the hook).
- **Reload** sends the assignment batch that is waiting, waits until the write queue is empty, and
  only then reads, so the read sees this page's own edits. It is the same re-read as after a
  failure: an edit made while the read is out makes the read run again after that edit's write,
  never take it off the screen. It keeps the active sheet; when that sheet was deleted elsewhere,
  it opens the first sheet, and the active sheet and its assignments change in one step, as for a
  switch.
- **Switching sheets.** The hook holds the active sheet's id and its assignments as one value, and
  takes assignment writes only while that value has the assignments of that sheet. A switch drops
  the previous sheet's assignments at once and reads the new sheet's: until they arrive the tree
  says the sheet is loading and every input is disabled, and if the read fails the panel says so
  with a Retry (the sheet select still works, to go back). An edit can never land in a sheet other
  than the one it was made on.

**Delete order.** A sheet: its `estimate.sheet.<id>` namespace first (`DELETE /data/{ns}`), then
its entry in `estimate.sheets`, so a sheet never points at data that is gone. The last sheet cannot
be deleted. A cost code or a work package: the app first clears it from the assignments of **every**
sheet — it reads the sheet list again, so a sheet that someone else added is cleaned too — and only
then deletes its entry. Duplicate creates the new sheet entry (create-only) with the source's
markups and currency, then copies the assignments with a batch upsert.

**Roles.** Writes need `Manager` or `Admin` on the project (`canWriteRole()`, an allow-list: a role
the app does not know reads only). With any other role the panel says it is read-only and names
the role, every input is disabled, and the menus show the write verbs disabled, because a write
would come back `403`. The role comes from `GET /project/{id}/role`, and if that call fails the app
assumes the lowest privilege rather than failing the page. Until the estimate and the role are both
known, nothing is written. The project page is keyed by the project id, so a role never carries
over from one project to the next.

### Quantities from the BIM tables

The estimate covers the elements that have geometry (`hasGeometry` in vim-web), less the saved 3D
views (category `Cameras`). Their facts come from the VIM's BIM tables (`vim.bim`) through the column
getters (`getAll…`): one call per column for the whole model, never one request per element
(`src/estimate/quantities.ts`). The viewer loads the snapshot with `prewarmBim: true`, which caches
those columns in the background.

- **Length, Area, Volume** are the Revit parameters `Length` / `長さ`, `Area` / `面積` and `Volume` /
  `体積`, from the `parameter` and `parameterDescriptor` tables. A stored value is
  `<raw>|<display>`; the raw part is in ft, ft² or ft³ and is converted to m, m², m³ (× 0.3048,
  × 0.09290304, × 0.028316846592). Several values on one element: the largest wins. A zero counts as
  no value.
- When an element has no `Area` or `Volume` parameter, the area and volume of its materials from
  `materialInElement` are summed instead, paint excluded.
- **System** is `System Name` / `システム名`. **Category, family, family type, level and BIM
  document** come from the `element`, `category`, `familyInstance`, `familyType`, `level` and
  `bimDocument` tables.

### Pricing

From `src/estimate/pricing.ts`, for each element in the active sheet:

```
qty      = 1 (basis count), or the element's length, area or volume (basis length / area / volume)
material = qty × unit price × (1 + material adders)
labor    = qty × labor days per unit × labor rate × (1 + labor adders)
amount   = material + labor + extra
direct   = Σ amount over all elements (excluded elements still count)
total    = direct × (1 + Σ markup % / 100)
```

A `lump` code charges its unit price once, on the lowest element index that carries it. An element
whose code needs a quantity that the element does not have is **missing**: it costs only its extra,
and the footer counts it. Display "Costs" colours each coded element by its rank among the coded
elements (green over the lowest quarter, amber at the median, red at the top), rounded to 33 colour
steps, and leaves uncoded elements white.

### Design system

`src/ds/` is a copy of the [vim-html-ds](https://github.com/vimaec/vim-html-ds) design system:
`ds.css` and `fonts/*` copied verbatim (Retina, Roboto, and FluentUI System Icons under MIT), plus
React components that render the same DOM, classes and ARIA as the DS factories, so `ds.css` styles
them with no extra CSS. The app uses the DS dark theme throughout, and `src/styles.css` holds layout
only. `main.tsx` imports `ds.css` once. Its fonts are relative `url()`s that Vite bundles with the
build's base path, so they also load under the GitHub Pages sub-path. `src/ds/README.md` records the
vim-html-ds commit the copy came from.

To refresh it: copy `styles/ds.css` and `styles/fonts/*` from vim-html-ds again unchanged, update the
commit hash in `src/ds/README.md`, and compare the DS factories that the React components mirror
(`git diff <old>..<new> -- src/` in vim-html-ds) for changed markup or class names.

## Prerequisites

- **Node 22 or later**, and npm (CI uses Node 22). There is no API key to request and no server-side
  component to deploy.
- An account on a VIM Server instance, the default being <https://server-dev.vimaec.com>, with
  membership of at least one organisation there — otherwise the project list is empty.

### Entra app registration

The app signs in through the VIM Server app registration: client
`f518716e-50bb-4c82-bbee-3c85da317f82`, tenant `4e856586-7c87-4498-956e-ab21660251e1`. Two things
must be true of it, and both already are:

- The redirect URIs `http://localhost:5173/signin-oidc` and
  `https://vimaec.github.io/vim-server-satellite/signin-oidc` are registered under the
  **Single-page application** platform. The SPA platform matters: it is what permits PKCE with no
  client secret and returns the CORS headers the token request needs.
- The delegated scope `api://f518716e-50bb-4c82-bbee-3c85da317f82/Sync.ReadWrite` is exposed under
  **Expose an API**. That is the scope the app asks for and the audience VIM Server validates.

Serving the app from any **other** origin or path — a fork, a different dev port, your own host —
needs that origin's `.../signin-oidc` URI added to the registration first. Entra refuses an
unregistered redirect URI outright, with `AADSTS50011`. See [Deploy](#deploy).

## Run locally

```bash
npm install
npm run dev            # http://localhost:5173
```

Open <http://localhost:5173> and choose **Sign in with Microsoft**. The dev port is fixed
(`strictPort: true`) because the registered redirect URI names port 5173; if the port moves, sign-in
stops working.

No configuration is needed: every value has a working default. To point the app somewhere else, copy
`.env.example` to `.env.local`:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_VIM_SERVER_URL` | `https://server-dev.vimaec.com` | VIM Server base URL, no trailing slash |
| `VITE_ENTRA_TENANT_ID` | `4e856586-7c87-4498-956e-ab21660251e1` | Fallback tenant, used only when `GET /api/v1/config` fails |
| `VITE_ENTRA_CLIENT_ID` | `f518716e-50bb-4c82-bbee-3c85da317f82` | Fallback client id, same |
| `VITE_ENTRA_API_SCOPE` | `api://<clientId>/Sync.ReadWrite` | The delegated scope to request |

Vite inlines `import.meta.env.*` at build time, so a change needs a restart of `npm run dev`, or a
rebuild. `BASE_PATH` is a build-time **environment** variable rather than a `VITE_` one, and it sets
Vite's `base`.

```bash
npm run build                                     # tsc --noEmit && vite build -> dist/
BASE_PATH=/vim-server-satellite/ npm run build    # what CI deploys; npm run preview serves dist/
```

## Tests

Playwright drives the app in headless Chromium against a complete in-browser mock of VIM Server, so
the suite needs no network, no tenant and no token.

```bash
npx playwright install chromium   # once
npm test
npm run test:ui                   # interactive runner
```

The main suite runs against `npm run dev`, which always serves the app from `/`. Serving it from a
sub-path is what GitHub Pages does, and it can break on its own — asset URLs, `public/` files, the
Entra redirect page — so that case has its own tiny suite over a real `BASE_PATH` build served by
`vite preview`:

```bash
BASE_PATH=/vim-server-satellite/ npm run build
BASE_PATH=/vim-server-satellite/ npm run test:subpath   # tests/subpath, port 4173
```

`playwright.config.ts` starts `npm run dev` itself, and reuses one already running locally. It pins
Chromium to SwiftShader so headless WebGL works (`--use-gl=angle --use-angle=swiftshader
--enable-unsafe-swiftshader --ignore-gpu-blocklist`) and runs one worker, because several software
WebGL contexts at once are not reliable.

What the mock (`tests/support/mockVimServer.ts`) provides:

- Interception of every request to `{server}/api/v1/**`, with two orgs and three projects — one of
  them deliberately without a VIM — plus project roles, snapshot lists and download URLs.
- The bearer check: `Authorization: Bearer e2e-token`, or `401`. `GET /config` is the one anonymous
  route, as on the real server, and `setUnauthorized(true)` flips every authenticated route to
  `401`, which is how the session-expiry path is tested.
- A working data store with `ETag` write-versions, `If-Match` and `If-None-Match: *` giving `412`,
  batch upsert, batch delete and namespace delete, plus a record of every write, so a test can
  assert what was actually sent. `data` seeds the store; `beforeEntryWrite` lets a test act as
  another writer between the app's read and its write; `failWrite` answers chosen writes with an
  error status (for example `500`) to test the rollback; `failRead` does the same for reads, and
  `holdRead` holds a read's reply (with the data of when it was asked for) until the test lets it
  go, so a read can arrive late and out of date.
- A **Range-capable blob route** on the fake origin `https://mock-blob.local`, serving
  `tests/fixtures/Tiny_House_Imperial.r2026.vim` (252 KB) with exact `206` / `Content-Range` /
  `Content-Length` / `Accept-Ranges` replies, and the CORS headers blob storage exposes. The vim-web
  loader retries a bad range reply forever and silently, so `tests/mock-server.spec.ts` asserts the
  range behaviour on its own: a broken harness must fail as a harness, not as a mysterious viewer
  timeout.

`tests/support/auth.ts` puts the app into a signed-in state with no Entra tenant: `useFakeSession()`
writes a **fake session** object into `localStorage` under the key `vimSatellite.auth` through
`addInitScript`, before any app code runs, with `access: "e2e-token"` — the token the mock accepts.
The real PKCE path is covered separately by `seedPkce()` and `mockEntraToken()`, which seed the
in-flight verifier and answer Entra's token endpoint. `tests/support/fixture.ts` reads the fixture
in Node with vim-format, so a test knows each element's key and quantities without asking the app.

`window.__vimSatellite` is a small read-only debug hook, always installed (`src/debug.ts`). It lets
a test ask the app what it thinks instead of scraping CSS:

```ts
window.__vimSatellite = {
  getState():             string                // 'loading' | 'sign-in' | 'picker' | 'project'
  getSelection():         number[]              // selected element indices
  getElementColor(index): string | undefined    // the applied colour override, '#rrggbb'
  getEstimate():          DebugEstimate | null  // { sheetId, sheets, totals,
                                                //   assignments: element key -> assignment,
                                                //   hidden: excluded element indices,
                                                //   canEdit, sheetStatus: 'loading' | 'ready' | 'error',
                                                //   loads: whole reads taken in so far }
  isElementHidden(index): boolean               // excluded in the active sheet, so hidden in 3D
  getViewerBackground():  string | null         // vim-web's background colour, '#rrggbb'
}
```

The specs:

| Spec | What it covers |
|---|---|
| `auth.spec.ts` | Sign-in page, the PKCE reply and its `state` check, Entra errors, sign out, silent refresh, a refused refresh, the `/config` fallback, a `401` while signed in |
| `projects.spec.ts` | The picker by organisation, a project without a VIM, the project page (title, snapshot, role), `?project=` across a reload, a hidden project, the loading and download-error states |
| `estimate.spec.ts` | The estimate end to end on the Tiny House: no writes while browsing, Set Cost Code with the virtual `sheet-1` created on the first write, seeded data and a reload, Exclude / Include, colours by cost, new / duplicate / delete sheet, the last sheet, delete a cost code in every sheet, a unit price edit, a markup read–modify–write over a concurrent edit, two users editing markups at once, the `Viewer` role and an unknown role, a sheet whose assignments cannot be read, an edit made while the estimate is re-read after a failure, a refused write rolled back, Reload (changes made on the server, a deleted active sheet, a Viewer; an edit still being written, an edit made while it reads), the viewer background, Cost Details, EN / 日本語, Ctrl+C / Ctrl+V, the 3D right-click menu |
| `estimate-pricing.spec.ts` | The pure functions: pricing, totals and markups, the lump-sum and missing rules, the cost ramp, colours by level, grouping and search, the cost code tree, number parsing |
| `estimate-quantities.spec.ts` | `readFacts()` on the fixture: metric lengths, areas and volumes, material fallbacks, names from the BIM tables |
| `mock-server.spec.ts` | The harness itself: Range replies, data store preconditions, the bearer check |
| `subpath/smoke.spec.ts` | A `BASE_PATH` build under `vite preview`: boot, favicon, the Entra redirect page |

## Deploy

Push to `develop`. `.github/workflows/pages.yml` runs one job: checkout, Node 22 with an npm cache,
`npm ci`, `npx playwright install --with-deps chromium`, `npm run build` with
`BASE_PATH=/vim-server-satellite/`, `npm test`, `npm run test:subpath` against that build, then
`configure-pages`, `upload-pages-artifact` over `dist`, and `deploy-pages`. A failing run uploads the Playwright HTML report, and
`workflow_dispatch` runs the whole thing by hand.

The repository's **Pages source must be set to "GitHub Actions"**, not "Deploy from a branch": the
workflow publishes an artifact, which a branch-based Pages setup would ignore. `public/.nojekyll` is
there because GitHub Pages otherwise runs Jekyll, which drops files whose names start with `_`.

**To fork and deploy under another name:**

1. Change `BASE_PATH` in the workflow to `/<your-repo-name>/`, with both slashes. Vite writes it
   into every asset URL, and the app derives its redirect URI from it.
2. Register `https://<your-org>.github.io/<your-repo-name>/signin-oidc` as a Single-page application
   redirect URI on the Entra app registration you sign in against. Until it exists, Entra refuses
   the sign-in with `AADSTS50011`.
3. Set the Pages source to GitHub Actions in the fork's settings. Serving from a domain root instead
   needs no `BASE_PATH` at all: the default is `/`.

## Project layout

```
src/
  main.tsx              createRoot, vim-web/style.css, the debug hook. No <StrictMode>
  App.tsx               the whole app as one state machine: loading -> sign-in -> picker -> project
  config.ts             env vars with defaults, derived Entra settings, storage keys
  debug.ts              window.__vimSatellite, the read-only hook the tests use
  format.ts             the two date formatters the pages share
  styles.css            plain CSS, layout only: colours, type and radii come from the DS tokens
  auth/                 pkce.ts (base64url, S256 challenge), entra.ts (the React-free flow:
                        begin, complete, refresh, session storage), AuthProvider.tsx (useAuth)
  api/                  http.ts (the only fetch to VIM Server: bearer, ApiError, the 401 bridge),
                        types.ts, vimServer.ts (endpoint wrappers), projectData.ts (the data store)
  pages/                SignInPage (Microsoft sign-in), ProjectPickerPage (projects by organisation),
                        ProjectPage (top bar over estimate panel | viewer | Cost Details;
                        resolves the snapshot URL)
  viewer/               the single long-lived vim-web viewer: load, selection, colour overrides,
                        hidden elements, the right-click hook
  ds/                   the vim-html-ds copy: ds.css, fonts, React components, icons (see README.md)
  estimate/             the data layer, no JSX: types, keys (elementKey), store (every data store
                        read and write), quantities, pricing, grouping, i18n (EN / JA), prefs
                        (localStorage), useEstimate (state and actions)
  estimate/ui/          the panel, the Elements and Cost Codes tabs, the tree, the footer, Cost
                        Details, the dialogs, the menus and the keyboard shortcuts
public/
  signin-oidc.html      one line: forwards the Entra reply fragment to the app root
  .nojekyll             stops GitHub Pages from running Jekyll over the build output
  favicon.ico           the VIM icon
tests/
  support/              the in-browser VIM Server (mockVimServer.ts), the fake session (auth.ts),
                        the fixture read in Node (fixture.ts)
  fixtures/             Tiny_House_Imperial.r2026.vim, 252 KB: the model the suite loads
  subpath/              the BASE_PATH build smoke test (playwright.subpath.config.ts)
  *.spec.ts             sign-in, projects, the estimate (end to end, pure functions, quantities),
                        and the mock itself
.github/workflows/
  pages.yml             build with BASE_PATH, test, deploy to GitHub Pages
```

## Adapting the sample

**Point it at another VIM Server.** Set `VITE_VIM_SERVER_URL` in `.env.local`. Nothing else has to
change: the tenant and client id come from that server's `GET /api/v1/config`, and the redirect URI
comes from where the app is served. The registration in the new server's tenant still needs your
origin's `signin-oidc` URI.

**Add an API call.** Put the response shape into `src/api/types.ts` and a one-line wrapper into
`src/api/vimServer.ts` using `apiFetch<T>(path)`. The bearer token, `Accept`, the CORS mode, error
translation and the 401 handling all come from `http.ts` for free. For a write, spread
`jsonBody(value)` into the init and set `method`. To handle a status yourself instead of throwing —
`404` for "absent" — use `apiRequest(path, { allowStatus: [404] })` and read the `Response`. A `412`
is deliberately *not* allow-listed: it is thrown like any other failure, and the sheet write
(`updateSheet()` in `src/estimate/store.ts`) catches it to retry.

**Store your own data.** Pick a namespace prefix of your own (the estimate uses `estimate.*`, all of
it in `src/estimate/store.ts`) and use `src/api/projectData.ts` as it is. The store is namespace plus key to arbitrary JSON (Postgres
`jsonb`), scoped to one project and gated by project membership, which makes it the right place for
anything a satellite app keeps per project: view states, annotations, review status, issue links, a
cached derived index. Keys must not contain `/`. Read with `getEntry()` and write with
`putEntry(..., { ifMatch })` when two users could collide, or `{ ifNoneMatch: '*' }` for a write that
must not overwrite an existing entry; use `putEntries()` and `deleteEntries()` when one user action
touches many keys — one request beats fifty — and `deleteNamespace()` to drop a namespace whole.

**Replace the estimate.** `src/estimate/` is deliberately a leaf. `ProjectPage.tsx` hands
`useEstimate(projectId, role, vim)` the loaded model and the project role, and shares the selection
with the panel; the estimate gives back a map of element index to colour and a set of hidden
elements, which the viewer applies. Anything that consumes a selection and produces colours can take
its place — a QA checklist, a clash list, a progress overlay — with no change to the auth, API or
viewer code. Delete the folder and its wiring in `ProjectPage.tsx` and `src/debug.ts`, and the rest of
the app still runs.

## Known limitations

This is a sample, and it stops where a product would keep going.

- **vim-web is pinned to `1.0.0-beta.3`, exactly.** It is a beta with no back-compatibility shims,
  and another beta can move the API. `three` is a dependency of vim-web and must not be added
  separately: use `VIM.THREE`, or a page ends up with two copies of three.js.
- **An assignment is written whole.** Assignments are last-write-wins per element: when two people
  change different fields of the same element (one the cost code, the other the note) at the same
  moment, the later write keeps only its own copy of the entry. Field-level merges would need a
  read–modify–write per element, which costs a request per element.
- **No live updates.** The estimate is read when the project opens, after a failed write and on
  Retry; changes other people make show up on the next read.
- **Deletes are not transactions.** A sheet delete is two requests (its namespace, then its entry),
  and a cost code delete is a clean-up of every sheet, then the entry. A failure between the steps
  leaves an empty sheet, or a code that some sheets no longer use; the app reports it and re-reads.
- **A cost code text is unique by convention only.** Two people who add a code at the same moment
  get two ids, and may both get the automatic code text `USER-<n>`.
- **A UniqueId can repeat across linked models.** A Revit `UniqueId` is unique inside one document,
  not across a set of linked documents, so in a federated model two elements can share an
  assignment key. A real app would prefix the key with the source document id.
- **Elements with no UniqueId fall back to `id-<elementId>`**, which is not stable across a
  re-export, and an element with no Revit id either falls back to `index-<row>`, which is only
  meaningful for the loaded snapshot. Those assignments can drift onto the wrong element, or be
  lost, when a new snapshot lands.
- **No Entra end-session on sign out.** The app forgets its own tokens, but the Microsoft session in
  the browser stays, so the next sign-in is usually silent, and signing in as a different user needs
  a Microsoft sign-out.
- **Tokens live in `localStorage`**, which any script on the origin can read, and they outlive the
  tab. That is the usual trade-off for a static SPA with no backend of its own; weigh it before
  copying the pattern into something that matters.
- **No paging anywhere.** The project list fans out over every organisation, and the data store is
  read with `take` omitted, meaning "all entries". Fine at the sizes this sample sees.
