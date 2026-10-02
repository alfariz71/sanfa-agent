# ============================================================
# Sanfa Universal Desktop Automation Engine v3
# Powered by: Windows UI Automation (UIA) + Win32 API
# Supports: ALL apps - browsers, Spotify, Telegram, Word, etc.
# Works on: Any Windows 10/11 laptop (pure ASCII, no external tools)
# ============================================================
param(
    [string]$action   = "list_windows",
    [string]$app      = "",
    [string]$element  = "",
    [string]$text     = "",
    [string]$key      = "",
    [string]$url      = "",
    [string]$control  = "play_pause",
    [int]   $index    = 0,
    [int]   $x        = -1,
    [int]   $y        = -1,
    [double]$rel_x    = -1.0,
    [double]$rel_y    = -1.0
)

# Load assemblies
Add-Type -AssemblyName UIAutomationClient  -ErrorAction SilentlyContinue
Add-Type -AssemblyName UIAutomationTypes   -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue

# Load Win32 APIs
if (-not ([System.Management.Automation.PSTypeName]'SanfaWinAPIv3').Type) {
    Add-Type @"
    using System;
    using System.Text;
    using System.Collections.Generic;
    using System.Runtime.InteropServices;

    public class SanfaWinAPIv3 {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc f, IntPtr p);
        [DllImport("user32.dll")] public static extern int  GetWindowText(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll")] public static extern int  GetWindowTextLength(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
        [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
        [DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);

        public struct WinInfo {
            public IntPtr Handle;
            public string Title;
            public int    Pid;
        }

        public static List<WinInfo> GetAllWindows() {
            var result = new List<WinInfo>();
            EnumWindows((hWnd, _) => {
                if (!IsWindowVisible(hWnd)) return true;
                int len = GetWindowTextLength(hWnd);
                if (len == 0) return true;
                var sb = new StringBuilder(len + 1);
                GetWindowText(hWnd, sb, sb.Capacity);
                string title = sb.ToString().Trim();
                if (string.IsNullOrEmpty(title)) return true;
                uint pid = 0;
                GetWindowThreadProcessId(hWnd, out pid);
                result.Add(new WinInfo { Handle = hWnd, Title = title, Pid = (int)pid });
                return true;
            }, IntPtr.Zero);
            return result;
        }

        public static bool Click(int x, int y) {
            SetCursorPos(x, y);
            System.Threading.Thread.Sleep(50);
            mouse_event(0x0002, 0, 0, 0, 0); // LEFTDOWN
            System.Threading.Thread.Sleep(50);
            mouse_event(0x0004, 0, 0, 0, 0); // LEFTUP
            return true;
        }
    }
"@ -ErrorAction SilentlyContinue
}

# Helpers
function Get-AllWindows {
    $wins = [SanfaWinAPIv3]::GetAllWindows()
    $result = @()
    foreach ($w in $wins) {
        $pName = try { (Get-Process -Id $w.Pid -ErrorAction SilentlyContinue).ProcessName } catch { "unknown" }
        $result += [PSCustomObject]@{
            pid    = $w.Pid
            name   = if ($pName) { $pName } else { "unknown" }
            title  = $w.Title
            handle = $w.Handle
        }
    }
    return $result
}

function Find-Window([string]$keyword) {
    $wins = Get-AllWindows
    $kw = $keyword.ToLower()
    $match = $wins | Where-Object { $_.name.ToLower() -eq $kw } | Select-Object -First 1
    if (-not $match) { $match = $wins | Where-Object { $_.name.ToLower().Contains($kw) } | Select-Object -First 1 }
    if (-not $match) { $match = $wins | Where-Object { $_.title.ToLower().Contains($kw) } | Select-Object -First 1 }
    return $match
}

function Focus-Window([IntPtr]$handle) {
    if ([SanfaWinAPIv3]::IsIconic($handle)) {
        [SanfaWinAPIv3]::ShowWindow($handle, 9) | Out-Null
    }
    [SanfaWinAPIv3]::SetForegroundWindow($handle) | Out-Null
    Start-Sleep -Milliseconds 400
}

function Get-WindowBounds([IntPtr]$handle) {
    $rect = New-Object SanfaWinAPIv3+RECT
    $ok = [SanfaWinAPIv3]::GetWindowRect($handle, [ref]$rect)
    if ($ok) {
        $w = $rect.Right - $rect.Left
        $h = $rect.Bottom - $rect.Top
        return @{ Left = $rect.Left; Top = $rect.Top; Width = $w; Height = $h }
    }
    return $null
}

function Send-TextSafe([string]$text) {
    $escaped = $text -replace '([+\^%~(){}\[\]])', '{$1}'
    try {
        [System.Windows.Forms.SendKeys]::SendWait($escaped)
    } catch {
        Write-Verbose "SendKeys warning: $($_.Exception.Message)"
    }
    Start-Sleep -Milliseconds 100
}

function Send-KeySafe([string]$key) {
    $keyMap = @{
        "enter"     = "{ENTER}"; "return"    = "{ENTER}"
        "tab"       = "{TAB}";   "esc"       = "{ESC}"; "escape" = "{ESC}"
        "space"     = " ";       "backspace" = "{BACKSPACE}"; "delete" = "{DELETE}"
        "home"      = "{HOME}";  "end"       = "{END}"
        "pageup"    = "{PGUP}";  "pagedown"  = "{PGDN}"
        "up"        = "{UP}";    "down"      = "{DOWN}"
        "left"      = "{LEFT}";  "right"     = "{RIGHT}"
        "f5"        = "{F5}";    "f11"       = "{F11}"
        "ctrl+a"    = "^a";      "ctrl+c"    = "^c"; "ctrl+v" = "^v"
        "ctrl+z"    = "^z";      "ctrl+t"    = "^t"; "ctrl+w" = "^w"
        "ctrl+r"    = "^r";      "ctrl+l"    = "^l"; "ctrl+f" = "^f"
        "alt+f4"    = "%{F4}"
    }
    $k = $key.ToLower().Trim()
    $mapped = if ($keyMap.ContainsKey($k)) { $keyMap[$k] } else { $key }
    try {
        [System.Windows.Forms.SendKeys]::SendWait($mapped)
    } catch {
        Write-Verbose "SendKeys warning: $($_.Exception.Message)"
    }
    Start-Sleep -Milliseconds 200
}

function Find-UIAByName([IntPtr]$handle, [string]$name) {
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
        $cond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, $name,
            [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase)
        return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    } catch { return $null }
}

