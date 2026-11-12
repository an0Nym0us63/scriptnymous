# syntax=docker/dockerfile:1.7
# ScriptNymous : image unique (API + websocket + planificateur + interface compilée).
# Étapes : 1) build de l'interface, 2) build du serveur, 3) image finale Debian slim avec le socle d'outils.

# ---------- 1. Interface ----------
FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund --workspace web --include-workspace-root
COPY web/ web/
RUN npm run build -w web

# ---------- 2. Serveur ----------
FROM node:22-bookworm-slim AS server
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund --workspace server --include-workspace-root
COPY server/ server/
RUN npm run build -w server \
 && npm prune --omit=dev --workspace server --include-workspace-root

# ---------- 3. Image finale ----------
FROM node:22-bookworm-slim
LABEL org.opencontainers.image.title="ScriptNymous" \
      org.opencontainers.image.description="Déclarer, lancer, planifier et suivre ses scripts."

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    SN_PORT=8080 \
    SN_SCRIPTS_DIR=/scripts \
    SN_DATA_DIR=/data \
    SN_WEB_DIST=/app/web/dist \
    TZ=Europe/Paris \
    PATH=/data/bin:/root/.local/bin:$PATH

# Socle d'outils disponibles pour tous les scripts (les paquets propres à un script s'ajoutent à chaud via `deps.apt`).
# Outils multi-usages inclus d'office : ffmpeg (vidéos, vignettes), imagemagick, exiftool, sqlite3, 7zip/zip, mediainfo,
# rclone, smbclient et quelques outils réseau. Ils ne sont jamais proposés comme dépendances.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash coreutils procps ca-certificates tzdata curl wget jq git rsync openssh-client \
      python3 python3-venv python3-pip unzip zip xz-utils p7zip-full gosu sudo \
      ffmpeg imagemagick libimage-exiftool-perl sqlite3 mediainfo rclone smbclient dnsutils iputils-ping netcat-openbsd \
 && rm -rf /var/lib/apt/lists/*

# uv : création rapide des venv par script.
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin INSTALLER_NO_MODIFY_PATH=1 sh \
 && uv --version

WORKDIR /app
COPY --from=server /src/node_modules ./node_modules
COPY --from=server /src/server/dist ./server/dist
COPY --from=server /src/server/migrations ./server/migrations
COPY --from=server /src/server/package.json ./server/package.json
COPY --from=web /src/web/dist ./web/dist
COPY package.json ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# sed : tolère un fichier en CRLF si l'image est construite depuis un poste Windows.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /scripts /data

VOLUME ["/scripts", "/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8080/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "--no-warnings=ExperimentalWarning", "server/dist/index.js"]
