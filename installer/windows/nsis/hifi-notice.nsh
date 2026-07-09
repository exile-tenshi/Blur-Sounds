; Override electron-builder's default app-running check.
; The stock check treats ANY process under $INSTDIR as the app, which includes
; VoiceMeeterEngine.exe and makes upgrades fail with "cannot be closed".

!macro BLUR_SOUNDS_IS_PROCESS_RUNNING IMAGE RESULT
  nsExec::ExecToStack '"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${IMAGE}" /NH | find /I "${IMAGE}"'
  Pop $0
  Pop ${RESULT}
  ${If} $0 == 0
    StrCpy ${RESULT} 0
  ${Else}
    StrCpy ${RESULT} 1
  ${EndIf}
!macroend

!macro BLUR_SOUNDS_KILL_PROCESSES FORCE
  !ifdef INSTALL_MODE_PER_ALL_USERS
    ${If} ${FORCE} == 1
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "VoiceMeeterEngine.exe"'
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "Uninstall Blur Sounds.exe"'
    ${Else}
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /T /IM "${APP_EXECUTABLE_FILENAME}"'
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /T /IM "VoiceMeeterEngine.exe"'
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /T /IM "Uninstall Blur Sounds.exe"'
    ${EndIf}
  !else
    ${If} ${FORCE} == 1
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"'
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "VoiceMeeterEngine.exe" /FI "USERNAME eq %USERNAME%"'
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "Uninstall Blur Sounds.exe" /FI "USERNAME eq %USERNAME%"'
    ${Else}
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"'
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /T /IM "VoiceMeeterEngine.exe" /FI "USERNAME eq %USERNAME%"'
      nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /T /IM "Uninstall Blur Sounds.exe" /FI "USERNAME eq %USERNAME%"'
    ${EndIf}
  !endif
!macroend

!macro customInit
  !insertmacro BLUR_SOUNDS_KILL_PROCESSES 1
  Sleep 500
!macroend

!macro customInstall
  IfFileExists "$INSTDIR\Uninstall Blur Sounds.exe" 0 blur_skip_uninstall_delete
    SetFileAttributes "$INSTDIR\Uninstall Blur Sounds.exe" FILE_ATTRIBUTE_NORMAL
    Delete "$INSTDIR\Uninstall Blur Sounds.exe"
  blur_skip_uninstall_delete:
!macroend

!macro customCheckAppRunning
  Push $R0
  Push $R1
  Push $R2

  StrCpy $R1 0

  blur_close_retry:
    StrCpy $R2 0

    !insertmacro BLUR_SOUNDS_IS_PROCESS_RUNNING "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      StrCpy $R2 1
    ${EndIf}

    !insertmacro BLUR_SOUNDS_IS_PROCESS_RUNNING "VoiceMeeterEngine.exe" $R0
    ${If} $R0 == 0
      StrCpy $R2 1
    ${EndIf}

    ${If} $R2 == 0
      Goto blur_close_done
    ${EndIf}

    ${If} $R1 == 0
      DetailPrint "Closing Blur Sounds..."
      !insertmacro BLUR_SOUNDS_KILL_PROCESSES 0
      Sleep 1500
      IntOp $R1 $R1 + 1
      Goto blur_close_retry
    ${ElseIf} $R1 == 1
      DetailPrint "Force closing Blur Sounds..."
      !insertmacro BLUR_SOUNDS_KILL_PROCESSES 1
      Sleep 1500
      IntOp $R1 $R1 + 1
      Goto blur_close_retry
    ${Else}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY blur_close_retry
      Quit
    ${EndIf}

  blur_close_done:
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

Function .onInstSuccess
  MessageBox MB_OK|MB_ICONINFORMATION "Blur Sounds is installed.$\r$\n$\r$\nBlur Sounds requires VB-Audio Hi-Fi Cable.$\r$\n$\r$\nDownload from vb-audio.com/Cable if Hi-Fi Cable Input is missing.$\r$\n$\r$\nSet both Hi-Fi Cable Input and Output to 24 bit, 384000 Hz (Studio Quality) in Windows Sound → Advanced."
FunctionEnd
