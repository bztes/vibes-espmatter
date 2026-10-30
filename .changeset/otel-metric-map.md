---
'vibes-espmatter': patch
---

OpenTelemetry keeps only the metrics that exist instead of a fixed table of 128: up to 512 with PSRAM (where they are kept then), 192 without.
