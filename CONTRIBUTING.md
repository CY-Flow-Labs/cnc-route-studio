# Contributing to CNC Route Studio

Issues and pull requests are welcome. The project is maintained by CY Flow Labs and focuses on reproducible CNC program parsing and visualization.

## Report an issue

Search existing issues first. Include the app version or commit, browser and operating system, expected result, actual result, and the smallest CNC program that reproduces the behavior. If the issue concerns a machine setting, describe only the relevant generic configuration.

Do not post production NC files, customer names, machine credentials, private drawings, or proprietary parameters. Replace them with synthetic values before sharing.

## Propose a change

Open an issue for significant changes so the intended behavior can be discussed. Keep pull requests focused and explain the affected G-code or user workflow. Update the README or changelog when user-facing behavior changes. Add a regression case when changing parsing or geometry behavior.

The CI workflow runs `npm test` and `npm run build` on pull requests. Before submitting, run those commands locally when practical and explain any checks you could not perform. A passing CI job does not establish controller or machine safety.

## Review scope

Maintainers review correctness, reproducibility, privacy of examples, and whether a change stays within the simulator's documented limits. Experimental behavior should be labeled clearly. Machine execution and production validation remain outside this repository's scope.
