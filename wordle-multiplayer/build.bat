@echo off
rem Automatically append MSYS2 GCC path to the current terminal environment
set PATH=C:\msys64\ucrt64\bin;C:\msys64\mingw64\bin;%PATH%

echo Building Wordle Multiplayer Server (C TCP Core)...
gcc src/server/main.c src/server/game.c src/server/room.c src/server/scoreboard.c src/common/protocol.c -o wordle_server.exe -lws2_32
if %errorlevel% neq 0 (
    echo [ERROR] Server build failed! Please check your GCC installation.
    pause
    exit /b %errorlevel%
)

echo.
echo =========================================
echo [SUCCESS] Server build completed!
echo =========================================
echo.
echo To start the Wordle Game Server, double-click wordle_server.exe or type:
echo    wordle_server.exe
echo.
echo Next, don't forget to run the Node.js Web Server in the web/ folder:
echo    cd web
echo    node server.js
echo.
pause
