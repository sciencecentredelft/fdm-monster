#!/bin/sh
set -eu

node --input-type=module -e "
import fs from 'node:fs';
import semver from 'semver';
import { AppConstants } from '/app/dist/server.constants.js';
const client = JSON.parse(fs.readFileSync('/opt/fork-client/package.json', 'utf8'));
if (!semver.gte(client.version, AppConstants.defaultClientMinimum)) {
  throw new Error('Fork client is below the server minimum. Build compatible fork revisions.');
}
"

mkdir -p "$MEDIA_PATH/client-dist" "$DATABASE_PATH"
cp -R /opt/fork-client/. "$MEDIA_PATH/client-dist/"
exec node /app/dist/index.js
