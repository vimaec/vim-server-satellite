# src/ds — the vim-html-ds design system, for React

`ds.css` and `fonts/*` are copies of `styles/ds.css` and `styles/fonts/*` from
[vim-html-ds](https://github.com/vimaec/vim-html-ds) at commit
`a90145c3babe04684c56ea43510e92a317b97847` (2026-10-14, "Merge pull request #24 from
vimaec/mavimaec/qol"): Roboto (titles, body, numbers) and FluentUI System Icons (MIT, see
`fonts/FluentSystemIcons-LICENSE.txt`). The DS ships plain TypeScript DOM factories; the `.tsx` files
here are React twins of the ones this app needs. They render the same DOM, class names, modifiers
and ARIA as the factory of the same name in vim-html-ds `src/`, so `ds.css` styles them with no
extra CSS. `icons.ts` is the DS icon map (`ICON_GLYPHS`, `FILLED_GLYPHS`, the drawn SVG paths).
`main.tsx` imports `ds.css` once, before `src/styles.css`; its fonts are relative `url(fonts/…)`
references, which Vite bundles into `assets/` with the build's `base`, so they also load under the
GitHub Pages sub-path. Mount `<DsHost />` once (main.tsx does) for `confirm()`, `prompt()`,
`toast()` and the `data-ds-tip` tooltips.

**One deviation from upstream: no Retina.** Upstream vim-html-ds still ships the commercial Retina
font for titles (`--font-display`). This copy drops it: the three Retina `@font-face` rules and the
`fonts/Retina-*` files are removed, and `--font-display` is `'Roboto',system-ui,-apple-system,sans-serif`
(the same stack as `--font-body`). Titles keep `font-weight:700`, which the Roboto variable fonts
cover (`font-weight:100 900`). Keep this deviation until upstream drops Retina too.

To refresh: copy `styles/ds.css` and `styles/fonts/*` again, then reapply the deviation: do not copy
the `Retina-*` files, delete the Retina `@font-face` rules, set `--font-display` to the Roboto stack
above, and fix the comments that name Retina (`grep -ril retina src/` must list only this file). Update the
commit above, and compare the factories you mirror (`git diff <old>..<new> -- src/`) for changed
markup or class names. When upstream has dropped Retina, the copy is verbatim again: remove this
paragraph and the one above.
