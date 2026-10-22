# Historical Hostinger deployment (rollback only)

Production website releases now use the Azure GitHub Actions workflow documented in ../../README.md. These instructions describe the retained Hostinger fallback only; do not deploy new releases here.

The React source implements the existing shared Caliber Pulse authentication
contract and retains the live Caliber theme in `public/caliber-theme.css`. The
functional modules use the separate Azure HR database through the authenticated
API; no database credentials are shipped to Hostinger.

Build with TypeScript and Vite, then publish the contents of `dist` into the HR
website's `public_html`. It includes the theme and connection badge from `public`.
Upload archives outside `public_html`, then extract with overwrite enabled. Keep
old hashed assets and the previous index for rollback. The initial functional
release used `hr-functional-modules.zip`, followed by `hr-functional-modules-final.zip`;
the prior public index is preserved
locally in `.tools/hr-live-index.html` and its assets remain on Hostinger.

The current `index.html` includes the public readiness badge:

```html
<script defer src="/azure-connection.js?v=20261022"></script>
```

The script requests only the HR API's public readiness endpoint, with credentials
omitted. A successful database query shows `Service connected` near the login
security note or in the dashboard header. The check repeats every 60 seconds and
reports unavailable on failed queries, invalid responses or timeouts. It does not
change login, send Pulse credentials to the HR API, or implement employee CRUD.

`window.HR_API_ORIGIN` exposes the public API origin for future frontend work. It
contains no database credentials. All record operations instead use bearer grants
validated server-side against Pulse. Configure actual company/location masters,
approver usernames and matrix rules before submitting employees or leave.
