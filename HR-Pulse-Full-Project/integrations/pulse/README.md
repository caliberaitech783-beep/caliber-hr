# Read-only Pulse directory bridge

`hr-directory-bridge.mjs` runs in Caliber Pulse beside `pulse-application-identity.mjs`.
Copy it into the Pulse source root, then run `install-directory.py` from that root.
The installer preserves the current identity module and adds an HR-only `directory`
action using the same grant, credential-version, expiry, active-user and current-session
validation as the existing `validate` action. Keep both changes in future Pulse releases.

POST `/api/integrations/hr/directory` with `{grant}` from the HR origin.
Only Employee Master, Employee Directory or Reports & MIS access can read it.
It rebuilds the live directory from C-Dir masters, merges reporting superiors, applies
Pulse's existing directory/contact visibility rules, excludes vacancies, and returns
only report fields. It does not write or synchronize HR employee records.

The HR Region Employee Details report fetches this endpoint on opening and Refresh.
Office/site, department, designation and search filters operate on the returned roster.
CSV export contains only the visible filtered rows.

Verification: `node --test integrations/pulse/hr-directory-bridge.test.mjs`.
Deployment on 26 October 2026 verified 675 filled employees across 12 locations,
including 140 office employees; category A contacts remained masked for an ordinary
viewer. No account credentials or grants were returned or stored in source.
