# Google Sheet edit tracking

Bo Apps Script nay chay doc lap bang tai khoan admin. No theo doi cot C va J
cua tab `2026_Design_Team`, gan `_TASK_ID` vao cot AA va ghi log vao mot file
Google Sheet rieng chi admin so huu.

Tracking v3 khong thu thap danh tinh nguoi sua. `Edit_Log` chi them event va
khong sua lai event cu. Sheet `Task_Index` luu dong hien tai, dong hoat dong
cuoi va trang thai `ACTIVE`/`DA XOA` cua tung Task ID.

## Cai dat

1. Tao mot Apps Script project doc lap tai `script.google.com`.
2. Dan `Code.gs` va `appsscript.json` vao project.
3. Chay `setupTracking()` mot lan va chap nhan quyen.
4. Mo `SETUP_RESULT` trong nhat ky thuc thi. Mo `logSpreadsheetUrl` de xem
   file log rieng; file nay mac dinh chi tai khoan admin so huu.
5. Deploy project thanh Web app:
   - Execute as: `Me`.
   - Who has access: `Anyone`.
6. Luu deployment URL vao GitHub secret `EDIT_LOG_API_URL`.
7. Luu `apiToken` tra ve boi `setupTracking()` vao GitHub secret
   `EDIT_LOG_API_TOKEN`.

Endpoint web app chi tra event khong co danh tinh. Cot tai khoan cu trong
`Edit_Log` duoc giu lai de khong pha cau truc du lieu lich su, nhung v3 khong
ghi du lieu moi vao cot nay.

## Kiem tra

- Sua thu mot o C va mot o J.
- Chay `getTrackingStatus()` de kiem tra trigger.
- Xem `Edit_Log`, `Task_Index` va xac nhan event moi khong co tai khoan.
- Chay workflow `Update Dashboard Snapshot`, sau do reload dashboard.

Neu task bi xoa, `Task_Index` ghi `DA XOA`; event cu van giu dong luc sua. Neu
task di chuyen, index cap nhat dong moi ma khong sua event cu. Neu C va J cung
bi xoa rong, Task ID van duoc giu; nhap lai duoc tinh la lan sua tiep theo thay
vi tao mot task moi va reset lich su.

Nen luon sort ca Sheet. Neu sort rieng A:Z bo sot cot AA, bo doi soat se tu sua
nhung chu trinh doi dong xac dinh duoc bang cap C/J; truong hop noi dung/ngay
trung nhau khong du bang chung de tu gan lai tuyet doi. Mot trigger dinh ky chay
5 phut/lần de doi soat thay doi bang API/script khong kich hoat onEdit. Doi soat
chi khoi phuc duoc thay doi rong cuoi cung, khong the dung lai moi buoc trung
gian da xay ra giua hai lan chay.

Can tam dung tracking thi chay `pauseTracking()`. Ham nay chi go trigger, khong
xoa cot Task ID va khong xoa lich su; chay lai `setupTracking()` de bat lai.

Neu can doi soat Task ID, Task Index va event bi bo sot, chay thu cong
`syncCurrentRows()`.
