'use client'

import { AppHeader } from '@/components/layout/app-header'
import { StatementReportBuilder } from '@/features/statement/components/statement-report-builder'

export default function StatementReportPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6">
        <StatementReportBuilder />
      </main>
    </>
  )
}
