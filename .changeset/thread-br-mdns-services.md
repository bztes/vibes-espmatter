---
'vibes-espmatter': patch
---

Fix commissioning of Thread devices failing with `CHIP_ERROR_TIMEOUT` at `FindOperationalForStayActive` once a few Thread nodes are paired: the Thread border router now has room for 64 mDNS services (was 10), so every node's SRP registration is published.
