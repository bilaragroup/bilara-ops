#!/bin/bash
# One-time local setup for Bilara: creates the local database tables
# and adds the local test user (seedy@sites.test) as Super Admin.
# Only touches the local copy in .wrangler/ — never the live site.
set -e
cd "$(dirname "$0")"

if [ ! -f wrangler.local.jsonc ]; then
  echo "wrangler.local.jsonc is missing — put it next to this script."; exit 1
fi

echo "1/2  Creating local database tables..."
CI=1 npx --yes wrangler@4 d1 migrations apply DB --local --config wrangler.local.jsonc

echo "2/2  Adding local Super Admin (seedy@sites.test)..."
npx --yes wrangler@4 d1 execute DB --local --config wrangler.local.jsonc --command \
  "INSERT OR REPLACE INTO app_users (email,name,roles,projects,active,version) VALUES ('seedy@sites.test','Local Admin','[\"Super Admin\"]','[]',1,1);"

echo ""
echo "Done. Now run:  npm run dev"
echo "Then open:      http://localhost:3000   (use 'localhost', not 127.0.0.1)"
