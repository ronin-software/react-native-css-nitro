# E2E verification

`verify-styles.yaml` drives the showcase app (Release build, iPhone 17 Pro /
iOS 26.5):

1. Assert the showcase header + both container-query labels render
2. Screenshot the light state
3. Tap the dark toggle, screenshot the dark state (class-selector dark mode)
4. Toggle back

Group press (`:active` on the group card propagating to the child pill) is
verified with `agent-device longpress 201 460 4000` + a screenshot mid-hold —
Maestro can't hold-and-screenshot.

Latest evidence: `verification/v3-*.png` (initial / dark / group-press).
Pixel-verified: dark flip (slate-50 → slate-950 screen, card → slate-800),
group press (child pill → red-700 mid-hold).
