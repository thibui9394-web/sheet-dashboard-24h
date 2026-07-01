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

## File quan trong

- [scripts/update-snapshot.mjs](E:\codex\sheet-dashboard-24h\scripts\update-snapshot.mjs): Tai CSV tu Google Sheet, tong hop KPI, ghi `data/snapshot.json`.
- [index.html](E:\codex\sheet-dashboard-24h\index.html): UI bao cao.
- [app.js](E:\codex\sheet-dashboard-24h\app.js): Logic filter + render.
- [data/snapshot.json](E:\codex\sheet-dashboard-24h\data\snapshot.json): Du lieu da tong hop cho frontend.

## Ghi chu nghiep vu

- Da loai tru dong `128` cua `KHANG` trong tinh KPI (outlier da thong nhat).
- Muon bo loai tru nay: sua `EXCLUDED_ROWS_BY_PERSON` trong script update.

## Logic tinh KPI (thang/tuan hien tai luon "gom no dong")

- Task da "Hoan thanh" duoc tinh vao thang/tuan **ngay hoan thanh thuc te** (`NGAY HOAN THANH`), khong phai thang order.
- Task con "Dang thuc hien" ma chua xong se duoc coi la con no: no van hien o thang order goc cho toi thang hien tai, va trong thang hien tai no luon "nhay" theo tuan hien tai (tuan 1 -> 2 -> 3 -> 4) cho toi khi hoan thanh.
- Toan bo dashboard (the KPI tong, bang "Theo nhan su", bang kenh/hang muc, tien do theo tuan) deu dung chung 1 cong thuc nay (`aggregateRows` trong `app.js`) de dam bao so lieu khop nhau o moi cho.
