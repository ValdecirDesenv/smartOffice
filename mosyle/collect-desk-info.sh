#!/bin/bash
#
# SmartOffice desk-location collector.
#
# Deployed via Mosyle (Custom Command / Custom Attribute) and run periodically on every
# managed Mac. Reports:
#   - this machine's serial number (desktop identity) and Mosyle/Computer Name
#   - the currently logged-in console user (who is using it right now)
#   - every connected monitor's name + serial number *when the display actually reports
#     one* - many monitors don't expose a serial via EDID at all; see the note further
#     down for a real, verified example of a monitor that reports more than one
#     serial-like value, only one of which is the right one
#   - the IP address of whichever interface currently owns the default route
#   - a UTC timestamp of when this snapshot was taken
#
# No interpretation happens here - which admin/system accounts to ignore (e.g. the
# "opt"/"admin" provisioning account every Mac gets before a real profile is created),
# matching a username to an employee, and deciding whether someone actually moved desks
# are all server-side, on purpose, so that logic can change without re-pushing this
# script to every machine.
#
# NOTE ON VERIFICATION: the monitor JSON parsing below has been run against real hardware
# (a Studio Display, see the comment just above it for what that caught) but NOT yet
# against a third-party monitor (e.g. Dell) - fleet machines will include both. Run this on
# a Dell-connected test Mac too and check the `jq .` printed payload's monitor serial
# actually matches that monitor's real serial, before pushing fully fleet-wide.
#
# ONE SCRIPT, PASTED ONCE: this combines what used to be two separate files
# (provision-collector-token.sh + collect-desk-info.sh) into one, since Mosyle is set up to
# run this on a recurring schedule rather than needing a re-paste per edit - the token-write
# step below just runs again (harmlessly, idempotently) on every scheduled poll. The SECRET
# HYGIENE discipline is unchanged: the committed copy in git must always keep the
# placeholder below; the real value only ever goes into what you actually paste into Mosyle.

set -uo pipefail

# Confirmed on a real Mac: Mosyle's Custom Command execution context doesn't source
# /etc/profile the way a normal login/interactive shell does, so it doesn't necessarily
# include /usr/local/bin on $PATH even once jq is correctly installed there (install-jq.sh
# hit exactly this - checksum verified, install succeeded, yet a bare `jq --version`
# right after still said "command not found"). Every jq call below is a bare `jq`, relying
# on $PATH - so without this, the jq-presence check further down could itself wrongly
# report jq as missing even when it's correctly installed, in this exact environment.
export PATH="/usr/local/bin:$PATH"

# --- Configuration -----------------------------------------------------------------
# The current SmartOffice deployment is only reachable from these Macs via its
# Cloudflare Quick Tunnel, which issues a NEW random URL every time the `cloudflared`
# container restarts (see docker-compose.yml's comment on that service). Until that's
# replaced with a stable/named Cloudflare Tunnel, this value has to be kept in sync by
# hand across the fleet (e.g. via a Mosyle Custom Variable) whenever the tunnel
# restarts - a plain hardcoded URL here WILL go stale.
SMARTOFFICE_INGEST_URL="https://lion-del-offshore-assessments.trycloudflare.com/api/ingestion/mosyle"

COLLECTOR_TOKEN="xxx"

# Guard against the single mistake that kept happening here: pasting
# CLOUDFLARE_TUNNEL_TOKEN (a long eyJ...-style string with dots in it) instead of
# MDM_COLLECTOR_TOKEN (a plain 64-character hex string, from .env). Refuses to run at all
# rather than silently sending the wrong secret - that produced a confusing 401 further
# down the line instead of a clear error right here.
if [ "$COLLECTOR_TOKEN" = "REPLACE-WITH-SHARED-SECRET" ]; then
  echo "ERROR: COLLECTOR_TOKEN still has its placeholder value - paste the real MDM_COLLECTOR_TOKEN (from .env) in first." >&2
  exit 1
fi
if ! [[ "$COLLECTOR_TOKEN" =~ ^[0-9a-f]{64}$ ]]; then
  echo "ERROR: that doesn't look like MDM_COLLECTOR_TOKEN (expected exactly 64 lowercase hex characters)." >&2
  echo "        This looks like CLOUDFLARE_TUNNEL_TOKEN instead (starts with eyJ, contains dots) - wrong secret." >&2
  echo "        Check .env - MDM_COLLECTOR_TOKEN, not CLOUDFLARE_TUNNEL_TOKEN." >&2
  exit 1
fi

