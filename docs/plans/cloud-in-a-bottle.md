# Cloud in a Bottle deployment

Base: upstream `52a19f0c`, fork `pocketIlmatto/kept`, local branch `cloud-in-a-bottle`.

Cloud in a Bottle builds one Dockerfile, exposes one HTTP port, and supplies a persistent
directory through `BOTTLE_APP_DATA_DIR`. Kept requires PostgreSQL with pgvector. Its Home
Assistant image already builds both from this checkout; reuse those build stages without
enabling Home Assistant ingress or depending on its Supervisor.

1. Add the Bottle manifest, a generated Dockerfile that reuses upstream's Home Assistant
   build stages, and a standalone startup script. Derive the public URL from Bottle's
   environment, persist the database/files/keys, bootstrap and migrate before serving,
   retain separate database roles, and supervise both processes. Keep Bottle's owner-only
   routing and Kept's own login/setup. Add focused configuration tests and run checks before
   committing this step.
2. Add and run a container smoke test for first boot, database readiness, persistent state
   across container recreation, and graceful shutdown. Document local development, platform
   deployment, setup, backups, and upstream synchronization. Verify the generated Dockerfile
   and commit the completed work. Report any checks the environment prevents running.

The generated Dockerfile is checked in because Bottle cannot select a Docker build target.
Its generator/check mode prevents silent drift from the upstream Dockerfile. Source changes
in this checkout are compiled into the image; it does not wrap a published application image.

Deployment to a live instance is outside this initial local preparation. The fork exists on
GitHub; implementation commits stay local until requested to push or deploy.

References:
- https://cloudinabottle.org/docs/creating_an_app/overview.html
- https://cloudinabottle.org/docs/creating_an_app/manifest_spec.html
- https://cloudinabottle.org/docs/how_it_works/routing.html

## Completion

Both steps are complete. The Docker image built on linux/arm64, and the disposable smoke
test passed with a 1 GiB memory limit and one CPU: setup, login, database extensions and
credential isolation, unchanged keys/files after container recreation, graceful shutdown,
and a nonzero container exit when PostgreSQL stops unexpectedly.

The smoke test caught and resolved two startup issues: the inherited image's `/data`
permissions blocked Bottle's nested mount, and runtime database URLs had to be omitted
from the bootstrap invocation until it had created the password files.

Five configuration tests passed under Node 24 and the local Node 26. Pinned Biome checks,
shell syntax, TOML parsing, generated-Dockerfile consistency and repository checks passed.
The original Dockerfile and application source remain unchanged. Rootless Podman and a
live Bottle instance have not been exercised; deployment is the next validation step.

## Live Bottle build follow-up

The user authorized deployment to Bottle. Its 18.3 GiB VM exhausted disk even with
8.1 GiB free after cache cleanup: compilation triggered a second pnpm install and
saved the default package store into an image layer.

3. Keep pnpm's store/cache settings and cache mounts consistent during compilation,
   and include the docs workspace manifest in the initial dependency install so
   copying sources does not change workspace membership. Check generation and build
   the image before committing the packaging fix.
4. Push the fix and retry Bottle deployment; verify startup or report the remaining
   concrete platform constraint. Do not delete app data or resize the VM.

Step 3 complete: the generated Bottle stages now include the docs manifest and use
consistent mounted pnpm stores during compilation. The linux/arm64 image build
passed without a second install during compilation. Generator consistency, diff
checks, pinned Biome, and the full disposable lifecycle smoke check passed.

Step 4 attempted: pushed f475be1f and used Bottle's Update & Reload. The live build
passed compilation without reinstalling dependencies, but exhausted the VM disk
later while copying dependency files into the ha-notices stage. Kept is not yet
running in Bottle. The next deployment needs more build disk headroom or a build
outside the VM; no app data was deleted and the VM was not resized.

## Deployment resolved

The local QEMU VM's disk was grown from 20 GiB to 50 GiB (`qemu-img resize`, then
cloud-init grew the root filesystem on boot) and its memory raised to 8 GiB. The
unchanged build then completed with 33 GiB still free, and Kept passed `/readyz`.

The app then showed "This isn't here any more" on every screen. On a plain-HTTP
Bottle domain, browsers send no Fetch Metadata, so Bottle's router accepts the owner
cookie on a same-origin GET only when its `Referer` is the app's own origin, and
answers 404 otherwise. Kept's global `Referrer-Policy: no-referrer` stripped that
header from every API GET. Kept now reads `KEPT_REFERRER_POLICY`
(`no-referrer` by default, unchanged upstream behaviour) and the Bottle package sets
`same-origin`, which still sends nothing to other origins.
