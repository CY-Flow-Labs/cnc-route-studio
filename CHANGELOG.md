# Changelog

## 1.12.0 - 2026-09-22

- Added configurable four-face rotary-table support for M31–M34, including zero face and rotation direction.
- Added G52 local-coordinate offsets to parsing, machine-coordinate conversion, and diagnostics.
- Added reconstruction of completed low-feed machining paths into a rotatable 3D workpiece shell.
- Added width, height, and length inference from reconstructed rotary machining faces.
- Improved rotary playback, camera framing, live rotary status, and Three.js resource cleanup.
- Added reconstruction and parser regression tests.
- Added a local native file-picker bridge while retaining browser-local processing.
- Replaced development machining files and machine-specific defaults with synthetic public examples.

The simulator remains an experimental preflight and visualization tool. It does not replace controller simulation, single-block testing, dry runs, or qualified operator review.
