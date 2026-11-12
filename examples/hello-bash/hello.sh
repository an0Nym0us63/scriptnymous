#!/usr/bin/env bash
# Exemple bash : lit un argument positionnel, une option --compte, une variable HUMEUR et un drapeau --echouer.
set -euo pipefail

prenom="${1:-monde}"
shift || true
compte=5
echouer=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --compte) compte="$2"; shift 2 ;;
    --echouer) echouer=1; shift ;;
    *) shift ;;
  esac
done

echo "Bonjour, ${prenom} ! Humeur du jour : ${HUMEUR:-inconnue}"
echo "Run ${SN_RUN_ID:-?} du script ${SN_SCRIPT:-?} (déclencheur : ${SN_TRIGGER:-?}, essai ${SN_ATTEMPT:-1})"
for i in $(seq 1 "${compte}"); do
  echo "  ... ${i}/${compte}"
  sleep 1
done

if [[ "${echouer}" == "1" ]]; then
  echo "Échec simulé demandé." >&2
  exit 1
fi
echo "Terminé."
