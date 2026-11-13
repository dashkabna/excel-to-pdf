# TESO Statement — Хуулгын тайлан

Excel (xlsx) файлын баганыг PDF хуулгын баганад тааруулж, TESO логотой хуулгын тайлан үүсгэнэ.
TESO ITAM-ын `/finance/statement-report` модулийг тусдаа төсөл болгон салгасан (ITAM дахь хувилбар хэвээр).

- Толгойн дизайнер: элементүүдийг чирж байрлуулах, логог буланаас нь томруулах
- Байгууллагын лого: PNG эсвэл SVG (SVG-г браузерт PNG болгоно)
- Баталгаажуулах QR: код + засварлах тайлбар; кодын мөр ба "албан ёсны баримт биш" мөр тогтмол

**Одоогийн шийдвэрүүд (2026-11-13):** нэвтрэлтгүй, өгөгдлийн сангүй. Үүсгэсэн тайлан бүрийн бүртгэл
(код, PDF-ийн SHA-256, гарчиг, хуудас/мөрийн тоо, огноо, IP) ба логоны өөрчлөлт `DATA_DIR`
доторх `audit.jsonl` файлд нэмэгдэнэ. QR нь тогтмол `https://itd.teso.mn/verify/<код>` руу заана
(API `config/env.ts` ба вэб `statement-header-layout.ts`-д ижил тогтмол) — ITAM-ын шалгах хуудас энэ
аппын кодыг одоогоор танихгүй; аппын өөрийн `/verify` хуудас бүртгэлийг уншдаг (бүртгэлийг дараа нь
импортлох боломжтой).

Нэвтрэлтгүй тул хамгаалалт:
- PDF 30/мин, лого 10/мин, шалгах 60/мин — клиентийн IP-ээр. Вэбийн `proxy.ts` хэрэглэгчийн илгээсэн
  `X-Forwarded-For`-ийг хасаж, Next.js бодит socket хаягийг бичнэ; API зөвхөн ойрын нэг hop-д итгэнэ
  (`trust proxy = 1`). nginx-ийн ард бол `BEHIND_PROXY=true` (nginx `X-Forwarded-For`-ийг бичнэ).
- Хэн ч логог сольж чадах тул PDF хүсэлт урьдчилан харагдацын логоны SHA-256-г илгээнэ; зөрвөл 409
  ("Лого өөрчлөгдсөн байна").
- Лого солих/устгахыг дарааллаар гүйцэтгэнэ, multipart-д текст талбар хориотой.

## Бүтэц

```
api/   Express 5 + TypeScript + Zod + pdfkit — PDF, лого, бүртгэл (порт 4000)
web/   Next.js 16 + React 19 + Tailwind 4 — тайлан бүтээгч, /verify хуудас (порт 3000)
```

Хөтөч зөвхөн вэб рүү хандана: `/api/v1/*` хүсэлтийг вэбийн route handler (`app/api/v1/[...path]`)
ажиллах үеийн `API_INTERNAL_URL` руу дамжуулна (CORS, LAN хаяг bundle-д шингээх шаардлагагүй).

## API

| Арга | Зам | Тайлбар |
|---|---|---|
| POST | `/api/v1/statement-report/pdf` | PDF үүсгэнэ; `X-Page-Count`, `X-Verification-Code` header; `logoSha256` зөрвөл 409 |
| GET | `/api/v1/statement-report/logo` | Лого (image/png, `X-Logo-Sha256`), байхгүй бол 404 |
| PUT | `/api/v1/statement-report/logo` | Лого оруулах (multipart `file`, PNG ≤ 2MB) |
| DELETE | `/api/v1/statement-report/logo` | Лого устгах |
| GET | `/api/v1/public/statement-reports/:code` | Бүртгэлээс кодоор шалгах |
| GET | `/health` | Амьд эсэх |

Хариу: `{ success: true, data }` / `{ success: false, error: { code, message } }`.

## Ажиллуулах

Нэг командаар хоёуланг (API :4301, web :3301):

```bash
npm run install:all   # анх удаа
npm run dev          # Ctrl+C-ээр хоёуланг нь зогсооно
```

Өгөгдлийн сан шаардлагагүй: лого ба бүртгэл `api/data/` дотор файлаар хадгалагдана.



```bash
# Локал хөгжүүлэлт
cd api && npm install && npm run dev          # http://localhost:4301
cd web && npm install && npm run dev          # http://localhost:3301 (API_INTERNAL_URL=http://localhost:4301)

# Docker
cp .env.example .env
docker compose up -d --build                 # вэб http://localhost:3300, API http://localhost:4300
```

Тест: `cd api && npm test`, `cd web && npm test`.
