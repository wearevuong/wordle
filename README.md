\# Wordle Multiplayer 🌍



Một tựa game Wordle trực tuyến hỗ trợ nhiều người chơi cùng lúc (Multiplayer).



Dự án là sự kết hợp giữa:

\- \*\*Backend Lõi:\*\* Lập trình bằng hệ thống mạng `C TCP Sockets`.

\- \*\*Frontend \& Cầu nối:\*\* Lập trình giao diện tĩnh kết hợp với `Node.js WebSockets` để giao tiếp thời gian thực.



---



\## 💻 Yêu cầu hệ thống

1\. \*\*Trình biên dịch C:\*\* (Dùng GCC của MinGW/MSYS2 là chuẩn nhất).

2\. \*\*Node.js:\*\* Kèm `npm` để chạy máy chủ giao diện Web.



---



\## 🚀 Hướng dẫn Cài đặt \& Khởi chạy



\### 1. Build Lõi Game (C TCP Server)

Tại thư mục gốc của project (nơi chứa file `build.bat`), bạn chỉ cần chạy lệnh sau trên Terminal để biên dịch toàn bộ mã C:

```bash

build.bat

```

\*(Nếu thành công, file `wordle\_server.exe` sẽ được tạo ra).\*



Để bắt đầu Host Server, hãy chạy file exe đó:

```bash

wordle\_server.exe

```



\### 2. Khởi chạy Giao diện Web (Node.js)

Mở một cửa sổ Terminal THỨ HAI và đi vào thư mục `web/`:

```bash

cd web

npm install

node server.js

```

\*(Khi hiện thông báo `Server listening on port 3000` tức là cầu nối WebSockets đã kết nối thành công với lõi C).\*



---



\## 🎮 Cách truy cập \& Chơi game



1\. Mở bất kỳ Trình duyệt nào (Chrome/Edge/Cốc Cốc) và truy cập:

&nbsp;  👉 \*\*`http://localhost:3000`\*\*

2\. \*\*Nhập Tên:\*\* Điền tên hiển thị của bạn.

3\. \*\*Phòng chơi (Rooms):\*\* 

&nbsp;  - Có thể \*\*Tạo phòng mới\*\* (Hệ thống sẽ cấp 1 mã Code 6 chữ số).

&nbsp;  - Truyền mã Code đó cho bạn bè để họ bấn \*\*Vào phòng\*\*.

4\. \*\*Bắt đầu:\*\* Thành viên đầu tiên vào phòng là Chủ phòng. Chủ phòng cần mở khung chat và gõ lệnh `/start` để kích hoạt game.

5\. \*\*Luật chơi:\*\* Bạn có 6 lượt để đoán từ tiếng Anh 5 chữ cái.

&nbsp;  - 🟩 \*\*XANH LÁ:\*\* Đúng chữ, ghim đúng chỗ.

&nbsp;  - 🟨 \*\*VÀNG:\*\* Đúng chữ, nhưng khác chỗ.

&nbsp;  - ⬛ \*\*XÁM:\*\* Sai hoàn toàn.

&nbsp;  - Ai đoán trúng trước hoặc hết giờ sẽ phân định thắng thua! Đừng quên gõ `/top` để xem điểm!



