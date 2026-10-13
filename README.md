# Kane Wedding: phiên bản Supabase

Đây là bản viết lại của `me-wedding` (Laravel) theo kiểu **Supabase-native**. Chức năng giữ nguyên:
chọn mẫu thiệp, sửa nội dung bằng form tự sinh từ schema, xem trước trực tiếp, thư viện ảnh và nhạc,
xác nhận tham dự (RSVP), sổ lưu bút realtime, phân quyền admin/editor, và trang thiệp công khai tại `/{slug}`
có OG meta để chia sẻ lên Zalo và Facebook.

## Kiến trúc

```
                 ┌──────────── Supabase ────────────┐
 Admin (Vue SPA) │ Auth · Postgres (RLS) · Storage   │◀── khách: RPC submit_rsvp / submit_guestbook
   /admin/*  ───▶│ Realtime (broadcast từ trigger)   │──▶ khách: lời chúc / số khách realtime
                 └──────────────▲────────────────────┘
                                │ public_invitation(slug)  (anon key, chỉ đọc thiệp đã xuất bản)
 Node server (Hono) ────────────┘
   GET  /{slug}             render HTML gốc LadiPage + window.__INV__ + OG meta
   POST /api/preview/:id    live preview cho editor (dùng JWT của người dùng, RLS quyết định quyền)
   GET  /templates/...      asset của mẫu (ảnh, font, nhạc)
```

| Laravel cũ | Bản Supabase |
|---|---|
| MySQL + Eloquent | Postgres + RLS (`supabase/migrations`) |
| Sanctum + Spatie Permission | Supabase Auth + bảng `profiles.role` (`admin` hoặc `editor`) |
| Policy (chỉ sửa thiệp của mình) | RLS: `user_id = auth.uid() or is_admin()` |
| Spatie Media Library + GD | Supabase Storage, resize sang WebP ngay trên trình duyệt (`web` ≤1920px, `thumb` ≤600px) |
| `/api/public/{slug}/*` + throttle | RPC `SECURITY DEFINER`: chỉ thao tác trên thiệp đã xuất bản, lọc HTML, giới hạn 5 lần/phút/IP |
| Reverb + Echo | Supabase Realtime: trigger gọi `realtime.send()` vào topic `invitation:{id}` |
| `LadiPageRenderer.php` | `shared/render.ts` (port 1:1) |
| `php artisan templates:sync` | `npm run templates:sync` |

Thư mục:

```
supabase/migrations/   schema, RLS, RPC, trigger realtime, bucket "media"
scripts/               sync-templates.ts
shared/                renderer và settings resolver, dùng chung cho server, admin và script
server/index.ts        Node server (Hono)
src/admin/             admin SPA (Vue 3 + Pinia + Tailwind)
src/public/            script hydrate trang thiệp (ladipage.ts, core.ts)
templates/{key}/       template.json, preview.json, index.html, assets/
```

## Cài đặt

### 1. Tạo project Supabase
1. Tạo project tại https://supabase.com/dashboard.
2. Vào **SQL Editor** và chạy toàn bộ file `supabase/migrations/20261008000000_init.sql`.
   Nếu dùng Supabase CLI thì chạy `supabase link` rồi `supabase db push`.
3. Vào **Authentication → Sign In / Providers**: giữ Email và **tắt "Allow new users to sign up"**,
   vì admin không có trang đăng ký.
4. **Tài khoản dev nhanh:** chạy `supabase/seed.sql` trong SQL Editor để tạo
   `admin@kanewedding.test` / `password` (admin) và `editor@kanewedding.test` / `password` (editor).
   Đổi mật khẩu trước khi chạy thật.
   Hoặc tạo tài khoản ở **Authentication → Users → Add user**, nhớ tick *Auto Confirm User*.
   **Tài khoản đầu tiên tự động là `admin`**, các tài khoản sau là `editor`. Muốn đổi quyền thì chạy:
   ```sql
   update public.profiles set role = 'admin' where email = 'ban@example.com';
   ```

