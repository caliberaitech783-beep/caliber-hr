# Notifications go to the assigned user only, never to the sender

Set by the owner on 20 November 2026.

- Whoever submits, sends a result, approves or rejects a form never gets that form's notification: no Telegram message popup on screen and no Telegram message from the bot.
- The notification goes only to the users assigned to the next step (by Telegram, and by the "Waiting for your approval" popup when they open the form). The sender sees one short line, such as "Sent to PM on Telegram.", or the reason it could not be delivered.
- A Telegram preview may still open when the user presses a button for it on purpose (a candidate's "Telegram message", "Telegram: today's pass list").
- Vehicle trials: `notifySent` in `HR-Pulse-Full-Project/src/trial-workflow-preview/mount.ts` and `notSender` in `HR-Pulse-Full-Project/server/telegram.mjs` hold the rule; `workflow.test.ts` and `server/trial-routing.test.mjs` check it. New forms and approval flows follow the same rule.

# Vehicle trial approval route

Set by the owner on 20 November 2026: Site HR → Driver Trainer → PM → Office HR → Regional HR → Directors (final) → cleared to join, then the employee is made Active.

- Regional HR is fixed per region: NCL (Jayant, Dudhichua East, Dudhichua West) → Vinod Pinjarkar (CMPL3399); WCL (Sasti, Majri, Dhuptala, Gauri Pauni) → Virat Singh (CMPL18114). Directors (any one): Mohit, Manish, Rahul Chadda.
- `HR-Pulse-Full-Project/server/trial-routing.mjs` holds it for vehicle trials only; leave and joining approvals keep the saved site hierarchy.