# Hard dependency, self-healing - without it, monitors_json and the final payload both
# silently end up empty (every jq call below just fails with "command not found" and the
# $(...) capture becomes ""), which still reaches curl and sends an empty body, producing a
# confusing server-side error instead of a clear local one. Rather than just fail here, this
# installs jq itself when missing, since not every host in the fleet has it yet - this one
# script now works unmodified whether pushed to a Mac that already has jq or one that
# doesn't, rather than needing to separately track and push install-jq.sh to a subset.
#
# Pinned to a specific version (not "latest") so this behaves identically and verifiably
# across the whole fleet regardless of when each machine happens to run it, and checksum-
# verified against jq's own published sha256sum.txt before the binary is trusted and made
# executable - confirmed against the real downloaded files, not copied from memory.
JQ_VERSION="1.8.2"
if ! command -v jq >/dev/null 2>&1; then
  jq_arch="$(uname -m)"
  case "$jq_arch" in
    arm64)
      jq_asset="jq-macos-arm64"
      jq_expected_sha256="2d75340ba57a4b4b4c8708a21c2dc8e958a48aaa8bba13b27f77f6e4c0eca07e"
      ;;
    x86_64)
      jq_asset="jq-macos-amd64"
      jq_expected_sha256="e94b266e3c26690550006abe63152b782280f4e14374accdf04cbde844f00bc0"
      ;;
    *)
      echo "ERROR: unrecognized architecture '$jq_arch' - don't know which jq binary to install." >&2
      exit 1
      ;;
  esac

  jq_url="https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}/${jq_asset}"
  jq_tmp_file="$(mktemp)"

  jq_http_status=$(curl -sL -o "$jq_tmp_file" -w "%{http_code}" "$jq_url")
  if [ "$jq_http_status" != "200" ]; then
    echo "ERROR: jq download failed (HTTP $jq_http_status) from $jq_url" >&2
    rm -f "$jq_tmp_file"
    exit 1
  fi

  jq_actual_sha256="$(shasum -a 256 "$jq_tmp_file" | awk '{print $1}')"
  if [ "$jq_actual_sha256" != "$jq_expected_sha256" ]; then
    echo "ERROR: jq checksum mismatch for $jq_asset - expected $jq_expected_sha256, got $jq_actual_sha256. Refusing to install." >&2
    rm -f "$jq_tmp_file"
    exit 1
  fi

  # /usr/local/bin is a default PATH entry for a normal interactive/login shell, but
  # confirmed NOT reliably so under Mosyle's own execution context (see the export above) -
  # creating it regardless, since the export above is what actually makes it resolvable
  # here. May not exist at all on a Mac that's never had Xcode Command Line Tools or
  # Homebrew installed.
  mkdir -p /usr/local/bin
  install -m 755 "$jq_tmp_file" /usr/local/bin/jq
  rm -f "$jq_tmp_file"

  if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq install reported success but still isn't found - check /usr/local/bin is in PATH." >&2
    exit 1
  fi
fi

# Also stashed in a hidden, root-only file (mode 600) - not needed for this script's own
# run (it already has $COLLECTOR_TOKEN above), but kept for inspectability/troubleshooting
# on the Mac itself, and so a plain collect-desk-info.sh-only deployment would still work
# unmodified if ever split back apart later.
TOKEN_DIR="/Library/Application Support/.smartoffice"
mkdir -p "$TOKEN_DIR"
chmod 700 "$TOKEN_DIR"
install -m 600 /dev/null "$TOKEN_DIR/.collector_token"
printf '%s' "$COLLECTOR_TOKEN" > "$TOKEN_DIR/.collector_token"

LOG_FILE="/var/log/smartoffice-collector.log"
log() { echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") $*" >>"$LOG_FILE" 2>/dev/null; }

# --- Collect: desktop identity -------------------------------------------------------
desktop_serial=$(system_profiler SPHardwareDataType | awk -F': ' '/Serial Number \(system\)/ {print $2}')
device_name=$(scutil --get ComputerName 2>/dev/null)
logged_in_user=$(stat -f%Su /dev/console)
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# --- Collect: network -----------------------------------------------------------------
# Resolves whichever interface actually owns the default route instead of assuming
# en0/en1 - more robust across Wi-Fi-only Minis, USB-Ethernet dongles, etc.
active_iface=$(route get default 2>/dev/null | awk '/interface:/{print $2; exit}')
ip_address=""
if [ -n "$active_iface" ]; then
  ip_address=$(ipconfig getifaddr "$active_iface" 2>/dev/null)
fi
if [ -z "$ip_address" ]; then
  for iface in en0 en1 en2 en3; do
    ip_address=$(ipconfig getifaddr "$iface" 2>/dev/null)
    [ -n "$ip_address" ] && break
  done
