# Mosyle desk-location collector

`collect-desk-info.sh` runs on each Mosyle-managed Mac and reports what's needed for
SmartOffice's desk-location tracking / automatic-reassignment workflow: the Mac mini's
own serial number (desktop identity), the currently logged-in console user, each
connected monitor's name + serial number (when the display actually reports one), the
IP of the active network interface, and a UTC timestamp — POSTed as JSON to a
SmartOffice ingestion endpoint.

**Design principle this script exists to serve:** the monitor is the stable physical
location anchor (it normally never leaves the desk); the desktop tells you who's using
it right now. The script itself does no interpretation — which logged-in accounts are
"nobody really" (the `opt`/`admin` provisioning account, system accounts), matching a
username to an employee record, and deciding a move actually happened are all decided
server-side, on purpose, so that logic can be updated without re-pushing this script to
every Mac in the fleet.

## Monitor serial extraction — verified against real hardware, with real gotchas

Confirmed on an actual Studio Display: `system_profiler -json SPDisplaysDataType` emits
**two different keys** that both look like "the serial number":

- `_spdisplays_display-serial-number` (underscore-prefixed) → present on every display,
  internal or external, but wrong/meaningless every time it's been checked against a
  real value - never trust this one
- `spdisplays_display-serial-number` (no underscore) → only present for a genuine
  external display with a real EDID serial; matches what the plain-text report calls
  "Display Serial Number" when it exists

An earlier version of this script fuzzy-matched "any key containing serial" and silently
grabbed the underscore-prefixed one, purely because of JSON key order. The current
version trusts only the cooked key, falling back straight to a last-resort generic fuzzy
match (for some future monitor type that uses neither Apple key at all).

**Also confirmed on a real MacBook Pro:** its own built-in screen ("Color LCD") shows up
in the same JSON and, if not filtered out, would get treated as a valid desk anchor -
wrong, since a laptop's own screen travels with the person, it's not a fixed desk
fixture. Excluded via `"spdisplays_connection_type": "spdisplays_internal"` (present on
the built-in screen, absent on a real external display) plus a `"built-in"` check on the
display-type string as a second, independent signal.

**Still unverified: third-party monitors (e.g. Dell).** Only tested against Apple's own
Studio Display and a MacBook's built-in screen so far. Before trusting this across the
full mixed fleet, run the same check on a Mac connected to one of the Dell monitors:
```bash
system_profiler -json SPDisplaysDataType | jq .
```
and confirm the serial the script extracts actually matches that monitor's real one.

**Multi-monitor desks:** the script itself already reports every connected display, not
just one - server-side, during the fleet bootstrap window (see below), every reported
monitor serial gets registered at the detected desk, not just the first one in the list.

## Before deploying fleet-wide

1. Fill in `SMARTOFFICE_INGEST_URL` at the top of the script.
2. Fill in the real `COLLECTOR_TOKEN` (see below) before the first real run — without it,
   every request gets a `401` from the server.

`jq` itself is a hard dependency, but no longer a separate manual step — see below.

## jq: installed automatically, self-healing

Not every Mac in the fleet has `jq` yet (confirmed on real hardware partway through
rollout - one Mac's Mosyle image never had it). Rather than track which hosts need it and
separately push an installer to just those, this one script checks for `jq` itself and
installs it on the spot if missing, before doing anything else - the exact same script
works unmodified whether pushed to a Mac that already has `jq` or one that doesn't.

Installed from jq's own GitHub releases, **pinned to a specific version** (not "latest",
so behavior is identical and reproducible across the whole fleet regardless of when each
machine happens to run this) and **checksum-verified** against jq's own published
`sha256sum.txt` before the downloaded binary is trusted and made executable - confirmed
against the real downloaded files, not copied from memory. Installed to
`/usr/local/bin/jq`.

**Also confirmed on real hardware:** Mosyle's Custom Command execution context doesn't
source `/etc/profile` the way a normal login/interactive shell does, so `/usr/local/bin`
isn't reliably on `$PATH` there even once `jq` is correctly installed - a checksum-verified,
successfully-installed binary still produced "command not found" on the very next line.
This script exports `PATH` itself near the top to compensate, rather than relying on the
environment to have it set correctly.

## The collector token

