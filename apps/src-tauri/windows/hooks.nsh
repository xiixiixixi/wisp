; Wisp NSIS Installer Hooks
; Registers "Open with Wisp" context menu entries on install,
; and cleans up all registry entries on uninstall.

!macro NSIS_HOOK_POSTINSTALL
  ; Register "Open with Wisp" context menu for folders
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithWisp" "" "Open with Wisp"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithWisp" "Icon" "$INSTDIR\Wisp.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithWisp\command" "" '"$INSTDIR\Wisp.exe" "%1"'

  ; Register for drives (C:\, D:\, etc.)
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenWithWisp" "" "Open with Wisp"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenWithWisp" "Icon" "$INSTDIR\Wisp.exe"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenWithWisp\command" "" '"$INSTDIR\Wisp.exe" "%1"'

  ; Register for folder background (right-click empty space inside folder)
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithWisp" "" "Open with Wisp"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithWisp" "Icon" "$INSTDIR\Wisp.exe"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithWisp\command" "" '"$INSTDIR\Wisp.exe" "%V"'

  ; Notify Windows shell of association change
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove context menu entries
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenWithWisp"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenWithWisp"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenWithWisp"

  ; If Wisp was set as default handler, restore Windows Explorer
  ReadRegStr $0 HKCU "Software\Classes\Directory\shell" ""
  StrCmp $0 "OpenWithWisp" 0 +2
    DeleteRegValue HKCU "Software\Classes\Directory\shell" ""

  ReadRegStr $0 HKCU "Software\Classes\Drive\shell" ""
  StrCmp $0 "OpenWithWisp" 0 +2
    DeleteRegValue HKCU "Software\Classes\Drive\shell" ""

  ; Notify Windows shell of association change
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend
