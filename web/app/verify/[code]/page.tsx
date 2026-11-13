import { StatementVerificationResult } from '@/features/statement/components/statement-verification'

export const metadata = { title: 'Тайлан шалгах — TESO' }

export default async function VerifyCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <StatementVerificationResult code={code} />
}
