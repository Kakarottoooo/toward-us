#!/bin/bash
# Pinky: keep ONE iMessage conversation (the one with your partner) synced to your private Pinky, every hour, on its own.
# Run once from the command Pinky shows you: curl ... | bash -s -- <pinky-url> <sync-token>
# It installs a small background job (no window) in your own user folder. Nothing else on this Mac is read or sent.
# To stop: launchctl bootout gui/$(id -u)/us.toward.pinky.imessage-sync; rm -rf ~/.pinky ~/Library/LaunchAgents/us.toward.pinky.imessage-sync.plist
set -euo pipefail
BASE="${1:?missing Pinky address}"; TOKEN="${2:?missing sync token}"
DB="${PINKY_CHAT_DB:-$HOME/Library/Messages/chat.db}"
HOME_DIR="${PINKY_HOME:-$HOME/.pinky}"; CONF="$HOME_DIR/imessage-sync.conf"; RUNNER="$HOME_DIR/imessage-sync-run.sh"
LABEL="us.toward.pinky.imessage-sync"; PLIST="${PINKY_LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}/$LABEL.plist"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

if ! sqlite3 -readonly "$DB" "SELECT 1 FROM message LIMIT 1" >/dev/null 2>&1; then
  echo ""
  echo "Pinky 需要读取“信息”的记录。 / Pinky needs to read your Messages history."
  echo "请打开 系统设置 → 隐私与安全性 → 完全磁盘访问权限，打开“终端”，然后重新运行同一条命令。"
  echo "Open System Settings → Privacy & Security → Full Disk Access, turn on Terminal, then run the same command again."
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" 2>/dev/null || true
  exit 1
fi

CHAT=""
if [ -f "$CONF" ]; then CHAT="$(sed -n 's/^CHAT=//p' "$CONF")"; fi
if [ -z "$CHAT" ]; then
  WHEN="CASE WHEN MAX(m.date) > 1000000000000 THEN MAX(m.date) / 1000000000 ELSE MAX(m.date) END + 978307200"
  sqlite3 -readonly -separator $'\t' "$DB" "SELECT c.ROWID, COALESCE(NULLIF(c.display_name, ''), c.chat_identifier), COUNT(*), date($WHEN, 'unixepoch')
    FROM chat c JOIN chat_message_join j ON j.chat_id = c.ROWID JOIN message m ON m.ROWID = j.message_id
    GROUP BY c.ROWID ORDER BY COUNT(*) DESC LIMIT 15" > "$WORK/chats.tsv"
  if [ ! -s "$WORK/chats.tsv" ]; then echo "这台 Mac 上没有找到 iMessage 对话。 / No iMessage conversations found on this Mac."; exit 1; fi
  echo ""
  echo "聊得最多的对话 / Your most active conversations:"
  n=0
  while IFS=$'\t' read -r id title count last; do
    n=$((n + 1)); echo "$id" >> "$WORK/ids"
    printf "  %2d) %s   %s 条/messages   最近/last %s\n" "$n" "$title" "$count" "$last"
  done < "$WORK/chats.tsv"
  echo ""
  read -r -p "和另一半的对话是第几个？ / Which one is with your partner? (1-$n): " pick < /dev/tty
  case "$pick" in ''|*[!0-9]*) echo "请输入编号。 / Please enter a number."; exit 1;; esac
  if [ "$pick" -lt 1 ] || [ "$pick" -gt "$n" ]; then echo "没有这个编号。 / No such number."; exit 1; fi
  CHAT="$(sed -n "${pick}p" "$WORK/ids")"
fi

mkdir -p "$HOME_DIR" "$(dirname "$PLIST")"; chmod 700 "$HOME_DIR"
LAST="0"; if [ -f "$CONF" ]; then LAST="$(sed -n 's/^LAST=//p' "$CONF")"; fi
# A new command (new token) keeps the chosen chat and how far it got; the server drops any overlap anyway.
umask 077; printf 'BASE=%s\nTOKEN=%s\nCHAT=%s\nLAST=%s\nDB=%s\n' "$BASE" "$TOKEN" "$CHAT" "${LAST:-0}" "$DB" > "$CONF"

