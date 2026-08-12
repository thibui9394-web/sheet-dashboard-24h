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

Moi lan chay, script quet toan bo Sheet. Cach nay bao dam chen, xoa, di chuyen,
sap xep va sua task o thang cu deu duoc phan anh. Workflow co khoa `concurrency`
de hai lan cap nhat gan nhau khong tranh nhau ghi snapshot.

## Theo doi chinh sua cot C/J

Tinh nang tracking la lop bo sung, khong tham gia tinh KPI va khong chan team
nhap task khi log gap loi.

- Theo doi `NOI DUNG ORDER` (cot C) va `NGAY ORDER` (cot J).
- Gan Task ID on dinh vao cot AA (`_TASK_ID`), an va bao ve cot nay.
- Ghi gia tri truoc/sau va thoi gian vao file Google Sheet
  `Design Team - Edit Log` chi admin so huu; khong thu thap danh tinh nguoi sua.
- `Edit_Log` chi them event. `Task_Index` giu dong hien tai hoac `DA XOA`;
  lich su cu khong bi sua lai khi task di chuyen.
- Task da sua hien badge `Da sua N`. Click badge de xem timeline va mo dung
  dong trong Google Sheet.
- Chi event Log xac nhan moi cong vao `Da sua N`. Chenh lech do doi soat snapshot
  hien thanh canh bao `can doi chieu`, khong gia thanh lan sua chinh thuc.
- Dashboard hien ro Log da dong bo, bi stale hay chua cau hinh.
- Trigger doi soat 5 phut/lần bat thay doi qua API/script va giu Task ID khi C/J
  tam thoi bi xoa rong. Sort A:Z bo sot cot AA duoc tu sua khi cap C/J du de
  nhan dien mot chu trinh doi dong ro rang.

Ma cai dat Google nam trong [google-apps-script](E:\codex\sheet-dashboard-24h-latest\google-apps-script).
Sau khi chay `setupTracking()` va deploy Web app, tao hai GitHub secrets:

- `EDIT_LOG_API_URL`: URL `/exec` cua Apps Script Web app.
- `EDIT_LOG_API_TOKEN`: token tra ve tu `setupTracking()`.

Moi lan dong bo deu quet toan bo. ETL se dung neu task thieu/trung Task ID, neu
snapshot rong, so task giam bat thuong, hoac Log API tra ve thieu event da tung
duoc cong bo. Truong hop Log thieu du lieu se hien canh bao `partial`, khong gia
thanh trang thai dong bo thanh cong.

## File quan trong

- [scripts/update-snapshot.mjs](E:\codex\sheet-dashboard-24h\scripts\update-snapshot.mjs): Tai CSV tu Google Sheet, tong hop KPI, ghi `data/snapshot.json`.
- [index.html](E:\codex\sheet-dashboard-24h\index.html): UI bao cao.
- [app.js](E:\codex\sheet-dashboard-24h\app.js): Logic filter + render.
- [dashboard-domain.js](E:\codex\sheet-dashboard-24h\dashboard-domain.js): Quy tac nghiep vu dung chung cho thang, trang thai, no dong va san luong.
- [data/snapshot.json](E:\codex\sheet-dashboard-24h\data\snapshot.json): Du lieu da tong hop cho frontend.

## Ghi chu nghiep vu

- Da loai tru task outlier cua `KHANG` bang Task ID on dinh, khong con bam so dong 128.
- Muon bo loai tru nay: sua `EXCLUDED_TASK_IDS` trong script update.

## Logic tinh KPI (thang/tuan hien tai luon "gom no dong")

- Cot `NGAY ORDER` (J) va `NGAY HOAN THANH` (R) co dinh dang `dd/MM/yyyy HH:mm`; ETL luon parse theo thu tu ngay/thang/nam, khong tu dao ngay va thang.
- Tong san luong chi gom task `Hoan thanh` va `Dang thuc hien`; `Pending`, trang thai trong va `Cancel` khong cong san luong.
- Task da "Hoan thanh" duoc tinh vao thang/tuan **ngay hoan thanh thuc te** (`NGAY HOAN THANH`), khong phai thang order.
- Task chua xong duoc tracking tu thang order qua cac thang tiep theo. San luong `Dang thuc hien` chi tinh o thang hien tai de khong bi lap.
- Khi task hoan thanh, toan bo san luong chuyen vao thang/tuan hoan thanh. Cac thang cu chi giu dau task ton voi san luong bang 0, khong danh dau la thieu so luong.
- Toan bo dashboard va ETL dung chung quy tac trong `dashboard-domain.js` de giu so lieu nhat quan.
