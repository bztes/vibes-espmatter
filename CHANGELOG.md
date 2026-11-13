# vibes-espmatter

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
