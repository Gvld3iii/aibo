' Aibo Launcher
' Double-click or add shortcut to shell:startup for auto-launch
' Runs Aibo with no terminal window

Dim objShell
Set objShell = CreateObject("WScript.Shell")

' Get the folder this script lives in
Dim scriptDir
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' Launch Electron silently — no terminal window
objShell.Run """" & scriptDir & "node_modules\electron\dist\electron.exe"" .", 0, False

Set objShell = Nothing