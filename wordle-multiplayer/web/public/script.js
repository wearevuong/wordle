let ws = null;
let currentUsername = "";
let currentGuess = "";
let currentRow = 0;
const grid = [];
const WORD_LENGTH = 5;
const MAX_ATTEMPTS = 6;
let isMyTurn = true;
let gameStarted = false; // Add state to prevent ghost typing
let keyStates = {};
let hangmanErrors = 0;

// Elements
const domLoginPanel = document.getElementById('lobby-container');
const domGamePanel = document.getElementById('game-container');
const btnLogin = document.getElementById('btn-login');
const roomControls = document.getElementById('room-controls');
const statusToast = document.getElementById('notification-toast');
const btnStart = document.getElementById('btn-start');
const btnLeave = document.getElementById('btn-leave');
const opponentGrids = document.getElementById('opponent-grids');
const txtHangmanStatus = document.getElementById('hangman-status');
const leaderboardModal = document.getElementById('leaderboard-modal');
const leaderboardContent = document.getElementById('leaderboard-content');

// Initialization
function initGrid() {
    grid.length = 0; // Prevent referencing old detached DOM nodes!
    const gridEl = document.getElementById('wordle-grid');
    gridEl.innerHTML = '';
    for (let r = 0; r < MAX_ATTEMPTS; r++) {
        const rowData = [];
        const rowEl = document.createElement('div');
        rowEl.className = 'grid-row';
        for (let c = 0; c < WORD_LENGTH; c++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            rowEl.appendChild(cell);
            rowData.push(cell);
        }
        gridEl.appendChild(rowEl);
        grid.push(rowData);
    }
}

function showToast(msg) {
    statusToast.innerText = msg;
    statusToast.style.opacity = 1;
    setTimeout(() => { if (statusToast.innerText === msg) statusToast.style.opacity = 0; }, 3000);
}

function appendLog(msg, isMatchLog = false) {
    // Log functionality removed per user request. We just log to console for debugging.
    console.log("[SERVER]", msg);
}

function connectWS() {
    ws = new WebSocket(`ws://${window.location.hostname}:3000`);
    ws.onopen = () => { btnLogin.innerText = "Set Username"; appendLog("[SYSTEM] Connected to TCP."); };
    ws.onmessage = (event) => parseServerMessage(event.data);
    ws.onclose = () => { appendLog("[SYSTEM] Connection lost."); btnLogin.innerText = "Disconnected"; };
}

function fillMissedRow() {
    for (let i = 0; i < WORD_LENGTH; i++) {
        const cell = grid[currentRow][i];
        cell.innerText = '-';
        cell.classList.add('state-absent');
    }
    currentRow++;
    currentGuess = "";
    isMyTurn = true;
}

// THE C SERVER PARSER
function parseServerMessage(msg) {
    appendLog(msg, domGamePanel.style.display !== 'none');

    if (msg.includes("Username set to")) {
        roomControls.style.display = "block";
        btnLogin.style.display = "none";
        document.getElementById('username-input').style.display = "none";
    }

    // Room Code Regex Fix (Case insensitive with spaces)
    let roomCode = "";
    const codeMatch1 = msg.match(/code:\s*([A-Za-z0-9]+)/i);
    const codeMatch2 = msg.match(/room\s+([A-Za-z0-9]+)/i);
    if (codeMatch1) roomCode = codeMatch1[1];
    else if (codeMatch2) roomCode = codeMatch2[1];

    if (msg.includes("Joined room") || msg.includes("Room created")) {
        domLoginPanel.style.display = "none";
        domGamePanel.style.display = "flex";
        initGrid();
        showToast("Room Joined!");
        if (roomCode) document.getElementById('room-status').innerText = `ROOM: ${roomCode.toUpperCase()}`;
    }

    if (msg.includes("Game starting!") || msg.includes("starts!")) {
        currentGuess = "";
        isMyTurn = true;
        gameStarted = true;
        btnStart.disabled = true; // Disable Start button until game ends
        showToast("Match Started!");
    }

    // LEADERBOARD LOGIC
    if (msg.includes("--- Room Leaderboard ---")) {
        let html = "<h2>Final Scores</h2><ul>";
        const lines = msg.split('\n');
        lines.forEach(l => {
            const m = l.match(/(.*?):\s+(\d+)\s+pts/);
            if (m) {
                html += `<li><span>${m[1]}</span> <span>${m[2]} pts</span></li>`;
            }
        });
        html += "</ul><button class='btn primary' onclick='document.getElementById(\"leaderboard-modal\").style.display=\"none\"'>Close</button>";
        leaderboardContent.innerHTML = html;
        leaderboardModal.style.display = "flex";
    }

    // EXTRACT RESULT STRING: "vuong: PAPER -> ~xvvx"
    const guessLines = msg.split('\n');
    guessLines.forEach(rawLine => {
        const line = rawLine.trim();

        if (line.includes("Waiting for others")) {
            showToast("Waiting for other players...");
        }

        const didNotMatch = line.match(/(.*?):\s+Did not guess/i);
        if (didNotMatch) {
            const player = didNotMatch[1].trim();
            if (player === currentUsername) {
                fillMissedRow(); // We missed the turn! Fill with blank and advance row
            } else {
                updateOpponentBoard(player, "     ", "xxxxx");
            }
        }

        const resultMatch = line.match(/(.*?):\s+([A-Za-z]{5})\s+->\s+([vx\~]{5})/i);

        if (resultMatch) {
            const player = resultMatch[1].trim();
            const word = resultMatch[2].toUpperCase();
            const hints = resultMatch[3].toLowerCase();

            if (player === currentUsername) {
                applyColorResultToGrid(word, hints);

                if (hints !== "vvvvv") {
                    hangmanErrors++;
                    if (hangmanErrors <= 6) {
                        const bone = document.querySelector(`.hm-${hangmanErrors}`);
                        if (bone) bone.style.opacity = 1;
                        txtHangmanStatus.innerText = `${hangmanErrors} / 6 Failed Guesses`;
                    }
                }
            } else {
                updateOpponentBoard(player, word, hints);
            }
        }

        if (line.includes("[Global Chat]")) {
            // Unlock isMyTurn if we accidentally sent global chat from Keyboard
            if (!gameStarted) isMyTurn = true;
        }

        if (line.includes("Too many") || line.includes("exactly 5") || line.includes("already guessed")) {
            showToast(line);
            isMyTurn = true; // Unlock so user can retype correctly
        }
    });

    if (msg.includes("Game Over") || msg.includes("Out of attempts")) {
        showToast("End of Match!");
        gameStarted = false; // Freeze keyboard
        btnStart.disabled = false; // Re-enable start match button
        setTimeout(() => {
            currentRow = 0;
            currentGuess = "";
            keyStates = {};
            hangmanErrors = 0;
            txtHangmanStatus.innerText = `0 / 6 Failed Guesses`;
            document.querySelectorAll('.hm-part:not(.hm-base):not(.hm-pole):not(.hm-rope)').forEach(el => el.style.opacity = 0);
            opponentGrids.innerHTML = '';
            resetKeyboardColors();
            initGrid();
        }, 5000);
    }
}

function updateOpponentBoard(playerName, word, hints) {
    let emojis = "";
    for (let i = 0; i < hints.length; i++) {
        let char = hints[i];
        let w = word[i] || " ";
        if (char === 'v') emojis += `<div class="mini-box correct">${w}</div>`;
        else if (char === '~') emojis += `<div class="mini-box present">${w}</div>`;
        else emojis += `<div class="mini-box absent">${w}</div>`;
    }

    let oppDiv = document.getElementById(`opp-${playerName}`);
    if (!oppDiv) {
        oppDiv = document.createElement('div');
        oppDiv.id = `opp-${playerName}`;
        oppDiv.className = 'opponent';
        oppDiv.innerHTML = `<h4>${playerName}</h4><div class="mini-blocks"></div>`;
        opponentGrids.appendChild(oppDiv);
    }
    oppDiv.querySelector('.mini-blocks').innerHTML += `<div class="opponent-word-row">${emojis}</div>`;
}

