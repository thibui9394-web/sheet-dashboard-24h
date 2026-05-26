# Sheet Dashboard 30m

Dashboard bao cao tu dong tu Google Sheet.

## Muc tieu

- Giao dien don gian, de nhin.
- Du lieu cap nhat theo snapshot 30 phut.
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

## Lich cap nhat 30 phut

Workflow co san tai:

- [.github/workflows/update-snapshot.yml](E:\codex\sheet-dashboard-24h\.github\workflows\update-snapshot.yml)

Cron dang set:

- `10,40 * * * *` (UTC) => chay vao phut 10 va 40 moi gio

Moi lan chay, script uu tien che do incremental:

- Luu `records` day du trong `data/snapshot.json`.
- Neu van la thang hien tai da cache, chi tai lai range tu dong bat dau cua thang hien tai den cuoi sheet.
- Khi chua co cache hoac sang thang moi, script full-bootstrap mot lan de tim lai dong bat dau cua thang hien tai.
- Neu can quet lai toan bo sheet thu cong: `FORCE_FULL_SNAPSHOT=1 npm run update`.
- Dashboard hien thoi diem cap nhat cuoi va lan cap nhat tiep theo du kien.

## File quan trong

- [scripts/update-snapshot.mjs](E:\codex\sheet-dashboard-24h\scripts\update-snapshot.mjs): Tai CSV tu Google Sheet, tong hop KPI, ghi `data/snapshot.json`.
- [index.html](E:\codex\sheet-dashboard-24h\index.html): UI bao cao.
- [app.js](E:\codex\sheet-dashboard-24h\app.js): Logic filter + render.
- [data/snapshot.json](E:\codex\sheet-dashboard-24h\data\snapshot.json): Du lieu da tong hop cho frontend.

## Ghi chu nghiep vu

- Da loai tru dong `128` cua `KHANG` trong tinh KPI (outlier da thong nhat).
- Muon bo loai tru nay: sua `EXCLUDED_ROWS_BY_PERSON` trong script update.
