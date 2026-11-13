import type { NextConfig } from 'next'

/**
 * Хөтөч зөвхөн энэ вэб рүү хандана: `/api/v1/*`-ийг app/api/v1/[...path]/route.ts API руу дамжуулна
 * (CORS, LAN хаягийг bundle-д шингээх шаардлагагүй). API-ийн хаяг `API_INTERNAL_URL` ажиллах үед уншигдана.
 */
const config: NextConfig = {
  reactCompiler: true,
  output: 'standalone',
  // LAN IP-ээр dev server-т хандахад /_next/* dev resource-уудыг зөвшөөрнө.
  allowedDevOrigins: ['172.16.40.41'],
  turbopack: {
    root: import.meta.dirname,
  },
  poweredByHeader: false,
  // `next dev` нь web/AGENTS.md үүсгэж repo-д нэмэлт файл үлдээдэг.
  agentRules: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ]
  },
}

export default config
