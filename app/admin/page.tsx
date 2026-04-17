'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { LoggedInTeacher, Campus, AttendanceWithRelations } from '@/types'

const MAIN_COLOR = '#F5C200'

const CAMPUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  '前原前校': { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8' },
  '可也校':   { bg: '#ECFDF5', border: '#10B981', text: '#065F46' },
  '南校':     { bg: '#F5F3FF', border: '#8B5CF6', text: '#5B21B6' },
  '東風校':   { bg: '#FDF2F8', border: '#EC4899', text: '#9D174D' },
  '東校':     { bg: '#ECFEFF', border: '#06B6D4', text: '#155E75' },
}
const DEFAULT_COLOR = { bg: '#F9FAFB', border: '#9CA3AF', text: '#374151' }

type TeacherSummary = {
  id: string
  name: string
  code: number
  totalPeriods: number
  totalWorkMinutes: number
  totalExtraMinutes: number
  records: AttendanceWithRelations[]
}

type EditTarget = AttendanceWithRelations & {
  _editDate: string
  _editCampusId: string
  _editPeriods: number
  _editExtraMinutes: number
  _editNotes: string
}

function formatDate(d: string) {
  const date = new Date(d + 'T00:00:00')
  const day = '日月火水木金土'[date.getDay()]
  return `${date.getMonth() + 1}月${date.getDate()}日（${day}）`
}

