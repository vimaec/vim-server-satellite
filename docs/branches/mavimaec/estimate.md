# Branch Tracker for mavimaec/estimate

## Requirements

- Port the "Estimate" workflow from `vim-renderer/run/Workflows/Estimate` into this satellite app, in place of the label workflow.
- Apply the styling from the `vim-renderer/vim-html-ds` submodule to the ported Estimate workflow; copy the resources that the app needs from the submodule.
- Keep VIM Server as the back-end: save the estimation data in the project's VIM Server data store and load it again from there.
- Show how estimation data attaches to the VIM model that the vim-web viewer loads.
- Keep the port lean and focused: do not port the application shell or the project file concept.
- Test locally on the branch `mavimaec/estimate`; push to `develop` (GitHub Pages) only after the operator validates it.
- Keep from the workflow: estimation sheets, cost codes, work packages, the element tree with work package / cost code / extra / note, include / exclude, markups and TOTAL, color by cost.
- Also keep: the Cost Details pane, Copy / Paste Cost Code, Group by with color by level.
- Keep the EN / 日本語 language switch.
- Remove the label feature (palette and colored labels).
- Keep per-user view settings (active sheet, grouping, display mode) in browser localStorage; only the shared estimate data goes to VIM Server.
- Add a "refresh" button next to the "Estimate" title that reloads the cost and estimation data from VIM Server.
- Set the background color of the vim-web viewer to #0b121c.
- Disable the axis widget in the top right of the 3D view.
- Give ghosted elements a lighter color that reads well on the dark background, with a default ghost opacity of 0.01.
- Style the vim-web control bar to match the design system theme, with circular buttons and rounded capsule sections.
- Do not rely on the element index: it can be inconsistent between exports.
- Remove all usage of the Retina font; use Roboto in its place.
- Use lighter, brighter colors for the "Display" color modes in the 3D view.

## Questions

- ✅ Which optional parts of the workflow must the port keep?
    Recommendation: Keep the core only.
    Keep the Cost Details pane, Copy / Paste Cost Code, and Group by with color by level. Do not port the Excel export.
- ✅ Keep the Japanese language switch?
    Recommendation: English only.
    Keep EN / 日本語.
- ✅ What happens to the label feature?
    Recommendation: Remove it.
    Remove it.
- ✅ Where do per-user view settings go?
    Recommendation: Browser localStorage.
    Browser localStorage.
- ✅ The design system uses the commercial Retina fonts (`src/ds/fonts/Retina-*`). The GitHub Pages build of this public repo will serve them. Does the Retina licence allow this?
    Recommendation: Keep them. The vim-html-ds gallery on GitHub Pages already serves the same fonts publicly. If the licence does not allow it, remove the Retina files and let ds.css fall back to Roboto.
    Keep things as they are. The design system will soon be updated to remove the Retina font, and this repository has only limited exposure.

## Manual Tests

