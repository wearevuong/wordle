let ws = null;
let currentUsername = "";
let currentGuess = "";
let currentRow = 0;
const grid = [];
const WORD_LENGTH = 5;
const MAX_ATTEMPTS = 6;
let isMyTurn = true;
let gameStarted = false;
let keyStates = {};
let hangmanErrors = 0;
let isHost = false;
let countdownInterval = null;
let countdownTotal = 45;

// ---- Mobile Tab Switching ----
function showTab(tab) {
    const left = document.querySelector('.left-sidebar');
    const right = document.querySelector('.right-sidebar');
    const tabs = document.querySelectorAll('.mob-tab');
    if (!tabs.length) return; // desktop: no tabs rendered

    left.classList.remove('mob-active');
    right.classList.remove('mob-active');
    tabs.forEach(t => t.classList.remove('active'));

    if (tab === 'left') {
        left.classList.add('mob-active');
        tabs[0].classList.add('active');
    } else if (tab === 'center') {
        tabs[1].classList.add('active');
    } else {
        right.classList.add('mob-active');
        tabs[2].classList.add('active');
    }
}

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
const playerList = document.getElementById('player-list');
const difficultyControls = document.getElementById('difficulty-controls');
const modeBadge = document.getElementById('mode-badge');
const countdownDisplay = document.getElementById('countdown-display');
const countdownNumber = document.getElementById('countdown-number');
const countdownArc = document.getElementById('countdown-arc');

// SVG arc circumference for countdown ring
const CIRC = 2 * Math.PI * 34; // r=34

function initGrid() {
    grid.length = 0;
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

function appendLog(msg) {
    console.log("[SERVER]", msg);
}

function connectWS() {
    ws = new WebSocket(`ws://${window.location.hostname}:3000`);
    ws.onopen = () => { btnLogin.innerText = "Set Username"; appendLog("[SYSTEM] Connected."); };
    ws.onmessage = (event) => parseServerMessage(event.data);
    ws.onclose = () => { appendLog("[SYSTEM] Connection lost."); btnLogin.innerText = "Disconnected"; };
}

// ---- Countdown Timer ----
function startCountdown(seconds) {
    stopCountdown();
    countdownTotal = seconds;
    countdownDisplay.style.display = 'flex';
    countdownArc.style.strokeDasharray = CIRC;
    countdownArc.style.strokeDashoffset = 0;

    let remaining = seconds;
    countdownNumber.innerText = remaining;

    countdownInterval = setInterval(() => {
        remaining--;
        countdownNumber.innerText = remaining;
        const progress = remaining / countdownTotal;
        countdownArc.style.strokeDashoffset = CIRC * (1 - progress);

        // Color changes
        if (remaining <= 10) {
            countdownArc.style.stroke = '#ef4444';
            countdownNumber.style.color = '#ef4444';
        } else if (remaining <= 20) {
            countdownArc.style.stroke = '#f59e0b';
            countdownNumber.style.color = '#f59e0b';
        }

        if (remaining <= 0) stopCountdown();
    }, 1000);
}

function stopCountdown() {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    countdownDisplay.style.display = 'none';
    countdownArc.style.stroke = '#6ee7b7';
    countdownNumber.style.color = '';
}

// ---- Player List (Waiting Room) ----
function updatePlayerList(playersStr, hostName) {
    const names = playersStr.split(',').filter(n => n.trim() !== '');
    playerList.innerHTML = '';
    names.forEach(name => {
        const li = document.createElement('li');
        li.className = 'player-item';
        li.innerHTML = `<span class="player-name">${name.trim()}${name.trim() === hostName ? ' 👑' : ''}</span>`;

        // Only host can kick, and cannot kick themselves
        if (isHost && name.trim() !== currentUsername) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'btn-kick';
            kickBtn.innerText = 'Kick';
            kickBtn.onclick = () => sendCmd(`/kick ${name.trim()}`);
            li.appendChild(kickBtn);
        }
        playerList.appendChild(li);
    });
}

