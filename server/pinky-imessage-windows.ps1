param([Parameter(Mandatory = $true)][string]$Base, [Parameter(Mandatory = $true)][string]$Token)
# Pinky: read ONE iMessage conversation from the iPhone backup on this Windows PC and send it to your private Pinky import.
# Nothing else is read or sent. Run from the command Pinky shows you. It reads a copy of the backup's message database with
# the SQLite that ships with Windows (winsqlite3.dll), and the backup's contacts only to show names in the list.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

# Running the command twice in one window must not define the type twice.
if (-not ('PinkyBackup' -as [type])) { Add-Type -ReferencedAssemblies System.Net.Http -TypeDefinition @'
using System; using System.Collections.Generic; using System.IO; using System.IO.Compression; using System.Net.Http;
using System.Runtime.InteropServices; using System.Text;
public static class PinkyBackup {
  [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_open_v2")] static extern int Open(byte[] name, out IntPtr db, int flags, IntPtr vfs);
  [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_prepare16_v2", CharSet = CharSet.Unicode)] static extern int Prepare(IntPtr db, string sql, int bytes, out IntPtr stmt, IntPtr tail);
  [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_step")] static extern int Step(IntPtr stmt);
  [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_count")] static extern int Count(IntPtr stmt);
  [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_type")] static extern int Kind(IntPtr stmt, int i);
  [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_int64")] static extern long Int(IntPtr stmt, int i);
  [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_text16")] static extern IntPtr Text(IntPtr stmt, int i);
  [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_errmsg16")] static extern IntPtr Error(IntPtr db);
  [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_finalize")] static extern int Finalize(IntPtr stmt);
  [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_close")] static extern int Close(IntPtr db);

  /** Every row of one query on a read-only database, each column a long, a string or null. */
  public static List<object[]> Query(string path, string sql) {
    IntPtr db, stmt; var rows = new List<object[]>();
    if (Open(Encoding.UTF8.GetBytes(path + "\0"), out db, 1, IntPtr.Zero) != 0) throw new Exception("open failed");
    try {
      if (Prepare(db, sql, -1, out stmt, IntPtr.Zero) != 0) throw new Exception(Marshal.PtrToStringUni(Error(db)));
      try {
        int code;
        while ((code = Step(stmt)) == 100) {
          var row = new object[Count(stmt)];
          for (int i = 0; i < row.Length; i++) { int k = Kind(stmt, i); row[i] = k == 1 ? (object)Int(stmt, i) : k == 5 ? null : (object)Marshal.PtrToStringUni(Text(stmt, i)); }
          rows.Add(row);
        }
        if (code != 101) throw new Exception(Marshal.PtrToStringUni(Error(db)));
      } finally { Finalize(stmt); }
    } finally { Close(db); }
    return rows;
  }

  static string J(object value) {
    if (value == null) return "null";
    if (value is long) return ((long)value).ToString();
    var s = new StringBuilder("\"");
    foreach (char c in (string)value) {
      if (c == '"') s.Append("\\\""); else if (c == '\\') s.Append("\\\\"); else if (c < ' ') s.AppendFormat("\\u{0:x4}", (int)c); else s.Append(c);
    }
    return s.Append('"').ToString();
  }

  /** The same document the Mac helper sends: the chat's title and its messages (tapbacks excluded). */
  public static string Export(string path, long chat, string title) {
    var rows = Query(path, "SELECT m.date, m.is_from_me, COALESCE(h.id, ''), m.text, CASE WHEN m.text IS NULL OR m.text = '' THEN hex(m.attributedBody) END, m.cache_has_attachments " +
      "FROM chat_message_join j JOIN message m ON m.ROWID = j.message_id LEFT JOIN handle h ON h.ROWID = m.handle_id " +
      "WHERE j.chat_id = " + chat + " AND COALESCE(m.associated_message_type, 0) = 0 ORDER BY m.date");
    var s = new StringBuilder("{\"format\":\"pinky-imessage\",\"chat\":{\"title\":" + J(title) + "},\"rows\":[");
    for (int i = 0; i < rows.Count; i++) {
      var r = rows[i];
      if (i > 0) s.Append(',');
      s.Append("{\"date\":").Append(J(r[0])).Append(",\"is_from_me\":").Append(J(r[1])).Append(",\"handle\":").Append(J(r[2]))
       .Append(",\"text\":").Append(J(r[3])).Append(",\"body_hex\":").Append(J(r[4])).Append(",\"attachments\":").Append(J(r[5])).Append('}');
    }
    return s.Append("]}").ToString();
  }

  /** Sends the document gzipped; returns the status code and Pinky's reply. */
  public static string[] Send(string url, string json) {
    var buffer = new MemoryStream();
    using (var zip = new GZipStream(buffer, CompressionMode.Compress, true)) { var bytes = Encoding.UTF8.GetBytes(json); zip.Write(bytes, 0, bytes.Length); }
    var content = new ByteArrayContent(buffer.ToArray());
    content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
    content.Headers.ContentEncoding.Add("gzip");
    using (var client = new HttpClient()) {
      client.Timeout = TimeSpan.FromMinutes(10);
      var response = client.PostAsync(url, content).Result;
      return new[] { ((int)response.StatusCode).ToString(), response.Content.ReadAsStringAsync().Result };
    }
  }
}
'@ }

function Say($zh, $en) { Write-Host $zh; Write-Host $en -ForegroundColor DarkGray }

# The backups Apple's apps make on Windows: iTunes, and the Apple Devices / Microsoft Store iTunes app.
$roots = @("$env:APPDATA\Apple Computer\MobileSync\Backup", "$env:USERPROFILE\Apple\MobileSync\Backup")
if ($env:PINKY_BACKUP_DIR) { $roots = @($env:PINKY_BACKUP_DIR) }
$sms = Get-ChildItem -Path $roots -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { Get-Item -LiteralPath (Join-Path $_.FullName '3d\3d0d7e5fb2ce288813306e4d4636395e047a3d28') -ErrorAction SilentlyContinue } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $sms) {
  Write-Host ''
  Say '这台电脑上还没有 iPhone 备份。请先用数据线连上 iPhone，打开“Apple 设备”App（或 iTunes），选中你的 iPhone，点“立即备份”（不要勾选“加密本地备份”），等它完成后重新运行同一条命令。' `
      'No iPhone backup on this PC yet. Connect the iPhone with a cable, open the Apple Devices app (or iTunes), select the iPhone, click Back Up Now (leave "Encrypt local backup" off), wait for it to finish, then run the same command again.'
  return
}

$work = Join-Path $env:TEMP ("pinky-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  # Read copies, so the backup itself is never touched.
  $db = Join-Path $work 'sms.db'
  Copy-Item -LiteralPath $sms.FullName -Destination $db
  try { [void][PinkyBackup]::Query($db, 'SELECT 1 FROM message LIMIT 1') } catch {
    Write-Host ''
    Say '这份 iPhone 备份是加密的，Pinky 读不了。在“Apple 设备”App（或 iTunes）里取消勾选“加密本地备份”（需要输入当时设的备份密码），再点“立即备份”，完成后重新运行同一条命令。' `
        'This iPhone backup is encrypted, so Pinky cannot read it. In the Apple Devices app (or iTunes), turn off "Encrypt local backup" (it asks for the backup password), click Back Up Now, then run the same command again.'
    return
  }

  # Names for the list only, from the backup's contacts; they are never sent.
  $names = @{}
  $book = Join-Path $sms.Directory.Parent.FullName '31\31bb7ba8914766d4ba40d6dfb6113c8b614be442'
  if (Test-Path -LiteralPath $book) {
    try {
      Copy-Item -LiteralPath $book -Destination (Join-Path $work 'book.db')
      foreach ($r in [PinkyBackup]::Query((Join-Path $work 'book.db'), "SELECT COALESCE(p.First, ''), COALESCE(p.Last, ''), v.value FROM ABPerson p JOIN ABMultiValue v ON v.record_id = p.ROWID WHERE v.value IS NOT NULL")) {
        # Chinese and Japanese names read family name first, with no space.
        $full = if (($r[0] + $r[1]) -match '[぀-ヿ㐀-鿿]') { $r[1] + $r[0] } else { ($r[0] + ' ' + $r[1]).Trim() }
        $r = @($full, $r[2])
        $key = if ($r[1] -match '@') { $r[1].ToLower() } else { ($r[1] -replace '\D', '') }
        if ($key.Length -gt 10) { $key = $key.Substring($key.Length - 10) }
        if ($r[0] -and $key) { $names[$key] = $r[0] }
      }
    } catch { }
  }
  function NameOf($id) { $key = if ($id -match '@') { $id.ToLower() } else { ($id -replace '\D', '') }; if ($key.Length -gt 10) { $key = $key.Substring($key.Length - 10) }; $names[$key] }

  # Apple stores times as nanoseconds (older iPhones: seconds) since 2001-01-01.
  $chats = [PinkyBackup]::Query($db, "SELECT c.ROWID, COALESCE(NULLIF(c.display_name, ''), c.chat_identifier), COUNT(*),
    date(CASE WHEN MAX(m.date) > 1000000000000 THEN MAX(m.date) / 1000000000 ELSE MAX(m.date) END + 978307200, 'unixepoch')
    FROM chat c JOIN chat_message_join j ON j.chat_id = c.ROWID JOIN message m ON m.ROWID = j.message_id
    GROUP BY c.ROWID ORDER BY COUNT(*) DESC LIMIT 15")
  if ($chats.Count -eq 0) { Say '这份备份里没有 iMessage 对话。' 'No iMessage conversations in this backup.'; return }

  Write-Host ''
  Say "找到 iPhone 备份（$($sms.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))）。聊得最多的对话：" "Found the iPhone backup ($($sms.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))). Your most active conversations:"
  for ($i = 0; $i -lt $chats.Count; $i++) {
    $who = $chats[$i][1]; $name = NameOf $who
    $label = if ($name) { "$name ($who)" } else { $who }
    Write-Host ("  {0,2}) {1}   {2} 条/messages   最近/last {3}" -f ($i + 1), $label, $chats[$i][2], $chats[$i][3])
  }
  Write-Host ''
  $pick = if ($env:PINKY_PICK) { $env:PINKY_PICK } else { Read-Host "和 TA 的对话是第几个？ / Which one is with them? (1-$($chats.Count))" }
  $n = 0
  if (-not [int]::TryParse($pick, [ref]$n) -or $n -lt 1 -or $n -gt $chats.Count) { Say '没有这个编号，请重新运行命令。' 'No such number; run the command again.'; return }
  $chosen = $chats[$n - 1]
  $title = NameOf $chosen[1]; if (-not $title) { $title = $chosen[1] }

  Say '正在读取并发送到 Pinky…' 'Reading and sending to Pinky…'
  $result = [PinkyBackup]::Send("$Base/api/imports/upload/$Token", [PinkyBackup]::Export($db, [long]$chosen[0], $title))
  Write-Host ''
  Write-Host (($result[1] -split "`n")[0])
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