- [ ] Run `npm run dev`, sign in, open a project with a VIM; the Estimate panel shows "Estimate 1" and the model loads in 3D
- [ ] Open a project with no estimate data and only browse (select, search, tabs, Display); no `estimate.*` namespace appears on the server
- [ ] Select a wall, right-click › Set Cost Code… › New cost code… (basis Length, price 100); the row shows the code and the TOTAL updates
- [ ] Reload the page; the cost code, the assignment and the TOTAL come back from VIM Server
- [ ] Set a work package on a group row; every element in the group gets it
- [ ] Type an Extra and a Note on an element row; the amount and the TOTAL include the extra
- [ ] Uncheck an element (Exclude); it is hidden in 3D, and stays hidden after a reload
- [ ] Press Ctrl+X on a selection twice; the elements are excluded, then included again
- [ ] Display › Costs; coded elements show green → red, uncoded elements show white, the legend shows the lowest and highest amounts
- [ ] Display › Colors by Category, then click the shuffle button; the 3D colors and the row swatches change together
- [ ] Open the grouping drawer, move Category to the top, remove Cost code; the tree regroups and keeps the order after a reload
- [ ] Search for "window"; only the matching elements show
- [ ] Show › Excluded; only the excluded elements show
- [ ] Sheet select › Duplicate…; the copy has the same codes, markups and currency
- [ ] Sheet select › New sheet…; the new sheet is empty, and switching back shows the first sheet's data
- [ ] Sheet select › Delete on the copy; it disappears and its data is gone from the server
- [ ] Change the currency to EUR; the amounts show "€" and the numbers do not change
- [ ] Add a markup of 10 %; TOTAL = direct cost × 1.10
- [ ] Cost Codes tab › Add code, edit its price in place; the Elements tab amounts reprice
- [ ] Cost Codes tab › click a code; its elements are selected in 3D
- [ ] Cost Codes tab › right-click › Edit…; change the basis and adders; the amounts follow
- [ ] Cost Codes tab › right-click › Delete; the elements lose the code in every sheet
- [ ] Select 3 elements, click "Cost Details"; the Summary shows shared values or "varies" and the total amount
- [ ] In Cost Details step with › and ‹; the 3D selection does not change, and with the camera toggle on the view frames each element
- [ ] Select a coded element, Ctrl+C; select others, Ctrl+V; they get the same cost code
- [ ] Right-click in the 3D view; the estimate menu opens and the selection stays
- [ ] Click 日本語; the panel, top bar and viewer status show in Japanese; reload keeps the language
- [ ] Open a project where your role is Viewer; a read-only banner shows and nothing can be changed
- [ ] Open the same project in two browsers; edit different markups in each, reload both; both changes are kept
- [ ] Drag the panel divider and the Cost Details divider; both panes resize and the 3D view reflows
- [ ] Check the look: dark VIM design system fonts and colors on sign-in, project picker and project pages
- [ ] Look at the panel, dialog and top-bar titles; they show in Roboto bold, and dev tools show no Retina font loaded
- [ ] Change a cost code price in a second browser, then click the refresh button next to "Estimate"; the new price and TOTAL show without a page reload
- [ ] Click refresh while you type a note; the note is kept after the refresh
- [ ] The 3D view background is #0b121c (sample it with a color picker), before and after the model loads
- [ ] The axis widget does not show in the top right of the 3D view; the "Cost Details" button sits in the top-right corner
- [ ] Isolate a selection (or exclude elements with ghosting on); the ghosted elements show light, not black, on the dark background
- [ ] Isolate a selection; the ghosted elements are a very faint light veil (opacity 0.01 by default), and the isolation panel shows 0.01
- [ ] The control bar at the bottom of the 3D view uses the dark design system colors; hover, active and disabled buttons are clear
- [ ] The control bar sections are rounded capsules and each button is a circle; hover, active and disabled stay clear
- [ ] Open Settings, the isolation settings (sliders button) and Help from the control bar; the panels are dark with readable text and inputs
- [ ] Select an element, then click Help in the control bar; the Help close button in the top-right corner is not covered by "Cost Details"
- [ ] On "MEP Estimate Sheet" in Medical Tower Project, check the header box (include all), then uncheck it again; both complete with no CORS error in the browser console and no error toast
- [ ] Open "Medical Tower Project", select "MEP Estimate Sheet"; only MEP elements show in 3D, grouped by the six MasterFormat work packages, TOTAL about $47.1M (direct about $34.4M)
- [ ] Display › Colors by Category, then Display › Costs; the 3D colors are light and clear on the dark background, and a lit face matches its tree swatch or the cost legend

## General Notes

## Changelist

- Replace the colored-label sample with a port of the VIM Flex Estimate workflow: estimation sheets, cost codes, work packages, markups and total
- Attach estimate data (work package, cost code, extra, note, included/excluded) to the elements of the VIM model loaded in the vim-web viewer, keyed by Revit UniqueId only (never the element index or ElementId); lump sums sit on the element with the lowest UniqueId
- Save and reload all estimate data in the project's VIM Server data store (`estimate.*` namespaces); browsing never writes
- Compute quantities (length, area, volume) from the VIM's BIM parameters and materials, and price elements as the original workflow does
- Group the element tree by configurable levels, color the 3D view by cost or by a grouping level (bright colors that match the tree swatches and the cost legend), and hide excluded elements in 3D
- Add the Cost Details pane, Set Cost Code / Set Work Package dialogs, context menus in the tree and the 3D view, and Ctrl+C / Ctrl+V / Ctrl+X shortcuts
- Add the EN / 日本語 language switch
- Keep view settings (active sheet, grouping, display, language) per user in the browser
- Allow edits only for the Manager and Admin project roles; Viewers see a read-only estimate
- Add a refresh button next to the "Estimate" title that reloads the estimate data from VIM Server without losing edits in progress
- Set the 3D viewer background to #0b121c and hide the axis widget
- Lighten ghosted elements, and restyle the vim-web control bar, its tooltips and the panels it opens in the design system theme
- Send at most two data-store write requests at a time, and retry safe requests when VIM Server is busy (no answer, 429 or 5xx), so bulk changes on large sheets do not fail with CORS errors
- Restyle the app with a copy of the vim-html-ds design system (stylesheet, Roboto and Fluent icon fonts, React components); titles use Roboto bold, not the commercial Retina font
- Replace the label end-to-end tests with estimate tests, and rewrite the README for the Estimate sample
