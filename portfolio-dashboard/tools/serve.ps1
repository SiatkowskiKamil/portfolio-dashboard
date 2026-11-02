<#
===============================================================================
 serve.ps1 — static file server + Jira proxy + Excel reader
-------------------------------------------------------------------------------
 Serves ..\public on http://localhost:8000 and exposes two endpoints:

     /api/issues      forwards a Jira REST search, adding the credentials
     /api/reference   reads the strategic-initiative matrix from an .xlsx

 Uses nothing but PowerShell itself: no installation, no administrator rights,
 no Node, no Python, and Excel does not have to be installed.

 Run from this folder:
     powershell -ExecutionPolicy Bypass -File serve.ps1

 Different port:
     powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8080

 Stop with Ctrl+C.

 Built on TcpListener rather than HttpListener on purpose: HttpListener needs a
 URL reservation, which a standard user account cannot create. A raw TCP socket
 on a high port needs no privileges at all.

 -- Why the proxy exists ------------------------------------------------------
 A browser will not let the page call atlassian.net directly. Atlassian does not
 send the headers that would allow it, and that is browser policy — not a
 network problem and not a bad token, so a VPN makes no difference. A request
 made from this script is not a browser request, so the policy does not apply.

 -- Live Jira data ------------------------------------------------------------
 Two models, selected by CFG.auth in public\js\config.js:

   'user'   each person signs in with their own e-mail and API token. The
            browser sends them, this script forwards them to Jira and keeps
            nothing. No environment variables are needed.

   'server' this script uses one account of its own, taken from the
            environment below, and the browser never sees a token.

 Credentials are never written to a file, never logged and never sent to the
 browser. For the 'server' model set them in the SAME window that starts the
 server:

     $env:JIRA_EMAIL="twoj.email@firma.pl"
     $env:JIRA_TOKEN="WKLEJ_TUTAJ_NOWY_TOKEN"
     powershell -ExecutionPolicy Bypass -File serve.ps1

 Then set CFG.apiBase = '/api' in public\js\config.js. Without the variables the
 static site still works; only live Jira is unavailable, and /api/issues replies
 with an explanation rather than failing silently.

 The token is a password. Closing the window discards it. Do not paste it into
 this script, into a file inside the project, or anywhere that gets committed.
 A token that has been exposed should be revoked in the Atlassian account.

 -- Known limitation ----------------------------------------------------------
 This server handles one request at a time. A Jira page takes a second or two,
 during which other requests wait. That is fine for one person on one machine,
 which is all this script is for.
===============================================================================
#>

param([int]$Port = 8000)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 still defaults to TLS 1.0 in some builds, and Atlassian
# refuses anything below 1.2. Without this the request fails with a bare
# "connection was closed" that gives no hint as to why.
[Net.ServicePointManager]::SecurityProtocol =
  [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol

# Find public\ whether this script sits in tools\ or next to public\ itself.
$candidates = @(
  (Join-Path $PSScriptRoot '..\public'),
  (Join-Path $PSScriptRoot 'public'),
  (Join-Path (Get-Location) 'public'),
  (Get-Location)
)
$root = $null
foreach ($c in $candidates) {
  if (Test-Path (Join-Path $c 'index.html')) { $root = (Resolve-Path $c).ProviderPath; break }
}
if (-not $root) {
  Write-Host ''
  Write-Host '  Nie znalazlem katalogu z plikiem index.html.' -ForegroundColor Red
  Write-Host '  Umiesc serve.ps1 w katalogu tools\ albo obok katalogu public\.'
  Write-Host ''
  exit 1
}

# ---- Reference workbook -----------------------------------------------------
# The strategic-initiative matrix, maintained by hand in Excel. The path is
# hard-coded on purpose: the dashboard picks the file up with no configuration,
# exactly as the Power BI report did. Edit the line below and restart.
#
# Expected layout: a header of one or more rows, then one row per project or
# initiative. The column holding the issue numbers is found by its CONTENT —
# the column with the most cells shaped like PF-1234 — never by a caption, so
# a merged two-row header, a counts row, blocks appended by a macro and shifting
# row numbers all work without changes here.
#
# Every header column that is not in $referenceSkip below counts as a strategic
# initiative, and any non-empty cell under it is a link. Two columns sharing a
# caption are told apart by their column letter, e.g. "... (I)" and "... (M)".
# Rows whose number is still a placeholder like "PP-" are counted and reported,
# never silently dropped.
# GDZIE TEN PLIK POWINIEN LEZEC
#
# Ten skoroszyt prowadzi zespol ds. strategii i zmienia sie na biezaco, wiec
# NIE jest plikiem aplikacji: ma zostac tam, gdzie ten zespol pracuje, a serwer
# ma go tylko czytac. Nie wolno go wkladac do repozytorium - osoba z biznesu
# nie bedzie robic commita, zeby dopisac wiersz, a dwie rownoczesne edycje
# daja konflikt w pliku binarnym, ktorego nie da sie rozwiazac.
#
#   PRODUKCJA  -> wpisz tu pelna sciezke, najczesciej UNC do zasobu sieciowego:
#                 $referenceFile = '\\serwer\dzial\inicjatywy.xlsm'
#                 Konto puli aplikacji IIS musi miec prawo odczytu.
#                 Docelowo: pobieranie z SharePointa przez Microsoft Graph.
#
#   LOKALNIE   -> zostaw pusto i wrzuc kopie do dane\ jako inicjatywy.xlsx
#                 albo inicjatywy.xlsm. Wygodne przy pracy nad kodem.
#
# Kolejnosc szukania: najpierw dane\, potem ta sciezka. Dzieki temu podmiana
# tego skryptu na nowa wersje NIE kasuje ustawienia produkcyjnego - wczesniej
# wystarczylo nadpisac serve.ps1, zeby macierz przestala sie zaczytywac.
#
# UWAGA: lokalna kopia w dane\ WYGRYWA ze sciezka ponizej. Jesli na serwerze
# zostanie tam przypadkowa kopia, raport bedzie po cichu pokazywal stare dane.
# --- wgrywanie macierzy przez przegladarke -----------------------------------
# Strona Inicjatywy strategiczne dostaje przycisk, ktorym uprawniona osoba
# wgrywa nowa wersje skoroszytu. Plik laduje w dane\ i od tej chwili to on jest
# zrodlem - razem z data i autorem, ktore raport pokazuje. Dzieki temu nieswieza
# macierz jest widoczna, zamiast po cichu udawac aktualna.
#
# KTO MOZE WGRYWAC: ten serwer nie sprawdza tego w ogole. Na produkcji robi to
# IIS - Windows Authentication plus grupa AD na tej sciezce. Nazwisko zapisane
# w metadanych pochodzi od przegladarki i jest informacja, NIE kontrola dostepu.
$uploadAllowed   = $true
$uploadMaxBytes  = 25MB

$referenceName  = 'inicjatywy'    # nazwa bez rozszerzenia, szukana w dane\
$referenceFile  = ''              # '' = look in dane\ ; otherwise a full path
$referenceSheet = 'Strategia'     # '' = first sheet in the workbook

# --- plik wartosci biznesowej ------------------------------------------------
# EBITDA w rozbiciu na lata i kategoria projektu (Growth / Compliance /
# Maintenance), przekazane przez dzial danych do czasu, az wystawia swoja
# tabele. W Jirze tych danych nie ma: jest jedna laczna EBITDA i nie ma pola
# z klasyfikacja.
#
# W odroznieniu od pliku inicjatyw TEJ sciezki nie wpisujemy: szukamy pliku
# w folderze dane\ obok public\. Dzieki temu caly folder mozna skopiowac na
# inna maszyne i nadal dziala, bez grzebania w kodzie.
#
# Plik NIE lezy w public\ celowo. Wszystko, co tam jest, serwer wystawia pod
# adresem - surowy skoroszyt z EBITDA dalby sie pobrac z pominieciem logowania
# do Jiry i filtra jednostek. Tutaj serwer czyta go z dysku i oddaje tylko
# policzone wartosci.
$valuationName = 'wartosc_biznesowa.xlsx'

# Captions that are NOT strategic initiatives. Compared without case or
# surrounding spaces. Anything else in the header becomes an initiative
# column, so adding one to the workbook needs no change here.
$referenceSkip  = @(
  'Issue', 'Type', 'Issue Type', 'L.p.', 'Lp.',
  'Nr PF', 'Nr. PF', 'Numer PF', 'Klucz',
  'Rodzaj', 'Typ',
  'Projekt', 'Projekt/Inicjatywa', 'Projekt / Inicjatywa', 'Nazwa',
  'Status', 'RAG', 'RAG (ikona)'
)

$jiraBase  = $env:JIRA_BASE
if (-not $jiraBase) { $jiraBase = 'https://your-company.atlassian.net' }
$jiraBase  = $jiraBase.TrimEnd('/')
$jiraEmail = $env:JIRA_EMAIL
$jiraToken = $env:JIRA_TOKEN
$hasCreds  = [bool]($jiraEmail -and $jiraToken)

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
}

