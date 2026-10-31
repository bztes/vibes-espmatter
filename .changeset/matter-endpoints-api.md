---
'vibes-espmatter': minor
---

The device API calls switchable Matter devices endpoints instead of lights, since they also cover plugs. The access API takes `control` and `view`, and scenes take `endpoints`, but the old `lights` parameter still works. `GET /api/scenes` now returns `endpoints` and `maxEndpoints`.
