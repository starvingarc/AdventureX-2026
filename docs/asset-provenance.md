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

The Figma-based recall home adds the following user-supplied design exports. They are used only by the iOS home screen and were provided in the product design conversation for this implementation:

| Asset | Purpose | SHA-256 |
|---|---|---|
| `FirstLaunchArrow/first-launch-arrow.svg` | First-upload and IP-tap guidance arrow | `03fc783fa0c062ab8837bdabacaeb9b2ea0062cdb48c99dba5c8411f3a84892c` |
| `FirstLaunchFolder/first-launch-folder.png` | Knowledge-folder illustration | `2436e97743f41259da66b6b7c5cced6940abd6632c68b351c6a49267ed2cf74f` |
| `FirstLaunchMenu/first-launch-menu.svg` | Side-menu button | `19f6b5ea3f86298f8ddd352308f6cf6cd5df50a3ee03a83ac0e6ca5b5d1f518b` |
| `FirstLaunchPanel/first-launch-panel.png` | Cream home surface exported from Figma | `0ede2990e6360584211e3dadf0adc7497ef7e79af557ce5c5f38ae9fb03dae6f` |
| `FirstLaunchUpload/first-launch-upload.svg` | Screenshot upload button | `5816bc26dfd05e7b06346e7450c0f70e9ac777070727981d019617a4f3460500` |

The current home reuses the repository-owned `OmoPoseStretch` as a temporary IP presentation. Final IP art direction remains a separate product decision.

## Related documents

- [[docs/frontend/v2-first-launch-empty-home]]
- [[docs/frontend/v2-active-recall-home]]
- [[docs/index]]
