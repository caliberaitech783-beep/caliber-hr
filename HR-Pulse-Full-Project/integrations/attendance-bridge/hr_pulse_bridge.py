"""
HR Pulse attendance bridge.

Runs on a PC at the site, on the same network as the eSSL / ZKTeco machine.

  1. The machine pushes every punch to this program (ADMS push); punches are
     kept in a local file, attendance.db.
  2. This program asks HR Pulse every few seconds whether someone clicked
     "Fetch attendance". When they have, it uploads the punches HR Pulse does
     not have yet.

Uses only built-in Python: nothing to pip install.

Run:   python hr_pulse_bridge.py
Stop:  Ctrl+C
"""
import json
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# ---------------- Settings: change these two ----------------
API_URL = "https://hr-api-cmll-783.azurewebsites.net"
BRIDGE_KEY = "PASTE-THE-BRIDGE-KEY-HERE"   # same value as ATTENDANCE_BRIDGE_KEY in Azure
# -------------------------------------------------------------
PORT = 8081                 # must match "Server Port" on the machine
DB_FILE = "attendance.db"
POLL_SECONDS = 5
CHUNK = 1000                # punches per upload

# Environment variables override the settings above (useful for testing).
API_URL = os.environ.get("HRPULSE_API_URL", API_URL).rstrip("/")
BRIDGE_KEY = os.environ.get("HRPULSE_BRIDGE_KEY", BRIDGE_KEY)
PORT = int(os.environ.get("HRPULSE_BRIDGE_PORT", PORT))
DB_FILE = os.environ.get("HRPULSE_BRIDGE_DB", DB_FILE)

STAMP = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")
USER_ID = re.compile(r"^[A-Za-z0-9_.-]{1,24}$")
SERIAL = re.compile(r"^[A-Za-z0-9_-]{1,40}$")

db_lock = threading.Lock()


def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def open_db():
    db = sqlite3.connect(DB_FILE, check_same_thread=False)
    db.execute(
        """CREATE TABLE IF NOT EXISTS attendance (
               device_sn  TEXT NOT NULL,
               user_id    TEXT NOT NULL,
               punched_at TEXT NOT NULL,
               status     TEXT,
               verify     TEXT,
               UNIQUE (device_sn, user_id, punched_at)
           )"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS users (
               device_sn TEXT NOT NULL,
               user_id   TEXT NOT NULL,
               name      TEXT,
               UNIQUE (device_sn, user_id)
           )"""
    )
    db.execute(
        "CREATE TABLE IF NOT EXISTS devices (device_sn TEXT PRIMARY KEY, last_contact TEXT)"
    )
    # A database created by the earlier adms_server.py has no "uploaded" column.
    columns = [row[1] for row in db.execute("PRAGMA table_info(attendance)")]
    if "uploaded" not in columns:
        db.execute("ALTER TABLE attendance ADD COLUMN uploaded INTEGER NOT NULL DEFAULT 0")
    db.commit()
    return db


DB = open_db()


# ---------------------------------------------------------------------------
# Part 1: receive punches pushed by the machine (ADMS / iclock protocol)
# ---------------------------------------------------------------------------
def touch_device(sn):
    if not SERIAL.match(sn):
        return
    with db_lock:
        DB.execute(
            "INSERT INTO devices VALUES (?, ?) ON CONFLICT(device_sn) DO UPDATE SET last_contact=excluded.last_contact",
            (sn, datetime.now().isoformat(sep=" ", timespec="seconds")),
        )
        DB.commit()


def save_attlog(sn, body):
    """Each line: PIN <tab> time <tab> status <tab> verify <tab> ..."""
    saved = 0
    with db_lock:
        for line in body.splitlines():
            parts = line.strip().split("\t")
            if len(parts) < 2 or not parts[0]:
                continue
            status = parts[2] if len(parts) > 2 else ""
            verify = parts[3] if len(parts) > 3 else ""
            cur = DB.execute(
                "INSERT OR IGNORE INTO attendance (device_sn, user_id, punched_at, status, verify) VALUES (?, ?, ?, ?, ?)",
                (sn, parts[0], parts[1], status, verify),
            )
            saved += cur.rowcount
        DB.commit()
    return saved


def save_users(sn, body):
    """Lines like: USER PIN=1 <tab> Name=Ravi <tab> ..."""
    with db_lock:
        for line in body.splitlines():
            if not line.startswith("USER "):
                continue
            fields = dict(kv.split("=", 1) for kv in line[5:].split("\t") if "=" in kv)
            if fields.get("PIN"):
                DB.execute(
                    "INSERT OR REPLACE INTO users VALUES (?, ?, ?)",
                    (sn, fields["PIN"], fields.get("Name", "")),
                )
        DB.commit()


