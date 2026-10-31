---
'vibes-espmatter': minor
---

Features only build their web interface and API parts when the HTTP server is part of the board. Pairing Thread devices moves out of the Matter controller into the new feature Matter controller Thread, and the Matter device values over OpenTelemetry into the new feature OpenTelemetry metrics. The dependency graph also shows the features a feature works with when they are on the same board. After upgrading, a saved project that had OpenTelemetry now has OpenTelemetry metrics instead: add OpenTelemetry again and set it up. Projects that pair Thread devices also need Matter controller Thread.