function sendCmd(cmd) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(cmd); }

btnLogin.onclick = () => {
    const name = document.getElementById('username-input').value;
    if (name) { currentUsername = name; sendCmd(`/username ${name}`); }
};
document.getElementById('btn-create').onclick = () => sendCmd("/create");
document.getElementById('btn-join').onclick = () => sendCmd(`/join ${document.getElementById('roomcode-input').value}`);
btnStart.onclick = () => sendCmd("/start");
btnLeave.onclick = () => { window.location.reload(); };

function updateGridVisual() {
    for (let i = 0; i < WORD_LENGTH; i++) {
        const cell = grid[currentRow][i];
        cell.innerText = currentGuess[i] || '';
        if (currentGuess[i]) cell.classList.add('filled');
        else cell.classList.remove('filled');
    }
}

function handleKeyPress(key) {
    if (domGamePanel.style.display === 'none') return;

    if (!gameStarted) {
        showToast("Press 'Start Match' first!");
        return;
    }

    if (!isMyTurn || currentRow >= MAX_ATTEMPTS) return;

    if (key === 'BACKSPACE') {
        currentGuess = currentGuess.slice(0, -1);
        updateGridVisual(); return;
    }
    if (key === 'ENTER') {
        if (currentGuess.length === WORD_LENGTH) {
            sendCmd(currentGuess);
            isMyTurn = false; // Lock UI until server returns Result
        } else {
            const rowEl = grid[currentRow][0].parentElement;
            rowEl.classList.remove('shake');
            void rowEl.offsetWidth;
            rowEl.classList.add('shake');
            showToast("Not enough letters");
        }
        return;
    }
    if (/^[A-Z]$/.test(key) && currentGuess.length < WORD_LENGTH) {
        currentGuess += key;
        updateGridVisual();
    }
}

document.getElementById('keyboard').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') handleKeyPress(e.target.getAttribute('data-key'));
});

window.addEventListener('keydown', (e) => {
    if (document.activeElement === document.getElementById('username-input') ||
        document.activeElement === document.getElementById('roomcode-input')) return;
    let key = e.key.toUpperCase();
    if (key === 'BACKSPACE' || key === 'ENTER') handleKeyPress(key);
    else if (/^[A-Z]$/.test(key)) handleKeyPress(key);
});

function applyColorResultToGrid(word, hints) {
    for (let i = 0; i < WORD_LENGTH; i++) {
        const cell = grid[currentRow][i];
        const letter = word[i];
        const hintChar = hints[i];

        let stateClass = '';
        let stateRank = 0;

        setTimeout(() => {
            cell.classList.add('flip-animation');
            if (hintChar === 'v') { stateClass = 'state-correct'; stateRank = 3; }
            else if (hintChar === '~') { stateClass = 'state-present'; stateRank = 2; }
            else { stateClass = 'state-absent'; stateRank = 1; }

            cell.classList.add(stateClass);

            const currentRank = keyStates[letter] || 0;
            if (stateRank > currentRank) {
                keyStates[letter] = stateRank;
                const keyBtn = document.querySelector(`button[data-key="${letter}"]`);
                if (keyBtn) {
                    keyBtn.classList.remove('state-correct', 'state-present', 'state-absent');
                    keyBtn.classList.add(stateClass);
                }
            }
        }, i * 200);
    }

    // Unlock and advance row
    setTimeout(() => {
        currentRow++;
        currentGuess = "";
        isMyTurn = true;
    }, WORD_LENGTH * 200 + 100);
}

function resetKeyboardColors() {
    document.querySelectorAll('#keyboard button').forEach(btn => {
        btn.classList.remove('state-correct', 'state-present', 'state-absent');
    });
}
connectWS();
