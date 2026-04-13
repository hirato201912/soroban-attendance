'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { LoggedInTeacher, AttendanceWithRelations } from '@/types'

const MAIN_COLOR = '#F5C200'

export default function HistoryPage() {
  const router = useRouter()
  const [teacher, setTeacher] = useState<LoggedInTeacher | null>(null)
  const [records, setRecords] = useState<AttendanceWithRelations[]>([])
  const [loading, setLoading] = useState(true)

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const fetchRecords = useCallback(async (teacherId: string) => {
    setLoading(true)
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).toISOString().split('T')[0]

    const { data } = await supabase
      .from('soroban_attendances')
      .select('*, teacher:itoshima_teachers(id, name, code), campus:soroban_campuses(id, name, minutes_per_period)')
      .eq('teacher_id', teacherId)
      .gte('date', firstDay)
      .lte('date', lastDay)
      .order('date', { ascending: false })

    setRecords((data as AttendanceWithRelations[]) ?? [])
    setLoading(false)
  }, [year, month])

  useEffect(() => {
    const saved = localStorage.getItem('soroban_teacher')
    if (!saved) { router.replace('/'); return }
    const t = JSON.parse(saved) as LoggedInTeacher
    setTeacher(t)
    fetchRecords(t.id)
  }, [router, fetchRecords])

  const totalWorkMinutes = records.reduce((s, r) => s + r.work_minutes, 0)
  const totalExtraMinutes = records.reduce((s, r) => s + r.extra_minutes, 0)
  const totalPeriods = records.reduce((s, r) => s + r.periods, 0)

  const changeMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m)
    setYear(y)
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="sticky top-0 z-10 shadow-md" style={{ backgroundColor: MAIN_COLOR }}>
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <p className="text-gray-900 font-bold text-lg leading-tight">そろばん塾ピコ</p>
            <p className="text-gray-700 text-sm">{teacher?.name} 先生</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/attendance')}
              className="px-4 py-2 rounded-lg bg-white/40 text-gray-900 font-semibold text-base"
            >
              入力
            </button>
            <button
              onClick={() => { localStorage.removeItem('soroban_teacher'); router.push('/') }}
              className="px-4 py-2 rounded-lg bg-white/40 text-gray-900 font-semibold text-base"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-5">
        {/* 月選択 */}
        <div className="flex items-center justify-between bg-white rounded-2xl shadow px-4 py-4">
          <button onClick={() => changeMonth(-1)} className="text-3xl px-3 py-1 text-gray-600">‹</button>
          <span className="text-2xl font-bold text-gray-800">{year}年 {month}月</span>
          <button onClick={() => changeMonth(1)} className="text-3xl px-3 py-1 text-gray-600">›</button>
        </div>

        {/* 月間合計 */}
        <div className="bg-white rounded-2xl shadow p-5">
          <h2 className="text-lg font-bold text-gray-600 mb-4">月間合計</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl py-4" style={{ backgroundColor: '#FFF9E0' }}>
              <p className="text-3xl font-bold" style={{ color: '#b08800' }}>{totalPeriods}</p>
              <p className="text-base text-gray-600 mt-1">コマ</p>
            </div>
            <div className="rounded-xl py-4" style={{ backgroundColor: '#FFF9E0' }}>
              <p className="text-3xl font-bold" style={{ color: '#b08800' }}>{totalWorkMinutes}</p>
              <p className="text-base text-gray-600 mt-1">業務(分)</p>
            </div>
            <div className="rounded-xl py-4" style={{ backgroundColor: '#FFF9E0' }}>
              <p className="text-3xl font-bold" style={{ color: '#b08800' }}>{totalExtraMinutes}</p>
              <p className="text-base text-gray-600 mt-1">その他(分)</p>
            </div>
          </div>
        </div>

        {/* 記録一覧 */}
        {loading ? (
          <p className="text-center text-xl text-gray-400 py-10">読み込み中...</p>
        ) : records.length === 0 ? (
          <p className="text-center text-xl text-gray-400 py-10">この月の記録はありません</p>
        ) : (
          <div className="space-y-3">
            {records.map((rec) => (
              <div key={rec.id} className="bg-white rounded-2xl shadow p-5">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xl font-bold text-gray-800">{rec.date}</span>
                  <span className="text-lg font-semibold px-3 py-1 rounded-lg"
                    style={{ backgroundColor: '#FFF9E0', color: '#b08800' }}>
                    {rec.campus.name}
                  </span>
                </div>
                <div className="flex gap-4 text-lg text-gray-600">
                  <span>{rec.periods}コマ</span>
                  <span>業務 {rec.work_minutes}分</span>
                  {rec.extra_minutes > 0 && <span>その他 {rec.extra_minutes}分</span>}
                </div>
                {rec.notes && (
                  <p className="mt-2 text-base text-gray-500">{rec.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
