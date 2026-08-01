# Contributing to Harvest

Harvest uses a lightweight issue-to-pull-request workflow. `main` is the only
long-lived branch.

## Workflow

1. Open or choose a GitHub issue with clear acceptance criteria.
2. Create a branch from the latest `main`.
3. Make one focused change.
4. Open a pull request into `main` and link the issue with `Closes #<number>`.
5. Ask a human teammate for review when it would help; reviews are not
   mandatory.
6. AI agents leave the pull request open after creating or updating it.
7. An authorised human manually decides whether to merge or close it and
   handles any post-merge branch deletion.

Do not push directly to `main`.
AI agents and automated systems must never merge or close a pull request,
submit a formal GitHub review, enable auto-merge, or delete a pull-request
branch. Any merge must be deliberately initiated by an authorised human.

## Branch names

Use lowercase words separated by hyphens:

```text
app/<issue>-<short-name>
simulation/<issue>-<short-name>
model/<issue>-<short-name>
contracts/<issue>-<short-name>
docs/<issue>-<short-name>
demo/<issue>-<short-name>
fix/<issue>-<short-name>
chore/<issue>-<short-name>
```

Examples:

```text
app/12-product-api-foundation
simulation/7-event-engine
contracts/3-crop-observation
demo/21-judge-mode
```

## Commits

Use a simple Conventional Commit prefix:

```text
feat:      new product behaviour
fix:       bug fix
docs:      documentation only
chore:     repository or tooling maintenance
research:  research findings or evidence
refactor:  behaviour-preserving restructure
test:      tests or validation
```

## Pull requests

- Keep the change small enough to understand quickly.
- State what is deliberately out of scope.
- Update documentation when behaviour or architecture changes.
- Update `contracts/` whenever communication between areas changes.
- Include validation steps and screenshots when they are useful.
- Clearly label synthetic data and simulated outcomes.
- Do not commit secrets, local environment files, private datasets, or
  generated artefacts.
- Leave formal reviews, approvals, merges, closes, and branch deletion to
  humans. AI agents may inspect, test, and report findings, but must leave the
  pull request open.

Contract or architecture disagreements should be resolved in the issue before
separate implementations drift apart.
