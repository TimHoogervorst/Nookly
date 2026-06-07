#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Create group with PGID if it doesn't exist
if ! getent group "$PGID" >/dev/null; then
    addgroup -g "$PGID" appgroup
fi
GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)

# Create user with PUID if it doesn't exist
if ! getent passwd "$PUID" >/dev/null; then
    adduser -D -u "$PUID" -G "$GROUP_NAME" appuser
fi
USER_NAME=$(getent passwd "$PUID" | cut -d: -f1)

# Fix ownership of data directory (volume mount may override)
chown -R "$PUID:$PGID" /app/data

# Run the app as the target user
exec su-exec "$USER_NAME" node server.js
