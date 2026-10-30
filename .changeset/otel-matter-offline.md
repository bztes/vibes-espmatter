---
'vibes-espmatter': patch
---

OpenTelemetry no longer sends the last values of Matter devices that are offline: when a device's subscription loses it, its metrics stop until it reports again.
