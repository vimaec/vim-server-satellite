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

## Manual Tests

## General Notes

## Changelist
