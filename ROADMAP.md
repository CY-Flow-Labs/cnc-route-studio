# Roadmap

This roadmap describes intended maintenance work. It is not a promise of release dates or machine compatibility.

## Current focus

- Keep the public release installable from a clean clone, using synthetic examples only.
- Triage dependency alerts and open update pull requests without weakening parser or build checks.
- Document supported G-code, uncertain behaviors, and simulator limits with small reproducible examples.

## Next milestones

1. Add a public synthetic fixture set for coordinate offsets, rotary faces, canned cycles, and macro calls. Each fixture should state its expected path or diagnostic result.
2. Publish a compatibility matrix showing which G-code behaviors are implemented, approximated, or unsupported, with links to synthetic cases.
3. Publish versioned GitHub releases with a change summary, known limitations, and the CI result for the release commit.
4. Gather opt-in user feedback through Issues about supported controllers, workflows, and failure cases. Report usage only when it can be verified; stars or downloads are not proxies for machine safety.

## Longer term

- Improve parser coverage for documented Fanuc-like behaviors while keeping unsupported behavior explicit.
- Compare visualization and diagnostics against independent synthetic reference cases.
- Keep the project useful as an educational and preflight tool; it will not replace controller simulation, dry runs, or qualified operator review.
