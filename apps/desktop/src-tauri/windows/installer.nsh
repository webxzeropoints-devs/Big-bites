!macro NSIS_HOOK_POSTINSTALL
  StrCpy $1 "$TEMP\BIG-BITES-POS-setup.log"
  IfFileExists "$INSTDIR\resources\Install-BigBites.ps1" setup_script_found setup_missing_script
  setup_missing_script:
  DetailPrint "Setup warning: bundled Install-BigBites.ps1 is missing from $INSTDIR\resources."
  goto setup_complete
  setup_script_found:
  IfFileExists "$INSTDIR\resources\server\dist\server.js" setup_server_found setup_missing_server
  setup_missing_server:
  DetailPrint "Bundled server resources are missing from $INSTDIR\resources\server; continuing without the local bundled server."
  goto setup_server_found
  setup_server_found:
  StrCpy $2 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$2" setup_powershell_found setup_missing_powershell
  setup_missing_powershell:
  DetailPrint "Setup warning: 64-bit Windows PowerShell is missing at $2."
  goto setup_complete
  setup_powershell_found:
  DetailPrint "Configuring BIG BITES POS server and network access..."
  DetailPrint "Install directory: $INSTDIR"
  DetailPrint "Server resources: $INSTDIR\resources\server"
  DetailPrint "Setup log: $1"
  ClearErrors
  ExecWait '"$2" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\Install-BigBites.ps1" -InstallDir "$INSTDIR" -ServerSourcePath "$INSTDIR\resources\server" -LogPath "$1"' $0
  IfErrors setup_launch_failed
  DetailPrint "PowerShell installer exit code: $0"
  IntCmp $0 0 setup_complete setup_failed setup_failed
  setup_launch_failed:
  DetailPrint "Setup warning: unable to launch Windows PowerShell."
  goto setup_complete
  setup_failed:
  DetailPrint "Setup warning: PowerShell returned exit code $0. See $1"
  goto setup_complete
  setup_complete:
  DetailPrint "BIG BITES POS startup continues."
  ExecShell "" "$INSTDIR\desktop.exe"
!macroend
