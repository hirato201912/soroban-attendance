'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { LoggedInTeacher, AttendanceWithRelations } from '@/types'

const MAIN_COLOR = '#F5C200'

const CAMPUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  '前原前校': { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8' },
  '可也校':   { bg: '#ECFDF5', border: '#10B981', text: '#065F46' },
  '南校':     { bg: '#F5F3FF', border: '#8B5CF6', text: '#5B21B6' },
  '春風校':   { bg: '#FDF2F8', border: '#EC4899', text: '#9D174D' },
  '東校':     { bg: '#ECFEFF', border: '#06B6D4', text: '#155E75' },
}
const DEFAULT_COLOR = { bg: '#F9FAFB', border: '#9CA3AF', text: '#374151' }

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
      .select('*, teacher:itoshima_teachers(id, name, code), campus:soroban_campuses(id, name, cleanup_minutes)')
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

  const totalPeriods = records.reduce((s, r) => s + r.periods, 0)
  const totalWorkMinutes = records.reduce((s, r) => s + r.work_minutes, 0)
  const totalExtraMinutes = records.reduce((s, r) => s + r.extra_minutes, 0)

  // 校舎別集計
  const campusSummary = records.reduce<Record<string, { periods: number; days: number }>>((acc, rec) => {
    const name = rec.campus.name
    if (!acc[name]) acc[name] = { periods: 0, days: 0 }
    acc[name].periods += rec.periods
    acc[name].days += 1
    return acc
  }, {})

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
          <div className="grid grid-cols-3 gap-3 text-center mb-5">
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

          {/* 校舎別内訳 */}
          {Object.keys(campusSummary).length > 0 && (
            <>
              <h3 className="text-base font-bold text-gray-500 mb-3">校舎別内訳</h3>
              <div className="space-y-2">
                {Object.entries(campusSummary).map(([name, { periods, days }]) => {
                  const color = CAMPUS_COLORS[name] ?? DEFAULT_COLOR
                  return (
                    <div
                      key={name}
                      className="flex items-center justify-between rounded-xl px-4 py-3 border-l-4"
                      style={{ backgroundColor: color.bg, borderColor: color.border }}
                    >
                      <span className="text-lg font-bold" style={{ color: color.text }}>{name}</span>
                      <div className="text-right">
                        <span className="text-lg font-bold text-gray-800">{periods}コマ</span>
                        <span className="text-sm text-gray-500 ml-2">（{days}日）</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* 記録一覧 */}
        {loading ? (
          <p className="text-center text-xl text-gray-400 py-10">読み込み中...</p>
        ) : records.length === 0 ? (
          <p className="text-center text-xl text-gray-400 py-10">この月の記録はありません</p>
        ) : (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-gray-600">勤務記録</h2>
            {records.map((rec) => {
              const color = CAMPUS_COLORS[rec.campus.name] ?? DEFAULT_COLOR
              return (
                <div
                  key={rec.id}
                  className="bg-white rounded-2xl shadow overflow-hidden border-l-4"
                  style={{ borderColor: color.border }}
                >
                  {/* 校舎名バー */}
                  <div className="px-5 py-3" style={{ backgroundColor: color.bg }}>
                    <span className="text-xl font-bold" style={{ color: color.text }}>
                      {rec.campus.name}
                    </span>
                  </div>
                  {/* 詳細 */}
                  <div className="px-5 py-4">
                    <div className="flex justify-between items-center">
                      <span className="text-lg text-gray-500">{rec.date}</span>
                      <span className="text-2xl font-bold text-gray-800">
                        {rec.periods === 0 ? '授業なし' : `${rec.periods}コマ`}
                      </span>
                    </div>
                    <div className="flex gap-4 text-base text-gray-500 mt-1">
                      <span>業務時間 {rec.work_minutes}分</span>
                      {rec.extra_minutes > 0 && (
                        <span>その他 {rec.extra_minutes}分</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
