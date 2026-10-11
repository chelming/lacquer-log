# Lacquer Log

Nail polish collection tracker. Runs as a single Docker container with a SQLite database and a local photos folder.

## Quick start

A GitHub Action builds and pushes `ghcr.io/chelming/lacquer-log` on every push to
`main` (tags: `latest` and `sha-<commit>`). To run it:

```bash
cp .env.example .env     # adjust as needed
docker compose up -d
```

Open http://your-server-ip:3377

If the package is private, `docker login ghcr.io` first (or make the package
public in the repo's Packages settings).

### docker-compose.yml

```yaml
services:
  lacquer-log:
    image: ghcr.io/chelming/lacquer-log:${TAG:-latest}
    container_name: lacquer-log
    restart: unless-stopped
    ports:
      - "${HOST_PORT:-3377}:${PORT:-3377}"
    volumes:
      - ${DATA_PATH:-./data}:${DATA_DIR:-/app/data}
      - ${PHOTOS_PATH:-./photos}:${PHOTOS_DIR:-/app/photos}
    environment:
      - PORT=${PORT:-3377}
      - DATA_DIR=${DATA_DIR:-/app/data}
      - PHOTOS_DIR=${PHOTOS_DIR:-/app/photos}
```

### Environment variables

Set these in `.env` next to the compose file (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `TAG` | `latest` | Image tag to run |
| `PORT` | `3377` | Port the app listens on inside the container |
| `HOST_PORT` | `3377` | Port published on the host |
| `DATA_PATH` | `./data` | Host folder for the SQLite DB (`lacquer.db`) |
| `PHOTOS_PATH` | `./photos` | Host folder for photos |
| `DATA_DIR` | `/app/data` | DB path inside the container |
| `PHOTOS_DIR` | `/app/photos` | Photos path inside the container |

Example `.env`:

```ini
# Image tag to run (latest, or a sha-<commit> tag)
TAG=latest
# Port the app listens on inside the container, and the port published on the host
PORT=3377
HOST_PORT=3377
# Host folders for the SQLite DB and photos (back these up)
DATA_PATH=./data
PHOTOS_PATH=./photos
# Paths inside the container (rarely needs changing)
DATA_DIR=/app/data
PHOTOS_DIR=/app/photos
```

## Data

`DATA_PATH` and `PHOTOS_PATH` are your entire dataset. Back them up.

## Traefik

Drop the `ports` block and add labels and a network to the service, e.g.:

```yaml
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.lacquer-log.rule=Host(`${LACQUER_HOST}`)"
      - "traefik.http.routers.lacquer-log.entrypoints=websecure"
      - "traefik.http.routers.lacquer-log.tls.certresolver=letsencrypt"
      - "traefik.http.services.lacquer-log.loadbalancer.server.port=${PORT:-3377}"
    networks: [traefik_proxy]
```

Declare `traefik_proxy` as an external network at the bottom of the file.

## Importing from the HTML file version

Export your collection from the old HTML file (↓ Export button), then use the
↑ Import button in this app. Base64 photos from the HTML version are automatically
converted to real files on import.

## Updating

```bash
docker compose pull && docker compose up -d
```

To build locally instead of pulling, replace `image:` with `build: .`.

## License

[GNU AGPL v3](LICENSE). Free to use, modify and share. If you distribute a modified version,
or run one as a network service, you must make your source available under the same license.
