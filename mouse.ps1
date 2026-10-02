param(
    [string]$action = "click",
    [int]$x = -1,
    [int]$y = -1
)

$code = '
using System;
using System.Runtime.InteropServices;

public class MouseOps {
    [DllImport("user32.dll")]
    public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);
    
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }
}
'

try {
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
} catch {}

$MOUSEEVENTF_LEFTDOWN   = 0x0002
$MOUSEEVENTF_LEFTUP     = 0x0004
$MOUSEEVENTF_RIGHTDOWN  = 0x0008
$MOUSEEVENTF_RIGHTUP    = 0x0010

function Get-MousePosition {
    $p = New-Object MouseOps+POINT
    [MouseOps]::GetCursorPos([ref]$p) | Out-Null
    return @{ x = $p.X; y = $p.Y }
}

if ($action -eq "get_pos") {
    $pos = Get-MousePosition
    $pos | ConvertTo-Json -Compress
    exit 0
}

if ($x -ge 0 -and $y -ge 0) {
    [MouseOps]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 40
}

switch ($action.ToLower()) {
    "move" {
        $pos = Get-MousePosition
        @{ success = $true; action = "move"; x = $pos.x; y = $pos.y } | ConvertTo-Json -Compress
    }
    "click" {
        [MouseOps]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 30
        [MouseOps]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        $pos = Get-MousePosition
        @{ success = $true; action = "click"; x = $pos.x; y = $pos.y } | ConvertTo-Json -Compress
    }
    "double_click" {
        [MouseOps]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 30
        [MouseOps]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 100
        [MouseOps]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 30
        [MouseOps]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        $pos = Get-MousePosition
        @{ success = $true; action = "double_click"; x = $pos.x; y = $pos.y } | ConvertTo-Json -Compress
    }
    "right_click" {
        [MouseOps]::mouse_event($MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 30
        [MouseOps]::mouse_event($MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
        $pos = Get-MousePosition
        @{ success = $true; action = "right_click"; x = $pos.x; y = $pos.y } | ConvertTo-Json -Compress
    }
    default {
        @{ error = "Action tidak dikenal: $action" } | ConvertTo-Json -Compress
    }
}
