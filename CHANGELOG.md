# vibes-espmatter

## 0.3.0

### Minor Changes

- [`3ee0120`](https://github.com/bztes/vibes-espmatter/commit/3ee0120b7e418116be4f429d8af3604f5a9f5269) Thanks [@bztes](https://github.com/bztes)! - Features only build their web interface and API parts when the HTTP server is part of the board. Pairing Thread devices moves out of the Matter controller into the new feature Matter controller Thread, and the Matter device values over OpenTelemetry into the new feature OpenTelemetry metrics. The dependency graph also shows the features a feature works with when they are on the same board. After upgrading, a saved project that had OpenTelemetry now has OpenTelemetry metrics instead: add OpenTelemetry again and set it up. Projects that pair Thread devices also need Matter controller Thread.

- [`3042153`](https://github.com/bztes/vibes-espmatter/commit/3042153fe420d4bc268f4ec3bfa95e138b42fbbd) Thanks [@bztes](https://github.com/bztes)! - The device API calls switchable Matter devices endpoints instead of lights, since they also cover plugs. The access API takes `control` and `view`, and scenes take `endpoints`, but the old `lights` parameter still works. `GET /api/scenes` now returns `endpoints` and `maxEndpoints`.

- [`d7889c3`](https://github.com/bztes/vibes-espmatter/commit/d7889c3e0ee264f8db163989ef7ac807c731cc63) Thanks [@bztes](https://github.com/bztes)! - An admin can now give a user view-only access to a Matter light or plug. The user sees its state on the dashboard, but its controls are disabled and timers and scenes leave it out. Existing access entries keep full control.

### Patch Changes

- [`0a07269`](https://github.com/bztes/vibes-espmatter/commit/0a0726912e5c3a39d35c11d0d14995d1681cae3b) Thanks [@bztes](https://github.com/bztes)! - The project is now licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later).

- [`8f79ec6`](https://github.com/bztes/vibes-espmatter/commit/8f79ec65a69c13f4a1268e5c44d4ff5e5eb7bc2b) Thanks [@bztes](https://github.com/bztes)! - Add a developer view of the device web interface at `/dev/ui`, served only by the dev server. It shows each feature's panels one at a time with mocked device API answers and a logged-in user. Features list them in `features/<name>/stories.ts`.

- [`8d5e3ec`](https://github.com/bztes/vibes-espmatter/commit/8d5e3ecfed8005bb57de96cb56d3869c3bb566da) Thanks [@bztes](https://github.com/bztes)! - Dropdown menus open upwards when there isn't enough room below their button.

- [`3638e7f`](https://github.com/bztes/vibes-espmatter/commit/3638e7fa1f82a38d6d64969f0e9e1cb2e281c6e1) Thanks [@bztes](https://github.com/bztes)! - OpenTelemetry no longer sends the last values of Matter devices that are offline: when a device's subscription loses it, its metrics stop until it reports again.

- [`4b487c3`](https://github.com/bztes/vibes-espmatter/commit/4b487c3cc87d9841b2fc89408ba4573bc54fefef) Thanks [@bztes](https://github.com/bztes)! - OpenTelemetry now sends all values the Matter controller knows of its devices: besides on/off, temperature, humidity and battery also the power draw (`matter.power`) and energy total (`matter.energy.imported`, a counter) of plugs, brightness and color temperature of lights and the battery charge level (`matter.battery.level`). They are subscribed, so they stay current; each device is only asked for what its device types have.

- [`fffa2ed`](https://github.com/bztes/vibes-espmatter/commit/fffa2ed47a01cb4b5b4165f56b9e0a9b54a46bd0) Thanks [@bztes](https://github.com/bztes)! - OpenTelemetry keeps only the metrics that exist instead of a fixed table of 128: up to 512 with PSRAM (where they are kept then), 192 without.

## 0.2.1

### Patch Changes

- [`d925baf`](https://github.com/bztes/vibes-espmatter/commit/d925baf38b9f7956284ec083ecbf0f93d781df38) Thanks [@bztes](https://github.com/bztes)! - The page menu of the device web interface is now ordered by path, so the dashboard comes before Setup.

- [`1346bab`](https://github.com/bztes/vibes-espmatter/commit/1346bab43f1be2b35a0fd8ff8074575c04ccb3d3) Thanks [@bztes](https://github.com/bztes)! - The device web interface no longer shows the page tabs in its header: the pages (Dashboard, Setup) are now in the user menu.

- [`086a314`](https://github.com/bztes/vibes-espmatter/commit/086a314df58658e02922b98c6b5e381ea66f1dac) Thanks [@bztes](https://github.com/bztes)! - Renaming a Matter device now drops spaces at the start and end of the new name.

- [`0eb68f8`](https://github.com/bztes/vibes-espmatter/commit/0eb68f811b351e9776849bd09a65ee6a47ce793a) Thanks [@bztes](https://github.com/bztes)! - Fix commissioning of Thread devices failing with `CHIP_ERROR_TIMEOUT` at `FindOperationalForStayActive` once a few Thread nodes are paired: the Thread border router now has room for 64 mDNS services (was 10), so every node's SRP registration is published.

## 0.2.0

### Minor Changes

- [`4e20be5`](https://github.com/bztes/vibes-espmatter/commit/4e20be52eb57f47f4d3a6e45140e8e98f2316d0e) Thanks [@bztes](https://github.com/bztes)! - The first account to sign up becomes the admin, who can now reopen sign-up for more accounts on the admin page.

- [`4e20be5`](https://github.com/bztes/vibes-espmatter/commit/4e20be52eb57f47f4d3a6e45140e8e98f2316d0e) Thanks [@bztes](https://github.com/bztes)! - Run ESP-IDF in its own `idf` compose service (the official `espressif/idf` image running `idf-worker.py`) instead of bundling it in the app image, which is now a small Node image. Build workers are set up by the admin on the new admin page (`/admin`) instead of with `IDF_PATH`, `IDF_PYTHON` and `MAX_WORKSPACES`: add several workers (`idf-worker.py` URLs or local ESP-IDF checkouts) to build in parallel. Builds can't be started until a worker is enabled. After upgrading, add the `idf` service there as a worker (`http://idf:3001`).

### Patch Changes

- [`4e20be5`](https://github.com/bztes/vibes-espmatter/commit/4e20be52eb57f47f4d3a6e45140e8e98f2316d0e) Thanks [@bztes](https://github.com/bztes)! - Move sign-out (and the admin page link) into an account menu in the header, and tell the user when "Run build" reuses the existing build because the configuration is already built.

## 0.1.1

### Patch Changes

- [`5fbd22d`](https://github.com/bztes/vibes-espmatter/commit/5fbd22d20012e4343d201252632f1e783f590c70) Thanks [@bztes](https://github.com/bztes)! - Fix the Docker image release running out of disk space on the GitHub runner.

## 0.1.0

### Minor Changes

- [`e9c8899`](https://github.com/bztes/vibes-espmatter/commit/e9c8899d9bcb2333a7a8381d570edb4523b77930) Thanks [@bztes](https://github.com/bztes)! - Set up versioned releases with changesets, and show the app version in the footer.
