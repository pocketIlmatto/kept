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
