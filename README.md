# vim-server-satellite

A sample "satellite" single-page app for [VIM Server](https://vimaec.com): sign in with a Microsoft
work account, pick a project, and open its latest VIM snapshot. It is meant as a starting point for
third-party developers, so the code stays plain — React 18 + TypeScript + Vite, plain CSS, no router,
no state library, no UI kit.

Live build: <https://vimaec.github.io/vim-server-satellite/>

> **Phase 1.** Sign-in, the project picker and the project page frame are done. The two panes on the
> project page are placeholders: the vim-web viewer, the element tree and the labels feature arrive in
> Phase 2. The project page already resolves the snapshot download URL that the viewer will be given.

## What it shows

- Microsoft Entra ID sign-in with the OAuth2 **authorization code + PKCE** flow written out by hand
  (`src/auth/`) — no MSAL, so the HTTP exchange is visible and portable.
- A VIM Server personal access token as a secondary way in, validated against `GET /api/v1/profile`.
- Silent token refresh, and a clean drop back to the sign-in page on a 401.
- Typed wrappers over the VIM Server REST API (`src/api/`), including the project custom data store
  that Phase 2 uses to persist labels.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

No configuration is needed: the defaults point at the VIM Server dev instance, and the app asks
`GET /api/v1/config` which Entra app registration to use. To change anything, copy `.env.example` to
`.env.local`.

Microsoft sign-in only works from an origin whose `.../signin-oidc` redirect URI is registered on the
Entra app registration. Until `http://localhost:5173/signin-oidc` is registered, use the access token
option on the sign-in page.

## Build

```bash
npm run build                                  # tsc --noEmit && vite build -> dist/
BASE_PATH=/vim-server-satellite/ npm run build # what CI deploys to GitHub Pages
```

## Test

Playwright drives the app in headless Chromium against a full in-browser mock of VIM Server
(`tests/support/mockVimServer.ts`), so the suite needs no network, tenant or token.

```bash
npx playwright install chromium   # once
npm test
npm run test:ui                   # interactive
```

`tests/live.spec.ts` is a smoke test against the real server; it is skipped unless
`VIM_SATELLITE_PAT` holds a personal access token.

## Layout

```
src/
  config.ts             env vars, storage keys, derived Entra settings
  auth/                 PKCE helpers, the Entra flow, AuthProvider + useAuth
  api/                  http.ts (bearer + errors), types.ts, vimServer.ts, projectData.ts
  pages/                SignInPage, ProjectPickerPage, ProjectPage
  App.tsx               loading -> sign-in -> picker -> project
public/
  signin-oidc.html      forwards the Entra reply fragment to the app root
tests/                  Playwright specs, the VIM Server mock and a .vim fixture
```
