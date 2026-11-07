# Docker setup and updates for the Science Centre forks

This deployment builds **both forks into one image**. Node runs the server, which
serves the custom production client and API on port 4000. No Vite development
server, separate frontend container, host Node installation, or upstream image
is required. The upstream Dockerfile and Compose file are unchanged.

## Prerequisites and checkout

Install Git and Docker with Linux containers: Docker Desktop on Windows/macOS,
or Docker Engine on Linux. Use Docker Compose **2.17 or newer** with BuildKit
support for additional build contexts. Docker Desktop/Engine must be running.
The Docker host must reach your printer controllers and external directory API.

Clone the forks into sibling folders (the names matter for the build context):

```sh
git clone --branch main https://github.com/sciencecentredelft/fdm-monster.git
git clone --branch main https://github.com/sciencecentredelft/fdm-monster-client-next.git
cd fdm-monster
docker version
docker compose version
docker compose -f docker-compose.fork.yml config --quiet
docker compose -f docker-compose.fork.yml build
docker compose -f docker-compose.fork.yml up -d
docker compose -f docker-compose.fork.yml ps
docker compose -f docker-compose.fork.yml logs --tail=100 fdm-monster
```

Stop if a command fails. Run every Compose command from the server checkout with
`-f docker-compose.fork.yml`; do not accidentally launch the upstream Compose file.
On Windows these commands work in PowerShell. No host npm installation is needed.
Builds use the repositories' pinned Yarn executable and immutable lockfiles inside
Linux containers. Record the image and Git revisions for each deployment.

Open **http://localhost:4000**, complete setup, and create your own administrator
with a strong password. Never import the laptop simulator database or test accounts.
The application runs as the container's non-root `node` user.

## Network access

By default port 4000 is exposed only on the host loopback address. For trusted LAN
access, set the host bind address before `up -d`:

PowerShell:

```powershell
$env:FDM_BIND_ADDRESS = "0.0.0.0"
docker compose -f docker-compose.fork.yml up -d
```

Bash:

```sh
FDM_BIND_ADDRESS=0.0.0.0 docker compose -f docker-compose.fork.yml up -d
```

You can instead bind a specific host LAN IP. Set `FDM_PORT` to change the host
port if 4000 is occupied. Preserve these values in your deployment environment
for future updates. A local ignored `.env` in the server checkout may contain
`FDM_BIND_ADDRESS=...` and `FDM_PORT=...`; it is for Compose substitution and is
not copied into this image.

Browse to `http://<Docker-host-LAN-IP>:4000` from other computers. Restrict firewall
access to the trusted subnet. Do not forward the port to the public internet.
Use an HTTPS reverse proxy/VPN where transport protection is needed; plain HTTP
does not encrypt passwords or API credentials in browser requests.

Use printer controller **LAN addresses**, not `localhost` (which means the
container itself). Prefer stable IPs or DNS; broadcast/mDNS discovery does not
necessarily cross Docker networks. Docker Desktop users must keep the host awake,
Docker running, and verify startup after reboot. `restart: always` restarts an
exited container and starts it again when Docker restarts, even if it was manually
stopped before the engine restart. A manual stop suppresses restarts until Docker
or the container is started again. Health status alone does not restart a frozen
process. For maintenance across engine restarts, use Compose `down` without `-v`;
this removes the container but preserves the farm volumes.

## Persistent data and custom-client protection

The Compose project `science-centre-fdm` creates:

- `science-centre-fdm_farm-database`: SQLite, accounts, printer configuration and
  directory credentials.
- `science-centre-fdm_farm-media`: files, thumbnails, logs and deployed client.

Container replacement does not remove these volumes. **Never run `down -v`,
volume prune, or delete the volumes on a real farm unless intentionally deleting
its data.** Keep the project name fixed or you will appear to have a new empty farm.
Treat backups and database access as sensitive.

The entrypoint copies the image's custom client and package metadata into the
media volume on each start, so image updates also update the frontend. It checks
the server's minimum client version before starting; it fails rather than silently
using an incompatible version. The normal server startup updater currently does
not correctly read `ENABLE_CLIENT_DIST_AUTO_UPDATE=false`, so the flag alone is
not sufficient. The matching deployed metadata/version prevents its normal
replacement download. Do not use upstream client-update controls inside this fork.