cat > "$RUNNER" <<'RUN'
#!/bin/zsh
# Sends the partner conversation's messages that are newer than the last run. Logs counts only, never message text.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"; CONF="$DIR/imessage-sync.conf"; LOG="$DIR/imessage-sync.log"
get() { sed -n "s/^$1=//p" "$CONF"; }
BASE="$(get BASE)"; TOKEN="$(get TOKEN)"; CHAT="$(get CHAT)"; LAST="$(get LAST)"; DB="$(get DB)"
stamp() { date '+%Y-%m-%d %H:%M:%S'; }
if ! sqlite3 -readonly "$DB" "SELECT 1 FROM message LIMIT 1" >/dev/null 2>&1; then
  echo "$(stamp) no access to Messages: give /bin/zsh Full Disk Access" >> "$LOG"; exit 1
fi
TOP="$(sqlite3 -readonly "$DB" "SELECT COALESCE(MAX(message_id), 0) FROM chat_message_join WHERE chat_id = $CHAT")"
if [ "$TOP" -le "${LAST:-0}" ]; then echo "$(stamp) nothing new" >> "$LOG"; exit 0; fi
TMP="$(mktemp)"; trap 'rm -f "$TMP" "$TMP.gz"' EXIT
sqlite3 -readonly "$DB" "SELECT json_object('format', 'pinky-imessage',
  'chat', json_object('title', (SELECT COALESCE(NULLIF(display_name, ''), chat_identifier) FROM chat WHERE ROWID = $CHAT)),
  'rows', (SELECT json_group_array(json_object('date', m.date, 'is_from_me', m.is_from_me, 'handle', COALESCE(h.id, ''), 'text', m.text,
    'body_hex', CASE WHEN m.text IS NULL OR m.text = '' THEN hex(m.attributedBody) END, 'attachments', m.cache_has_attachments))
    FROM (SELECT m.* FROM chat_message_join j JOIN message m ON m.ROWID = j.message_id
          WHERE j.chat_id = $CHAT AND m.ROWID > ${LAST:-0} AND m.ROWID <= $TOP AND COALESCE(m.associated_message_type, 0) = 0 ORDER BY m.date) m
    LEFT JOIN handle h ON h.ROWID = m.handle_id))" > "$TMP"
gzip -c "$TMP" > "$TMP.gz"
if REPLY="$(curl -fsS -m 300 -X POST -H "content-type: application/octet-stream" -H "content-encoding: gzip" --data-binary @"$TMP.gz" "$BASE/api/imports/sync/$TOKEN")"; then
  sed -i '' "s/^LAST=.*/LAST=$TOP/" "$CONF" 2>/dev/null || sed -i "s/^LAST=.*/LAST=$TOP/" "$CONF"
  echo "$(stamp) synced up to $TOP" >> "$LOG"; echo "$REPLY"
else
  echo "$(stamp) upload failed (Pinky offline or the command was replaced); will retry next hour" >> "$LOG"; exit 1
fi
RUN
chmod 700 "$RUNNER"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$RUNNER</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
PL
if [ -z "${PINKY_NO_LAUNCHD:-}" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
fi

echo ""
echo "正在同步到 Pinky… / Syncing to Pinky…"
"${PINKY_RUN_SHELL:-/bin/zsh}" "$RUNNER"
echo ""
echo "好了。以后每小时自动同步一次，不会弹出任何窗口。 / Done. It now syncs every hour on its own, with no window."
echo "最后一步（只做一次）：在 系统设置 → 隐私与安全性 → 完全磁盘访问权限 里点“+”，按 Cmd+Shift+G 输入 /bin/zsh，添加并打开。"
echo "Last step (once): in System Settings → Privacy & Security → Full Disk Access, click +, press Cmd+Shift+G, type /bin/zsh, add it and turn it on."
