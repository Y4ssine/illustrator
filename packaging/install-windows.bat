@echo off
REM Artboard Forge - development install for Windows (unsigned build).
REM Double-click this file.
setlocal
set "HERE=%~dp0"
set "DEST=%APPDATA%\Adobe\CEP\extensions"
echo Artboard Forge installer
echo 1/3  Allowing unsigned panels for CEP 11 and 12 (PlayerDebugMode)...
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo 2/3  Copying the panel to: %DEST%
if not exist "%DEST%" mkdir "%DEST%"
if exist "%DEST%\com.artboardforge.panel" rmdir /s /q "%DEST%\com.artboardforge.panel"
xcopy "%HERE%com.artboardforge.panel" "%DEST%\com.artboardforge.panel\" /e /i /q /y >nul
echo 3/3  Done.
echo.
echo Next: quit Illustrator completely, reopen it, then Window ^> Extensions ^> Artboard Forge.
echo Self-test: File ^> Scripts ^> Other Script... ^> tests\af-selftest.jsx (in this folder).
echo.
pause