class MachineHandler(BaseHTTPRequestHandler):
    def reply(self, text):
        data = text.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        sn = parse_qs(url.query).get("SN", ["?"])[0]
        touch_device(sn)
        if url.path.endswith("/cdata"):
            log(f"Machine {sn} connected")
            self.reply(
                f"GET OPTION FROM: {sn}\n"
                "ATTLOGStamp=0\n"        # 0 = send all stored logs once
                "OPERLOGStamp=0\n"
                "ErrorDelay=30\n"
                "Delay=10\n"
                "TransTimes=00:00;12:00\n"
                "TransInterval=1\n"
                "TransFlag=TransData AttLog OpLog EnrollUser\n"
                "Realtime=1\n"
                "Encrypt=None\n"
            )
        else:
            self.reply("OK")

    def do_POST(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        sn = q.get("SN", ["?"])[0]
        table = q.get("table", [""])[0]
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8", errors="replace")
        touch_device(sn)
        if table == "ATTLOG" and SERIAL.match(sn):
            saved = save_attlog(sn, body)
            total = len([l for l in body.splitlines() if l.strip()])
            log(f"Machine {sn}: received {total} punches, {saved} new")
            self.reply(f"OK: {total}")
        elif table == "OPERLOG" and SERIAL.match(sn):
            save_users(sn, body)
            self.reply("OK")
        else:
            self.reply("OK")

    def log_message(self, *args):
        pass


# ---------------------------------------------------------------------------
# Part 2: upload to HR Pulse when "Fetch attendance" is clicked
# ---------------------------------------------------------------------------
def call_api(path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        f"{API_URL}/api/attendance/bridge/{path}",
        data=data,
        method="GET" if payload is None else "POST",
        headers={"X-Bridge-Key": BRIDGE_KEY, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def digits(value):
    value = (value or "").strip()
    return value if value.isdigit() and len(value) <= 3 else ""


def pending_rows(sn):
    with db_lock:
        rows = DB.execute(
            "SELECT rowid, user_id, punched_at, status, verify FROM attendance WHERE device_sn=? AND uploaded=0 ORDER BY punched_at",
            (sn,),
        ).fetchall()
        bad = [r[0] for r in rows if not (USER_ID.match(r[1] or "") and STAMP.match(r[2] or ""))]
        if bad:  # never retry rows HR Pulse would reject
            DB.executemany("UPDATE attendance SET uploaded=2 WHERE rowid=?", [(i,) for i in bad])
            DB.commit()
            log(f"Skipped {len(bad)} unreadable punch rows from machine {sn}")
    return [r for r in rows if r[0] not in set(bad)]


def mark_uploaded(rowids):
    with db_lock:
        DB.executemany("UPDATE attendance SET uploaded=1 WHERE rowid=?", [(i,) for i in rowids])
        DB.commit()


def upload(request_id):
    with db_lock:
        serials = [r[0] for r in DB.execute(
            "SELECT device_sn FROM devices UNION SELECT DISTINCT device_sn FROM attendance")]
    serials = [s for s in serials if SERIAL.match(s or "")]
    if not serials:
        call_api("punches", {"requestId": request_id,
                             "error": "The fingerprint machine has not connected to the bridge PC yet. "
                                      "Check the machine's ADMS / Cloud Server settings."})
        log("Fetch requested, but no machine has connected to this PC yet")
        return

    batches = []
    for sn in serials:
        rows = pending_rows(sn)
        with db_lock:
            users = [{"biometricId": u, "name": n or ""} for u, n in DB.execute(
                "SELECT user_id, name FROM users WHERE device_sn=?", (sn,)) if USER_ID.match(u or "")]
        chunks = [rows[i:i + CHUNK] for i in range(0, len(rows), CHUNK)] or [[]]
        for index, chunk in enumerate(chunks):
            batches.append((sn, chunk, users[:2000] if index == 0 else []))

    sent = added = 0
    for index, (sn, chunk, users) in enumerate(batches):
        result = call_api("punches", {
            "requestId": request_id,
            "device": {"serial": sn},
            "users": users,
            "punches": [{"biometricId": r[1], "punchedAt": r[2],
                         "punchType": digits(r[3]), "verify": digits(r[4])} for r in chunk],
            "final": index == len(batches) - 1,
        })
        mark_uploaded([r[0] for r in chunk])
        sent += len(chunk)
        added += int(result.get("added", 0))
    log(f"Fetch complete: uploaded {sent} punches to HR Pulse, {added} new")


def poll_forever():
    last_error = ""
    while True:
        try:
            request = call_api("next").get("request")
            if last_error:
                log("Connected to HR Pulse again")
                last_error = ""
            if request:
                log("HR Pulse asked for attendance")
                try:
                    upload(request["id"])
                except Exception as exc:
                    log(f"Upload failed: {exc}")
                    try:
                        call_api("punches", {"requestId": request["id"],
                                             "error": "The bridge PC could not upload the punches. Try again."})
                    except Exception:
                        pass
        except urllib.error.HTTPError as exc:
            message = {401: "HR Pulse rejected the bridge key. Check BRIDGE_KEY.",
                       503: "HR Pulse has no bridge key configured yet (ATTENDANCE_BRIDGE_KEY)."}.get(
                exc.code, f"HR Pulse returned error {exc.code}")
            if message != last_error:
                log(message)
                last_error = message
        except Exception as exc:
            message = f"Cannot reach HR Pulse ({exc}). Will keep trying."
            if message != last_error:
                log(message)
                last_error = message
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    if len(BRIDGE_KEY) < 32:
        raise SystemExit("Set BRIDGE_KEY at the top of this file first (at least 32 characters).")
    log(f"Waiting for the machine on port {PORT}; checking {API_URL} every {POLL_SECONDS}s")
    threading.Thread(target=poll_forever, daemon=True).start()
    try:
        ThreadingHTTPServer(("0.0.0.0", PORT), MachineHandler).serve_forever()
    except KeyboardInterrupt:
        log("Stopped")
