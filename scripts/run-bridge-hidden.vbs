' Sanfa Bridge Silent Background Launcher
' Menjalankan Sanfa Bridge di background tanpa jendela CMD hitam sama sekali

Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

scriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
bridgeScript = objFSO.BuildPath(scriptDir, "sanfa-bridge.mjs")

If Not objFSO.FileExists(bridgeScript) Then
    MsgBox "File sanfa-bridge.mjs tidak ditemukan di: " & scriptDir, 16, "Sanfa Bridge Error"
    WScript.Quit 1
End If

' Parameter 0 = Hidden window (tanpa popup jendela hitam)
cmd = "node """ & bridgeScript & """"
objShell.Run cmd, 0, False