### 2. Cấu hình
```bash
cp .env.example .env
# điền VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY (Project Settings → API)
npm install
```

### 3. Nạp các mẫu thiệp
```bash
npm run templates:sync           # sinh supabase/templates.sql
```
Sau đó chạy file `supabase/templates.sql` trong SQL Editor. Nếu muốn đẩy thẳng lên mà không qua SQL Editor,
điền `SUPABASE_SERVICE_ROLE_KEY` vào `.env` rồi chạy `npm run templates:sync -- --push`.
Mỗi lần thêm hoặc sửa template thì chạy lại bước này.

### 4. Chạy local
```bash
npm run dev
```
- Admin: http://localhost:5173/admin
- Trang thiệp: http://localhost:3000/{slug} (chỉ hiện khi thiệp đã **Xuất bản**)

## Triển khai lên domain của bạn

Ứng dụng là **một container Node** gồm admin, trang thiệp và asset template. Cách đơn giản nhất là chạy
trên VPS bằng Docker Compose, có Caddy đứng trước để tự lấy chứng chỉ HTTPS:

```bash
# Trên VPS (Ubuntu): cài Docker
curl -fsSL https://get.docker.com | sh

# Lấy code, tạo .env (điền VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, DOMAIN, SITE_URL)
git clone <repo> kane-wedding && cd kane-wedding
cp .env.example .env && nano .env

docker compose up -d --build
```
Ở DNS, tạo **bản ghi A** trỏ `DOMAIN` về IP của VPS. Caddy sẽ tự cấp HTTPS.
Khi cập nhật code: chạy `git pull && docker compose up -d --build`.

Nếu dùng Railway hoặc Render: tạo service từ repo (có sẵn Dockerfile), khai báo các biến môi trường ở trên
(cả lúc build lẫn lúc chạy), rồi thêm custom domain trong dashboard của họ và tạo bản ghi CNAME theo hướng dẫn.

**Tùy chọn CDN cho asset:** khoảng 60MB ảnh và nhạc của template có thể đặt lên CDN hoặc một bucket.
Upload thư mục `templates/{key}/assets/*` lên đường dẫn `/templates/{key}/...`, sau đó đặt
`ASSET_BASE_URL` (lúc chạy) và `VITE_ASSET_BASE_URL` (lúc build) bằng URL gốc của CDN.

## Thêm mẫu thiệp mới
1. Tạo thư mục `templates/<key>/` gồm `index.html` (asset trỏ tới `/templates/<key>/...`), `assets/`,
   `template.json` (với `"engine": "ladipage"`, khối `ladipage` map element id sang settings, và `sections`)
   và `preview.json` (dùng `@image:file.jpg` và `@audio:song.mp3`). Có thể chép thư mục `nobel` làm mẫu.
2. Chạy `npm run templates:sync` rồi nạp SQL như bước 3. Không cần sửa code.

## Ghi chú
- Chỉ engine `ladipage` được port, vì cả 3 mẫu đều dùng engine này. Engine Blade của bản cũ không còn.
- Xoá thiệp là **xoá vĩnh viễn**, kèm toàn bộ file trong Storage. Bản cũ dùng soft delete.
- Tiết kiệm Storage: không lưu ảnh gốc (chỉ `web` ≤1920px và `thumb`; GIF giữ nguyên). Tải file trùng tên
  trong cùng thiệp sẽ dùng lại ảnh cũ. Khi **Lưu**, ảnh/nhạc không còn dùng bị xoá; nút **Dọn ảnh không dùng**
  xoá thêm cả file rác. Ảnh mẫu trong "Ảnh trong mẫu" có thể **Xoá**, trang sẽ hiện khung xám ghi kích thước.
- Dữ liệu cũ trong MySQL **không** tự chuyển sang. Key của các ô ảnh `custom_images` (`img_<md5>`) giữ
  nguyên như bản Laravel, nên nếu cần import thì `settings` dùng lại được, chỉ phải map lại media id.
