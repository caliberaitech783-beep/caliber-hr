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
- Directors approve two ways (owner, 21 Nov 2026): when the HOD approves, the Directors are told on the Leave Request bot and any one approves or rejects in HRMS › Approvals. The OTP is the backup when they are out of station: Regional HR is told at the same time and can press "Request OTP from Directors"; any one Director gets the OTP on the bot and tells it to Regional HR, who enters it. 15 minutes, single use, five wrong tries.
- Nobody approves their own leave: an HOD's own leave skips the HOD step; a Director's leave goes to the other Directors.
- Leave messages go out on @CMLLLeaveRequestBot (`TELEGRAM_LEAVE_REQUEST_BOT_TOKEN`, `_BOT_USERNAME`, `_WEBHOOK_SECRET`), only to the next step; the employee gets the final result. Before the token is set, the old leave bot route is used.
- Approval Master › Leave Request bot lists every employee with a Pulse login and every leave approver, and sends each a personal join link (through an HR bot they already use, or copied to forward on WhatsApp).
- `HR-Pulse-Full-Project/server/leave-request-bot.mjs` holds the route; `server/leave-request-bot.test.mjs` and `src/LeaveRequestFlow.test.tsx` check it.

# New employee route and the CALIBER Employee Track bot

Set by the owner on 21 November 2026. It replaces the joining routes of 20 November (Site HR → PM / HOD → Office HR → Regional HR → Directors, and office HR → office HR Manager → Directors) for every newly added employee: site staff, drivers / operators, Nagpur office and Chandrapur HO.

- Route: Site HR initiates the form → Regional HR → Directors (approve by OTP) → the employee becomes Active. No PM / HOD, Driver Trainer or Office HR step.
- Site HR is the site's "HR Manager" in Approval Master › Hierarchy; when that person submits, the submission is their step. Anyone else who submits still needs Site HR's approval first. For the two offices the office HR initiates and the office's HR Manager is Regional HR (Chandrapur HO: Virat Singh; Nagpur office: the saved HR Manager, default Vinod Pinjarkar).
- Regional HR is fixed per region (`server/site-staff-routing.mjs`): NCL → Vinod Pinjarkar, WCL → Virat Singh. Directors (any one): Mohit, Manish, Rahul Chadda.
- Directors approve two ways (owner, 21 Nov 2026): Regional HR's approval sends the Directors the form on the Employee Track bot with Approve / Reject buttons and an OTP. Any one Director taps Approve (or approves in HRMS › Approvals / the pop-up) and the employee becomes Active. The OTP is the backup when they are out of station: a Director tells it to Regional HR, who enters it in HRMS › Approvals (or the pop-up). 15 minutes, single use, five wrong tries, "Resend OTP".
- Messages go out on the CALIBER Employee Track bot (`TELEGRAM_EMPLOYEE_TRACK_BOT_TOKEN`, `_BOT_USERNAME`, `_WEBHOOK_SECRET`), only to the next step, never to the sender; Site HR gets the result. Before the token and username are set, the old Nagpur Employee Addition bot route is used.
- Approval Master › Employee Track bot lists everyone on the route and sends each a personal join link (through an HR bot they already use, or copied to forward on WhatsApp).
- Forms already in progress keep the route they were submitted with.
- `HR-Pulse-Full-Project/server/employee-track.mjs` holds the route; `server/employee-track.test.mjs` checks it.

# Batch trial approvals: Yes / No per candidate on Telegram

Set by the owner on 21 November 2026.

