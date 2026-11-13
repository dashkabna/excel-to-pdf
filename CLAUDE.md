# CLAUDE.md — TESO Statement

TESO ITAM-ын "Хуулгын тайлан" (statement-report) модулийг салгасан тусдаа төсөл. Дэлгэрэнгүй: [README.md](README.md),
өөрчлөлтийн түүх: [docs/WORK_LOG.md](docs/WORK_LOG.md).

## Дүрэм

- UI зөвхөн монгол хэлээр, emoji-гүй. Тайлбар (comment) зөвхөн "яагаад"-ыг бичнэ.
- `git commit` / `git push`-ийг хэрэглэгч өөрөө хийнэ.
- Нэвтрэлтгүй, өгөгдлийн сангүй (2026-11-13-ны шийдвэр). Бүртгэл `DATA_DIR/audit.jsonl`-д нэмэгдэнэ.
- QR-ийн кодын мөр ба "албан ёсны баримт биш" мөр ТОГТМОЛ — хуурамч баталгаажуулалтаас сэргийлнэ.
  Зөвхөн дунд тайлбар засагдана. QR-ийн холбоос засагдах ч зөвхөн https + `QR_ALLOWED_HOSTS` (анхдагч
  teso.mn) — дурын домэйн нээвэл хуурамч "шалгах" сайт руу заасан тайлан хийх боломжтой болно.
- Footer-ийн "Энэхүү тайланг ... үүсгэв." мөр ТОГТМОЛ; хэрэглэгчийн хөлийн текст түүний дээр тусдаа мөр.
- api ба web хоёрт давхардсан тогтмол (хуудасны хэмжээ, мөрийн өндөр, хязгаар, тайлбарын текст) үг үсгээрээ ижил
  байх ёстой — урьдчилан харагдац PDF-тэй яг таарна. `api/src/tests/statement.test.ts`-ийн parity тест вэбийн
  мөр тоололыг pdfkit-тэй тулгадаг.
- Хөтөч зөвхөн вэб рүү хандана (`/api/v1/*` → Next.js rewrites → API).

## Тушаал

```bash
cd api && npm run dev | npm test | npm run typecheck | npm run build
cd web && npm run dev | npm test | npm run typecheck | npm run build
docker compose up -d --build     # вэб :3300, API :4300
```
