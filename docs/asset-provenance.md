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

The knowledge-library implementation adds two SVGs supplied by the product owner in the Figma handoff for node `884:324` (`Pick The Shell`):

- `KnowledgeLibraryBack` — SHA-256 `7fcced08d0141faeaa406fe77b26c16f96b41a69e27b8a14b296ff984df265c9`
- `KnowledgeLibraryMicrophone` — SHA-256 `63878e3adc529f8bbdca392c5dcd546b3929c1f84e96b8cf8b9d5b6f4a2a62de`

They are project-specific design inputs provided for implementation in Omo. The responsive search field, cards, panel and states are native SwiftUI rather than rasterized component screenshots.
