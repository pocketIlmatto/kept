# Kept on Cloud in a Bottle

This fork adds a standalone Bottle package. It compiles the local Kept source, includes
PostgreSQL 18 and pgvector, and runs on port 8080. No external database or Compose stack is
required. The manifest budgets 1 GiB for runtime and 4 GiB for the build; the host needs
room for those allocations in addition to Bottle and other apps.
The source build needs far more temporary disk than the ~1 GB finished image: a 20 GiB
VM with 8 GiB free failed, while 38 GiB free succeeded. On a local QEMU VM, stop it, run
`qemu-img resize <disk>.qcow2 +30G`, and boot; cloud-init grows the root filesystem.

The package sets `KEPT_REFERRER_POLICY=same-origin`. On plain-HTTP Bottle domains the router
needs a same-origin `Referer` to accept the owner cookie on API GETs; without it every
screen reports "This isn't here any more".

## Local development

The checkout has `origin` pointing to `pocketIlmatto/kept`, `upstream` pointing to
`keptinventory/kept`, and the implementation on `cloud-in-a-bottle`.

```sh
node scripts/bottle-dockerfile.mjs --check
node --test docker/bottle/env.test.mjs
docker build -f Dockerfile.bottle -t kept:bottle-dev .
bash scripts/smoke-bottle-image.sh kept:bottle-dev
```

The smoke test creates and removes its own container and volume. It exercises setup, sign-in,
database extensions and permissions, persistence across recreation, shutdown, and database
failure detection. To run against a rootless Podman engine, replace `docker build` with
`podman build` and prefix the smoke command with `CONTAINER_ENGINE=podman`.

For an interactive local instance:

```sh
docker volume create kept-bottle-dev-data
docker run -d --name kept-bottle-dev --stop-timeout 30 \
  -p 127.0.0.1:8080:8080 \
  -v kept-bottle-dev-data:/data/app_data/kept \
  -e BOTTLE_APP_DATA_DIR=/data/app_data/kept \
  -e KEPT_PUBLIC_URL=http://localhost:8080 \
  kept:bottle-dev
docker logs kept-bottle-dev
```

Open `http://localhost:8080`, enter the `KEPT SETUP CODE` from the logs, and create your
administrator account. Stop with `docker stop kept-bottle-dev`. After rebuilding, remove
the stopped container and repeat `docker run` with the same volume to keep the inventory.
The upstream development workflow in `CONTRIBUTING.md` remains available for live code edits.

## Deploy to Bottle

Push the implementation branch when ready:

```sh
git push -u origin cloud-in-a-bottle
```

In Bottle's dashboard, choose **Deploy New App** and use
`https://github.com/pocketIlmatto/kept.git@cloud-in-a-bottle`.
The `@ref` suffix selects the branch; the fork's `main` currently has no Bottle manifest.
With the Bottle CLI already installed and logged in, the equivalent is:

```sh
bottle app deploy https://github.com/pocketIlmatto/kept.git@cloud-in-a-bottle --wait
```

The platform reads `cloudinabottle.toml` and builds `Dockerfile.bottle`. Open the app after
its `/readyz` check succeeds. Its default URL is `https://kept.<your-zone-domain>`;
renaming the app changes the subdomain automatically. Local HTTP Bottle domains are
derived from `BOTTLE_ROUTER_PUBLIC_URL`, including its port. `KEPT_PUBLIC_URL` can override
the derived address for local testing.

Find the first-run setup code in the app's runtime logs and create your Kept administrator.
The first build can take several minutes; migration runs on each startup before HTTP is
ready. **Update and reload** rebuilds from the selected branch after subsequent pushes.

Bottle authentication protects every route (`public_paths = []`), then Kept presents its
own login. No single sign-on or trust of owner headers is added. Public shares, calendar
feeds and remote MCP clients also need Bottle authentication; they are not anonymously
accessible. Review routing deliberately before using these integrations with others.
Forwarded client IPs are not trusted by default, so requests share the proxy's rate-limit
identity. Set Kept's `KEPT_TRUSTED_PROXIES` only to the actual router address if needed.

## Persistent data and backups

All state lives below `BOTTLE_APP_DATA_DIR` (the path itself is supplied by Bottle):

| Directory | Contents |
| --- | --- |
| `postgres/` | PostgreSQL 18 cluster |
| `kept/` | Uploads and other local file storage |
| `config/` | Encryption keys, auth keys and runtime database passwords |
| `owner/` | Database owner password; unavailable to the serving app user |

The startup script runs as container root, maps to an unprivileged host identity under
Bottle's rootless Podman, and drops PostgreSQL and Kept to their own users. It does not
expose port 5432 or request extra host capabilities. The image declares no anonymous volumes.
Migrations briefly receive a readable copy of the owner credential, removed before serving.

**Stop Kept before taking a Bottle filesystem backup of this package**, and start it again
afterward. A live filesystem copy of `postgres/` is not a PostgreSQL-consistent backup.
This package does not implement a Bottle pre-backup hook or automatically coordinate with
scheduled platform backups. For scheduled online backups, use a PostgreSQL-aware backup
procedure and include the uploads and keys consistently. A standalone `pg_dump` alone
does not include Kept's uploaded files or encryption keys.

Restore a cold backup of the complete app directory with the app stopped, retaining all
four subdirectories. Startup repairs ownership and opens the existing cluster. It refuses
a nonempty database directory without `PG_VERSION` or a PostgreSQL major version other
than 18; it never deletes that directory to start fresh. Major PostgreSQL upgrades need
an explicit dump/restore or `pg_upgrade` procedure.

Keep the recovery kit outside the server. On the local container above:

```sh
docker exec kept-bottle-dev bash -c \
  '. /run/kept-bottle/env; kept admin recovery-kit'
```

This prints secrets; save them privately. On a Bottle host, the equivalent is a `podman exec`
against this app's container. Kept's CLI needs `/run/kept-bottle/env` because its runtime
configuration is derived by the entrypoint, not inherited by later `exec` commands.

## Keep up with upstream

```sh
git fetch upstream
git merge upstream/main
node scripts/bottle-dockerfile.mjs
node --test docker/bottle/env.test.mjs
node scripts/bottle-dockerfile.mjs --check
docker build -f Dockerfile.bottle -t kept:bottle-dev .
bash scripts/smoke-bottle-image.sh kept:bottle-dev
```

Commit the regenerated Dockerfile with any merge fixes. `Dockerfile.bottle` is generated
from the upstream Home Assistant build stages because Bottle selects a Dockerfile but
cannot select a build target. The Bottle entrypoint replaces the Home Assistant entrypoint;
it does not contact a Supervisor or enable Home Assistant ingress. Changes to the upstream
startup/bootstrap lifecycle should also be reviewed against `docker/bottle/start`.

For release builds, pass `--build-arg VERSION=<version>` to stamp the application version.
`SOURCE` and `REVISION` are upstream build arguments for source attribution; use a repository
URL for `SOURCE` and a published commit SHA for `REVISION` when setting both.

References: [app packaging](https://cloudinabottle.org/docs/creating_an_app/overview.html),
[manifest](https://cloudinabottle.org/docs/creating_an_app/manifest_spec.html),
[routing](https://cloudinabottle.org/docs/how_it_works/routing.html).
Branch URL syntax is covered by Bottle's
[repository URL tests](https://github.com/cloud-in-a-bottle/cloud-in-a-bottle/blob/main/compute_space/src/compute_space/tests/test_parse_repo_url.py).
