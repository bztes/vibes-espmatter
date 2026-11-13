# espmatter studio

Configure, build and flash ESP32 firmware for Matter hubs and devices from the browser.

## Run

```sh
pnpm install
pnpm dev                     # http://localhost:5173
```

Or with Docker: `docker compose up -d --build` (http://localhost:3000).

The first account you create is the admin. Under **Admin**, set the public URL that devices use to reach the app.

### Build runners

Firmware is compiled by runners ([runner/](runner/)): the stock `espressif/idf` image running a small Python script that is mounted in. An admin adds a runner under **Admin → Build runners** and gets its token, shown once; deleting the runner revokes it. The runner only makes outgoing calls, so it may sit behind NAT: it long-polls the app for builds, posts the log and uploads the images.

Start the runner with its own compose file, on the app host or another machine:

```sh
cd runner
cp .env.example .env   # fill in every field
docker compose up -d
```

---

Vibe coded.
