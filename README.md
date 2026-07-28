# Telegram Zalo QR bot

Bot Telegram đăng nhập tài khoản Zalo cá nhân bằng QR, hiển thị danh sách liên hệ/nhóm và đăng xuất phiên cục bộ.

> `zca-js` là API không chính thức mô phỏng Zalo Web. Việc sử dụng có thể khiến tài khoản bị giới hạn hoặc khóa; tự chịu rủi ro và chỉ dùng với tài khoản bạn sở hữu.

## Chạy dự án

```bash
cp .env.example .env
npm install
npm run build
npm run typecheck
npm test
npm start
```

Điền token BotFather vào `TELEGRAM_BOT_TOKEN`. Phiên được cô lập theo Telegram user ID và chỉ lưu trong bộ nhớ; khởi động lại tiến trình sẽ yêu cầu quét QR lại.

## Bộ lọc cuốc xe

Listener chỉ xử lý các nhóm đã được người dùng chọn theo dõi. Pipeline lọc gồm chuẩn hóa Unicode/có dấu/không dấu, mở rộng viết tắt theo ngữ cảnh, phát hiện địa điểm và loại địa điểm, nhận diện tuyến, trích xuất tín hiệu chuyến xe và chấm điểm. Chế độ mặc định là `high_recall`.

Mỗi tin nhắn được phân loại và báo độc lập ngay lập tức; bot không ghép các tin liên tiếp. Có thể cấu hình:

```env
TRIP_FILTER_MODE=high_recall
TRIP_FORWARD_LOW_SCORE=false
```

Tin có địa điểm, số tiền hoặc loại xe `X4/X6/X7/4c/6c/7c` được báo ngay. Ảnh từ nhóm theo dõi cũng được báo ngay. Nội dung chữ được giữ nguyên trong cảnh báo Telegram; hệ thống không log toàn bộ nội dung, số điện thoại, cookie, token hoặc credential.

## Tính năng

- Phiên Zalo độc lập theo từng Telegram user ID.
- Đăng nhập Zalo Web bằng QR thật.
- Chọn nhiều nhóm theo dõi và loại bỏ từng nhóm.
- Cảnh báo realtime theo địa điểm, giá tiền, loại xe hoặc hình ảnh.
- Nút `✅ Nhận` trả lời trực tiếp `ok7` vào tin Zalo gốc.
- Chống callback lặp và chống gửi trùng tin listener.

## Bảo mật và GitHub

Không commit file `.env`. File này chứa Telegram token và đã được khai báo trong `.gitignore`. Trước khi đưa repository lên GitHub, nên tạo token BotFather mới nếu token từng được chia sẻ qua chat hoặc ảnh chụp.

GitHub Actions tự động chạy `npm ci`, build, typecheck và toàn bộ test trên Node.js 20.
