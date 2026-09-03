# vim-server-satellite

A sample **"satellite" app** for [VIM Server](https://vimaec.com): a single-page app that signs the
user in with the VIM Server Microsoft Entra ID app registration, lists the projects they can reach,
loads a project's latest VIM snapshot in the [vim-web](https://www.npmjs.com/package/vim-web)
viewer, lets them select elements in 3D or in an element tree, and applies coloured labels stored
back on the project — in the project's own custom data store, so the app needs no database and no
server code of its own. It exists to be copied: plain React 18 + TypeScript + Vite and plain CSS, no
router, no state library and no UI kit, so each piece lifts out on its own.

Live build: <https://vimaec.github.io/vim-server-satellite/>

## What it demonstrates

| Feature | Where to read it |
|---|---|
| Entra ID authorization code + PKCE, written out with `fetch` (no MSAL, no CDN) | `src/auth/pkce.ts`, `src/auth/entra.ts` |
| Session storage, silent refresh, and a clean drop back to sign-in on a 401 | `src/auth/AuthProvider.tsx`, `src/api/http.ts` |
| Asking the server which Entra app registration to trust (`GET /api/v1/config`) | `src/config.ts` |
| Bearer header, `ProblemDetails` to `ApiError`, allow-listed statuses (404, 412) | `src/api/http.ts` |
| Typed wrappers for the REST endpoints, and the custom data store as app storage | `src/api/vimServer.ts`, `src/api/projectData.ts`, `src/api/types.ts` |
| Listing every reachable project (there is no "all projects" endpoint) | `src/pages/ProjectPickerPage.tsx` |
| Resolving a snapshot to a time-limited blob URL and loading it in the viewer | `src/pages/ProjectPage.tsx`, `src/viewer/` |
| An element tree built from the VIM's own BIM tables, kept in sync with the 3D selection | `src/tree/`, `src/viewer/` |
| Labels persisted per project, with ETag concurrency and role checks | `src/labels/` |
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
as `{ access, refresh, exp, name, upn, kind }`. `name` and `upn` are read out of the `id_token`
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
| GET | `/profile` | The signed-in user: name, email, organisations | `getProfile()` |
| GET | `/org` | Organisations the user belongs to, with their org role | `listOrgs()` |
| GET | `/org/{orgId}/project` | Projects in one org; each carries `latestVim` or `null` | `listProjects()` |
| GET | `/project/{id}` | Project detail: name, organisation, `latestVim` | `getProject()` |
| GET | `/project/{id}/role` | `Viewer`, `Manager` or `Admin` for this project | `getProjectRole()` |
| GET | `/project/{id}/vim` | `{ latest, history }`: the snapshot list | `getVimHistory()` |
| GET | `/project/{id}/vim/download?redirect=false` | `{ url, expiresAtUtc }`: a ~6 h Azure Blob SAS URL | `getVimDownloadUrl()` |
| GET | `/project/{id}/data/{ns}` | Every entry in a namespace | `listEntries()` |
| GET | `/project/{id}/data/{ns}/{key}` | One entry, plus the `ETag` response header; `404` when absent | `getEntry()` |
| PUT | `/project/{id}/data/{ns}/{key}` | Write one entry; optional `If-Match`, which gives `412` on a stale write | `putEntry()` |
| PUT | `/project/{id}/data/{ns}` | Batch upsert of `[{ key, value }]`, returns `{ created, updated }` | `putEntries()` |
| POST | `/project/{id}/data/{ns}/delete` | Batch delete of `["key", ...]`, returns `{ deleted }` | `deleteEntries()` |

Things worth knowing before you write your own client:

- There is no "all my projects" endpoint. `listAccessibleProjects()` reads `/org` and then fans out
  over `/org/{id}/project` in parallel; an org whose project list fails is shown empty rather than
  failing the whole page.
- A project you cannot see answers `404`, never `403`. A `403` means the licence gate, and its body
  is `{ error, message }` rather than RFC 7807 `ProblemDetails`; `http.ts` handles both shapes.
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

### Element identity

Three different ids show up around one element, and choosing the wrong one silently breaks
persistence:

| In the viewer | In the VIM | Stable across snapshots? | Used here for |
|---|---|---|---|
| `element` (`number`) | `Vim.Element._key` | **No** — it is a row index | selection, colour overrides, tree keys: all in memory |
| `elementUniqueId` (`string`) | Revit `Element.UniqueId` | **Yes** | the label key stored on the server |
| `elementId` (`bigint`) | Revit `ElementId` | per document (`-1` means none) | the `[id]` shown in the tree |

An element index is only meaningful for the model instance currently loaded — re-export the project
and the indices move. So labels are keyed by **UniqueId**:

```ts
elementKey(e) = e.uniqueId ?? `id-${e.elementId}`
```

The fallback covers source formats that have no UniqueId, and a key like `id-42` reads as the weaker
thing it is. On load the app fetches the assignments, maps each key back to the element index of the
loaded model, and applies the colours.

### Labels data layout

Two namespaces in the project's custom data store. Nothing is stored anywhere else.

| Namespace | Key | Value | Written by |
|---|---|---|---|
| `satellite.palette` | `palette` | `{ labels: [{ id, name, color: "#rrggbb" }] }` | palette edits: one `PUT` with `If-Match` |
| `satellite.labels` | element key: UniqueId, else `id-<elementId>` | `{ labelId, elementId, elementName?, by?, at }` | applying a label (batch `PUT`), removing one (batch delete) |

The default palette — Review `#e5484d`, Approved `#30a46c`, Question `#f5a524` — is created
client-side when a project has none, and is written to the server only on the first label write, so
browsing a project never changes it.

An assignment stores the label **id**, not its colour. Renaming a label or changing its colour is
then one palette write, and every element carrying that label follows. `by` and `at` record who
labelled what, and when.

**Concurrency.** The palette is read with its `ETag` — a quoted integer write-version, for example
`"3"` — and written back with `If-Match`, so if two people edit the palette at the same time one of
them gets a `412` instead of a silent overwrite. Per-element assignments are last-write-wins on
purpose: they are independent keys, and one user labelling a wall does not conflict with another
labelling a door.

**Roles.** The label panel needs `Manager` or `Admin` on the project; with `Viewer` it is read-only
and says so, because a write would come back `403`. The role comes from `GET /project/{id}/role`,
and if that call fails the app assumes the lowest privilege rather than failing the page.

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
- A working data store with `ETag` write-versions, `If-Match` giving `412`, batch upsert and batch
  delete, plus a record of every write, so a test can assert what was actually sent.
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
in-flight verifier and answer Entra's token endpoint.

`window.__vimSatellite` is a small read-only debug hook, always installed (`src/debug.ts`). It lets
a test ask the app what it thinks instead of scraping CSS:

```ts
window.__vimSatellite = {
  getState():             string                     // 'loading' | 'sign-in' | 'picker' | 'project'
  getSelection():         number[]                   // selected element indices
  getElementColor(index): string | undefined         // the applied colour override, '#rrggbb'
  getAssignments():       Record<string, Assignment> // element key -> assignment
}
```

## Deploy

Push to `develop`. `.github/workflows/pages.yml` runs one job: checkout, Node 22 with an npm cache,
`npm ci`, `npx playwright install --with-deps chromium`, `npm run build` with
`BASE_PATH=/vim-server-satellite/`, `npm test`, then `configure-pages`, `upload-pages-artifact` over
`dist`, and `deploy-pages`. A failing run uploads the Playwright HTML report, and
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
  config.ts             env vars with defaults, derived Entra settings, storage keys, namespaces
  debug.ts              window.__vimSatellite, the read-only hook the tests use
  styles.css            plain CSS, one light theme, no framework
  auth/                 pkce.ts (base64url, S256 challenge), entra.ts (the React-free flow:
                        begin, complete, refresh, session storage), AuthProvider.tsx (useAuth)
  api/                  http.ts (the only fetch to VIM Server: bearer, ApiError, the 401 bridge),
                        types.ts, vimServer.ts (endpoint wrappers), projectData.ts (the data store)
  pages/                SignInPage (Microsoft sign-in), ProjectPickerPage (projects by organisation),
                        ProjectPage (header, side pane, viewer pane; resolves the snapshot URL)
  viewer/               the single long-lived vim-web viewer: load, selection, colour overrides
  tree/                 ModelElement, built from the VIM's BIM tables, and the element tree itself
  labels/               the palette, the assignments, the label panel, and the writes to the data store
public/
  signin-oidc.html      one line: forwards the Entra reply fragment to the app root
  .nojekyll             stops GitHub Pages from running Jekyll over the build output
  favicon.ico           the VIM icon
tests/
  support/              the in-browser VIM Server (mockVimServer.ts) and the fake session (auth.ts)
  fixtures/             Tiny_House_Imperial.r2026.vim, 252 KB: the model the suite loads
  *.spec.ts             sign-in, projects, the viewer and labels, and the mock itself
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
`404` for "absent", `412` for "someone wrote first" — use `apiRequest(path, { allowStatus: [404] })`
and read the `Response`.

**Store your own data.** Add a namespace to `namespaces` in `src/config.ts` and use
`src/api/projectData.ts` as it is. The store is namespace plus key to arbitrary JSON (Postgres
`jsonb`), scoped to one project and gated by project membership, which makes it the right place for
anything a satellite app keeps per project: view states, annotations, review status, issue links, a
cached derived index. Keys must not contain `/`. Read with `getEntry()` and write with
`putEntry(..., ifMatch)` when two users could collide; use `putEntries()` and `deleteEntries()` when
one user action touches many keys — one request beats fifty.

**Replace the label feature.** `src/labels/` is deliberately a leaf. It is handed the
`ModelElement[]` built by `src/tree/`, plus the current selection, and it gives back a map of
element index to colour that the viewer applies. Anything that consumes a selection and produces
colours can take its place — a QA checklist, a cost lookup, a clash list, a progress overlay — with
no change to the auth, API or viewer code. Delete the folder and its wiring in `ProjectPage.tsx` and
the rest of the app still runs.

## Known limitations

This is a sample, and it stops where a product would keep going.

- **vim-web is pinned to `1.0.0-beta.3`, exactly.** It is a beta with no back-compatibility shims,
  and another beta can move the API. `three` is a dependency of vim-web and must not be added
  separately: use `VIM.THREE`, or a page ends up with two copies of three.js.
- **One label per element.** `satellite.labels` holds a single assignment per element key. Several
  labels per element would need an array value and a rule for which colour wins.
- **A UniqueId can repeat across linked models.** A Revit `UniqueId` is unique inside one document,
  not across a set of linked documents, so in a federated model two elements can share a label key.
  A real app would prefix the key with the source document id.
- **Elements with no UniqueId fall back to `id-<elementId>`**, which is not stable across a
  re-export. Those labels can drift onto the wrong element when a new snapshot lands.
- **No Entra end-session on sign out.** The app forgets its own tokens, but the Microsoft session in
  the browser stays, so the next sign-in is usually silent, and signing in as a different user needs
  a Microsoft sign-out.
- **Tokens live in `localStorage`**, which any script on the origin can read, and they outlive the
  tab. That is the usual trade-off for a static SPA with no backend of its own; weigh it before
  copying the pattern into something that matters.
- **No paging anywhere.** The project list fans out over every organisation, and the data store is
  read with `take` omitted, meaning "all entries". Fine at the sizes this sample sees.