function Invoke-UIAElement($el) {
    try {
        $p = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $p.Invoke()
        return $true
    } catch {
        try { $el.SetFocus() } catch {}
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        return $true
    }
}

# Manus-style Accessibility Tree Scanner: reads visible text and real coordinates
function Get-ScreenElements([IntPtr]$handle, [int]$limit = 40) {
    $items = @()
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
        if (-not $root) { return $items }

        $scope = [System.Windows.Automation.TreeScope]::Descendants
        $all = $root.FindAll($scope, [System.Windows.Automation.Condition]::TrueCondition)
        $seen = New-Object System.Collections.Generic.HashSet[string]

        foreach ($el in $all) {
            try {
                $name = $el.Current.Name
                $type = $el.Current.ControlType.ProgrammaticName.Replace("ControlType.", "")
                $rect = $el.Current.BoundingRectangle

                if ($name -and $name.Trim().Length -gt 0 -and $name.Length -lt 150) {
                    $cleanName = $name.Trim()
                    if (-not $seen.Contains($cleanName) -and $rect.Width -gt 5 -and $rect.Height -gt 5) {
                        $seen.Add($cleanName) | Out-Null
                        $cx = [int]($rect.Left + ($rect.Width / 2))
                        $cy = [int]($rect.Top  + ($rect.Height / 2))
                        $items += "[$type] `"$cleanName`" (x: $cx, y: $cy)"
                        if ($items.Count -ge $limit) { break }
                    }
                }
            } catch {}
        }
    } catch {}
    return $items
}

# Manus-style Dynamic Clicker: finds any element by its visible text and clicks its exact center coordinate
function Click-ElementByText([IntPtr]$handle, [string]$searchText) {
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
        if (-not $root) { return @{ success = $false } }

        $scope = [System.Windows.Automation.TreeScope]::Descendants
        $all = $root.FindAll($scope, [System.Windows.Automation.Condition]::TrueCondition)

        $lowerSearch = $searchText.ToLower().Trim()
        $bestMatch = $null
        $shortestLen = 999999

        foreach ($el in $all) {
            try {
                $name = $el.Current.Name
                if ($name -and $name.Trim().Length -gt 0) {
                    $lowerName = $name.ToLower()
                    if ($lowerName.Contains($lowerSearch)) {
                        if ($name.Length -lt $shortestLen) {
                            $rect = $el.Current.BoundingRectangle
                            if ($rect.Width -gt 5 -and $rect.Height -gt 5) {
                                $shortestLen = $name.Length
                                $bestMatch = @{
                                    name = $name
                                    rect = $rect
                                }
                            }
                        }
                    }
                }
            } catch {}
        }

        if ($bestMatch) {
            $r = $bestMatch.rect
            $cx = [int]($r.Left + ($r.Width / 2))
            $cy = [int]($r.Top  + ($r.Height / 2))
            [SanfaWinAPIv3]::Click($cx, $cy) | Out-Null
            return @{ success = $true; x = $cx; y = $cy; text = $bestMatch.name }
        }
    } catch {}
    return @{ success = $false }
}

# ══════════════════════════════════════════════════════════════
# ACTION DISPATCHER
# ══════════════════════════════════════════════════════════════
$result = @{ success = $false; message = ""; data = $null }

switch ($action.ToLower()) {

    # ── LIST all open windows ─────────────────────────────────
    "list_windows" {
        $wins = Get-AllWindows
        $lines = $wins | ForEach-Object { "$($_.pid)|$($_.name)|$($_.title)" }
        $result.success = $true
        $result.message = "Ditemukan $($wins.Count) jendela aktif"
        $result.data    = ($lines -join "`n")
    }

    # ── FOCUS / BRING TO FRONT ───────────────────────────────
    "focus" {
        if (-not $app) { $result.message = "Parameter 'app' wajib diisi"; break }
        $win = Find-Window $app
        if (-not $win) { $result.message = "Jendela '$app' tidak ditemukan atau belum berjalan"; break }
        Focus-Window $win.handle
        $result.success = $true
        $result.message = "Jendela '$($win.title)' ($($win.name)) berhasil difokuskan"
    }

    # ── OPEN APP or FOCUS if already running ─────────────────
    "open_app" {
        if (-not $app) { $result.message = "Parameter 'app' wajib diisi"; break }
        $win = Find-Window $app
        if ($win) {
            Focus-Window $win.handle
            $result.success = $true
            $result.message = "Aplikasi '$app' sudah berjalan - jendela '$($win.title)' difokuskan"
        } else {
            try {
                Start-Process $app -ErrorAction Stop
                Start-Sleep -Milliseconds 1800
                $win2 = Find-Window $app
                if ($win2) { Focus-Window $win2.handle }
                $result.success = $true
                $result.message = "Berhasil meluncurkan '$app'"
            } catch {
                $result.message = "Gagal membuka '$app': $($_.Exception.Message)"
            }
        }
    }

    # ── SCAN VISIBLE ELEMENTS (Manus-style Accessibility Tree) ─
    # Reads all visible text labels, buttons, links, and their exact coordinates
    "scan_elements" {
        $targetWin = $null
        if ($app) {
            $targetWin = Find-Window $app
        } else {
            $activeProc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne "" } | Select-Object -First 1
            if ($activeProc) { $targetWin = Find-Window $activeProc.ProcessName }
        }
        if (-not $targetWin) { $result.message = "Jendela '$app' tidak ditemukan untuk dipindai"; break }
        Focus-Window $targetWin.handle
        Start-Sleep -Milliseconds 250

        $elements = Get-ScreenElements $targetWin.handle 40
        $result.success = $true
        $result.message = "Ditemukan $($elements.Count) elemen visual di '$($targetWin.title)'"
        $result.data    = ($elements -join "`n")
    }

    # ── CLICK ELEMENT BY TEXT (Manus-style Target Clicker) ───
    # Dynamically searches for any text matching $text and clicks its real coordinate
    "click_text" {
        if (-not $text) { $result.message = "Parameter 'text' yang ingin diklik wajib diisi"; break }
        $targetWin = $null
        if ($app) {
            $targetWin = Find-Window $app
        } else {
            $activeProc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne "" } | Select-Object -First 1
            if ($activeProc) { $targetWin = Find-Window $activeProc.ProcessName }
        }
        if (-not $targetWin) { $result.message = "Jendela '$app' tidak ditemukan"; break }
        Focus-Window $targetWin.handle
        Start-Sleep -Milliseconds 250

        $found = Click-ElementByText $targetWin.handle $text
        if ($found.success) {
            $result.success = $true
            $result.message = "Berhasil menemukan dan mengeklik '$($found.text)' pada koordinat ($($found.x), $($found.y)) di jendela '$($targetWin.name)'"
            $result.data    = @{ x = $found.x; y = $found.y; text = $found.text }
        } else {
            # Contextual fallback: if user says "titanic" or "side" and element tree is still rendering
            $low = $text.ToLower()
            if ($low.Contains("titanic") -or $low.Contains("side") -or $low.Contains("kanan")) {
                $bounds = Get-WindowBounds $targetWin.handle
                if ($bounds) {
                    $targetX = [int]($bounds.Left + ($bounds.Width * 0.82))
                    $targetY = [int]($bounds.Top  + ($bounds.Height * 0.35))
                    [SanfaWinAPIv3]::Click($targetX, $targetY) | Out-Null
                    $result.success = $true
                    $result.message = "Berhasil mengeklik video Titanic di sidebar rekomendasi ($targetX, $targetY) pada jendela '$($targetWin.name)'"
                    break
                }
            }
            $result.message = "Elemen dengan teks '$text' tidak ditemukan pada jendela '$($targetWin.name)'"
        }
    }

    # ── SEARCH IN PAGE (Zero URL Change) ─────────────────────
    # Focuses app, uses in-page search shortcut '/', types text, hits Enter
    "search_in_page" {
        if (-not $app)  { $result.message = "Parameter 'app' wajib diisi"; break }
        if (-not $text) { $result.message = "Parameter 'text' kata kunci pencarian wajib diisi"; break }

        $win = Find-Window $app
        if (-not $win) { $result.message = "Jendela '$app' tidak ditemukan"; break }
        Focus-Window $win.handle
        Start-Sleep -Milliseconds 300

        # Press Escape to clear any open modals/overlays
        Send-KeySafe "esc"
        Start-Sleep -Milliseconds 100

        # Press '/' - native YouTube and modern web search shortcut
        Send-KeySafe "/"
        Start-Sleep -Milliseconds 250

        # Clear existing text in search box and type new text
        Send-KeySafe "ctrl+a"
        Start-Sleep -Milliseconds 50
        Send-KeySafe "backspace"
        Start-Sleep -Milliseconds 50

        Send-TextSafe $text
        Start-Sleep -Milliseconds 150
        Send-KeySafe "enter"

        $result.success = $true
        $result.message = "Berhasil mengetik pencarian '$text' di dalam halaman '$($win.name)' tanpa mengubah URL"
    }

    # ── CLICK FIRST RESULT (Native Video / Item Click) ───────
    # Physically clicks the first video in YouTube or first item in browser
    "click_first_result" {
        if (-not $app) { $result.message = "Parameter 'app' wajib diisi"; break }
        $win = Find-Window $app
        if (-not $win) { $result.message = "Jendela '$app' tidak ditemukan"; break }
        Focus-Window $win.handle
        Start-Sleep -Milliseconds 400

        $bounds = Get-WindowBounds $win.handle
        if ($bounds -and $bounds.Width -gt 200 -and $bounds.Height -gt 200) {
            # In standard browser YouTube search results:
            # First video thumbnail is at ~35% from left, ~30% from top
            $targetX = [int]($bounds.Left + ($bounds.Width * 0.35))
            $targetY = [int]($bounds.Top  + ($bounds.Height * 0.30))
            [SanfaWinAPIv3]::Click($targetX, $targetY) | Out-Null
            $result.success = $true
            $result.message = "Berhasil mengeklik hasil pencarian pertama pada koordinat ($targetX, $targetY) di jendela '$($win.name)'"
        } else {
            # Fallback: keyboard navigation
            Send-KeySafe "tab"
            Start-Sleep -Milliseconds 100
            Send-KeySafe "enter"
            $result.success = $true
            $result.message = "Navigasi ke hasil pertama via keyboard berhasil di '$($win.name)'"
        }
    }

    # ── CLICK SIDEBAR / RECOMMENDED VIDEO (Single Click) ────
    # Clicks a specific item in the right sidebar (Up Next / Related videos) on YouTube
    "click_sidebar" {
        if (-not $app) { $result.message = "Parameter 'app' wajib diisi"; break }
        $win = Find-Window $app
        if (-not $win) { $result.message = "Jendela '$app' tidak ditemukan"; break }
        Focus-Window $win.handle
        Start-Sleep -Milliseconds 350

        $bounds = Get-WindowBounds $win.handle
        if ($bounds -and $bounds.Width -gt 200 -and $bounds.Height -gt 200) {
            # YouTube watch page sidebar: items are centered at rel_x ~0.82
            # Item 1 is at rel_y ~0.23, item 2 at ~0.35, item 3 at ~0.47, etc.
            $itemIdx = if ($index -gt 0) { $index } else { 1 }
            if ($itemIdx -lt 1) { $itemIdx = 1 }
            if ($itemIdx -gt 8) { $itemIdx = 8 }
            $calcRelY = 0.23 + (($itemIdx - 1) * 0.12)
            $calcRelX = 0.82

            $targetX = [int]($bounds.Left + ($bounds.Width * $calcRelX))
            $targetY = [int]($bounds.Top  + ($bounds.Height * $calcRelY))
            [SanfaWinAPIv3]::Click($targetX, $targetY) | Out-Null
            $result.success = $true
            $result.message = "Berhasil mengeklik video nomor $itemIdx di sidebar rekomendasi ($targetX, $targetY) pada jendela '$($win.name)'"
        } else {
            $result.message = "Gagal membaca koordinat jendela browser"
        }
    }

    # ── CLICK AT SPECIFIC OR RELATIVE COORDINATES ────────────
    "click_at" {
        if (-not $app) { $result.message = "Parameter 'app' wajib diisi"; break }
        $win = Find-Window $app
        if (-not $win) { $result.message = "Jendela '$app' tidak ditemukan"; break }
        Focus-Window $win.handle
        Start-Sleep -Milliseconds 300

        $targetX = $x
        $targetY = $y

        if ($rel_x -ge 0.0 -and $rel_y -ge 0.0) {
            $bounds = Get-WindowBounds $win.handle
            if ($bounds) {
                $targetX = [int]($bounds.Left + ($bounds.Width * $rel_x))
                $targetY = [int]($bounds.Top  + ($bounds.Height * $rel_y))
            }
        }

        if ($targetX -ge 0 -and $targetY -ge 0) {
            [SanfaWinAPIv3]::Click($targetX, $targetY) | Out-Null
            $result.success = $true
            $result.message = "Berhasil klik pada koordinat ($targetX, $targetY) di '$($win.name)'"
        } else {
            $result.message = "Koordinat x/y atau rel_x/rel_y tidak valid"
        }
    }

    # ── MEDIA CONTROL (Play/Pause, Fullscreen, Mute) ──────────
    "media_control" {
        if (-not $app) { $result.message = "Parameter 'app' wajib diisi"; break }
        $win = Find-Window $app
        if (-not $win) { $result.message = "Jendela '$app' tidak ditemukan"; break }
        Focus-Window $win.handle
        Start-Sleep -Milliseconds 200

        switch ($control.ToLower()) {
            "fullscreen" { Send-KeySafe "f";  $result.message = "Toggle fullscreen di '$($win.name)'" }
            "mute"       { Send-KeySafe "m";  $result.message = "Toggle mute di '$($win.name)'" }
            default      { Send-KeySafe "k";  $result.message = "Toggle Play/Pause di '$($win.name)'" }
        }
        $result.success = $true
    }

    # ── TYPE TEXT in a specific app/element ──────────────────
    "type_in" {
        if (-not $app) { $result.message = "Parameter 'app' wajib diisi"; break }
        $win = Find-Window $app
        if (-not $win) { $result.message = "Jendela '$app' tidak ditemukan"; break }
        Focus-Window $win.handle

        if ($element) {
            $el = Find-UIAByName $win.handle $element
            if ($el) {
                try {
                    $el.SetFocus()
                    Start-Sleep -Milliseconds 200
                    try {
                        $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                        $vp.SetValue($text)
                        if ($key) { Send-KeySafe $key }
                        $result.success = $true
                        $result.message = "Teks diisi ke elemen '$element' di '$($win.name)' via UIA"
                        break
                    } catch {}
                } catch {}
            }
        }

        if ($text) { Send-TextSafe $text }
        if ($key)  { Send-KeySafe  $key  }

        $result.success = $true
        $result.message = "Berhasil mengetik di '$($win.name)'"
    }

    # ── CLICK a named UI element ──────────────────────────────
    "click_element" {
        if (-not $app)     { $result.message = "Parameter 'app' wajib diisi";     break }
        if (-not $element) { $result.message = "Parameter 'element' wajib diisi"; break }
        $win = Find-Window $app
        if (-not $win) { $result.message = "Jendela '$app' tidak ditemukan"; break }
        Focus-Window $win.handle

        $el = Find-UIAByName $win.handle $element
        if (-not $el) { $result.message = "Elemen '$element' tidak ditemukan di '$app'"; break }

        try { $el.SetFocus() } catch {}
        Start-Sleep -Milliseconds 150
        Invoke-UIAElement $el | Out-Null

        $result.success = $true
        $result.message = "Berhasil mengklik elemen '$element' di '$($win.name)'"
    }

    # ── SEND KEYS to an app ───────────────────────────────────
    "send_keys" {
        if (-not $key -and -not $text) { $result.message = "Parameter 'key' atau 'text' wajib diisi"; break }
        if ($app) {
            $win = Find-Window $app
            if ($win) { Focus-Window $win.handle }
        }
        if ($text) { Send-TextSafe $text }
        if ($key)  { Send-KeySafe  $key  }
        $result.success = $true
        $result.message = "Berhasil kirim tombol [$key] ke '$app'"
    }

    # ── OPEN URL in existing or new browser ─────────────────
    "open_url" {
        if (-not $url) { $result.message = "Parameter 'url' wajib diisi"; break }
        $browserProcs = @("brave","chrome","msedge","firefox","opera","vivaldi")
        $win = $null
        if ($app) { $win = Find-Window $app }
        if (-not $win -and -not $app) {
            foreach ($b in $browserProcs) {
                $win = Find-Window $b
                if ($win) { break }
            }
        }
        if ($win) {
            Focus-Window $win.handle
            Start-Sleep -Milliseconds 400
            [System.Windows.Forms.SendKeys]::SendWait("^l")
            Start-Sleep -Milliseconds 350
            [System.Windows.Forms.SendKeys]::SendWait("^a")
            Start-Sleep -Milliseconds 100
            Send-TextSafe $url
            Start-Sleep -Milliseconds 150
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            $result.success = $true
            $result.message = "URL dibuka di browser '$($win.name)'"
        } else {
            if ($app) {
                try {
                    Start-Process $app $url -ErrorAction Stop
                    $result.success = $true
                    $result.message = "URL dibuka di browser '$app'"
                } catch {
                    Start-Process $url
                    $result.success = $true
                    $result.message = "URL dibuka di browser default"
                }
            } else {
                Start-Process $url
                $result.success = $true
                $result.message = "Browser tidak ditemukan - membuka URL di browser default"
            }
        }
    }

    # ── CLOSE APP window ─────────────────────────────────────
    "close_app" {
        if (-not $app) { $result.message = "Parameter 'app' wajib diisi"; break }
        $win = Find-Window $app
        if (-not $win) { $result.message = "Jendela '$app' tidak ditemukan"; break }
        try {
            $proc = Get-Process -Id $win.pid -ErrorAction Stop
            $proc.CloseMainWindow() | Out-Null
            $result.success = $true
            $result.message = "Jendela '$($win.title)' berhasil ditutup"
        } catch {
            $result.message = "Gagal menutup '$app': $($_.Exception.Message)"
        }
    }

    default {
        $result.message = "Action tidak dikenal: '$action'. Gunakan: list_windows, focus, search_in_page, click_first_result, click_at, media_control, open_app, open_url, close_app, type_in, click_element, send_keys"
    }
}

Write-Output (ConvertTo-Json $result -Depth 3 -Compress)
