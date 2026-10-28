# Aadhaar image extraction

`POST /api/aadhaar/scan` accepts `{mime, content}` (JPEG/PNG and base64), behind Pulse authentication and Employee Master/Employee Onboarding write access. The image is sent to Gemini once; no automatic retries or browser PaddleOCR fallback are used. The frontend preserves previously populated form fields if a later upload fails. PDFs remain manual entry.

Configure `GEMINI_API_KEY` in the backend App Service environment only. Never add it to frontend variables, repository files, logs, URLs or client responses. `GEMINI_OCR_MODEL` optionally overrides the default `gemini-3.1-flash-lite`. Production use of employee documents requires the approved billing-enabled Google project. Usage is chargeable; this feature is no longer the free on-device OCR path.

The reader does not persist images or model responses. Existing employee-document storage is separate. Google processing/retention is governed by the project's applicable service terms. The upload UI identifies Google Gemini as the processor.

Limits: 20 MB source image in the browser, resized to at most 2200 pixels and 1.3 MB, backend request body under 2 MB, 45-second provider timeout. Per backend process: six attempts per account per minute, one concurrent scan per account, four concurrent scans overall. These limits reduce accidental repeated usage; they are not an account-wide billing cap and reset on restart. Configure Google project quotas separately when needed.

Extraction prefers the English name above DOB and explicit S/O, D/O or W/O relationship text. C/O alone does not populate the father/spouse field. Invalid dates, masked/non-12-digit IDs and unsupported gender values are blanked. These checks do not authenticate a card or guarantee OCR accuracy; users must verify details before saving.

Checks: `node --test server/aadhaar-ocr.test.mjs server/app.test.mjs`, frontend tests, and production build. Backend deployment is separate from the static website workflow; preserve unrelated live API changes when deploying `app.mjs` and `aadhaar-ocr.mjs`.
