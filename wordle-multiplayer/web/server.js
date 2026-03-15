const net = require('net');
const WebSocket = require('ws');
const WS_PORT = 3000;
const TCP_PORT = 8080;
const TCP_HOST = '127.0.0.1';

//Khởi tạo WebSocket Server (Lắng nghe Client/Frontend)
const wss = new WebSocket.Server({ port: WS_PORT }, () => {
    console.log(`[WebSocket] Server đang chạy ở cổng ${WS_PORT}`);
});

//Khởi tạo TCP Client (Kết nối tới Server C)
const tcpClient = new net.Socket();

function connectToTCP() {
    tcpClient.connect(TCP_PORT, TCP_HOST, () => {
        console.log(`[TCP] Đã kết nối thành công tới Backend C tại cổng ${TCP_PORT}`);
    });
}

connectToTCP();

//Luồng TCP -> Websocket (Backend C trả kết quả Wordle về Frontend)
tcpClient.on('data', (data) => {
    const message = data.toString().trim();
    console.log(`[Backend C gửi]: ${message}`);

    // Bắn kết quả này cho tất cả Frontend đang mở
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
});

tcpClient.on('error', (err) => {
    console.error('[TCP Lỗi]:', err.message);
});

tcpClient.on('close', () => {
    console.log('[TCP] Mất kết nối tới Backend. Thử lại sau 3 giây...');
    setTimeout(connectToTCP, 3000);
});

//Luồng websocket -> TCP (Nhận từ người chơi gửi xuống Backend C)
wss.on('connection', (ws) => {
    console.log('[WebSocket] Một Client (Frontend) vừa kết nối!');

    ws.on('message', (message) => {
        const clientMsg = message.toString().trim();
        console.log(`[Frontend gửi]: ${clientMsg}`);

        // Đẩy thẳng data từ Frontend xuống Backend C qua TCP (thêm \n để C dễ đọc)
        if (!tcpClient.destroyed) {
            tcpClient.write(clientMsg + '\n');
        } else {
            console.log('[Lỗi] Không thể gửi vì TCP Backend đang sập.');
        }
    });

    ws.on('close', () => {
        console.log('[WebSocket] Client đã ngắt kết nối.');
    });
});