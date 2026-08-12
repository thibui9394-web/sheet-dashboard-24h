# Google Sheet edit tracking

Bo Apps Script nay chay doc lap bang tai khoan admin. No theo doi cot C va J
cua tab `2026_Design_Team`, gan `_TASK_ID` vao cot AA va ghi log vao mot file
Google Sheet rieng chi admin so huu.

Sheet `Edit_Log` luu ca `DONG HIEN TAI` va `DONG LUC SUA`. Khi chen, xoa
hoac sap xep dong trong sheet nguon, trigger `onTrackedStructureChange` tu dong
doi `DONG HIEN TAI` theo `_TASK_ID`; `DONG LUC SUA` duoc giu nguyen de doi chieu.

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

Endpoint web app chi tra event da loai email. Email nguoi sua chi ton tai trong
file `Design Team - Edit Log`.

## Kiem tra

- Sua thu mot o C va mot o J bang hai tai khoan khac nhau.
- Chay `getTrackingStatus()` de kiem tra trigger.
- Xem tab `Edit_Log` va xac nhan cot `EDITOR_EMAIL`.
- Chay workflow `Update Dashboard Snapshot`, sau do reload dashboard.

Neu Google khong cung cap danh tinh cho mot edit event, `EDITOR_EMAIL` se de
trong. Tracking khong tu doan danh tinh.

Can tam dung tracking thi chay `pauseTracking()`. Ham nay chi go trigger, khong
xoa cot Task ID va khong xoa lich su; chay lai `setupTracking()` de bat lai.

Neu can dong bo so dong ngay lap tuc, chay thu cong `syncCurrentRows()`.
