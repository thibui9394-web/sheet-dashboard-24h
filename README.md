# Sheet Dashboard

Dashboard bao cao tu Google Sheet, cap nhat snapshot thu cong qua GitHub Actions.

## Muc tieu

- Giao dien don gian, de nhin.
- Du lieu cap nhat theo snapshot khi chay workflow.
- Public link de moi nguoi trong team xem.
- Mui gio mac dinh: `Asia/Ho_Chi_Minh` (gio Viet Nam / Ha Noi).

## Nguon du lieu

- Sheet id: `1QQ-FGthecJ9bl-XlwDU17ZiD8b47ilJuUs1bSkgpYvM`
- Tab gid: `131891982` (`2026_Design_Team`)

## Chay local

```bash
cd sheet-dashboard-24h
npm run update
npm run serve
```

Mo: `http://localhost:4173`

## Cap nhat snapshot

Workflow co san tai:

- [.github/workflows/update-snapshot.yml](E:\codex\sheet-dashboard-24h\.github\workflows\update-snapshot.yml)

Workflow chi chay thu cong bang `workflow_dispatch`.

Cach cap nhat tren GitHub:

1. Mo tab Actions.
2. Chon workflow `Update Dashboard Snapshot`.
3. Bam `Run workflow`.
4. Chon branch `main`.
5. Doi workflow va deploy Pages chay xong, sau do bam `Nap lai` tren dashboard.

Moi lan chay, script uu tien che do incremental:

- Luu `records` day du trong `data/snapshot.json`.
- Neu van la thang hien tai da cache, chi tai lai range tu dong bat dau cua thang hien tai den cuoi sheet.
- Khi chua co cache hoac sang thang moi, script full-bootstrap mot lan de tim lai dong bat dau cua thang hien tai.
- Neu can quet lai toan bo sheet thu cong: `FORCE_FULL_SNAPSHOT=1 npm run update`.
- Dashboard hien thoi diem cap nhat cuoi.

## Theo doi chinh sua cot C/J

Tinh nang tracking la lop bo sung, khong tham gia tinh KPI va khong chan team
nhap task khi log gap loi.

- Theo doi `NOI DUNG ORDER` (cot C) va `NGAY ORDER` (cot J).
- Gan Task ID on dinh vao cot AA (`_TASK_ID`) va an cot nay.
- Ghi gia tri truoc/sau, thoi gian va email nguoi sua vao file Google Sheet
  `Design Team - Edit Log` chi admin so huu.
- Dashboard cong khai chi nhan log da an danh; email khong duoc ghi vao
  `data/snapshot.json`.
- Task da sua hien badge `Da sua N`. Click badge de xem timeline va mo dung
  dong trong Google Sheet.
- Neu endpoint log tam loi, ETL giu lich su cu va van cap nhat KPI binh thuong.

Ma cai dat Google nam trong [google-apps-script](E:\codex\sheet-dashboard-24h-latest\google-apps-script).
Sau khi chay `setupTracking()` va deploy Web app, tao hai GitHub secrets:

- `EDIT_LOG_API_URL`: URL `/exec` cua Apps Script Web app.
- `EDIT_LOG_API_TOKEN`: token tra ve tu `setupTracking()`.

Lan dong bo dau sau khi bat tracking nen chon `Quet toan bo lich su` de moi
record nhan Task ID that thay vi Task ID fallback theo so dong.

## File quan trong

- [scripts/update-snapshot.mjs](E:\codex\sheet-dashboard-24h\scripts\update-snapshot.mjs): Tai CSV tu Google Sheet, tong hop KPI, ghi `data/snapshot.json`.
- [index.html](E:\codex\sheet-dashboard-24h\index.html): UI bao cao.
- [app.js](E:\codex\sheet-dashboard-24h\app.js): Logic filter + render.
- [dashboard-domain.js](E:\codex\sheet-dashboard-24h\dashboard-domain.js): Quy tac nghiep vu dung chung cho thang, trang thai, no dong va san luong.
- [data/snapshot.json](E:\codex\sheet-dashboard-24h\data\snapshot.json): Du lieu da tong hop cho frontend.

## Ghi chu nghiep vu

- Da loai tru dong `128` cua `KHANG` trong tinh KPI (outlier da thong nhat).
- Muon bo loai tru nay: sua `EXCLUDED_ROWS_BY_PERSON` trong script update.

## Logic tinh KPI (thang/tuan hien tai luon "gom no dong")

- Cot `NGAY ORDER` (J) va `NGAY HOAN THANH` (R) co dinh dang `dd/MM/yyyy HH:mm`; ETL luon parse theo thu tu ngay/thang/nam, khong tu dao ngay va thang.
- Tong san luong chi gom task `Hoan thanh` va `Dang thuc hien`; `Pending`, trang thai trong va `Cancel` khong cong san luong.
- Task da "Hoan thanh" duoc tinh vao thang/tuan **ngay hoan thanh thuc te** (`NGAY HOAN THANH`), khong phai thang order.
- Task chua xong duoc tracking tu thang order qua cac thang tiep theo. San luong `Dang thuc hien` chi tinh o thang hien tai de khong bi lap.
- Khi task hoan thanh, toan bo san luong chuyen vao thang/tuan hoan thanh. Cac thang cu chi giu dau task ton voi san luong bang 0, khong danh dau la thieu so luong.
- Toan bo dashboard va ETL dung chung quy tac trong `dashboard-domain.js` de giu so lieu nhat quan.