Migrations run automatically at startup. QoL features are disabled unless
configured. Test one real printer first: connection/status, file browsing,
assignment and history, then a supervised known-safe job before batch operations.

For the directory example, configure `results`, `count`, `page_number`, `page_size`,
and enable numbered pagination. Combined names use `first_name` and `last_name`;
email uses `email`. Configure your real API authentication/scopes in QoL settings,
not Dockerfile/client env values. Test the API before disabling manual names.
Users are cached in memory for 24 hours and refreshed on demand; restarting empties
the cache. Settings provide an immediate refresh button. Grid passwords remain
convenience locks, not API access restrictions.

## Backups

Schedule downtime with no uploads, pending queue starts or active managed jobs.
Stop the server **before** copying SQLite, and keep it stopped for both archives:

```sh
docker compose -f docker-compose.fork.yml stop
docker compose -f docker-compose.fork.yml run --rm --no-deps --user root --entrypoint sh fdm-monster -c "tar -czf /tmp/database-backup.tar.gz -C /app/database . && tar --exclude=./backups -czf /tmp/media-backup.tar.gz -C /app/media . && mkdir -p /app/media/backups && cp /tmp/database-backup.tar.gz /tmp/media-backup.tar.gz /app/media/backups/"
```

Copy the archives out of the volume to a host backup directory before updating.
These commands use a temporary container, not the application entrypoint:

```sh
docker create --name science-centre-fdm-backup --mount source=science-centre-fdm_farm-media,target=/backup,readonly science-centre-fdm:local
docker cp science-centre-fdm-backup:/backup/backups/database-backup.tar.gz ./database-backup.tar.gz
docker cp science-centre-fdm-backup:/backup/backups/media-backup.tar.gz ./media-backup.tar.gz
docker rm science-centre-fdm-backup
git rev-parse HEAD
git -C ../fdm-monster-client-next rev-parse HEAD
docker image inspect science-centre-fdm:local --format "{{.Id}}"
```

Move the host archives to a dated, protected backup directory on another device;
record both Git revisions and the image ID. Archive names above are overwritten
on the next backup. The media archive excludes its `backups` directory to avoid
recursive backup growth. A YAML printer export is not a complete database/media backup.

## Updating both forks

Back up as above, and retain the old image for rollback:

```sh
docker tag science-centre-fdm:local science-centre-fdm:previous
git status --short
git -C ../fdm-monster-client-next status --short
```

If either checkout has local changes, preserve them before continuing. Then:

```sh
git pull --ff-only origin main
git -C ../fdm-monster-client-next pull --ff-only origin main
docker compose -f docker-compose.fork.yml build
docker compose -f docker-compose.fork.yml up -d
docker compose -f docker-compose.fork.yml ps
docker compose -f docker-compose.fork.yml logs --tail=100 fdm-monster
```

Stop on any failed pull/build; do not start a partially updated deployment.
Use `build --pull` when deliberately refreshing the Node base image, then retest.
Check migration logs, hard-refresh browsers, verify login, printer status and
directory selection, and record the new revisions. The image embeds both forks;
pulling Git without rebuilding/recreating the container does not deploy changes.

## Rollback and recovery

Stop the application first and retain failed-deployment data for investigation.
Restore database **and** media backups into empty replacement volumes; do not
overlay an older SQLite backup onto existing WAL/journal files. From the server
checkout, with the two verified pre-update archives in the current directory:

```sh
docker compose -f docker-compose.fork.yml stop
docker volume create science-centre-fdm-restored-database
docker volume create science-centre-fdm-restored-media
docker create --name science-centre-fdm-restore --user root --entrypoint sh --mount source=science-centre-fdm-restored-database,target=/restore/database --mount source=science-centre-fdm-restored-media,target=/restore/media science-centre-fdm:previous -c 'test -z "$(ls -A /restore/database)" && test -z "$(ls -A /restore/media)" && tar -xzf /tmp/database-backup.tar.gz -C /restore/database && tar -xzf /tmp/media-backup.tar.gz -C /restore/media && chown -R 1000:1000 /restore/database /restore/media'
docker cp ./database-backup.tar.gz science-centre-fdm-restore:/tmp/database-backup.tar.gz
docker cp ./media-backup.tar.gz science-centre-fdm-restore:/tmp/media-backup.tar.gz
docker start -a science-centre-fdm-restore
docker inspect science-centre-fdm-restore --format "{{.State.ExitCode}}"
docker rm science-centre-fdm-restore
```