fi

# --- Collect: monitors ------------------------------------------------------------------
# Uses -json rather than scraping the human-readable text report - far less brittle than
# slicing text blocks with awk. Only name + serial are kept - that's all the detection logic
# actually needs (Mac mini serial identifies the desktop, monitor serial identifies the desk).
#
# Verified against two real machines that system_profiler emits TWO near-identical serial
# keys here, not one - and that the underscore-prefixed one is never trustworthy:
#   _spdisplays_display-serial-number   (underscore-prefixed) -> present on EVERY display,
#                                                                  internal or external, but
#                                                                  wrong/meaningless both times
#                                                                  it's been checked against a
#                                                                  real value
#   spdisplays_display-serial-number    (no underscore)        -> only present for a genuine
#                                                                  external display with a real
#                                                                  EDID serial; matches what the
#                                                                  text report calls "Display
#                                                                  Serial Number" when it exists
# An earlier version of this script fuzzy-matched "any key containing serial" and silently
# grabbed the underscore-prefixed one because of JSON key order - fixed once (still wrong for a
# Studio Display), then found to ALSO wrongly grab a MacBook's own built-in screen's raw
# pseudo-serial, which would have let a laptop's own display anchor a desk location (wrong - a
# laptop's screen travels with the person, it's not a fixed fixture). Fixed for real now: the
# cooked key is the ONLY trusted serial source, with only a last-resort fuzzy match (for some
# future monitor type that uses neither Apple key at all, e.g. an unverified third-party Dell
# monitor) - and any internal/built-in display is excluded from the list outright, confirmed via
# "spdisplays_connection_type": "spdisplays_internal" (present on a MacBook's own screen,
# absent entirely on a real external display) plus a "built-in" check on the display type string
# as a second, independent signal.
# A candidate object must have both a "_name" and a resolution-ish key to count as an actual
# display - without that check, the top-level GPU/chipset entry (which also has a "_name",
# e.g. "Apple M2") would get picked up as a fake extra monitor.
monitors_json=$(system_profiler -json SPDisplaysDataType 2>/dev/null | jq -c '
  [.. | objects
     | select(has("_name"))
     | select([to_entries[] | select(.key | test("resolution";"i"))] | length > 0)
     | select((.spdisplays_connection_type // "") != "spdisplays_internal")
     | select(((.spdisplays_display_type // "") | test("built-in";"i")) | not)
     | . as $d
     | {
         name: $d["_name"],
         serial: ($d["spdisplays_display-serial-number"]
                   // ([$d | to_entries[] | select(.key | test("serial";"i")) | .value] | first)
                   // null)
       }
  ]
' 2>/dev/null)
[ -z "$monitors_json" ] && monitors_json="[]"

# Raw text fallback, sent alongside the structured version above - if a future macOS
# release changes the JSON shape in a way the jq query above misses, nothing is lost,
# and it's there to eyeball during review.
monitor_info_raw=$(system_profiler SPDisplaysDataType 2>/dev/null | grep -E "Display|Vendor|Model|Resolution|Serial" | tr '\n' ' ')

# --- Build payload and send ----------------------------------------------------------------
payload=$(jq -n \
  --arg desktop_serial "$desktop_serial" \
  --arg device_name "$device_name" \
  --arg logged_in_user "$logged_in_user" \
  --arg ip_address "$ip_address" \
  --arg timestamp "$timestamp" \
  --arg monitor_info_raw "$monitor_info_raw" \
  --argjson monitors "$monitors_json" \
  '{
    desktop_serial: $desktop_serial,
    device_name: $device_name,
    logged_in_user: $logged_in_user,
    ip_address: $ip_address,
    collected_at: $timestamp,
    monitors: $monitors,
    monitor_info_raw: $monitor_info_raw
  }')

http_status=$(curl -s -o /tmp/smartoffice-collector-response.json -w "%{http_code}" \
  -X POST "$SMARTOFFICE_INGEST_URL" \
  -H "Content-Type: application/json" \
  -H "X-Collector-Token: $COLLECTOR_TOKEN" \
  -d "$payload")

if [ "$http_status" = "200" ] || [ "$http_status" = "201" ]; then
  log "OK ($http_status) serial=$desktop_serial user=$logged_in_user"
else
  log "FAILED ($http_status) serial=$desktop_serial user=$logged_in_user response=$(cat /tmp/smartoffice-collector-response.json 2>/dev/null)"
fi

echo "SmartOffice collector: HTTP $http_status"
echo "$payload" | jq .
