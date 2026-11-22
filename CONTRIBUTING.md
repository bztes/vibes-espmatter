# Contributing

## Development

```sh
pnpm install
pnpm dev        # http://localhost:5173
```

To build and run the image locally: `docker compose up -d --build` (http://localhost:3000).

Point a runner's `APP_URL` at the dev server to build firmware, see [runner/](runner/).

## Checks

```sh
pnpm check
pnpm lint
pnpm test
```

## Changesets

Every change gets a changeset with one short sentence:

```sh
pnpm changeset
```

Merging the release PR tags the version and publishes the Docker image to GHCR.
