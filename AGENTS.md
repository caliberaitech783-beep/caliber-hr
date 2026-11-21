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
- Owner, 21 Nov 2026: the PM approves directly, like the Driver Trainer, at every site: Approve / Reject in HRMS › Trial Status or Approve / Decline on the CALIBER Trial Status bot. There is no PM OTP and Office HR is not asked to request one.
- Owner, 21 Nov 2026: Directors approve two ways. Normally any one Director approves directly (Approve in HRMS › Trial Status, or Approve / Decline on the CALIBER Trial Status bot, sent to all three when Regional HR approves). The OTP is the backup for when they are out of station: Office HR is told at the same time, presses "Request OTP from Directors", a Director tells the OTP to Office HR, who enters it; the Approve buttons already sent stay valid. `OTP_ROLES` in `server/telegram.mjs` and `src/trial-workflow-preview/records.ts` lists who has the OTP backup; `server/trial-status-bot.test.mjs` and `src/trial-workflow-preview/workflow.test.ts` check it.

# Leave approval route and the CALIBER Leave Request bot

Set by the owner on 20 November 2026.

- Every site and office uses one leave route: the employee raises their own leave → HOD (concerned) → Directors (approve by OTP) → Regional HR (final approval). There is no PM step, and the site HR Manager no longer raises leave for others (OD and gate passes are unchanged).
- Directors approve by OTP only: Regional HR presses "Request OTP from Directors" in the approval, any one Director gets the OTP on the Leave Request bot and tells it to Regional HR, who enters it. 15 minutes, single use, five wrong tries. Directors can still reject in HRMS.
- Nobody approves their own leave: an HOD's own leave skips the HOD step; a Director's leave goes to the other Directors.
- Leave messages go out on @CMLLLeaveRequestBot (`TELEGRAM_LEAVE_REQUEST_BOT_TOKEN`, `_BOT_USERNAME`, `_WEBHOOK_SECRET`), only to the next step; the employee gets the final result. Before the token is set, the old leave bot route is used.
- Approval Master › Leave Request bot lists every employee with a Pulse login and every leave approver, and sends each a personal join link (through an HR bot they already use, or copied to forward on WhatsApp).
- `HR-Pulse-Full-Project/server/leave-request-bot.mjs` holds the route; `server/leave-request-bot.test.mjs` and `src/LeaveRequestFlow.test.tsx` check it.

# New employee route and the CALIBER Employee Track bot

Set by the owner on 21 November 2026. It replaces the joining routes of 20 November (Site HR → PM / HOD → Office HR → Regional HR → Directors, and office HR → office HR Manager → Directors) for every newly added employee: site staff, drivers / operators, Nagpur office and Chandrapur HO.

- Route: Site HR initiates the form → Regional HR → Directors (approve by OTP) → the employee becomes Active. No PM / HOD, Driver Trainer or Office HR step.
- Site HR is the site's "HR Manager" in Approval Master › Hierarchy; when that person submits, the submission is their step. Anyone else who submits still needs Site HR's approval first. For the two offices the office HR initiates and the office's HR Manager is Regional HR (Chandrapur HO: Virat Singh; Nagpur office: the saved HR Manager, default Vinod Pinjarkar).
- Regional HR is fixed per region (`server/site-staff-routing.mjs`): NCL → Vinod Pinjarkar, WCL → Virat Singh. Directors (any one): Mohit, Manish, Rahul Chadda.
- Directors approve by OTP only: Regional HR's approval sends the OTP at once to the Directors on the Employee Track bot (with a Reject button only). Any one Director tells it to Regional HR, who enters it in HRMS › Approvals (or the pop-up); the employee becomes Active. 15 minutes, single use, five wrong tries, "Resend OTP". Directors can still reject.
- Messages go out on the CALIBER Employee Track bot (`TELEGRAM_EMPLOYEE_TRACK_BOT_TOKEN`, `_BOT_USERNAME`, `_WEBHOOK_SECRET`), only to the next step, never to the sender; Site HR gets the result. Before the token and username are set, the old Nagpur Employee Addition bot route is used.
- Approval Master › Employee Track bot lists everyone on the route and sends each a personal join link (through an HR bot they already use, or copied to forward on WhatsApp).
- Forms already in progress keep the route they were submitted with.
- `HR-Pulse-Full-Project/server/employee-track.mjs` holds the route; `server/employee-track.test.mjs` checks it.