Keep the single quotes around the restore command in PowerShell or Bash so it
is evaluated inside the container. Stop if any command fails or the restore exit
code is not `0`. Use new
volume names if these restore volumes already contain data; do not delete the
original farm volumes.

Create a local, uncommitted `docker-compose.restore.yml`:

```yaml
services:
  fdm-monster:
    image: science-centre-fdm:previous
    volumes:
      - restored-database:/app/database
      - restored-media:/app/media
volumes:
  restored-database:
    external: true
    name: science-centre-fdm-restored-database
  restored-media:
    external: true
    name: science-centre-fdm-restored-media
```

```sh
docker compose -f docker-compose.fork.yml -f docker-compose.restore.yml up -d --no-build
docker compose -f docker-compose.fork.yml -f docker-compose.restore.yml ps
docker compose -f docker-compose.fork.yml -f docker-compose.restore.yml logs --tail=100 fdm-monster
```

Keep using both Compose files while running on the restored volumes. Alternatively
rebuild matching clean checkouts at the recorded revisions. Do not run an older
server against a newly migrated database without confirming compatibility.
Backup restoration loses later changes.

## Troubleshooting

- **Build cannot find client-source:** keep both checkouts as siblings and use a
  Compose version supporting `additional_contexts`.
- **Port unavailable:** stop only the known conflicting instance or change
  `FDM_PORT`; do not stop every Node/Docker process.
- **Permission denied on volumes:** the image uses UID 1000. Existing imported
  volumes/bind mounts must be writable by that user. Do not make all files
  world-writable; repair only the known farm volume ownership.
- **404 for user-directory routes:** deploy matching server/client revisions and
  recreate the container; refreshing the browser cannot update backend code.
- **UI changes missing:** hard-refresh and inspect startup/client-copy errors.
  Do not replace the fork bundle through upstream update controls.
- **Directory errors:** check logs, URL reachability, scopes and response paths.
  Each lookup is limited to 30 seconds, 100 pages and 10,000 users; partial results
  are not silently returned.
  After deploying the logging changes, run
  `docker compose -f docker-compose.fork.yml logs --since=5m -f fdm-monster`,
  then use **Save**, followed by **Test connection** in the directory settings.
  `UserDirectoryService` warnings distinguish `oauth-token` from `users`
  requests, with method, endpoint origin, status, elapsed milliseconds, auth mode,
  credential placement, whether scopes are configured, and the failing user page.
  Redirect diagnostics include only the destination origin and whether it matches
  the request origin; use the API's canonical URL because redirects are not followed.
  Lookup warnings also explain missing token fields, invalid user mapping, or
  inconsistent pagination. Successful/cached lookups do not emit warnings.
  These logs omit URL paths/query strings, credentials, token values, bodies and
  user records. Endpoint hostnames are still operational information: redact them
  as appropriate before sharing. Rebuild/recreate the container to deploy changes;
  refreshing the browser alone cannot update backend logging.
- **Logs:** `docker compose -f docker-compose.fork.yml logs`; persistent file logs
  are in the media volume. Logs may contain sensitive operational details.
  Failed API responses (HTTP 400-599) produce a `HttpRequest` warning with caller
  IP, method, path without query parameters, and status. This also covers missing
  endpoints such as `/api/v1/printer`. Request bodies and credentials are not
  included in these warnings. Docker NAT or a reverse proxy may cause the IP to
  identify a gateway/proxy instead of the original computer. Forwarded headers
  are not trusted by default; use proxy access logs to trace callers behind a
  proxy rather than enabling unrestricted proxy trust. Treat IP addresses as
  sensitive when sharing logs.
