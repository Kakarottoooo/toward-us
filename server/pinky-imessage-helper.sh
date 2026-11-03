#!/bin/bash
# Pinky: read ONE iMessage conversation on this Mac and send it to your private Pinky import.
# Nothing else is read or sent. Run from the command Pinky shows you: curl ... | bash -s -- <pinky-url> <one-time-token>
set -euo pipefail
BASE="${1:?missing Pinky address}"; TOKEN="${2:?missing one-time token}"
DB="${PINKY_CHAT_DB:-$HOME/Library/Messages/chat.db}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

if ! sqlite3 -readonly "$DB" "SELECT 1 FROM message LIMIT 1" >/dev/null 2>&1; then
  echo ""
  echo "Pinky 需要读取“信息”的记录。 / Pinky needs to read your Messages history."
  echo "请打开 系统设置 → 隐私与安全性 → 完全磁盘访问权限，打开“终端”，然后重新运行同一条命令。"
  echo "Open System Settings → Privacy & Security → Full Disk Access, turn on Terminal, then run the same command again."
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" 2>/dev/null || true
  exit 1
fi

# Apple stores times as nanoseconds (older Macs: seconds) since 2001-01-01.
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

# One JSON document: the chat title and its messages (tapbacks excluded). Rich-text bodies are decoded by Pinky.
sqlite3 -readonly "$DB" "SELECT json_object('format', 'pinky-imessage',
  'chat', json_object('title', (SELECT COALESCE(NULLIF(display_name, ''), chat_identifier) FROM chat WHERE ROWID = $CHAT)),
  'rows', (SELECT json_group_array(json_object('date', m.date, 'is_from_me', m.is_from_me, 'handle', COALESCE(h.id, ''), 'text', m.text,
    'body_hex', CASE WHEN m.text IS NULL OR m.text = '' THEN hex(m.attributedBody) END, 'attachments', m.cache_has_attachments))
    FROM (SELECT m.* FROM chat_message_join j JOIN message m ON m.ROWID = j.message_id WHERE j.chat_id = $CHAT AND COALESCE(m.associated_message_type, 0) = 0 ORDER BY m.date) m
    LEFT JOIN handle h ON h.ROWID = m.handle_id))" > "$WORK/chat.json"

echo "正在发送到 Pinky… / Sending to Pinky…"
gzip -c "$WORK/chat.json" | curl -sS -X POST -H "content-type: application/octet-stream" -H "content-encoding: gzip" --data-binary @- "$BASE/api/imports/upload/$TOKEN" | head -1
