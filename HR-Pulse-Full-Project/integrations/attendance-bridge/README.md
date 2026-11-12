# Attendance bridge

Connects an eSSL / ZKTeco fingerprint or face machine to HR Pulse.

HR Pulse runs on Azure and cannot reach a machine on a site network. This
program runs on a PC at the site and sits between the two:

1. The machine pushes each punch to the bridge (ADMS push), which stores it in
   `attendance.db` next to the script.
2. When someone clicks **Fetch attendance** in HR Pulse, the bridge uploads the
   punches HR Pulse does not have yet. This takes about 5 to 15 seconds.

The bridge needs only Python 3.8 or later. There is nothing to `pip install`.

## One-time setup

### 1. Create a bridge key

On any PC with Python, run:

    python -c "import secrets; print(secrets.token_urlsafe(36))"

Keep the printed value private. It is the password the bridge uses.

### 2. Add the key to the HR API

In the Azure portal, open the App Service `hr-api-cmll-783` → **Settings →
Environment variables** → add `ATTENDANCE_BRIDGE_KEY` with the key as its value
→ **Apply**. The API restarts by itself.

### 3. Configure the bridge PC

1. Put `hr_pulse_bridge.py` in a folder, for example `C:\essl`.
2. Open it in Notepad and paste the key into `BRIDGE_KEY` near the top.
3. Run it:

       cd C:\essl
       python hr_pulse_bridge.py

4. Allow it through Windows Firewall when asked (Private and Public).

### 4. Point the machine at the bridge PC

On the machine: **Menu → Comm. → Cloud Server Setting** (or **ADMS**).

- Server Address: the bridge PC's IP address
- Server Port: `8081`
- Enable Domain Name: off
- Enable Proxy Server: off

Within a minute the bridge window prints `Machine <serial> connected`.

### 5. Start it automatically

In Task Scheduler create a task that runs at startup:

- Program: `python`
- Arguments: `hr_pulse_bridge.py`
- Start in: `C:\essl`
- "Run whether user is logged on or not"

## In HR Pulse

Open **Employee Master → Attendance Management** and click **Fetch attendance**.

- **Machine punches** lists the punches.
- **Machine IDs not linked to an employee** is where each machine user ID is
  matched to an employee once.
- **Machines** is where an HR administrator assigns each machine to a site, so
  site HR users can see its punches.

## Messages in the bridge window

| Message | Meaning |
|---|---|
| `HR Pulse rejected the bridge key` | `BRIDGE_KEY` differs from `ATTENDANCE_BRIDGE_KEY` in Azure. |
| `HR Pulse has no bridge key configured yet` | Step 2 has not been done. |
| `Cannot reach HR Pulse` | The PC has no internet. The bridge keeps retrying. |
| `no machine has connected to this PC yet` | Check step 4 and that the PC and machine can ping each other. |

## Limits

- The bridge PC must be on and online for Fetch attendance to work.
- One bridge key and one bridge PC are supported at present. A second site
  needs its own bridge support added first.
- Punch times are stored exactly as the machine's clock shows them, so keep the
  machine's date and time correct.