# Reply shape used by both branches below: status line, body bytes, media type.
function New-Reply($status, [byte[]]$bytes, $type) {
  return @{ Status = $status; Body = $bytes; Type = $type }
}

function New-JsonError($status, $message) {
  $json = (@{ error = $message } | ConvertTo-Json -Compress)
  return New-Reply $status ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8'
}

<#
  GET /api/issues  ->  GET <jira>/rest/api/3/search/jql

  A deliberately narrow pass-through: one upstream path, and only the four
  parameters the app actually sends. Anything else is dropped, so this cannot be
  used as a general-purpose proxy into Jira by whatever else runs on this
  machine. Pagination stays in the browser — the app already follows
  nextPageToken — which keeps this stateless.
#>
function Invoke-JiraProxy($rawQuery, $authHeader) {
  # Two models, one proxy. When the browser sends credentials they are passed
  # straight through, so Jira applies that person's permissions and the server
  # stores nothing. When it does not, the server's own account is used and
  # everyone sees identical figures. CFG.auth in config.js picks the model;
  # this end simply honours whichever arrives.
  $fromUser = [bool]$authHeader
  if ($authHeader) {
    $auth = $authHeader
  }
  elseif ($hasCreds) {
    # Jira Cloud uses Basic auth with an API token in place of a password.
    # -f avoids writing "$jiraEmail:" directly, which PowerShell would try to
    # read as a scope qualifier.
    $auth = 'Basic ' + [Convert]::ToBase64String(
      [Text.Encoding]::UTF8.GetBytes(('{0}:{1}' -f $jiraEmail, $jiraToken)))
  }
  else {
    return New-JsonError 503 ('Brak danych logowania do Jiry. Albo zaloguj sie w aplikacji ' +
      '(CFG.auth = ''user''), albo uruchom serwer ze zmiennymi JIRA_EMAIL i JIRA_TOKEN ' +
      'ustawionymi w tym samym oknie. Szczegoly w komentarzu na gorze tools\serve.ps1.')
  }

  # Parse the incoming query by hand rather than loading System.Web: fewer
  # moving parts, and the format here is always simple key=value pairs.
  $incoming = @{}
  foreach ($pair in ($rawQuery -split '&')) {
    if (-not $pair) { continue }
    $i = $pair.IndexOf('=')
    if ($i -lt 1) { continue }
    # '+' means a space in a query string, which is form-urlencoding, not
    # percent-encoding. UnescapeDataString only handles %XX, so the plus has to
    # be translated first — otherwise Jira receives "project+=+pp" and rejects
    # it, because '+' is a reserved character in JQL. A literal plus in a value
    # arrives as %2B and survives this untouched.
    $k = [Uri]::UnescapeDataString($pair.Substring(0, $i).Replace('+', ' '))
    $v = [Uri]::UnescapeDataString($pair.Substring($i + 1).Replace('+', ' '))
    $incoming[$k] = $v
  }

  $parts = @()
  foreach ($k in @('jql', 'maxResults', 'fields', 'nextPageToken')) {
    if ($incoming.ContainsKey($k)) {
      $parts += ([Uri]::EscapeDataString($k) + '=' + [Uri]::EscapeDataString($incoming[$k]))
    }
  }
  $target = $jiraBase + '/rest/api/3/search/jql?' + ($parts -join '&')

  try {
    $resp = Invoke-WebRequest -Uri $target -Method Get -TimeoutSec 30 `
      -UseBasicParsing `
      -Headers @{ Authorization = $auth; Accept = 'application/json' }

    # Take the raw bytes rather than .Content: the body is UTF-8 and this way
    # nothing is re-encoded on the way through.
    $bytes = $resp.RawContentStream.ToArray()
    Write-Host ("  /api/issues -> Jira 200, {0} B" -f $bytes.Length) -ForegroundColor DarkGray
    return New-Reply 200 $bytes 'application/json; charset=utf-8'
  }
  catch {
    $status = 0
    if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
      try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = 0 }
    }

    # Jira's own message, which for a rejected JQL names the exact field or
    # value it did not like. Windows PowerShell 5.1 usually leaves
    # $_.ErrorDetails empty for web errors, so the body has to be read from the
    # response stream instead; without this the user only ever sees "400".
    $raw = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $raw = $_.ErrorDetails.Message
    }
    elseif ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
      try {
        $rs = $_.Exception.Response.GetResponseStream()
        try { $rs.Position = 0 } catch { }
        $sr = New-Object System.IO.StreamReader($rs)
        $raw = $sr.ReadToEnd()
        $sr.Close()
      } catch { $raw = '' }
    }

    $detail = ''
    if ($raw) {
      try {
        $j = $raw | ConvertFrom-Json
        $bits = @()
        if ($j.errorMessages) { $bits += $j.errorMessages }
        if ($j.errors) { $bits += ($j.errors.PSObject.Properties | ForEach-Object { $_.Value }) }
        $detail = ($bits -join ' ')
      } catch {
        # Not JSON — pass the first line through, trimmed, rather than nothing.
        $detail = ($raw -split "`n")[0]
      }
      $detail = $detail.Trim()
      if ($detail.Length -gt 300) { $detail = $detail.Substring(0, 300) + '...' }
    }

    if ($status -eq 401 -or $status -eq 403) {
      Write-Host "  /api/issues -> Jira $status (odrzucone logowanie)" -ForegroundColor Yellow
      # Say whose credentials were rejected: the user can fix their own, but
      # only an operator can fix the server's.
      if ($fromUser) {
        return New-JsonError $status ("Jira odrzucila logowanie (HTTP $status). Sprawdz adres " +
          'e-mail i czy token jest nadal wazny - tokeny Atlassiana wygasaja.')
      }
      return New-JsonError $status ("Jira odrzucila dane logowania serwera (HTTP $status). " +
        'Sprawdz JIRA_EMAIL i czy token jest nadal wazny.')
    }
    if ($status -ge 400) {
      Write-Host "  /api/issues -> Jira $status" -ForegroundColor Yellow
      $msg = "Jira zwrocila blad $status"
      if ($detail) { $msg = $msg + ': ' + $detail } else { $msg = $msg + '.' }
      return New-JsonError $status $msg
    }

    # No HTTP response at all: DNS, a corporate proxy, a firewall, or TLS.
    Write-Host ("  /api/issues -> brak polaczenia: " + $_.Exception.Message) -ForegroundColor Yellow
    return New-JsonError 502 ('Serwer nie mogl polaczyc sie z Jira (' + $_.Exception.Message + '). ' +
      'Sprawdz adres w JIRA_BASE, siec firmowa i VPN.')
  }
}

