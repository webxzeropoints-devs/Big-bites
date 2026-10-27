!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $2 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$2" uninstall_powershell_found uninstall_missing_powershell

  uninstall_powershell_found:
  IfFileExists "$INSTDIR\resources\windows\Stop-BigBitesServer.ps1" uninstall_script_found uninstall_missing_script

  uninstall_script_found:
  ClearErrors
  ExecWait '"$2" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows\Stop-BigBitesServer.ps1"' $0
  IfErrors uninstall_cleanup_failed
  IntCmp $0 0 uninstall_cleanup_complete uninstall_cleanup_failed uninstall_cleanup_failed
  Goto uninstall_cleanup_complete

  uninstall_missing_powershell:
  MessageBox MB_ICONSTOP "Windows PowerShell is unavailable. The POS server could not be stopped, so uninstall was cancelled."
  Abort

  uninstall_missing_script:
  MessageBox MB_ICONSTOP "The POS server shutdown script is missing, so uninstall was cancelled."
  Abort

  uninstall_cleanup_failed:
  MessageBox MB_ICONSTOP "The POS server could not be stopped cleanly. Uninstall was cancelled to avoid leaving a background server running."
  Abort

  uninstall_cleanup_complete:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $1 "$TEMP\BIG-BITES-POS-setup.log"
  IfFileExists "$INSTDIR\resources\windows\Install-BigBites.ps1" setup_script_found setup_missing_setup_script

  setup_script_found:
  IfFileExists "$INSTDIR\resources\server\dist\server.js" setup_server_found setup_missing_server

  setup_server_found:
  IfFileExists "$INSTDIR\resources\server\node_modules\prisma\build\index.js" setup_dependencies_found setup_missing_dependencies

  setup_dependencies_found:
  IfFileExists "$INSTDIR\resources\windows\node-runtime\node.exe" setup_node_found setup_missing_node_runtime

  setup_node_found:
  StrCpy $2 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$2" setup_powershell_found setup_missing_powershell

  setup_powershell_found:
  DetailPrint "Configuring the local BIG BITES POS server and PostgreSQL..."
  DetailPrint "Setup progress and PostgreSQL download/install status will be shown below."
  nsExec::ExecToLog /TIMEOUT=7200000 '"$2" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows\Install-BigBites.ps1" -InstallDir "$INSTDIR" -ServerSourcePath "$INSTDIR\resources\server" -LogPath "$1"'
  Pop $0
  StrCmp $0 "error" setup_launch_failed
  StrCmp $0 "timeout" setup_timed_out
  IntCmp $0 0 setup_success setup_failed setup_failed

  setup_success:
  ExecShell "" "$INSTDIR\desktop.exe"
  Goto setup_complete

  setup_missing_setup_script:
  MessageBox MB_ICONSTOP "The local server setup script is missing. The desktop application was not started."
  Abort

  setup_missing_server:
  MessageBox MB_ICONSTOP "The bundled local server is missing. The desktop application was not started."
  Abort

  setup_missing_dependencies:
  MessageBox MB_ICONSTOP "The bundled server dependencies are missing. The desktop application was not started."
  Abort

  setup_missing_node_runtime:
  MessageBox MB_ICONSTOP "The bundled Node.js runtime is missing. The desktop application was not started."
  Abort

  setup_missing_powershell:
  MessageBox MB_ICONSTOP "Windows PowerShell is unavailable. Local server setup cannot continue."
  Abort

  setup_launch_failed:
  MessageBox MB_ICONSTOP "Could not start local server setup. Check the setup log at $1. The desktop application was not started."
  Abort

  setup_timed_out:
  MessageBox MB_ICONSTOP "Local server setup exceeded the 2-hour setup limit and was stopped. Check the setup log at $1, confirm PostgreSQL/download access, then retry setup. The desktop application was not started."
  Abort

  setup_failed:
  MessageBox MB_ICONSTOP "Local server setup failed (exit code $0). Check the setup log at $1. The desktop application was not started."
  Abort

  setup_complete:
!macroend