function setMode(mode) {
    sendCmd(`/mode ${mode}`);
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

// ---- Main Server Message Parser ----
function parseServerMessage(msg) {
    appendLog(msg);

    // --- PLAYERS UPDATE ---
    if (msg.startsWith("PLAYERS:")) {
        const payload = msg.substring(8); // everything after "PLAYERS:"
        const hostSplit = payload.split("|HOST:");
        const playersStr = hostSplit[0];
        const hostName = hostSplit[1] || "";
        isHost = (hostName.trim() === currentUsername);
        difficultyControls.style.display = isHost ? 'block' : 'none';
        updatePlayerList(playersStr, hostName.trim());
        return;
    }

    // --- KICKED ---
    if (msg.startsWith("KICKED:")) {
        showToast(msg.substring(7));
        setTimeout(() => window.location.reload(), 2500);
        return;
    }

    // --- MODE CHANGE ---
    if (msg.startsWith("MODE:")) {
        const parts = msg.substring(5).split("|");
        const mode = parts[0]; // "easy" or "hard"
        const notice = parts[1] || "";
        if (mode === "hard") {
            modeBadge.innerText = "HARD 30s";
            modeBadge.className = "mode-badge hard";
            document.getElementById('btn-easy').classList.remove('active');
            document.getElementById('btn-hard').classList.add('active');
        } else {
            modeBadge.innerText = "EASY 45s";
            modeBadge.className = "mode-badge easy";
            document.getElementById('btn-hard').classList.remove('active');
            document.getElementById('btn-easy').classList.add('active');
        }
        if (notice) showToast(notice);
        return;
    }

    // --- COUNTDOWN ---
    if (msg.startsWith("COUNTDOWN:")) {
        const secs = parseInt(msg.substring(10));
        startCountdown(secs);
        return;
    }

    // --- USERNAME SET ---
    if (msg.includes("Username set to")) {
        roomControls.style.display = "block";
        btnLogin.style.display = "none";
        document.getElementById('username-input').style.display = "none";
    }

    // --- ROOM JOIN / CREATE ---
    let roomCode = "";
    const codeMatch1 = msg.match(/code:\s*([A-Za-z0-9]+)/i);
    const codeMatch2 = msg.match(/room\s+([A-Za-z0-9]+)/i);
    if (codeMatch1) roomCode = codeMatch1[1];
    else if (codeMatch2) roomCode = codeMatch2[1];

    if (msg.includes("Joined room") || msg.includes("Room created")) {
        domLoginPanel.style.display = "none";
        domGamePanel.style.display = "flex";
        initGrid();
        showToast(msg.includes("Room created") ? "Room Created! You are the host." : "Room Joined!");
        if (roomCode) document.getElementById('room-status').innerText = `ROOM: ${roomCode.toUpperCase()}`;
        if (msg.includes("Room created")) {
            isHost = true;
            difficultyControls.style.display = 'block';
        }
    }

    // --- GAME START ---
    if (msg.includes("Game starting!") || msg.includes("starts!")) {
        currentGuess = "";
        isMyTurn = true;
        gameStarted = true;
        btnStart.disabled = true;
        showToast("Match Started!");
        showTab('center'); // Auto-switch to Game tab on mobile
    }


    // --- LEADERBOARD ---
    if (msg.includes("--- Room Leaderboard ---")) {
        stopCountdown();
        const lines = msg.split('\n');
        const entries = [];
        lines.forEach(l => {
            const m = l.match(/(.*?):\s+(\d+)\s+pts/);
            if (m) entries.push({ name: m[1].trim(), pts: parseInt(m[2]) });
        });

        const medals = ['🥇', '🥈', '🥉'];
        const maxPts = entries.length > 0 ? Math.max(...entries.map(e => e.pts)) : 1;

        let html = '<h2 class="lb-title">🏆 Final Scoreboard</h2><div class="lb-entries">';
        entries.forEach((e, i) => {
            const pct = maxPts > 0 ? Math.round((e.pts / maxPts) * 100) : 0;
            const medal = medals[i] || `#${i + 1}`;
            const top = i < 3 ? `lb-rank-${i + 1}` : '';
            html += `
              <div class="lb-row ${top}">
                <span class="lb-medal">${medal}</span>
                <span class="lb-name">${e.name}</span>
                <div class="lb-bar-wrap">
                  <div class="lb-bar" style="width:${pct}%"></div>
                </div>
                <span class="lb-pts">${e.pts} pts</span>
              </div>`;
        });
        html += `</div><button class='btn primary lb-close' onclick='document.getElementById("leaderboard-modal").style.display="none"'>Close</button>`;
        leaderboardContent.innerHTML = html;
        leaderboardModal.style.display = "flex";
    }

    // --- RESULT LINES ---
    const guessLines = msg.split('\n');
    guessLines.forEach(rawLine => {
        const line = rawLine.trim();

        if (line.includes("Waiting for others")) showToast("Waiting for other players...");

        const didNotMatch = line.match(/(.*?):\s+Did not guess/i);
        if (didNotMatch) {
            const player = didNotMatch[1].trim();
            if (player === currentUsername) fillMissedRow();
            else updateOpponentBoard(player, "     ", "xxxxx");
        }

        const resultMatch = line.match(/(.*?):\s+([A-Za-z]{5})\s+->\s+([vx~]{5})/i);
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

        if (line.includes("[Global Chat]") && !gameStarted) isMyTurn = true;

        if (line.includes("Too many") || line.includes("exactly 5") || line.includes("already guessed")) {
            showToast(line);
            isMyTurn = true;
        }
    });

    if (msg.includes("Game Over") || msg.includes("Out of attempts")) {
        showToast("End of Match!");
        gameStarted = false;
        btnStart.disabled = false;
        stopCountdown();
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
    const name = document.getElementById('username-input').value.trim();
    if (name) { currentUsername = name; sendCmd(`/username ${name}`); }
};

document.getElementById('btn-create').onclick = () => sendCmd("/create");

// BUG FIX: Always send room code as UPPERCASE to match server
document.getElementById('btn-join').onclick = () => {
    const code = document.getElementById('roomcode-input').value.trim().toUpperCase();
    if (code) sendCmd(`/join ${code}`);
};

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
    if (!gameStarted) { showToast("Press 'Start Match' first!"); return; }
    if (!isMyTurn || currentRow >= MAX_ATTEMPTS) return;

    if (key === 'BACKSPACE') { currentGuess = currentGuess.slice(0, -1); updateGridVisual(); return; }
    if (key === 'ENTER') {
        if (currentGuess.length === WORD_LENGTH) {
            sendCmd(currentGuess);
            isMyTurn = false;
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
