const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('New web client connected via WebSocket');

    // Connect to C Server
    const tcpClient = new net.Socket();
    tcpClient.connect(8888, '127.0.0.1', () => {
        console.log('Connected to locally running C Server (Port 8888)');
    });

    let buffer = Buffer.alloc(0);

    // Xử lý data từ C Server (TCP) gửi về Web
    tcpClient.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);

        // Decode Length-Prefixed Framing (4 bytes Big Endian)
        while (buffer.length >= 4) {
            const msgLength = buffer.readUInt32BE(0);
            if (buffer.length >= 4 + msgLength) {
                const payload = buffer.toString('utf8', 4, 4 + msgLength);
                buffer = buffer.slice(4 + msgLength);
                ws.send(payload); // Push cho giao diện Web (Frontend)
            } else {
                break; // Chờ nhận thêm data bị phân mảnh
            }
        }
    });

    tcpClient.on('error', (err) => {
        console.error('TCP Connection Error:', err);
        ws.send('[SYSTEM] Lỗi kết nối tới Server C++. Hãy chắc chắn bạn đã chạy wordle_server.exe!');
    });

    tcpClient.on('close', () => {
        console.log('TCP Connection closed');
        ws.close();
    });

    // Nhận Input từ Giao diện Web (Chat hoặc Đoán từ)
    ws.on('message', (message) => {
        const msgStr = message.toString();
        const payloadBuffer = Buffer.from(msgStr, 'utf8');

        // Encode Length-Prefixed Framing (4 Bytes Big Endian)
        const lengthBuffer = Buffer.alloc(4);
        lengthBuffer.writeUInt32BE(payloadBuffer.length, 0);

        // Bơm data xuống C Server
        tcpClient.write(lengthBuffer);
        tcpClient.write(payloadBuffer);
    });

    ws.on('close', () => {
        tcpClient.destroy();
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Wordle Web Interface đang chạy tại: http://localhost:${PORT}`);
    console.log(`Node.js Middleware đang lắng nghe WebSocket liên kết với C Server Port 8888.`);
});