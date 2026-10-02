param(
    [string]$text = "",
    [string]$key = ""
)

$code = '
using System;
using System.Runtime.InteropServices;
public class KeybdOps {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    
    [DllImport("user32.dll")]
    public static extern short VkKeyScan(char ch);

    public static void SendKey(byte vk, bool shift = false) {
        if (shift) keybd_event(0x10, 0, 0, UIntPtr.Zero);
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(20);
        keybd_event(vk, 0, 2, UIntPtr.Zero);
        if (shift) keybd_event(0x10, 0, 2, UIntPtr.Zero);
    }

    public static void TypeText(string text) {
        foreach (char c in text) {
            short vkScan = VkKeyScan(c);
            byte vk = (byte)(vkScan & 0xff);
            bool shift = (vkScan & 0x100) != 0;
            SendKey(vk, shift);
            System.Threading.Thread.Sleep(25);
        }
    }
}
'
try {
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
} catch {}

if ($text) {
    [KeybdOps]::TypeText($text)
}

if ($key) {
    switch ($key.ToLower()) {
        "enter"     { [KeybdOps]::SendKey(0x0D) }
        "tab"       { [KeybdOps]::SendKey(0x09) }
        "esc"       { [KeybdOps]::SendKey(0x1B) }
        "escape"    { [KeybdOps]::SendKey(0x1B) }
        "space"     { [KeybdOps]::SendKey(0x20) }
        "backspace" { [KeybdOps]::SendKey(0x08) }
        "up"        { [KeybdOps]::SendKey(0x26) }
        "down"      { [KeybdOps]::SendKey(0x28) }
        "left"      { [KeybdOps]::SendKey(0x25) }
        "right"     { [KeybdOps]::SendKey(0x27) }
        default     {
            if ($key.Length -eq 1) {
                [KeybdOps]::TypeText($key)
            }
        }
    }
}

@{ success = $true; text = $text; key = $key } | ConvertTo-Json -Compress