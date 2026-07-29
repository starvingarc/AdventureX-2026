# Asset provenance

The iOS client keeps the Omo app icon and the focused motion assets used by the SwiftUI recall flow:

- `OmoPoseStretch`
- `OmoPoseSmirk`
- `OmoPoseRun`
- `OmoPoseApprove`
- `OmoPoseHeart`
- `OmoPoseConfused`, `OmoPoseDazed`, `OmoPoseDejected`
- `OmoMotionRunAtlas`, `OmoMotionRummageAtlas`, `OmoMotionCarryReturnAtlas` and their posters
- `OmoParticleGlow`, `OmoParticlePuff`, `OmoParticleSpark`
- `RecallFolder`

These assets were already part of the Omo project and were restored from `Omo-main.zip`. The frame-atlas player, particles, transitions and feedback are implemented in SwiftUI; no third-party animation package is required.
