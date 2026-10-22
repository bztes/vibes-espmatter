# vibes-espmatter

Configure, build and flash Matter firmware for ESP32 in the browser. Vibecoded, so mostly unreviewed.

```sh
cp .env.example .env   # set BETTER_AUTH_SECRET
docker compose up -d --build                        # prod, :3000
docker compose -f docker-compose.dev.yaml up --build  # dev, :5173 (set ORIGIN)
```
