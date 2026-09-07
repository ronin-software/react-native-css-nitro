# E2E verification

`maestro test .e2e/verify-styles.yaml` against a Release build of the example
app on iPhone 17 Pro (iOS 26.5). Screenshots land in ~/.maestro/tests/<run>/
— the pressed screenshot must show the e2e-press row with a yellow
background and black text (active pseudo-class), reverting on release.
