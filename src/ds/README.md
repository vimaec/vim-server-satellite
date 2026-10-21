# src/ds — the vim-html-ds design system, for React

`ds.css` and `fonts/*` are verbatim copies of `styles/ds.css` and `styles/fonts/*` from
[vim-html-ds](https://github.com/vimaec/vim-html-ds) at commit
`a90145c3babe04684c56ea43510e92a317b97847` (2026-10-14, "Merge pull request #24 from
vimaec/mavimaec/qol"): Retina (titles), Roboto (body, numbers) and FluentUI System Icons (MIT, see
`fonts/FluentSystemIcons-LICENSE.txt`). The DS ships plain TypeScript DOM factories; the `.tsx` files
here are React twins of the ones this app needs. They render the same DOM, class names, modifiers
and ARIA as the factory of the same name in vim-html-ds `src/`, so `ds.css` styles them with no
extra CSS. `icons.ts` is the DS icon map (`ICON_GLYPHS`, `FILLED_GLYPHS`, the drawn SVG paths).
`main.tsx` imports `ds.css` once, before `src/styles.css`; its fonts are relative `url(fonts/…)`
references, which Vite bundles into `assets/` with the build's `base`, so they also load under the
GitHub Pages sub-path. Mount `<DsHost />` once (main.tsx does) for `confirm()`, `prompt()`,
`toast()` and the `data-ds-tip` tooltips. To refresh: copy `styles/ds.css` and `styles/fonts/*`
again unchanged, update the commit above, and compare the factories you mirror
(`git diff <old>..<new> -- src/`) for changed markup or class names.
