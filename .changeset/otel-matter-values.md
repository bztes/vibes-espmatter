---
'vibes-espmatter': patch
---

OpenTelemetry now sends all values the Matter controller knows of its devices: besides on/off, temperature, humidity and battery also the power draw (`matter.power`) and energy total (`matter.energy.imported`, a counter) of plugs, brightness and color temperature of lights and the battery charge level (`matter.battery.level`). They are subscribed, so they stay current; each device is only asked for what its device types have.