This one script both provisions the token locally AND does the actual collection/POST -
originally split into two files so the token only needed re-pasting rarely, but since
Mosyle is set up to run this on a recurring schedule rather than needing a re-paste per
edit (see "Deploying via Mosyle" below), the provisioning step just runs again harmlessly
on every scheduled poll, so there's no benefit left to keeping them separate.

The committed copy in git must always keep the `REPLACE-WITH-SHARED-SECRET` placeholder
— the real value only ever goes into what you actually paste into Mosyle's console,
never saved back to this repo. Since Mosyle's Custom Command flow is "paste one script,
it runs," there's no secrets manager or separate env-var injection step available - an
unattended script can only know a secret that's embedded in it or stored somewhere it
can read locally, so this is a necessary tradeoff of that deployment model, not a gap.

A validation guard refuses to run (loudly, with a clear error) rather than silently
sending the wrong secret, if `COLLECTOR_TOKEN` is still the placeholder or doesn't look
like a real `MDM_COLLECTOR_TOKEN` (expected: exactly 64 lowercase hex characters, no
dots) - this exists because `CLOUDFLARE_TUNNEL_TOKEN` (a completely different, also-opaque
secret in the same `.env`) kept getting pasted in by mistake during testing.

Also written to a hidden, root-only file (`/Library/Application Support/.smartoffice/.collector_token`,
mode 600) on every run - not needed by this script itself, but kept for inspectability on
the Mac and so a future split-apart deployment would still work unmodified.

## Fleet bootstrap mode (server-side, not in this script)

Controlled by `MDM_BOOTSTRAP_UNTIL` in SmartOffice's own `.env` (not anything in this
script) - while set to a near-future date, a never-before-seen monitor or desktop is
trusted and registered directly at whoever's logged in user is already assigned to in
SmartOffice, with no manual pre-registration or per-machine approval needed. Meant only
for the initial fleet rollout - unset it (or let the date pass) once that's done, so
later moves go back through the normal pending-proposal review instead of being
auto-trusted.

## ⚠ Known limitation: the ingestion URL isn't stable yet

SmartOffice is currently reachable from outside its LAN via a Cloudflare **Quick
Tunnel** (`cloudflared tunnel --url ...` in `docker-compose.yml`), which hands out a
brand-new random `*.trycloudflare.com` URL every time that container restarts — there is
no fixed hostname to deploy once and forget. A named/token-based tunnel
(`CLOUDFLARE_TUNNEL_TOKEN` in `.env`) is already configured and ready to switch to, but
still needs a **Public Hostname** route added for it in the Cloudflare Zero Trust
dashboard (Networks → Tunnels → the tunnel → Public Hostname, pointing at
`http://core-api:8080`) before it'll actually resolve anywhere. Until that route exists,
`SMARTOFFICE_INGEST_URL` has to be updated by hand across the fleet every time the Quick
Tunnel container restarts — treat this as an open ops problem to solve before relying on
this for real, not a one-time setup step.

## Deploying via Mosyle

**Recommended: a recurring Custom Attribute** (or Custom Command set to repeat), not a
one-off push — every 15–30 minutes is a reasonable starting cadence. This is the chosen
alternative to a true "run at login" hook: a macOS login hook (LaunchAgent) runs as the
logged-in user, not root, and would be locked out of the root-only collector token file
by design (see above). Periodic root-context polling achieves the same practical goal -
`stat -f%Su /dev/console` reports whoever's *currently* there on every run regardless of
when they actually logged in - just within a window (one polling interval) rather than
instantly. Logs locally to `/var/log/smartoffice-collector.log` on each Mac for
troubleshooting independent of whatever Mosyle itself surfaces. Safe to run as often as
you like - every run is independent and idempotent (a "no change" result is a normal,
expected outcome on most polls, not an error).

## What's intentionally NOT collected

- **Keyboard/mouse serial numbers** — dropped from an earlier draft. They don't
  participate in the monitor→desk / desktop→user detection logic at all, and the
  USB-parsing needed to find them (slicing `system_profiler SPUSBDataType` text output
  by device name) was the most fragile part of the original script for data that wasn't
  used.
- **Monitor vendor/resolution/`is_main`** — also dropped. Only `name` + `serial` are
  sent per monitor now; the rest wasn't needed by the detection logic and was part of
  what caused the serial-extraction bug described above.
