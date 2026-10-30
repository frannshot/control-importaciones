#!/bin/sh
# Raise the app version (sw.js cache name + APP_V in index.html) so open apps update themselves.
set -e; cd "$(dirname "$0")"
cur=$(grep -o "importaciones-v[0-9]*" sw.js | head -1); n=${cur#importaciones-v}; next="importaciones-v$((n+1))"
sed -i "s/$cur'/$next'/" sw.js; sed -i "s/const APP_V = '$cur'/const APP_V = '$next'/" index.html; echo "$next"