<#
  GET /api/reference  ->  the strategic matrix, read straight from the .xlsx

  An .xlsx is a ZIP of XML, so it is read here with nothing but the .NET
  classes already present in Windows. Excel does NOT have to be installed, and
  the file is not locked: it can stay open in Excel while the server reads it.

  Two text encodings have to be handled. Excel puts strings in a shared table
  and cells reference them by index (t="s"); other tools write the text inside
  the cell (t="inlineStr"). A file from either source must work.

  Everything is read fresh on every request, so saving in Excel and pressing
  F5 in the browser is the whole refresh cycle.
#>
function Get-ZipText($zip, $name) {
  $entry = $zip.Entries | Where-Object { $_.FullName -eq $name }
  if (-not $entry) { return $null }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  $text = $reader.ReadToEnd()
  $reader.Close()
  return $text
}

# "BC12" -> 55. Column letters are base-26 with A=1.
function Convert-ColRef($ref) {
  $letters = ($ref -replace '[^A-Za-z]', '').ToUpper()
  $n = 0
  foreach ($ch in $letters.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
  return $n
}

# 55 -> "BC". The inverse of Convert-ColRef, for naming duplicate columns.
function Convert-ColLetter($n) {
  $s = ''
  while ($n -gt 0) {
    $r = ($n - 1) % 26
    $s = [string][char](65 + $r) + $s
    $n = ($n - 1 - $r) / 26
  }
  return $s
}

function Get-CellText($c, $shared) {
  $t = $c.GetAttribute('t')
  if ($t -eq 's') {
    $v = $c.SelectSingleNode('*[local-name()="v"]')
    if (-not $v) { return '' }
    $i = [int]$v.InnerText
    if ($i -ge 0 -and $i -lt $shared.Count) { return $shared[$i] }
    return ''
  }
  if ($t -eq 'inlineStr') {
    $n = $c.SelectSingleNode('*[local-name()="is"]')
    if ($n) { return $n.InnerText }
    return ''
  }
  $v = $c.SelectSingleNode('*[local-name()="v"]')
  if ($v) { return $v.InnerText }
  return ''
}

function Read-ReferenceWorkbook($path) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue

  # Copy first: Excel keeps the file open with a share mode that blocks a
  # plain read, so opening the original would fail whenever someone is editing.
  $temp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::Copy($path, $temp, $true)

  $zip = $null
  try {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($temp)

    # --- locate the worksheet -------------------------------------------
    $wbText = Get-ZipText $zip 'xl/workbook.xml'
    if (-not $wbText) { throw 'To nie jest plik xlsx (brak xl/workbook.xml).' }
    [xml]$wb = $wbText
    $sheets = $wb.DocumentElement.SelectNodes('*[local-name()="sheets"]/*[local-name()="sheet"]')
    if ($sheets.Count -eq 0) { throw 'Skoroszyt nie zawiera arkuszy.' }

    $chosen = $null
    if ($referenceSheet) {
      foreach ($s in $sheets) {
        if ($s.GetAttribute('name').Trim() -ieq $referenceSheet.Trim()) { $chosen = $s; break }
      }
      if (-not $chosen) {
        $names = ($sheets | ForEach-Object { $_.GetAttribute('name') }) -join ', '
        throw "Nie ma arkusza '$referenceSheet'. Dostepne: $names."
      }
    } else {
      $chosen = $sheets[0]
    }
    $sheetName = $chosen.GetAttribute('name')

    # The sheet's XML file is named in the workbook relationships, not by
    # position, so sheet order and file names need not agree.
    $relId = $chosen.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $target = $null
    $relsText = Get-ZipText $zip 'xl/_rels/workbook.xml.rels'
    if ($relsText -and $relId) {
      [xml]$rels = $relsText
      foreach ($r in $rels.DocumentElement.SelectNodes('*[local-name()="Relationship"]')) {
        if ($r.GetAttribute('Id') -eq $relId) { $target = $r.GetAttribute('Target'); break }
      }
    }
    if (-not $target) { $target = 'worksheets/sheet1.xml' }
    $target = $target.TrimStart('/')
    if (-not $target.StartsWith('xl/')) { $target = 'xl/' + $target }

    $sheetText = Get-ZipText $zip $target
    if (-not $sheetText) { throw "Nie moge odczytac arkusza ($target)." }

    # --- shared strings, when the file uses them -------------------------
    $shared = New-Object System.Collections.ArrayList
    $ssText = Get-ZipText $zip 'xl/sharedStrings.xml'
    if ($ssText) {
      [xml]$ss = $ssText
      foreach ($si in $ss.DocumentElement.SelectNodes('*[local-name()="si"]')) {
        [void]$shared.Add($si.InnerText)
      }
    }

    # --- rows as column-index -> text ------------------------------------
    [xml]$sh = $sheetText
    $rows = New-Object System.Collections.ArrayList
    foreach ($row in $sh.DocumentElement.SelectNodes('*[local-name()="sheetData"]/*[local-name()="row"]')) {
      $cells = @{}
      foreach ($c in $row.SelectNodes('*[local-name()="c"]')) {
        $idx = Convert-ColRef $c.GetAttribute('r')
        $cells[$idx] = (Get-CellText $c $shared).Trim()
      }
      [void]$rows.Add($cells)
    }
    if ($rows.Count -eq 0) { throw "Arkusz '$sheetName' jest pusty." }

    # --- the key column, by content -----------------------------------------
    # Found by what the cells hold, not by a caption: the workbook has a merged
    # two-row header, a counts row under it and no "Nr PF" anywhere, and a macro
    # appends rows to two separate blocks, so positions shift over time.
    $keyPattern = '^[A-Za-z][A-Za-z0-9]*-[0-9]+$'
    $hits = @{}
    foreach ($cells in $rows) {
      foreach ($k in $cells.Keys) {
        if ($cells[$k] -match $keyPattern) {
          if ($hits.ContainsKey($k)) { $hits[$k] = $hits[$k] + 1 } else { $hits[$k] = 1 }
        }
      }
    }
    if ($hits.Count -eq 0) {
      throw "W arkuszu '$sheetName' nie znalazlem ani jednej komorki z numerem zgloszenia (np. PF-1234)."
    }
    $keyCol = ($hits.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 1).Key

    # Data begins at the first row holding a key; everything above is header.
    $firstData = -1
    for ($i = 0; $i -lt $rows.Count; $i++) {
      if ($rows[$i][$keyCol] -match $keyPattern) { $firstData = $i; break }
    }

    # --- initiative columns --------------------------------------------------
    # A column's caption is the first non-empty, non-numeric text found anywhere
    # in the header rows: the header spans two rows and a merged cell stores its
    # text only in the top-left one.
    $caption = @{}
    for ($i = 0; $i -lt $firstData; $i++) {
      foreach ($k in $rows[$i].Keys) {
        $v = $rows[$i][$k]
        if (-not $v) { continue }
        if ($caption.ContainsKey($k)) { continue }
        if ($v -match '^[0-9\s.,%-]+$') { continue }
        $caption[$k] = $v
      }
    }

    $skip = $referenceSkip | ForEach-Object { $_.Trim().ToLower() }
    $initCols = @{}
    $nameCount = @{}
    foreach ($k in ($caption.Keys | Sort-Object)) {
      if ($k -eq $keyCol) { continue }
      $name = $caption[$k]
      if ($skip -contains $name.Trim().ToLower()) { continue }
      $initCols[$k] = $name
      if ($nameCount.ContainsKey($name)) { $nameCount[$name] = $nameCount[$name] + 1 }
      else { $nameCount[$name] = 1 }
    }
    if ($initCols.Count -eq 0) {
      throw 'W naglowku nie ma zadnej kolumny z inicjatywa strategiczna. Kolumny pomijane sa wymienione w zmiennej referenceSkip w tym pliku.'
    }
    # Two columns in the workbook carry the same caption. Tell them apart by the
    # column letter, which is how the people maintaining the sheet refer to them.
    foreach ($k in @($initCols.Keys)) {
      if ($nameCount[$initCols[$k]] -gt 1) {
        $initCols[$k] = $initCols[$k] + ' (' + (Convert-ColLetter $k) + ')'
      }
    }

    # --- data rows -----------------------------------------------------------
    $strategic = @($initCols.Keys | Sort-Object | ForEach-Object { $initCols[$_] })
    $links = New-Object System.Collections.ArrayList
    $count = 0
    $skipped = 0
    for ($i = $firstData; $i -lt $rows.Count; $i++) {
      $key = $rows[$i][$keyCol]
      if (-not $key) { continue }
      $key = $key.Trim()
      # A row with a placeholder like "PP-" is work that has no Jira issue yet.
      if ($key -notmatch $keyPattern) { $skipped++; continue }
      $count++
      foreach ($k in $initCols.Keys) {
        $mark = $rows[$i][$k]
        # Any non-empty cell counts as a link: people write X, x, TAK or 1, and
        # insisting on one of them would only create support calls.
        if ($mark -and $mark.Trim()) {
          [void]$links.Add(@{ k = $key; i = $initCols[$k] })
        }
      }
    }
    # @() around both: PowerShell collapses a one-element collection to a
    # scalar, and the browser expects arrays whatever the count.
    return @{ strategic = @($strategic); links = @($links); rows = $count;
              skipped = $skipped; sheet = $sheetName }
  }
  finally {
    if ($zip) { $zip.Dispose() }
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

# ---------------------------------------------------------------------------
#  GET /api/valuation  ->  EBITDA po latach i kategoria, z dane\
# ---------------------------------------------------------------------------
#  Ta sama metoda co przy macierzy inicjatyw: kolumny rozpoznajemy po tym, co
#  mowi ich naglowek, a wiersze po kolumnie z numerem PP. Czytamy KAZDY arkusz
#  skoroszytu i zapamietujemy, z ktorego pochodzi wiersz - przekazany plik ma
#  jeden arkusz na jednostke raportowa (Northwind Retail, Finance & Legal).
#
#  Trzymac zgodnie z tools/xlsx.js, gdzie ten sam algorytm da sie przetestowac.
# ---------------------------------------------------------------------------

function ConvertTo-SheetNumber($text) {
  if ($null -eq $text) { return $null }
  # Spacja zwykla i nielamiaca (Excel wstawia ja jako separator tysiecy).
  # Obie podajemy jako TEKST, nie [char]: przeciazenie Replace(char, char)
  # nie przyjmuje pustego lancucha jako drugiego argumentu.
  $s = ([string]$text).Replace(' ', '').Replace([string][char]0x00A0, '').Replace(',', '.')
  if ($s -eq '' -or $s -eq '-') { return $null }
  $out = 0.0
  if ([double]::TryParse($s, [Globalization.NumberStyles]::Float,
        [Globalization.CultureInfo]::InvariantCulture, [ref]$out)) { return $out }
  return $null
}

function Read-ValuationWorkbook($path, $displayName) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue

  # Kopia, bo Excel trzyma plik otwarty w trybie blokujacym zwykly odczyt.
  $temp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::Copy($path, $temp, $true)

  $zip = $null
  try {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($temp)

    $wbText = Get-ZipText $zip 'xl/workbook.xml'
    if (-not $wbText) { throw 'To nie jest plik xlsx (brak xl/workbook.xml).' }
    [xml]$wb = $wbText
    $sheets = $wb.DocumentElement.SelectNodes('*[local-name()="sheets"]/*[local-name()="sheet"]')
    if ($sheets.Count -eq 0) { throw 'Skoroszyt nie zawiera arkuszy.' }

    $relsText = Get-ZipText $zip 'xl/_rels/workbook.xml.rels'
    $rels = $null
    if ($relsText) { [xml]$rels = $relsText }

    $shared = New-Object System.Collections.ArrayList
    $ssText = Get-ZipText $zip 'xl/sharedStrings.xml'
    if ($ssText) {
      [xml]$ss = $ssText
      foreach ($si in $ss.DocumentElement.SelectNodes('*[local-name()="si"]')) {
        [void]$shared.Add($si.InnerText)
      }
    }

    $out       = New-Object System.Collections.ArrayList
    $sheetsOk  = New-Object System.Collections.ArrayList
    $problems  = New-Object System.Collections.ArrayList
    $dups      = New-Object System.Collections.ArrayList
    $years     = @{}
    $seen      = @{}

    foreach ($sheet in $sheets) {
      $sheetName = $sheet.GetAttribute('name')

      $relId = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
      $target = $null
      if ($rels -and $relId) {
        foreach ($r in $rels.DocumentElement.SelectNodes('*[local-name()="Relationship"]')) {
          if ($r.GetAttribute('Id') -eq $relId) { $target = $r.GetAttribute('Target'); break }
        }
      }
      if (-not $target) { continue }
      $target = $target.TrimStart('/')
      if (-not $target.StartsWith('xl/')) { $target = 'xl/' + $target }

      $sheetText = Get-ZipText $zip $target
      if (-not $sheetText) { continue }

      [xml]$sh = $sheetText
      $rows = New-Object System.Collections.ArrayList
      foreach ($row in $sh.DocumentElement.SelectNodes('*[local-name()="sheetData"]/*[local-name()="row"]')) {
        $cells = @{}
        foreach ($c in $row.SelectNodes('*[local-name()="c"]')) {
          $idx = Convert-ColRef $c.GetAttribute('r')
          $cells[$idx] = (Get-CellText $c $shared).Trim()
        }
        [void]$rows.Add($cells)
      }
      if ($rows.Count -eq 0) { continue }

      # --- kolumna z numerem PP, po zawartosci ---------------------------
      $hits = @{}
      foreach ($cells in $rows) {
        foreach ($k in $cells.Keys) {
          if ($cells[$k] -match '^[A-Za-z][A-Za-z0-9]*-\d+$') { $hits[$k] = [int]$hits[$k] + 1 }
        }
      }
      if ($hits.Count -eq 0) {
        [void]$problems.Add("arkusz '$sheetName' nie ma kolumny z numerem PP")
        continue
      }
      $keyCol = ($hits.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 1).Key

      $firstData = -1
      for ($i = 0; $i -lt $rows.Count; $i++) {
        if ($rows[$i][$keyCol] -match '^[A-Za-z][A-Za-z0-9]*-\d+$') { $firstData = $i; break }
      }
      if ($firstData -lt 0) { continue }

      # --- naglowki ------------------------------------------------------
      $cap = @{}
      for ($i = 0; $i -lt $firstData; $i++) {
        foreach ($k in $rows[$i].Keys) {
          $v = $rows[$i][$k]
          if ($v -and -not $cap.ContainsKey($k)) { $cap[$k] = $v }
        }
      }

      $yearCol = @{}
      $totalCol = $null; $typeCol = $null; $statusCol = $null; $nameCol = $null; $kindCol = $null
      foreach ($k in $cap.Keys) {
        $c = $cap[$k].ToLower()
        if ($c -match 'ebitda' -and $c -match '(20\d\d)') {
          $yr = [int]$Matches[1]
          $yearCol[$yr] = [int]$k
          $years[$yr] = $true
        }
        elseif ($c -match 'ebitda')                                  { $totalCol  = [int]$k }
        elseif ($c -match 'project\s*type|typ\s*projektu|kategoria') { $typeCol   = [int]$k }
        elseif ($c -match 'status')                                  { $statusCol = [int]$k }
        elseif ($c -match 'summary|nazwa|opis')                      { $nameCol   = [int]$k }
        elseif ($c -match 'issue\s*type|rodzaj')                     { $kindCol   = [int]$k }
      }
      if ($yearCol.Count -eq 0 -and $null -eq $totalCol) {
        [void]$problems.Add("arkusz '$sheetName' nie ma zadnej kolumny z EBITDA")
        continue
      }
      [void]$sheetsOk.Add($sheetName)

      # --- wiersze -------------------------------------------------------
      for ($i = $firstData; $i -lt $rows.Count; $i++) {
        $key = [string]$rows[$i][$keyCol]
        if ($key) { $key = $key.Trim() }
        if (-not ($key -match '^[A-Za-z][A-Za-z0-9]*-\d+$')) { continue }

        $y = @{}
        foreach ($yr in $yearCol.Keys) {
          $y["$yr"] = ConvertTo-SheetNumber $rows[$i][$yearCol[$yr]]
        }

        # Suma trzyletnia z wlasnej kolumny, nie z dodawania lat: arkusz
        # zaokragla kazdy rok, wiec czesci nie musza sie zsumowac do liczby,
        # ktora ludzie cytuja. Dodajemy tylko, gdy kolumny sumy brak.
        $eb3 = $null
        if ($null -ne $totalCol) { $eb3 = ConvertTo-SheetNumber $rows[$i][$totalCol] }
        if ($null -eq $eb3) {
          $sum = $null
          foreach ($yr in $y.Keys) { if ($null -ne $y[$yr]) { $sum = [double]$sum + $y[$yr] } }
          $eb3 = $sum
        }

        if ($seen.ContainsKey($key)) { [void]$dups.Add($key); continue }
        $seen[$key] = $true

        [void]$out.Add([ordered]@{
          k  = $key
          s  = $sheetName
          y  = $y
          eb3 = $eb3
          pt = $(if ($null -ne $typeCol)   { $rows[$i][$typeCol] }   else { $null })
          st = $(if ($null -ne $statusCol) { $rows[$i][$statusCol] } else { $null })
          n  = $(if ($null -ne $nameCol)   { $rows[$i][$nameCol] }   else { $null })
          t  = $(if ($null -ne $kindCol)   { $rows[$i][$kindCol] }   else { $null })
        })
      }
    }

    if ($sheetsOk.Count -eq 0) {
      throw ('Nie udalo sie odczytac zadnego arkusza. ' + ($problems -join '; ') + '.')
    }

    # @() wokol kolekcji: ConvertTo-Json zwija jednoelementowa kolekcje do
    # pojedynczego obiektu, a strona oczekuje tablicy.
    return [ordered]@{
      file     = $displayName
      sheets   = @($sheetsOk)
      years    = @($years.Keys | Sort-Object)
      rows     = @($out)
      dups     = @($dups | Select-Object -Unique)
      problems = @($problems)
    }
  }
  finally {
    if ($zip) { $zip.Dispose() }
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

# ---------------------------------------------------------------------------
#  Folder dane\ — wspolne miejsce na skoroszyty czytane przez serwer
# ---------------------------------------------------------------------------
#  Lezy obok public\, niezaleznie od tego, czy skrypt stoi w tools\. NIE jest
#  serwowany po HTTP: wszystko w public\ da sie pobrac z przegladarki, a to sa
#  surowe dane o EBITDA.
# ---------------------------------------------------------------------------

# DANE_DIR przenosi ten folder POZA katalog aplikacji - tego wymaga wdrozenie:
# katalog aplikacji jest podmieniany przy kazdym wydaniu, a dane\ w jego
# srodku zniknelby razem z wgrana macierza. Gdy zmienna jest ustawiona, ma
# pierwszenstwo przed trzema sciezkami zapasowymi.
function Get-DaneDirs {
  $list = @()
  if ($env:DANE_DIR -and $env:DANE_DIR.Trim()) { $list += $env:DANE_DIR.Trim() }
  return $list + @(
    (Join-Path $PSScriptRoot '..\dane'),
    (Join-Path $PSScriptRoot 'dane'),
    (Join-Path (Get-Location) 'dane')
  )
}

# .xlsm obok .xlsx: skoroszyt z makrami to ten sam format w srodku i czytnik
# radzi sobie z nim tak samo, a pliki przekazywane przez ludzi bywaja jednym
# i drugim.
function Find-InDane($base) {
  $b = [System.IO.Path]::GetFileNameWithoutExtension($base)
  foreach ($d in (Get-DaneDirs)) {
    foreach ($n in @("$b.xlsx", "$b.xlsm")) {
      $p = Join-Path $d $n
      if (Test-Path -LiteralPath $p -PathType Leaf) { return (Resolve-Path -LiteralPath $p).ProviderPath }
    }
  }
  return $null
}

# Komunikat ma powiedziec, CO serwer widzi w folderze. Inaczej literowka w
# nazwie albo ukryte rozszerzenie (wartosc_biznesowa.xlsx.xlsx) kosztuja pol
# godziny szukania bledu w kodzie, ktorego tam nie ma.
function Show-DaneHint($base) {
  $b   = [System.IO.Path]::GetFileNameWithoutExtension($base)
  $dir = [System.IO.Path]::GetFullPath((Get-DaneDirs)[0])
  $msg = "Szukalem $b.xlsx i $b.xlsm w: $dir."
  if ($env:DANE_DIR -and $env:DANE_DIR.Trim()) { $msg += ' (folder wskazany zmienna DANE_DIR)' }
  if (Test-Path -LiteralPath $dir -PathType Container) {
    $found = @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
               ForEach-Object { $_.Name })
    if ($found.Count) { $msg += " W tym folderze widze: " + ($found -join ', ') + "." }
    else { $msg += ' Folder istnieje, ale jest pusty.' }
  } else {
    $msg += ' Tego folderu jeszcze nie ma - utworz go.'
  }
  return $msg
}

function Get-ValuationPath { return (Find-InDane $valuationName) }

function Invoke-Valuation {
  $file = Get-ValuationPath
  if (-not $file) {
    return New-JsonError 503 ("Nie znalazlem pliku wartosci biznesowej. " + (Show-DaneHint $valuationName))
  }
  try {
    $data = Read-ValuationWorkbook $file (Split-Path -Leaf $file)
    Write-Host ("  /api/valuation -> {0} poz., arkusze: {1}" -f `
      $data.rows.Count, ($data.sheets -join ', ')) -ForegroundColor DarkGray
    $json = $data | ConvertTo-Json -Depth 6 -Compress
    return New-Reply 200 ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8'
  }
  catch {
    Write-Host ("  /api/valuation -> blad: " + $_.Exception.Message) -ForegroundColor Yellow
    return New-JsonError 500 ($_.Exception.Message)
  }
}

# Sciezka wpisana recznie, ze sprawdzeniem obu rozszerzen. Skoroszyt z makrami
# i bez to ten sam format w srodku, a przy przepisywaniu sciezki z Eksploratora
# latwo pomylic .xlsx z .xlsm - i wtedy komunikat mowi "nie ma pliku" o pliku,
# ktory lezy dokladnie tam, gdzie trzeba.
function Resolve-RefFile($p) {
  if (-not $p) { return $null }
  if (Test-Path -LiteralPath $p -PathType Leaf) { return (Resolve-Path -LiteralPath $p).ProviderPath }
  $alt = $null
  if ($p -match '\.xlsx$')      { $alt = $p -replace '\.xlsx$', '.xlsm' }
  elseif ($p -match '\.xlsm$')  { $alt = $p -replace '\.xlsm$', '.xlsx' }
  if ($alt -and (Test-Path -LiteralPath $alt -PathType Leaf)) {
    return (Resolve-Path -LiteralPath $alt).ProviderPath
  }
  return $null
}

# Co naprawde lezy w folderze ze wpisanej sciezki. Bez tego "nie znalazlem"
# nie odroznia zlej nazwy od zlego folderu.
function Show-RefFolderHint($p) {
  if (-not $p) { return '' }
  $dir = Split-Path -Parent $p
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
    return " Folder $dir nie istnieje albo jest niedostepny."
  }
  $base = [System.IO.Path]::GetFileNameWithoutExtension($p)
  $found = @(Get-ChildItem -LiteralPath $dir -File -Filter "$base*" -ErrorAction SilentlyContinue |
             ForEach-Object { $_.Name })
  if ($found.Count) { return " W folderze $dir widze: " + ($found -join ', ') + "." }
  return " W folderze $dir nie ma zadnego pliku o nazwie zaczynajacej sie od '$base'."
}

# Skoroszyt z macierza inicjatyw: najpierw dane\, potem wpisana sciezka.
function Get-ReferencePath {
  $p = Find-InDane $referenceName
  if ($p) { return $p }
  return (Resolve-RefFile $referenceFile)
}


# ---------------------------------------------------------------------------
#  POST /api/reference  ->  replace the strategic matrix with an uploaded file
# ---------------------------------------------------------------------------
#  The body is the raw bytes of the workbook - no multipart, because parsing
#  multipart by hand in PowerShell is a lot of code to get subtly wrong, and
#  fetch() can send a File object as the body directly.
#
#  The new file is PARSED BEFORE it replaces anything. An upload of the wrong
#  workbook is the obvious mistake here, and it must fail loudly instead of
#  wiping the matrix.
# ---------------------------------------------------------------------------

function Get-DaneWritePath {
  # With DANE_DIR set, that folder is the only writable home: an upload must
  # never land in a copy inside the application directory, where the next
  # release would delete it.
  if ($env:DANE_DIR -and $env:DANE_DIR.Trim()) {
    $d = [System.IO.Path]::GetFullPath($env:DANE_DIR.Trim())
    [void][System.IO.Directory]::CreateDirectory($d)
    return $d
  }
  foreach ($d in (Get-DaneDirs)) {
    if (Test-Path -LiteralPath $d -PathType Container) { return (Resolve-Path -LiteralPath $d).ProviderPath }
  }
  $d = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\dane'))
  [void][System.IO.Directory]::CreateDirectory($d)
  return $d
}

function Get-ReferenceMeta {
  $p = Join-Path (Get-DaneWritePath) "$referenceName.meta.json"
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return $null }
  try { return (Get-Content -Raw -LiteralPath $p | ConvertFrom-Json) } catch { return $null }
}

function Invoke-ReferenceUpload($bytes, $by) {
  if (-not $uploadAllowed) {
    return New-JsonError 403 'Wgrywanie jest wylaczone w serve.ps1 (uploadAllowed).'
  }
  if (-not $bytes -or $bytes.Length -eq 0) {
    return New-JsonError 400 'Puste zadanie - nie przyszedl zaden plik.'
  }
  # Every .xlsx/.xlsm is a ZIP. Checking the signature rejects a .xls, a PDF or
  # a renamed text file before we spend time unzipping it.
  if ($bytes.Length -lt 4 -or $bytes[0] -ne 0x50 -or $bytes[1] -ne 0x4B -or
      $bytes[2] -ne 0x03 -or $bytes[3] -ne 0x04) {
    return New-JsonError 400 'To nie jest plik .xlsx ani .xlsm (brak sygnatury ZIP). Zapisz skoroszyt w nowszym formacie i sprobuj ponownie.'
  }

  $dir  = Get-DaneWritePath
  $temp = Join-Path $dir ("$referenceName.upload.tmp")
  try {
    [System.IO.File]::WriteAllBytes($temp, $bytes)

    # Parse first. If this throws, nothing has been replaced.
    $data = Read-ReferenceWorkbook $temp

    # One name wins. Removing the other extension matters: Find-InDane prefers
    # .xlsx, so an old .xlsx left behind would quietly outrank a fresh .xlsm.
    $target = Join-Path $dir "$referenceName.xlsm"
    $other  = Join-Path $dir "$referenceName.xlsx"
    [System.IO.File]::Copy($temp, $target, $true)
    if (Test-Path -LiteralPath $other -PathType Leaf) { Remove-Item -LiteralPath $other -Force }

    $meta = [ordered]@{
      uploadedAt = (Get-Date).ToString('o')
      uploadedBy = if ($by) { $by } else { '' }
      bytes      = $bytes.Length
      rows       = $data.rows
      links      = $data.links.Count
      sheet      = $data.sheet
    }
    # UTF-8 WITHOUT a BOM: Set-Content -Encoding UTF8 adds one and JSON.parse
    # refuses to read it.
    [System.IO.File]::WriteAllText(
      (Join-Path $dir "$referenceName.meta.json"),
      ($meta | ConvertTo-Json -Compress),
      (New-Object System.Text.UTF8Encoding $false))

    Write-Host ("  POST /api/reference -> przyjeto {0} B, {1} poz., {2} powiazan, od: {3}" -f `
      $bytes.Length, $data.rows, $data.links.Count, $(if ($by) { $by } else { '(nieznany)' })) -ForegroundColor Green

    $data | Add-Member -NotePropertyName uploadedAt -NotePropertyValue $meta.uploadedAt -Force
    $data | Add-Member -NotePropertyName uploadedBy -NotePropertyValue $meta.uploadedBy -Force
    $json = $data | ConvertTo-Json -Depth 5 -Compress
    return New-Reply 200 ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8'
  }
  catch {
    Write-Host ("  POST /api/reference -> odrzucono: " + $_.Exception.Message) -ForegroundColor Yellow
    return New-JsonError 400 ("Nie moge odczytac tego skoroszytu, wiec go nie podmieniam. " + $_.Exception.Message)
  }
  finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-Reference {
  $refPath = Get-ReferencePath
  if (-not $refPath) {
    $msg = "Nie znalazlem pliku z macierza inicjatyw. " + (Show-DaneHint $referenceName)
    if ($referenceFile) {
      $msg += " Sprawdzilem tez sciezke z serve.ps1 (w obu rozszerzeniach): $referenceFile."
      $msg += (Show-RefFolderHint $referenceFile)
    }
    else { $msg += " Mozesz tez wpisac pelna sciezke w zmiennej referenceFile na gorze serve.ps1." }
    return New-JsonError 503 $msg
  }
  try {
    $data = Read-ReferenceWorkbook $refPath
    Write-Host ("  /api/reference -> {0}, {1} poz., {2} powiazan, {3} bez numeru" -f `
      $data.sheet, $data.rows, $data.links.Count, $data.skipped) -ForegroundColor DarkGray
    # When the workbook came from an upload, say when and from whom: that is
    # what turns a stale matrix from invisible into obvious.
    $meta = Get-ReferenceMeta
    $data | Add-Member -NotePropertyName uploadedAt -NotePropertyValue $(if ($meta) { $meta.uploadedAt } else { '' }) -Force
    $data | Add-Member -NotePropertyName uploadedBy -NotePropertyValue $(if ($meta) { $meta.uploadedBy } else { '' }) -Force
    $data | Add-Member -NotePropertyName canUpload  -NotePropertyValue $uploadAllowed -Force

    $json = $data | ConvertTo-Json -Depth 5 -Compress
    return New-Reply 200 ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8'
  }
  catch {
    Write-Host ("  /api/reference -> blad: " + $_.Exception.Message) -ForegroundColor Yellow
    return New-JsonError 500 ($_.Exception.Message)
  }
}

# ---------------------------------------------------------------------------
#  Reading one HTTP request
# ---------------------------------------------------------------------------
#  Byte by byte, NOT through a StreamReader. A StreamReader buffers: after it
#  has read the headers it has usually swallowed part of the body as well, and
#  those bytes can never be recovered from the stream. That is invisible until
#  the first request that actually has a body - which is exactly what the
#  workbook upload is.
#
#  Headers are small, so reading them one byte at a time costs nothing and
#  removes the need to hand bytes back.
#
#  Returns @{ Method; Target; Auth; Body } where Body is a byte[] (possibly
#  empty), or $null when the connection carried nothing.
# ---------------------------------------------------------------------------
function Read-HttpRequest($stream, [int]$maxBody) {
  $head = New-Object System.Collections.Generic.List[byte]
  $one  = New-Object byte[] 1

  # Read up to the blank line that ends the header block. The 64 KB ceiling
  # stops a malformed request from growing this list without end.
  while ($head.Count -lt 65536) {
    $n = $stream.Read($one, 0, 1)
    if ($n -le 0) { break }
    [void]$head.Add($one[0])
    if ($head.Count -ge 4 -and
        $head[$head.Count - 4] -eq 13 -and $head[$head.Count - 3] -eq 10 -and
        $head[$head.Count - 2] -eq 13 -and $head[$head.Count - 1] -eq 10) { break }
  }
  if ($head.Count -eq 0) { return $null }

  $text  = [System.Text.Encoding]::UTF8.GetString($head.ToArray())
  $lines = $text -split "`r`n"
  if (-not $lines[0]) { return $null }

  $parts  = $lines[0].Split(' ')
  $method = $parts[0]
  $target = if ($parts.Length -ge 2) { $parts[1] } else { '/' }

  $auth = ''
  $len  = 0
  $by   = ''
  $user = ''
  for ($i = 1; $i -lt $lines.Length; $i++) {
    $h = $lines[$i]
    if (-not $h) { break }
    if ($h -like 'Authorization:*')  { $auth = $h.Substring(14).Trim() }
    elseif ($h -like 'Content-Length:*') { [void][int]::TryParse($h.Substring(15).Trim(), [ref]$len) }
    # Who is uploading. X-Remote-User is set by IIS from LOGON_USER and is the
    # only trustworthy source, so it wins; X-Uploaded-By comes from the page
    # itself and is only there for the local development server, where nobody
    # has signed in with a Windows account.
    elseif ($h -like 'X-Remote-User:*')  { $user = $h.Substring(14).Trim() }
    elseif ($h -like 'X-Uploaded-By:*')  { $by = $h.Substring(14).Trim() }
  }
  if ($user) { $by = $user }

  $body = New-Object byte[] 0
  if ($len -gt 0) {
    if ($maxBody -gt 0 -and $len -gt $maxBody) {
      # Refuse before allocating: a declared length is not a promise, but it is
      # enough to stop an accidental multi-gigabyte upload.
      return @{ Method = $method; Target = $target; Auth = $auth; By = $by; TooBig = $true; Body = $body }
    }
    $body = New-Object byte[] $len
    $got = 0
    while ($got -lt $len) {
      $n = $stream.Read($body, $got, $len - $got)
      if ($n -le 0) { break }
      $got += $n
    }
    if ($got -lt $len) { return @{ Method = $method; Target = $target; Auth = $auth; By = $by; Short = $true; Body = $body } }
  }

  return @{ Method = $method; Target = $target; Auth = $auth; By = $by; Body = $body }
}

# Loopback, deliberately: this server has no TLS and no authentication, and it
# proxies Jira and accepts matrix uploads. On a network address it would hand
# all of that to anyone who can reach the port. The report therefore runs only
# for the person sitting at this machine - putting it on a server for other
# people is a different job: IIS listens on the network and proxies here -
# see "Deployment" in README.md.
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

Write-Host ''
Write-Host "  Dashboard dziala:  http://localhost:$Port" -ForegroundColor Green
Write-Host "  Katalog:           $root"
if ($hasCreds) {
  Write-Host "  Jira:              $jiraBase jako $jiraEmail"
} else {
  Write-Host '  Jira:              brak danych logowania - ustaw JIRA_EMAIL i JIRA_TOKEN' -ForegroundColor Yellow
}
# The matrix normally arrives by upload and lands in dane\, so the banner asks
# the same resolver the API uses instead of looking only at $referenceFile -
# which is empty by default, and which Test-Path refuses as an empty string.
$refPath = Get-ReferencePath
if ($refPath) {
  $refWhen = ''
  $refMeta = Get-ReferenceMeta
  if ($refMeta -and $refMeta.uploadedAt) {
    # ConvertFrom-Json turns the stored ISO timestamp into a DateTime, which
    # interpolates in the host's culture - 10/29/2026 on an English Windows.
    # Format it explicitly so the banner reads the same everywhere.
    $when = $refMeta.uploadedAt
    if ($when -is [datetime]) { $when = $when.ToString('dd.MM.yyyy HH:mm') }
    $refWhen = "  (wgrano $when"
    if ($refMeta.uploadedBy) { $refWhen += " przez $($refMeta.uploadedBy)" }
    $refWhen += ')'
  }
  Write-Host "  Inicjatywy:        $refPath$refWhen"
} elseif ($referenceFile) {
  Write-Host "  Inicjatywy:        NIE ZNALEZIONO $referenceFile" -ForegroundColor Yellow
} else {
  Write-Host '  Inicjatywy:        brak macierzy - wgraj ja w raporcie (Inicjatywy strategiczne -> Wgraj nowa wersje)' -ForegroundColor Yellow
}
Write-Host '  Zatrzymanie:       Ctrl+C'
Write-Host ''

try {
  while ($true) {
    # Poll instead of blocking on AcceptTcpClient(): a blocked call gives
    # PowerShell no point at which to notice Ctrl+C, so the only way to stop
    # the server would be to close the window.
    if (-not $listener.Pending()) { Start-Sleep -Milliseconds 100; continue }
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      if ($stream.CanTimeout) { $stream.ReadTimeout = 20000 }

      $req = Read-HttpRequest $stream $uploadMaxBytes
      if ($null -eq $req) { continue }

      # The credentials the browser sends when the user signs in. Held for the
      # length of this request and never logged.
      $authHeader = $req.Auth
      $rawTarget  = $req.Target

      # Split off the query string; the API branch needs it, the static one
      # must not see it.
      $qIndex = $rawTarget.IndexOf('?')
      if ($qIndex -ge 0) {
        $rawPath  = $rawTarget.Substring(0, $qIndex)
        $rawQuery = $rawTarget.Substring($qIndex + 1)
      } else {
        $rawPath  = $rawTarget
        $rawQuery = ''
      }
      $rawPath = [System.Uri]::UnescapeDataString($rawPath)

      if ($rawPath -eq '/api/issues') {
        $reply = Invoke-JiraProxy $rawQuery $authHeader
      }
      elseif ($rawPath -eq '/api/reference') {
        if ($req.Method -eq 'POST') {
          if ($req.TooBig) {
            $reply = New-JsonError 413 ("Plik jest wiekszy niz limit $([int]($uploadMaxBytes/1MB)) MB.")
          } elseif ($req.Short) {
            $reply = New-JsonError 400 'Polaczenie urwalo sie w trakcie wysylania pliku.'
          } else {
            $reply = Invoke-ReferenceUpload $req.Body $req.By
          }
        } else {
          $reply = Invoke-Reference
        }
      }
      elseif ($rawPath -eq '/api/valuation') {
        $reply = Invoke-Valuation
      }
      else {
        if ($rawPath.EndsWith('/')) { $rawPath += 'index.html' }
        $relative = $rawPath.TrimStart('/').Replace('/', '\')
        $file = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

        # Refuse anything resolving outside public\ — a "..\.." in the URL must
        # not expose the rest of the disk.
        if (-not $file.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
          $reply = New-Reply '403 Forbidden' ([Text.Encoding]::UTF8.GetBytes('403')) 'text/plain; charset=utf-8'
        }
        elseif (Test-Path -LiteralPath $file -PathType Leaf) {
          $ext = [System.IO.Path]::GetExtension($file).ToLower()
          $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
          $reply = New-Reply 200 ([System.IO.File]::ReadAllBytes($file)) $type
        }
        else {
          $reply = New-Reply '404 Not Found' `
            ([Text.Encoding]::UTF8.GetBytes("404 - nie znaleziono: $rawPath")) 'text/plain; charset=utf-8'
        }
      }

      # A numeric status becomes "200 OK"; the string ones already carry a reason.
      $statusLine = if ($reply.Status -is [int]) {
        switch ($reply.Status) {
          200 { '200 OK' }
          400 { '400 Bad Request' }
          401 { '401 Unauthorized' }
          403 { '403 Forbidden' }
          413 { '413 Payload Too Large' }
          500 { '500 Internal Server Error' }
          502 { '502 Bad Gateway' }
          503 { '503 Service Unavailable' }
          default { "$($reply.Status) Error" }
        }
      } else { $reply.Status }

      $body = $reply.Body
      $header = "HTTP/1.1 $statusLine`r`n" +
                "Content-Type: $($reply.Type)`r`n" +
                "Content-Length: $($body.Length)`r`n" +
                "Cache-Control: no-store`r`n" +
                "Connection: close`r`n`r`n"
      $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)

      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($body, 0, $body.Length)
      $stream.Flush()
    }
    catch {
      # A browser dropping a connection mid-request is normal; keep serving.
      Write-Host "  (pominieto zadanie: $($_.Exception.Message))" -ForegroundColor DarkGray
    }
    finally {
      $client.Close()
    }
  }
}
finally {
  $listener.Stop()
  Write-Host '  Serwer zatrzymany.'
}
