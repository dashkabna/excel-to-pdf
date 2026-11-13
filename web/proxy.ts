import { NextResponse, type NextRequest } from 'next/server'

/*
 * Хөтчийн илгээсэн X-Forwarded-For-ийг устгана: тэгвэл Next route handler-т жинхэнэ socket хаягийг
 * x-forwarded-for болгон өгдөг (app/api/v1/[...path]/route.ts үүнийг API руу дамжуулна). Ингэснээр
 * хэрэглэгч бүр өөрийн IP-ээр хязгаарлагдаж, аудитад жинхэнэ IP үлдэнэ, хуурамч IP илгээж болохгүй.
 * nginx зэрэг reverse proxy-ийн ард ажиллуулбал BEHIND_PROXY=true — тэр proxy-ийн бичсэн толгойг үлдээнэ.
 */
export function proxy(request: NextRequest) {
  if (process.env.BEHIND_PROXY === 'true') return NextResponse.next()
  const headers = new Headers(request.headers)
  headers.delete('x-forwarded-for')
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: '/api/v1/:path*',
}
