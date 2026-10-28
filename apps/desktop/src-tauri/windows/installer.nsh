!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ExecShell "" "$INSTDIR\desktop.exe"
!macroend
