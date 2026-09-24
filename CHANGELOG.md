# Changelog

## 1.15.0 - 2026-09-24

- Refined four-face reconstruction so only completed milling surfaces shape the preview; drilling cycles and axial approach moves remain visible without changing the reconstructed outline.
- Added finished-face distance inference for paired G55/G57 Z0 surfaces, rotary dimension labels, and six orthographic views alongside 3D view.
- Corrected G0–G3 behavior after G81–G89 canned cycles and added parser and reconstruction regression cases.
- Kept the public default program synthetic and added a browser file-picker fallback when the optional local picker service is unavailable.

The simulator remains an educational preflight tool. Its output does not replace controller simulation, dry runs, or qualified operator checks.

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