export default function AdminPage() {
  const router = useRouter()
  const [teacher, setTeacher] = useState<LoggedInTeacher | null>(null)
  const [campuses, setCampuses] = useState<Campus[]>([])
  const [summaries, setSummaries] = useState<TeacherSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherSummary | null>(null)
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

    const newSummaries = Array.from(map.values()).sort((a, b) => a.code - b.code)
    setSummaries(newSummaries)

    // 選択中の講師データを更新
    if (selectedTeacher) {
      const updated = newSummaries.find(s => s.id === selectedTeacher.id)
      setSelectedTeacher(updated ?? null)
    }

    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setSelectedTeacher(null)
    setEditTarget(null)
    setMonth(m)
    setYear(y)
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
    await fetchData()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このレコードを削除しますか？')) return
    // 即座にUIから削除
    setSelectedTeacher(prev => prev ? { ...prev, records: prev.records.filter(r => r.id !== id) } : null)
    setSummaries(prev => prev.map(s => ({ ...s, records: s.records.filter(r => r.id !== id) })))
    if (editTarget?.id === id) setEditTarget(null)
    // DBに反映・集計値を再同期
    await supabase.from('soroban_attendances').delete().eq('id', id)
    fetchData()
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      {/* ヘッダー */}
      <header className="shadow-md" style={{ backgroundColor: MAIN_COLOR }}>
        <div className="flex items-center justify-between px-6 py-4 max-w-screen-xl mx-auto">
          <div>
            <p className="text-gray-900 font-bold text-xl">そろばん塾ピコ　管理画面</p>
            <p className="text-gray-700 text-sm">{teacher?.name}</p>
          </div>
          <button
            onClick={() => { localStorage.removeItem('soroban_teacher'); router.push('/') }}
            className="px-4 py-2 rounded-lg bg-white/40 text-gray-900 font-semibold"
          >
            ログアウト
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-screen-xl mx-auto w-full px-6 py-6 flex flex-col gap-4">

        {/* 月選択 */}
        <div className="flex items-center gap-4 bg-white rounded-2xl shadow px-6 py-4">
          <button onClick={() => changeMonth(-1)} className="text-3xl px-2 text-gray-500 hover:text-gray-800">‹</button>
          <span className="text-2xl font-bold text-gray-800 w-40 text-center">{year}年 {month}月</span>
          <button onClick={() => changeMonth(1)} className="text-3xl px-2 text-gray-500 hover:text-gray-800">›</button>
          <p className="ml-4 text-gray-400 text-sm">講師名をクリックすると詳細・編集できます</p>
        </div>

        {/* メインエリア：左リスト＋右詳細 */}
        <div className="flex gap-5 items-start">

          {/* 左：講師一覧 */}
          <div className="w-80 shrink-0 space-y-2">
            {loading ? (
              <p className="text-center text-gray-400 py-10">読み込み中...</p>
            ) : summaries.length === 0 ? (
              <p className="text-center text-gray-400 py-10">この月の記録はありません</p>
            ) : (
              summaries.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedTeacher(s); setEditTarget(null) }}
                  className="w-full text-left bg-white rounded-2xl shadow px-5 py-4 border-2 transition-all hover:shadow-md"
                  style={{
                    borderColor: selectedTeacher?.id === s.id ? MAIN_COLOR : 'transparent',
                    backgroundColor: selectedTeacher?.id === s.id ? '#FFFBEB' : 'white',
                  }}
                >
                  <p className="font-bold text-gray-800 text-lg">{s.name}</p>
                  <div className="mt-1 text-sm text-gray-500 space-y-0.5">
                    <p>{s.totalPeriods}コマ　業務 {s.totalWorkMinutes}分</p>
                    {s.totalExtraMinutes > 0 && <p>その他 {s.totalExtraMinutes}分</p>}
                    <p>{s.records.length}件の記録</p>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* 右：詳細・編集エリア */}
          <div className="flex-1 min-w-0">
            {!selectedTeacher ? (
              <div className="bg-white rounded-2xl shadow p-10 text-center text-gray-400">
                <p className="text-lg">左の講師名を選択してください</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 講師ヘッダー */}
                <div className="bg-white rounded-2xl shadow px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-xl font-bold text-gray-800">{selectedTeacher.name} 先生</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      合計 {selectedTeacher.totalPeriods}コマ　業務 {selectedTeacher.totalWorkMinutes}分
                      {selectedTeacher.totalExtraMinutes > 0 && `　その他 ${selectedTeacher.totalExtraMinutes}分`}
                    </p>
                  </div>
                  {editTarget && (
                    <button
                      onClick={() => setEditTarget(null)}
                      className="text-sm text-gray-400 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                    >
                      編集を閉じる
                    </button>
                  )}
                </div>

                {/* 編集フォーム */}
                {editTarget && (
                  <div className="bg-white rounded-2xl shadow p-6">
                    <h3 className="text-lg font-bold text-gray-700 mb-5 pb-3 border-b border-gray-100">
                      記録を編集：{formatDate(editTarget.date)}
                    </h3>
                    <div className="grid grid-cols-2 gap-6">
                      {/* 左列 */}
                      <div className="space-y-5">
                        {/* 日付 */}
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">日付</label>
                          <input
                            type="date"
                            value={editTarget._editDate}
                            onChange={(e) => setEditTarget({ ...editTarget, _editDate: e.target.value })}
                            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-[#F5C200]"
                          />
                        </div>
                        {/* 校舎 */}
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">校舎</label>
                          <div className="space-y-2">
                            {campuses.map((c) => {
                              const color = CAMPUS_COLORS[c.name] ?? DEFAULT_COLOR
                              const isSelected = editTarget._editCampusId === c.id
                              return (
                                <button
                                  key={c.id}
                                  onClick={() => setEditTarget({ ...editTarget, _editCampusId: c.id })}
                                  className="w-full py-3 px-4 rounded-xl border-2 text-left font-semibold transition-all"
                                  style={
                                    isSelected
                                      ? { backgroundColor: color.bg, borderColor: color.border, color: color.text }
                                      : { borderColor: '#e5e7eb', color: '#6b7280' }
                                  }
                                >
                                  {c.name}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>

                      {/* 右列 */}
                      <div className="space-y-5">
                        {/* コマ数 */}
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">コマ数</label>
                          <div className="grid grid-cols-4 gap-2">
                            {[0, 1, 2, 3].map((n) => (
                              <button
                                key={n}
                                onClick={() => setEditTarget({ ...editTarget, _editPeriods: n })}
                                className="py-3 rounded-xl border-2 font-bold text-base transition-all"
                                style={
                                  editTarget._editPeriods === n
                                    ? { backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR, color: '#1a1a1a' }
                                    : { borderColor: '#e5e7eb', color: '#374151' }
                                }
                              >
                                {n === 0 ? '授業なし' : `${n}コマ`}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* その他業務時間 */}
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">その他業務時間</label>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setEditTarget({ ...editTarget, _editExtraMinutes: Math.max(0, editTarget._editExtraMinutes - 10) })}
                              disabled={editTarget._editExtraMinutes === 0}
                              className="px-5 py-3 rounded-xl border-2 border-gray-300 font-bold text-gray-700 disabled:opacity-30 hover:bg-gray-50"
                            >
                              −10分
                            </button>
                            <span className="flex-1 text-center text-3xl font-bold" style={{ color: '#b08800' }}>
                              {editTarget._editExtraMinutes}分
                            </span>
                            <button
                              onClick={() => setEditTarget({ ...editTarget, _editExtraMinutes: editTarget._editExtraMinutes + 10 })}
                              className="px-5 py-3 rounded-xl border-2 font-bold"
                              style={{ backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR }}
                            >
                              ＋10分
                            </button>
                          </div>
                        </div>

                        {/* メモ */}
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">メモ</label>
                          <textarea
                            value={editTarget._editNotes}
                            onChange={(e) => setEditTarget({ ...editTarget, _editNotes: e.target.value })}
                            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-[#F5C200] resize-none"
                            rows={3}
                          />
                        </div>

                        {/* 保存・キャンセル */}
                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={() => setEditTarget(null)}
                            className="flex-1 py-3 rounded-xl border-2 border-gray-300 text-gray-600 font-semibold hover:bg-gray-50"
                          >
                            キャンセル
                          </button>
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex-1 py-3 rounded-xl font-bold text-gray-900 disabled:opacity-60"
                            style={{ backgroundColor: MAIN_COLOR }}
                          >
                            {saving ? '保存中...' : '保存する'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 記録一覧テーブル */}
                <div className="bg-white rounded-2xl shadow overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100" style={{ backgroundColor: '#FFF9E0' }}>
                        <th className="text-left px-6 py-3 text-sm font-bold text-gray-600">日付</th>
                        <th className="text-left px-4 py-3 text-sm font-bold text-gray-600">校舎</th>
                        <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">コマ数</th>
                        <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">業務(分)</th>
                        <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">その他(分)</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectedTeacher.records.map((rec) => {
                        const color = CAMPUS_COLORS[rec.campus.name] ?? DEFAULT_COLOR
                        const isEditing = editTarget?.id === rec.id
                        return (
                          <tr
                            key={rec.id}
                            className="transition-colors"
                            style={{ backgroundColor: isEditing ? '#FFFBEB' : undefined }}
                          >
                            <td className="px-6 py-4 text-base font-medium text-gray-800 whitespace-nowrap">
                              {formatDate(rec.date)}
                            </td>
                            <td className="px-4 py-4">
                              <span
                                className="text-sm font-bold px-3 py-1 rounded-lg border-l-4"
                                style={{ backgroundColor: color.bg, borderColor: color.border, color: color.text }}
                              >
                                {rec.campus.name}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-center text-base font-bold text-gray-800">
                              {rec.periods === 0 ? '授業なし' : `${rec.periods}コマ`}
                            </td>
                            <td className="px-4 py-4 text-center text-base text-gray-600">
                              {rec.work_minutes}
                            </td>
                            <td className="px-4 py-4 text-center text-base text-gray-600">
                              {rec.extra_minutes > 0 ? rec.extra_minutes : '−'}
                            </td>
                            <td className="px-4 py-4 text-right whitespace-nowrap">
                              <button
                                onClick={() => startEdit(rec)}
                                className="text-sm px-4 py-2 rounded-lg border font-medium mr-2 hover:bg-gray-50"
                                style={{ color: '#b08800', borderColor: '#F5C200' }}
                              >
                                編集
                              </button>
                              <button
                                onClick={() => handleDelete(rec.id)}
                                className="text-sm px-4 py-2 rounded-lg border border-red-200 text-red-400 font-medium hover:bg-red-50"
                              >
                                削除
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
