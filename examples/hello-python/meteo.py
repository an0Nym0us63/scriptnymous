#!/usr/bin/env python3
"""Exemple Python : dépend de `requests` (installé dans le venv du script par ScriptNymous)."""
import argparse
import os
import sys

import requests

VILLES = {
    "Paris": (48.8566, 2.3522),
    "Lyon": (45.7640, 4.8357),
    "Marseille": (43.2965, 5.3698),
    "Lille": (50.6292, 3.0573),
    "Bordeaux": (44.8378, -0.5792),
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ville", default="Paris")
    args = parser.parse_args()
    unites = os.environ.get("UNITES", "celsius")

    coords = VILLES.get(args.ville)
    if not coords:
        print(f"Ville inconnue : {args.ville}", file=sys.stderr)
        return 2

    print(f"Météo pour {args.ville} ({unites})…", flush=True)
    r = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={"latitude": coords[0], "longitude": coords[1], "current_weather": "true", "temperature_unit": unites},
        timeout=20,
    )
    r.raise_for_status()
    cw = r.json()["current_weather"]
    print(f"Température : {cw['temperature']}° · vent : {cw['windspeed']} km/h · mesuré à {cw['time']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