- When a vehicle trial batch (two or more candidates) reaches the PM, Office HR, Regional HR or the Directors on the CALIBER Trial Status bot, each candidate has its own ✅ Yes / ❌ No buttons and the message ends with "Submit". Every candidate starts on Yes; Submit sends the Yes candidates to the next step and rejects the No candidates.
- Each approver's ticks are kept apart, so two Directors ticking at once do not change each other's choice. One candidate keeps the plain Approve / Decline buttons, and batches above 45 candidates keep Approve / Decline for all (Telegram's button limit).
- HRMS › Trial Status already lets each approver select forms before Approve / Reject, and the Driver Trainer marks PASS / FAIL per candidate there.
- `trialGroupMarkup` and `parseTrialCallback` in `HR-Pulse-Full-Project/server/telegram.mjs` hold it; `server/trial-batch-picks.test.mjs` checks it.

# Directors' decision on a vehicle trial is final

Set by the owner on 21 November 2026.

- Once any Director approves (cleared to join) or rejects a candidate, that trial form is closed: nobody can change it, enter a new trial result or send it for approval again. The server refuses it with "The Directors have already given the final decision on this candidate."
- A candidate the Directors rejected cannot be sent through a fresh trial either (same Aadhaar number), on the server and in Site HR's Part 1 form. A rejection at an earlier step (PM, Office HR, Regional HR) still allows a new trial.
- `directorDecided` in `HR-Pulse-Full-Project/server/trial-review.mjs` and `src/trial-workflow-preview/records.ts` holds it; `server/trial-director-final.test.mjs` and `src/trial-workflow-preview/director-final.test.ts` check it.

# Smart Print on the vehicle trial form

Set by the owner on 21 November 2026: the trial form window (HRMS › Trial Status, a candidate's form) has a Smart Print button with the same features as Pulse's Smart Print.

- Tick the sections to print (Part 1 candidate details, photo, document check, Part 2 trial result, approvals, approval notes); all are ticked by default and the same selection is used for printing, PDF and Excel. Named layouts can be saved, printed and deleted (kept per login in this browser).
- Print asks the page size (A4 / A3, portrait or landscape), then pages, sides and copies. Print/Export downloads a PDF (page size asked) or Excel. Pages never cut a line in half.
- The printer is chosen in the browser's print window (HR has no print helper); copies and the page selection are applied to the pages sent there.
- `HR-Pulse-Full-Project/src/trial-workflow-preview/formSmartPrint.ts` holds it and reads the form's values from `views.ts` (`candidateDetails`, `resultDetails`, `approvalSigns`), so the print always matches the form; `formSmartPrint.test.ts` checks it.

# No separate joining OTP on Submit Employee

Set by the owner on 21 November 2026.

- Submit Employee (Document Checklist) saves the employee straight into the saved hierarchy route (Approval Master › Trial Hierarchy, Employee Track bot). It never opens the "Joining approval – Telegram" OTP pop-up.
- Approval Master has no "Joining Approval" tab; `joiningApprovers` in `HR-Pulse-Full-Project/server/telegram.mjs` always reports it switched off, whatever the old setting says.

# Completed Form shows every approved employee in the user's sites

Set by the owner on 21 November 2026.

- Employee Master › Completed Form lists every fully approved employee form in the sites the user's Pulse login covers, whoever submitted or approved it (up to the latest 2000). It still needs Approval Management access.
- Employee Verify lists only the user's own employee forms (submitted by them or waiting for them) that are not yet fully approved, so leave, OD and gate pass requests never push them out of its latest-200 list.
- `completedEmployees` and `employeeApprovals` in `HR-Pulse-Full-Project/server/service.mjs` (`/api/approvals/completed-employees`, `/api/approvals/employees`) hold it; `server/completed-employees.test.mjs` and `src/ApprovalReview.test.tsx` check it.

# Joining form takes region, site and department from the top selection

Set by the owner on 21 November 2026.

- On Employee Master › Add Temp. Employee, whatever is chosen in the top bar (region, site, department, sub-department, designation) is filled into the joining form as read-only text (Joining Category, Site, Department, Sub-department, Designation). The form shows a dropdown for one of these only while it is still empty at the top.
- For OB / COAL the top bar offers only the regions and sites in the login's Pulse site rights (`/api/telegram/trial-scope`, falling back to the session's site permission); a login with one region or one site gets it filled in by itself.
- `Field` (`locked`) and `permittedSites` in `HR-Pulse-Full-Project/src/EmployeeLocation.tsx` and `src/siteRights.ts` hold it; `src/EmployeeLocation.test.tsx` checks it.
