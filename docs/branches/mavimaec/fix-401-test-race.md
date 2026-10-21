# Branch Tracker for mavimaec/fix-401-test-race

## Requirements

- Fix the deployment GitHub action failure in `tests/auth.spec.ts` › "a 401 while signed in drops the session and explains why".

## Questions

## Manual Tests

- [ ] Merge to develop; the "Build, test and deploy to GitHub Pages" action passes and deploys

## General Notes

## Changelist

- Fix a race in the 401 sign-in test: it now waits for the project list to load before the mock server starts to refuse the token
