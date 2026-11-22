# vibes-espmatter

## 0.5.1

### Patch Changes

- [`e2a569e`](https://github.com/bztes/vibes-espmatter/commit/e2a569ecee8808b73472fbd2eaa97ebf88f10181) Thanks [@bztes](https://github.com/bztes)! - Buttons, fields, selects and segmented controls share the same heights.

- [`8bd0613`](https://github.com/bztes/vibes-espmatter/commit/8bd061339be1835d1381a6c6f682a0412dc86595) Thanks [@bztes](https://github.com/bztes)! - Fix the arm64 docker build running on the target platform.

- [`839e282`](https://github.com/bztes/vibes-espmatter/commit/839e28294b390ccbb16cdbd1781a270c092e077b) Thanks [@bztes](https://github.com/bztes)! - The history card's header shows the device, value and time range, with the controls as icons.

- [`02c3558`](https://github.com/bztes/vibes-espmatter/commit/02c35588d2f0b6ca91c35a21ffbb155498ee86b1) Thanks [@bztes](https://github.com/bztes)! - History remembers the picked value per device.

- [`8867199`](https://github.com/bztes/vibes-espmatter/commit/8867199914b78d80dc68ddc85318e96bbe040b0f) Thanks [@bztes](https://github.com/bztes)! - README setup uses the Docker image, development moved to CONTRIBUTING.

- [`4fb0a89`](https://github.com/bztes/vibes-espmatter/commit/4fb0a897566b79f4622d769fe7cd62cf6dac7e41) Thanks [@bztes](https://github.com/bztes)! - Docker image is published to GHCR.

- [`3c12abc`](https://github.com/bztes/vibes-espmatter/commit/3c12abcb8c96774289a8d2073fbe8e899bb0f20e) Thanks [@bztes](https://github.com/bztes)! - Scenes show as cards on the dashboard and are managed on the automations page.

## 0.5.0

### Minor Changes

- [`dedaa7d`](https://github.com/bztes/vibes-espmatter/commit/dedaa7d19e9f463ccfe5d927d7838fcd2f1c59fe) Thanks [@bztes](https://github.com/bztes)! - The hub exports paired devices’ battery to OpenTelemetry and history.

- [`090e45f`](https://github.com/bztes/vibes-espmatter/commit/090e45f018ed44c4b079cce53f2b7c48a5749774) Thanks [@bztes](https://github.com/bztes)! - Firmware builds can be deleted.

- [`2192204`](https://github.com/bztes/vibes-espmatter/commit/21922043475d0ad8a3b02a9c105f02baacb16366) Thanks [@bztes](https://github.com/bztes)! - Link devices to each other from the hub, so they talk directly.

- [`c13437c`](https://github.com/bztes/vibes-espmatter/commit/c13437c38fc0561c92f97900f8bd62c49a03d46a) Thanks [@bztes](https://github.com/bztes)! - The history chart takes presets like today, steps back and forth, custom ranges and zooming by dragging.

- [`d544351`](https://github.com/bztes/vibes-espmatter/commit/d5443513b009f95a5d0bcf21bc4d3d3ec75fa455) Thanks [@bztes](https://github.com/bztes)! - History shows fitting stats and charts for counters and states, and counters are exported as OpenTelemetry sums.

- [`c13437c`](https://github.com/bztes/vibes-espmatter/commit/c13437c38fc0561c92f97900f8bd62c49a03d46a) Thanks [@bztes](https://github.com/bztes)! - Widgets can show a popover next to an element, placed on the side with room.

### Patch Changes

- [`45f43cf`](https://github.com/bztes/vibes-espmatter/commit/45f43cfbe94e980d4c68a2cc9e7793499a922042) Thanks [@bztes](https://github.com/bztes)! - Publish the docker image for arm64 too and build it like the other vibes projects

## 0.4.0

### Minor Changes

- [`1a96229`](https://github.com/bztes/vibes-espmatter/commit/1a96229cced35b03ccc613ff1ba18da1cfbb6916) Thanks [@bztes](https://github.com/bztes)! - The app link of hubs and devices is part of every firmware, set in one place and shown as a diagram.

- [`77d9865`](https://github.com/bztes/vibes-espmatter/commit/77d98658e6ecd13f72de873e275a2707a0ee1236) Thanks [@bztes](https://github.com/bztes)! - Firmware settings list the boards last, only those that run the chosen features and peripherals.

- [`208d20b`](https://github.com/bztes/vibes-espmatter/commit/208d20b630f1c75776dac16e18a2a7e4a0d7570a) Thanks [@bztes](https://github.com/bztes)! - The settings stored on the board have their own Device settings tab; the rest is under General.

- [`f9aab9c`](https://github.com/bztes/vibes-espmatter/commit/f9aab9ca9ed58e1e09bcee96d78848f3f18a9a9a) Thanks [@bztes](https://github.com/bztes)! - Firmware settings and device settings are separate: per-device values are set only on each device.

- [`d167bf7`](https://github.com/bztes/vibes-espmatter/commit/d167bf7ada32e5eb365874ca5b55b8cb2591ec8f) Thanks [@bztes](https://github.com/bztes)! - Firmware and devices share one page: each firmware lists its devices.

- [`f85699f`](https://github.com/bztes/vibes-espmatter/commit/f85699f9bcb85c2c3a69ad6b93160b993a6240d9) Thanks [@bztes](https://github.com/bztes)! - The app reaches Thread devices through their hub, e.g. to start an update check right away.

- [`208d20b`](https://github.com/bztes/vibes-espmatter/commit/208d20b630f1c75776dac16e18a2a7e4a0d7570a) Thanks [@bztes](https://github.com/bztes)! - Device settings live on the board only and are read and written there, over the air or over USB in any mix.

### Patch Changes

- [`208d20b`](https://github.com/bztes/vibes-espmatter/commit/208d20b630f1c75776dac16e18a2a7e4a0d7570a) Thanks [@bztes](https://github.com/bztes)! - Device subdomains use the public URL and are entered as a subdomain.

## 0.3.0

### Minor Changes

- [`00291f1`](https://github.com/bztes/vibes-espmatter/commit/00291f1ebdc7132f2dcb830f97043aed26df5e3d) Thanks [@bztes](https://github.com/bztes)! - The project is rebuilt as ESPMatter Studio: firmwares are built once and set up per device, devices update over the air from the app.

- [`70904b6`](https://github.com/bztes/vibes-espmatter/commit/70904b62901e18487315725e997baa67d7fe46d7) Thanks [@bztes](https://github.com/bztes)! - New History feature: charts that show how values such as temperature changed over time, for the Matter hub and its connected devices.

- [`d839239`](https://github.com/bztes/vibes-espmatter/commit/d839239e45735aad2db51437bd350dc060457ad2) Thanks [@bztes](https://github.com/bztes)! - Firmware is built by runners that connect to the app with a token and may run on any machine, even behind NAT. The app no longer needs the Docker socket; existing runners must be added again.

- [`d968b0c`](https://github.com/bztes/vibes-espmatter/commit/d968b0c9a294619d3c11853473c3ab9a2fb996a3) Thanks [@bztes](https://github.com/bztes)! - Scenes can only be activated, and show as active while their devices are as the scene sets them. Deactivating ("back to before") is removed.

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
