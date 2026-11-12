#!/usr/bin/env bash
# Point d'entrée du conteneur ScriptNymous :
#  1. crée l'utilisateur d'exécution (PUID/PGID facultatifs) et ajuste /data ;
#  2. installe l'union des paquets apt déclarés par les scripts (cache apt dans /data/apt-cache) ;
#  3. lance le service. Le service lui-même installe à chaud les paquets ajoutés plus tard.
set -euo pipefail

PUID="${PUID:-0}"
PGID="${PGID:-0}"
SCRIPTS_DIR="${SN_SCRIPTS_DIR:-/scripts}"
DATA_DIR="${SN_DATA_DIR:-/data}"
APT_CACHE="${DATA_DIR}/apt-cache"

mkdir -p "${DATA_DIR}" "${APT_CACHE}" "${DATA_DIR}/logs" "${DATA_DIR}/envs" "${DATA_DIR}/bin" "${DATA_DIR}/uploads"

# ---- 2. apt : union des paquets déclarés (lecture YAML minimaliste, sans dépendance) ----
collect_apt() {
  [ -d "${SCRIPTS_DIR}" ] || return 0
  for y in "${SCRIPTS_DIR}"/*/script.yaml; do
    [ -f "$y" ] || continue
    # Extrait les éléments de la liste `apt:` sous `deps:` (formes « - pkg » et « apt: [a, b] »).
    awk '
      /^deps:/ {indeps=1; next}
      indeps && /^[^[:space:]]/ {indeps=0}
      indeps && /^[[:space:]]+apt:[[:space:]]*\[/ {
        s=$0; sub(/.*\[/,"",s); sub(/\].*/,"",s); n=split(s,a,","); for(i=1;i<=n;i++){gsub(/[[:space:]"\047]/,"",a[i]); if(a[i]!="") print a[i]}; next }
      indeps && /^[[:space:]]+apt:[[:space:]]*$/ {inapt=1; next}
      indeps && inapt && /^[[:space:]]+-[[:space:]]*/ { s=$0; sub(/^[[:space:]]+-[[:space:]]*/,"",s); gsub(/["\047]/,"",s); if(s!="") print s; next }
      indeps && inapt && !/^[[:space:]]+-/ {inapt=0}
    ' "$y"
  done | sort -u
}

if command -v apt-get >/dev/null 2>&1; then
  PKGS="$(collect_apt | tr '\n' ' ')"
  if [ -n "${PKGS// /}" ]; then
    MISSING=""
    for p in ${PKGS}; do dpkg -s "$p" >/dev/null 2>&1 || MISSING="${MISSING} ${p}"; done
    if [ -n "${MISSING// /}" ]; then
      echo "[entrypoint] installation des paquets apt déclarés :${MISSING}"
      apt-get -o Dir::Cache::archives="${APT_CACHE}" update -qq || echo "[entrypoint] avertissement : apt-get update a échoué"
      apt-get -o Dir::Cache::archives="${APT_CACHE}" install -y -qq --no-install-recommends ${MISSING} \
        || echo "[entrypoint] avertissement : certains paquets n'ont pas pu être installés (le service réessaiera par script)"
    else
      echo "[entrypoint] paquets apt déjà présents : ${PKGS}"
    fi
  fi
fi

# ---- 1. identité d'exécution ----
if [ "${PUID}" != "0" ]; then
  if ! getent group "${PGID}" >/dev/null; then groupadd -g "${PGID}" scriptnymous; fi
  if ! getent passwd "${PUID}" >/dev/null; then useradd -u "${PUID}" -g "${PGID}" -M -d "${DATA_DIR}" -s /bin/bash scriptnymous; fi
  USER_NAME="$(getent passwd "${PUID}" | cut -d: -f1)"
  chown -R "${PUID}:${PGID}" "${DATA_DIR}" 2>/dev/null || true
  # L'installation apt à chaud (deps.apt ajouté plus tard) a besoin de root : sudo sans mot de passe, limité à apt-get et dpkg.
  echo "${USER_NAME} ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/bin/dpkg" > /etc/sudoers.d/scriptnymous
  chmod 0440 /etc/sudoers.d/scriptnymous
  echo "[entrypoint] démarrage en tant que ${USER_NAME} (${PUID}:${PGID})"
  exec gosu "${PUID}:${PGID}" "$@"
fi

exec "$@"
