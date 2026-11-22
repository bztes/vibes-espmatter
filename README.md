# espmatter studio

Configure, build and flash ESP32 firmware for Matter hubs and devices from the browser.

## Setup

Create a `docker-compose.yaml`:

```yaml
services:
  app:
    image: ghcr.io/bztes/vibes-espmatter:latest
    ports: ['3000:3000']
    environment:
      DATA_DIR: /data
    volumes:
      - ./data:/data
    restart: unless-stopped
```

Start it with `docker compose up -d` and open http://localhost:3000.

The first account you create is the admin. Under **Admin**, set the public URL that devices use to reach the app.

### Build runners

Firmware is compiled by runners ([runner/](runner/)). A runner only makes outgoing calls, so it may sit behind NAT. Add one under **Admin → Build runners** to get its token, then on the app host or another machine:

```sh
cd runner
cp .env.example .env   # fill in every field
docker compose up -d
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

Vibe coded.
