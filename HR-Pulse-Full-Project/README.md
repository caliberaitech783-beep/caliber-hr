# Caliber HR

Production website: https://hrpulse.cmll.in
Frontend host: Azure Static Web App `hr-pulse-cmll-783` (Free tier).
Azure hostname: https://red-forest-095f3fd00.6.azurestaticapps.net
API: https://hr-api-cmll-783.azurewebsites.net
Data: separate private Azure PostgreSQL database `hr`.

## Website deployment

Push to `main` in `caliberaitech783-beep/caliber-hr`. GitHub Actions installs
locked dependencies, runs frontend tests, builds `dist`, then publishes the
frontend to Azure Static Web Apps. A failed test/build does not deploy.
The workflow can also be run manually from GitHub Actions.
Check the workflow result before expecting the website to change.
`/release.json` identifies the deployed commit.

Local checks (Node 24 and pnpm 10+):

```
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

The existing repository secret `AZURE_STATIC_WEB_APPS_API_TOKEN_RED_FOREST_095F3FD00`
authenticates deployment only to this Static Web App. Never commit its value.
Hostinger manages DNS only after migration; do not upload website releases there.
Keep the `_dnsauth` TXT validation and Azure ALIAS target in the hrpulse.cmll.in
DNS zone. Azure manages the HTTPS certificate.

## API and access

The website continues to use the existing Azure API and Pulse authentication.
The production origin remains https://hrpulse.cmll.in, so API and Pulse origin
permissions do not need to be widened. The default Azure hostname is useful for
checking static assets; use the custom domain for authenticated HR operations.
See server/README.md for API deployment and database restrictions. The website
workflow does not deploy backend files or database migrations.

Employee Master intentionally shows a blank content area. Other functional
modules remain available according to the user's Pulse menu and site scope.
Initial company, site and approval configuration requires an unrestricted HR
administrator. Credentials and employee data are not bundled into the website.
