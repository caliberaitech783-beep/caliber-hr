# Caliber HR

Run npm ci, npm test and npm run build. Deploy dist to Hostinger public_html, uploading assets before index.html. Retain old index and hashed assets for rollback.

Login verifies the existing Pulse username/password using the fixed central HR integration endpoint. HR roles and configured HR portal access are checked centrally. No separate credentials or mock login transition remain. Passwords are never stored. Grants expire after seven days, and validation checks password changes and central revocation. The remaining HR modules are the existing prototype; this change does not implement an HR database/API.
