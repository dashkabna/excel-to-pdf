import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4301),
  /** Лого ба тайлангийн бүртгэл (audit.jsonl) — docker-т volume. */
  DATA_DIR: z.string().min(1).default('./data'),
  /**
   * QR-ийн холбоос зөвхөн эдгээр домэйн (ба дэд домэйн) дээр байж болно — хэрэглэгч холбоосыг
   * өөрчилж чадах ч хуурамч "баталгаажуулах" сайт руу заалгахгүй. Таслалаар тусгаарлана.
   */
  QR_ALLOWED_HOSTS: z
    .string()
    .default('teso.mn')
    .transform((value) =>
      value
        .split(',')
        .map((host) => host.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1, 'QR_ALLOWED_HOSTS дор хаяж нэг домэйн')),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Тохиргоо буруу:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  process.exit(1)
}

export const env = parsed.data

/**
 * QR-ийн хаяг тогтмол (хэрэглэгчийн шийдвэр): вэбийн урьдчилан харагдац ижил тогтмолыг
 * (statement-header-layout.ts VERIFICATION_BASE_URL) ашигладаг тул env-ээр өөрчилбөл PDF ба
 * урьдчилан харагдац зөрнө. Солих бол хоёуланг нь зэрэг солино.
 */
export const PUBLIC_WEB_URL = 'https://itd.teso.mn'
export const publicWebUrl = () => PUBLIC_WEB_URL
