'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { LoggedInTeacher, Campus, AttendanceWithRelations } from '@/types'

const MAIN_COLOR = '#F5C200'

type TeacherSummary = {
  id: string
  name: string
  code: number
  totalPeriods: number
  totalWorkMinutes: number
  totalExtraMinutes: number
  records: AttendanceWithRelations[]
}

type EditTarget = AttendanceWithRelations & { _editDate: string; _editCampusId: string; _editPeriods: number; _editExtraMinutes: number; _editNotes: string }

export default function AdminPage() {
  const router = useRouter()
  const [teacher, setTeacher] = useState<LoggedInTeacher | null>(null)
  const [campuses, setCampuses] = useState<Campus[]>([])
  const [summaries, setSummaries] = useState<TeacherSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const mm = String(month).padStart(2, '0')
    const firstDay = `${year}-${mm}-01`
    const lastDayNum = new Date(year, month, 0).getDate()
    const lastDay = `${year}-${mm}-${String(lastDayNum).padStart(2, '0')}`

    const { data } = await supabase
      .from('soroban_attendances')
      .select('*, teacher:itoshima_teachers(id, name, code), campus:soroban_campuses(id, name, cleanup_minutes)')
      .gte('date', firstDay)
      .lte('date', lastDay)
      .order('date', { ascending: false })

    const records = (data as AttendanceWithRelations[]) ?? []

    // 講師ごとに集計
    const map = new Map<string, TeacherSummary>()
    for (const rec of records) {
      const t = rec.teacher
      if (!map.has(t.id)) {
        map.set(t.id, { id: t.id, name: t.name, code: t.code, totalPeriods: 0, totalWorkMinutes: 0, totalExtraMinutes: 0, records: [] })
      }
      const s = map.get(t.id)!
      s.totalPeriods += rec.periods
      s.totalWorkMinutes += rec.work_minutes
      s.totalExtraMinutes += rec.extra_minutes
      s.records.push(rec)
    }

    setSummaries(Array.from(map.values()).sort((a, b) => a.code - b.code))
    setLoading(false)
  }, [year, month])

  useEffect(() => {
    const saved = localStorage.getItem('soroban_teacher')
    if (!saved) { router.replace('/'); return }
    const t = JSON.parse(saved) as LoggedInTeacher
    if (!t.is_soroban_admin) { router.replace('/attendance'); return }
    setTeacher(t)

    supabase.from('soroban_campuses').select('*').order('sort_order').then(({ data }) => {
      setCampuses(data ?? [])
    })

    fetchData()
  }, [router, fetchData])

  const changeMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m); setYear(y)
  }

  const startEdit = (rec: AttendanceWithRelations) => {
    setEditTarget({
      ...rec,
      _editDate: rec.date,
      _editCampusId: rec.campus_id,
      _editPeriods: rec.periods,
      _editExtraMinutes: rec.extra_minutes,
      _editNotes: rec.notes ?? '',
    })
  }

  const handleSave = async () => {
    if (!editTarget) return
    setSaving(true)
    const campus = campuses.find(c => c.id === editTarget._editCampusId)
    const newWorkMinutes = campus ? campus.cleanup_minutes : editTarget.work_minutes

    const { error } = await supabase
      .from('soroban_attendances')
      .update({
        date: editTarget._editDate,
        campus_id: editTarget._editCampusId,
        periods: editTarget._editPeriods,
        work_minutes: newWorkMinutes,
        extra_minutes: editTarget._editExtraMinutes,
        notes: editTarget._editNotes.trim() || null,
      })
      .eq('id', editTarget.id)

    if (error) { alert('更新に失敗しました'); setSaving(false); return }
    setEditTarget(null)
    setSaving(false)
    fetchData()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このレコードを削除しますか？')) return
    setDeleting(id)
    await supabase.from('soroban_attendances').delete().eq('id', id)
    setDeleting(null)
    fetchData()
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="sticky top-0 z-10 shadow-md" style={{ backgroundColor: MAIN_COLOR }}>
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <p className="text-gray-900 font-bold text-lg leading-tight">そろばん塾ピコ 管理者</p>
            <p className="text-gray-700 text-sm">{teacher?.name}</p>
          </div>
          <button
            onClick={() => { localStorage.removeItem('soroban_teacher'); router.push('/') }}
            className="px-4 py-2 rounded-lg bg-white/40 text-gray-900 font-semibold text-base"
          >
            ログアウト
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-5">
        {/* 月選択 */}
        <div className="flex items-center justify-between bg-white rounded-2xl shadow px-4 py-4">
          <button onClick={() => changeMonth(-1)} className="text-3xl px-3 py-1 text-gray-600">‹</button>
          <span className="text-2xl font-bold text-gray-800">{year}年 {month}月</span>
          <button onClick={() => changeMonth(1)} className="text-3xl px-3 py-1 text-gray-600">›</button>
        </div>

        {loading ? (
          <p className="text-center text-xl text-gray-400 py-10">読み込み中...</p>
        ) : summaries.length === 0 ? (
          <p className="text-center text-xl text-gray-400 py-10">この月の記録はありません</p>
        ) : (
          <div className="space-y-4">
            {summaries.map((s) => (
              <div key={s.id} className="bg-white rounded-2xl shadow overflow-hidden">
                {/* 講師サマリー行 */}
                <button
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  className="w-full px-5 py-4 flex items-center justify-between text-left"
                >
                  <div>
                    <p className="text-xl font-bold text-gray-800">{s.name}</p>
                    <p className="text-base text-gray-500 mt-1">
                      {s.totalPeriods}コマ　業務{s.totalWorkMinutes}分　その他{s.totalExtraMinutes}分
                    </p>
                  </div>
                  <span className="text-2xl text-gray-400">{expandedId === s.id ? '▲' : '▼'}</span>
                </button>

                {/* 詳細レコード */}
                {expandedId === s.id && (
                  <div className="border-t border-gray-100 divide-y divide-gray-100">
                    {s.records.map((rec) => (
                      <div key={rec.id} className="px-5 py-4">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-lg font-semibold text-gray-800">{rec.date}</span>
                          <span className="text-base px-3 py-1 rounded-lg" style={{ backgroundColor: '#FFF9E0', color: '#b08800' }}>
                            {rec.campus.name}
                          </span>
                        </div>
                        <p className="text-base text-gray-600 mb-3">
                          {rec.periods}コマ　業務{rec.work_minutes}分
                          {rec.extra_minutes > 0 && `　その他${rec.extra_minutes}分`}
                          {rec.notes && `　(${rec.notes})`}
                        </p>
                        <div className="flex gap-3">
                          <button
                            onClick={() => startEdit(rec)}
                            className="flex-1 py-3 rounded-xl border-2 border-gray-300 text-gray-700 font-semibold text-lg"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => handleDelete(rec.id)}
                            disabled={deleting === rec.id}
                            className="flex-1 py-3 rounded-xl border-2 border-red-200 text-red-500 font-semibold text-lg disabled:opacity-50"
                          >
                            {deleting === rec.id ? '削除中...' : '削除'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 編集モーダル */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-xl font-bold text-gray-800">記録を編集</h3>

            <div>
              <label className="block text-base font-semibold text-gray-600 mb-1">日付</label>
              <input
                type="date"
                value={editTarget._editDate}
                onChange={(e) => setEditTarget({ ...editTarget, _editDate: e.target.value })}
                className="w-full border-2 border-gray-300 rounded-xl px-3 py-3 text-lg focus:outline-none focus:border-[#F5C200]"
              />
            </div>

            <div>
              <label className="block text-base font-semibold text-gray-600 mb-2">校舎</label>
              <div className="flex flex-col gap-2">
                {campuses.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setEditTarget({ ...editTarget, _editCampusId: c.id })}
                    className="py-3 px-4 rounded-xl border-2 text-left text-lg font-semibold"
                    style={
                      editTarget._editCampusId === c.id
                        ? { backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR }
                        : { borderColor: '#d1d5db', color: '#374151' }
                    }
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-base font-semibold text-gray-600 mb-2">コマ数</label>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    onClick={() => setEditTarget({ ...editTarget, _editPeriods: n })}
                    className="py-3 rounded-xl border-2 font-bold text-lg"
                    style={
                      editTarget._editPeriods === n
                        ? { backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR }
                        : { borderColor: '#d1d5db', color: '#374151' }
                    }
                  >
                    {n}コマ
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-base font-semibold text-gray-600 mb-2">
                その他業務（分）
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setEditTarget({ ...editTarget, _editExtraMinutes: Math.max(0, editTarget._editExtraMinutes - 10) })}
                  disabled={editTarget._editExtraMinutes === 0}
                  className="flex-1 py-3 rounded-xl border-2 border-gray-300 font-bold text-xl text-gray-700 disabled:opacity-30"
                >
                  −10
                </button>
                <span className="flex-1 text-center text-3xl font-bold" style={{ color: '#b08800' }}>
                  {editTarget._editExtraMinutes}分
                </span>
                <button
                  onClick={() => setEditTarget({ ...editTarget, _editExtraMinutes: editTarget._editExtraMinutes + 10 })}
                  className="flex-1 py-3 rounded-xl border-2 font-bold text-xl text-gray-900"
                  style={{ backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR }}
                >
                  ＋10
                </button>
              </div>
            </div>

            <div>
              <label className="block text-base font-semibold text-gray-600 mb-1">メモ</label>
              <textarea
                value={editTarget._editNotes}
                onChange={(e) => setEditTarget({ ...editTarget, _editNotes: e.target.value })}
                className="w-full border-2 border-gray-300 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-[#F5C200] resize-none"
                rows={2}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditTarget(null)}
                className="flex-1 py-4 rounded-xl border-2 border-gray-300 text-gray-700 font-bold text-lg"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-4 rounded-xl text-gray-900 font-bold text-lg disabled:opacity-60"
                style={{ backgroundColor: MAIN_COLOR }}
              >
                {saving ? '保存中...' : '保存する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
