'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { LoggedInTeacher, Campus, AttendanceWithRelations } from '@/types'

const MAIN_COLOR = '#F5C200'
const TODAY_JST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })

const CAMPUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  '前原駅前校': { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8' },
  '可也校':   { bg: '#ECFDF5', border: '#10B981', text: '#065F46' },
  '南校':     { bg: '#F5F3FF', border: '#8B5CF6', text: '#5B21B6' },
  '東風校':   { bg: '#FDF2F8', border: '#EC4899', text: '#9D174D' },
  '東校(GC)':     { bg: '#ECFEFF', border: '#06B6D4', text: '#155E75' },
}
const DEFAULT_COLOR = { bg: '#F9FAFB', border: '#9CA3AF', text: '#374151' }

type SimpleTeacher = { id: string; name: string; code: number }

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
  _editWorkMinutes: number
  _editExtraMinutes: number
  _editNotes: string
}

type NewRecordForm = {
  date: string
  campusId: string
  periods: number
  workMinutes: number
  extraMinutes: number
  notes: string
}

function formatDate(d: string) {
  const date = new Date(d + 'T00:00:00')
  const day = '日月火水木金土'[date.getDay()]
  return `${date.getMonth() + 1}月${date.getDate()}日（${day}）`
}

// 新規追加フォームを開くときの既定日：
// 表示中が当月なら今日、それ以外の月はその月の1日を返す。
// （日付ピッカーが表示中の月で開くようにして、月の取り違えを防ぐ）
function defaultDateForMonth(year: number, month: number): string {
  const todayYear = Number(TODAY_JST.slice(0, 4))
  const todayMonth = Number(TODAY_JST.slice(5, 7))
  if (year === todayYear && month === todayMonth) return TODAY_JST
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function calcWorkMinutes(campus: Campus, periods: number, dateStr: string): number {
  if (periods === 0) return 0
  const dow = new Date(dateStr + 'T00:00:00').getDay()
  const base = periods * campus.cleanup_minutes
  const thursdayMin30 = dow === 4 && (campus.name === '東校(GC)' || campus.name === '前原駅前校')
  return thursdayMin30 ? Math.max(base, 30) : base
}

function fmtMin(min: number): string {
  if (min === 0) return '0分'
  if (min < 60) return `${min}分`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}時間` : `${h}時間${m}分`
}

export default function AdminPage() {
  const router = useRouter()
  const [teacher, setTeacher] = useState<LoggedInTeacher | null>(null)
  const [campuses, setCampuses] = useState<Campus[]>([])
  const [allTeachers, setAllTeachers] = useState<SimpleTeacher[]>([])
  const [summaries, setSummaries] = useState<TeacherSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherSummary | null>(null)
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [saving, setSaving] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [newRecord, setNewRecord] = useState<NewRecordForm>({ date: TODAY_JST, campusId: '', periods: 1, workMinutes: 0, extraMinutes: 0, notes: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [noticeBanner, setNoticeBanner] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'teacher' | 'day'>('teacher')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const dayDetailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selectedDate && dayDetailRef.current) {
      requestAnimationFrame(() => {
        dayDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [selectedDate])

  const closeDetailAndScrollUp = () => {
    calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setSelectedDate(null)
  }

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const fetchData = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
    if (!opts?.silent) setLoading(true)
    const mm = String(month).padStart(2, '0')
    const firstDay = `${year}-${mm}-01`
    const lastDayNum = new Date(year, month, 0).getDate()
    const lastDay = `${year}-${mm}-${String(lastDayNum).padStart(2, '0')}`

    const { data, error } = await supabase
      .from('soroban_attendances')
      .select('*, teacher:itoshima_teachers(id, name, code), campus:soroban_campuses(id, name, cleanup_minutes)')
      .gte('date', firstDay)
      .lte('date', lastDay)
      .order('date', { ascending: true })

    // 取得に失敗したら画面の表示は書き換えない
    // （空データで上書きすると、全記録が消えたように見えてしまうため）
    if (error) {
      if (!opts?.silent) {
        setErrorBanner('データの取得に失敗しました。通信状況を確認して「最新に更新」を押してください。')
        setLoading(false)
      }
      return false
    }

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

    setSelectedTeacher(prev => {
      if (!prev) return null
      const updated = newSummaries.find(s => s.id === prev.id)
      return updated ?? { ...prev, totalPeriods: 0, totalWorkMinutes: 0, totalExtraMinutes: 0, records: [] }
    })

    if (!opts?.silent) setLoading(false)
    return true
  }, [year, month])

  useEffect(() => {
    const saved = localStorage.getItem('soroban_teacher')
    if (!saved) { router.replace('/'); return }
    const t = JSON.parse(saved) as LoggedInTeacher
    if (!t.is_soroban_admin) { router.replace('/attendance'); return }
    setTeacher(t)

    supabase.from('soroban_campuses').select('*').order('sort_order').then(({ data }) => {
      const cs = (data ?? []) as Campus[]
      setCampuses(cs)
      if (cs.length > 0) {
        const initWork = calcWorkMinutes(cs[0], 1, TODAY_JST)
        setNewRecord(prev => ({ ...prev, campusId: cs[0].id, workMinutes: initWork }))
      }
    })

    supabase.from('itoshima_teachers').select('id, name, code')
      .eq('is_soroban', true).order('code')
      .then(({ data }) => setAllTeachers((data ?? []) as SimpleTeacher[]))

    fetchData()
  }, [router, fetchData])

  // タブに戻ってきたとき（他画面・他端末での追加/編集を反映するため）静かに再取得する。
  // 大きな読み込み表示は出さず、編集中のフォーム状態にも触れない。
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchData({ silent: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [fetchData])

  // 手動更新ボタン用：ボタンにだけ状態を出して静かに再取得する。
  const handleManualRefresh = async () => {
    setRefreshing(true)
    const ok = await fetchData({ silent: true })
    if (!ok) setErrorBanner('更新に失敗しました。通信状況を確認して、もう一度お試しください。')
    else setErrorBanner(null)
    setRefreshing(false)
  }

  const changeMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setSelectedTeacher(null)
    setEditTarget(null)
    setIsAdding(false)
    setSelectedDate(null)
    setMonth(m)
    setYear(y)
  }

  const recordsByDate = useMemo(() => {
    const map = new Map<string, AttendanceWithRelations[]>()
    for (const s of summaries) {
      for (const r of s.records) {
        const list = map.get(r.date) ?? []
        list.push(r)
        map.set(r.date, list)
      }
    }
    return map
  }, [summaries])

  const calendarCells = useMemo(() => {
    const firstDow = new Date(year, month - 1, 1).getDay()
    const daysInMonth = new Date(year, month, 0).getDate()
    const totalRows = Math.ceil((firstDow + daysInMonth) / 7)
    const total = totalRows * 7
    const mm = String(month).padStart(2, '0')
    const cells: Array<null | { dateStr: string; day: number; dow: number; records: AttendanceWithRelations[] }> = []
    for (let i = 0; i < total; i++) {
      const dayNum = i - firstDow + 1
      if (dayNum < 1 || dayNum > daysInMonth) {
        cells.push(null)
      } else {
        const dateStr = `${year}-${mm}-${String(dayNum).padStart(2, '0')}`
        const records = recordsByDate.get(dateStr) ?? []
        cells.push({ dateStr, day: dayNum, dow: (firstDow + dayNum - 1) % 7, records })
      }
    }
    return cells
  }, [year, month, recordsByDate])

  const selectTeacher = (t: SimpleTeacher) => {
    const s = summaries.find(s => s.id === t.id) ?? {
      id: t.id, name: t.name, code: t.code,
      totalPeriods: 0, totalWorkMinutes: 0, totalExtraMinutes: 0, records: [],
    }
    setSelectedTeacher(s)
    setEditTarget(null)
    setIsAdding(false)
  }

  const startEdit = (rec: AttendanceWithRelations) => {
    setIsAdding(false)
    setEditTarget({
      ...rec,
      _editDate: rec.date,
      _editCampusId: rec.campus_id,
      _editPeriods: rec.periods,
      _editWorkMinutes: rec.work_minutes,
      _editExtraMinutes: rec.extra_minutes,
      _editNotes: rec.notes ?? '',
    })
  }

  const handleSave = async () => {
    if (!editTarget) return
    setSaving(true)
    setErrorBanner(null)

    // 編集で日付か校舎を変えたとき、同じ(先生×新しい日付×新しい校舎)のレコードが他にある場合は
    // そちらの編集モードに切り替える（DBのユニーク制約による更新失敗を避け、編集体験を一致させる）
    const dateOrCampusChanged =
      editTarget._editDate !== editTarget.date ||
      editTarget._editCampusId !== editTarget.campus_id
    if (dateOrCampusChanged) {
      const { data: conflict } = await supabase
        .from('soroban_attendances')
        .select('*, teacher:itoshima_teachers(id, name, code), campus:soroban_campuses(id, name, cleanup_minutes)')
        .eq('teacher_id', editTarget.teacher_id)
        .eq('date', editTarget._editDate)
        .eq('campus_id', editTarget._editCampusId)
        .neq('id', editTarget.id)
        .maybeSingle()
      if (conflict) {
        const rec = conflict as AttendanceWithRelations
        setEditTarget({
          ...rec,
          _editDate: rec.date,
          _editCampusId: rec.campus_id,
          _editPeriods: rec.periods,
          _editWorkMinutes: rec.work_minutes,
          _editExtraMinutes: rec.extra_minutes,
          _editNotes: rec.notes ?? '',
        })
        setNoticeBanner(`${formatDate(editTarget._editDate)}・${rec.campus.name} には別の記録があります。下の編集フォームはその記録に切り替わりました。`)
        setSaving(false)
        return
      }
    }

    const finalWorkMinutes = editTarget._editPeriods === 0 ? 0 : editTarget._editWorkMinutes

    const { error } = await supabase
      .from('soroban_attendances')
      .update({
        date: editTarget._editDate,
        campus_id: editTarget._editCampusId,
        periods: editTarget._editPeriods,
        work_minutes: finalWorkMinutes,
        extra_minutes: editTarget._editExtraMinutes,
        notes: editTarget._editNotes.trim() || null,
      })
      .eq('id', editTarget.id)

    if (error) { setErrorBanner('更新に失敗しました'); setSaving(false); return }
    setEditTarget(null)
    setNoticeBanner(null)
    setSaving(false)
    await fetchData()
  }

  const handleAddNew = async () => {
    if (!selectedTeacher || !newRecord.campusId) return
    setAddSaving(true)
    setErrorBanner(null)
    setNoticeBanner(null)

    // 同じ先生・同じ日・同じ校舎のレコードが既にある場合は編集モードに切り替え
    const { data: existing } = await supabase
      .from('soroban_attendances')
      .select('*, teacher:itoshima_teachers(id, name, code), campus:soroban_campuses(id, name, cleanup_minutes)')
      .eq('teacher_id', selectedTeacher.id)
      .eq('date', newRecord.date)
      .eq('campus_id', newRecord.campusId)
      .maybeSingle()

    if (existing) {
      const rec = existing as AttendanceWithRelations
      setIsAdding(false)
      setEditTarget({
        ...rec,
        _editDate: rec.date,
        _editCampusId: rec.campus_id,
        _editPeriods: rec.periods,
        _editWorkMinutes: rec.work_minutes,
        _editExtraMinutes: rec.extra_minutes,
        _editNotes: rec.notes ?? '',
      })
      setNoticeBanner(`${formatDate(newRecord.date)}・${rec.campus.name} には既に記録があります。下の編集フォームで内容を変更してください。`)
      setAddSaving(false)
      return
    }

    const finalWorkMinutes = newRecord.periods === 0 ? 0 : newRecord.workMinutes

    const { error } = await supabase.from('soroban_attendances').insert({
      teacher_id: selectedTeacher.id,
      date: newRecord.date,
      campus_id: newRecord.campusId,
      periods: newRecord.periods,
      work_minutes: finalWorkMinutes,
      extra_minutes: newRecord.extraMinutes,
      notes: newRecord.notes.trim() || null,
    })

    if (error) { setErrorBanner('追加に失敗しました'); setAddSaving(false); return }
    setIsAdding(false)
    const resetDate = defaultDateForMonth(year, month)
    const resetCampusId = campuses[0]?.id ?? ''
    const resetWork = campuses[0] ? calcWorkMinutes(campuses[0], 1, resetDate) : 0
    setNewRecord({ date: resetDate, campusId: resetCampusId, periods: 1, workMinutes: resetWork, extraMinutes: 0, notes: '' })
    setAddSaving(false)
    await fetchData()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このレコードを削除しますか？')) return
    setSelectedTeacher(prev => prev ? { ...prev, records: prev.records.filter(r => r.id !== id) } : null)
    setSummaries(prev => prev.map(s => ({ ...s, records: s.records.filter(r => r.id !== id) })))
    if (editTarget?.id === id) setEditTarget(null)
    await supabase.from('soroban_attendances').delete().eq('id', id)
    fetchData()
  }

  // 今月の全講師レコードを CSV ダウンロード（画面表示と同じ見た目）
  const downloadMonthCsv = () => {
    const headers = ['講師コード', '講師名', '日付', '校舎', 'コマ数', '業務時間', 'その他業務時間', '合計業務時間']
    type Row = { code: number; name: string; date: string; campus: string; periods: string; work: string; extra: string; total: string }
    const rows: Row[] = []
    for (const t of summaries) {
      for (const r of t.records) {
        rows.push({
          code: t.code,
          name: t.name,
          date: r.date,
          campus: r.campus.name,
          periods: r.periods === 0 ? '授業なし' : `${r.periods}コマ`,
          work: r.work_minutes > 0 ? fmtMin(r.work_minutes) : '−',
          extra: r.extra_minutes > 0 ? fmtMin(r.extra_minutes) : '−',
          total: fmtMin(r.work_minutes + r.extra_minutes),
        })
      }
    }
    rows.sort((a, b) => a.code - b.code || a.date.localeCompare(b.date))
    const escape = (s: string) => /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    const body = rows.map(r => [String(r.code), r.name, formatDate(r.date), r.campus, r.periods, r.work, r.extra, r.total])
    const csv = [headers, ...body].map(row => row.map(escape).join(',')).join('\r\n')
    // Excel が UTF-8 として正しく開けるよう BOM を先頭に付与
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `soroban-attendance-${year}-${String(month).padStart(2, '0')}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
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

        {/* ビュー切替＋月選択 */}
        <div className="flex items-center gap-4 bg-white rounded-2xl shadow px-6 py-4">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setViewMode('teacher')}
              className="px-5 py-2 rounded-lg text-sm font-bold transition-colors"
              style={viewMode === 'teacher'
                ? { backgroundColor: '#fff', color: '#1f2937', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }
                : { color: '#6b7280' }
              }
            >
              講師別
            </button>
            <button
              onClick={() => setViewMode('day')}
              className="px-5 py-2 rounded-lg text-sm font-bold transition-colors"
              style={viewMode === 'day'
                ? { backgroundColor: '#fff', color: '#1f2937', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }
                : { color: '#6b7280' }
              }
            >
              日別
            </button>
          </div>
          <div className="flex-1" />
          <button
            onClick={handleManualRefresh}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border-2 text-sm font-bold disabled:opacity-40 text-gray-600 border-gray-300 bg-white hover:bg-gray-50"
          >
            <span
              className={`block w-4 h-4 border-2 border-gray-300 rounded-full ${refreshing ? 'animate-spin' : ''}`}
              style={{ borderTopColor: '#6b7280' }}
            />
            {refreshing ? '更新中...' : '最新に更新'}
          </button>
          <button
            onClick={downloadMonthCsv}
            disabled={loading || summaries.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border-2 text-sm font-bold disabled:opacity-40"
            style={{ borderColor: '#F5C200', color: '#b08800', backgroundColor: '#FFFBEB' }}
          >
            📥 今月のCSV
          </button>
          <button onClick={() => changeMonth(-1)} className="text-3xl px-2 text-gray-500 hover:text-gray-800">‹</button>
          <span className="text-2xl font-bold text-gray-800 w-40 text-center">{year}年 {month}月</span>
          <button onClick={() => changeMonth(1)} className="text-3xl px-2 text-gray-500 hover:text-gray-800">›</button>
        </div>

        {errorBanner && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-3 flex items-center justify-between">
            <span className="text-red-600 font-medium">{errorBanner}</span>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-red-500 hover:text-red-700 text-sm font-medium underline"
            >
              閉じる
            </button>
          </div>
        )}

        {noticeBanner && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-3 flex items-center justify-between gap-4">
            <span className="text-blue-700 font-medium">{noticeBanner}</span>
            <button
              onClick={() => setNoticeBanner(null)}
              className="text-blue-500 hover:text-blue-700 text-sm font-medium underline whitespace-nowrap"
            >
              閉じる
            </button>
          </div>
        )}

        {/* 講師別ビュー：左リスト＋右詳細 */}
        {viewMode === 'teacher' && (
        <div className="flex gap-5 items-start">

          {/* 左：全講師一覧 */}
          <div className="w-80 shrink-0 sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-2">
            {loading ? (
              <div className="flex items-center justify-center gap-3 py-10">
                <span
                  className="block w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                  style={{ borderTopColor: '#F5C200' }}
                />
                <span className="text-gray-500">読み込み中</span>
              </div>
            ) : allTeachers.length === 0 ? (
              <p className="text-center text-gray-400 py-10">講師データがありません</p>
            ) : (
              allTeachers.map((t) => {
                const s = summaries.find(s => s.id === t.id)
                const isSelected = selectedTeacher?.id === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTeacher(t)}
                    className="w-full text-left bg-white rounded-2xl shadow px-5 py-4 border-2 transition-all hover:shadow-md"
                    style={{
                      borderColor: isSelected ? MAIN_COLOR : 'transparent',
                      backgroundColor: isSelected ? '#FFFBEB' : 'white',
                    }}
                  >
                    <p className="font-bold text-gray-800 text-lg">{t.name}</p>
                    {s ? (
                      <div className="mt-1 text-sm text-gray-500 space-y-0.5">
                        <p className="font-bold" style={{ color: '#b08800' }}>
                          勤務 {new Set(s.records.map(r => r.date)).size}日　業務時間 {fmtMin(s.totalWorkMinutes + s.totalExtraMinutes)}
                        </p>
                        <p className="text-xs">
                          {s.totalPeriods}コマ　（内訳：業務 {fmtMin(s.totalWorkMinutes)}
                          {s.totalExtraMinutes > 0 && ` ＋ その他 ${fmtMin(s.totalExtraMinutes)}`}）
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-gray-400">この月の記録なし</p>
                    )}
                  </button>
                )
              })
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
                    {selectedTeacher.records.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <div className="rounded-xl px-4 py-2 bg-gray-50">
                          <p className="text-xs font-bold text-gray-500">{month}月のコマ数</p>
                          <p className="text-xl font-bold text-gray-700">{selectedTeacher.totalPeriods}コマ</p>
                        </div>
                        <div className="rounded-xl px-4 py-2" style={{ backgroundColor: '#FFF9E0' }}>
                          <p className="text-xs font-bold text-gray-500">{month}月の業務時間（その他込み）</p>
                          <p className="text-xl font-bold" style={{ color: '#b08800' }}>
                            {fmtMin(selectedTeacher.totalWorkMinutes + selectedTeacher.totalExtraMinutes)}
                          </p>
                          <p className="text-xs text-gray-500">
                            業務 {fmtMin(selectedTeacher.totalWorkMinutes)} ＋ その他 {fmtMin(selectedTeacher.totalExtraMinutes)}
                          </p>
                        </div>
                        <div className="rounded-xl px-4 py-2" style={{ backgroundColor: '#FFF9E0' }}>
                          <p className="text-xs font-bold text-gray-500">{month}月の勤務日数</p>
                          <p className="text-xl font-bold" style={{ color: '#b08800' }}>
                            {new Set(selectedTeacher.records.map(r => r.date)).size}日
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 mt-0.5">この月の記録はありません</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {editTarget && (
                      <button
                        onClick={() => setEditTarget(null)}
                        className="text-sm text-gray-400 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                      >
                        編集を閉じる
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const defaultDate = defaultDateForMonth(year, month)
                        const c = campuses.find(x => x.id === newRecord.campusId) ?? campuses[0]
                        const work = c ? calcWorkMinutes(c, newRecord.periods, defaultDate) : 0
                        setNewRecord(prev => ({ ...prev, date: defaultDate, workMinutes: work }))
                        setIsAdding(true)
                        setEditTarget(null)
                      }}
                      className="text-sm font-bold px-4 py-1.5 rounded-lg text-gray-900"
                      style={{ backgroundColor: MAIN_COLOR }}
                    >
                      ＋ 新規追加
                    </button>
                  </div>
                </div>

                {/* 校舎別集計（複数校舎の場合のみ） */}
                {selectedTeacher.records.length > 0 && (() => {
                  const campusMap = new Map<string, { periods: number; workMin: number; extraMin: number }>()
                  for (const rec of selectedTeacher.records) {
                    const k = rec.campus.name
                    if (!campusMap.has(k)) campusMap.set(k, { periods: 0, workMin: 0, extraMin: 0 })
                    const s = campusMap.get(k)!
                    s.periods += rec.periods; s.workMin += rec.work_minutes; s.extraMin += rec.extra_minutes
                  }
                  const subs = Array.from(campusMap.entries())
                  if (subs.length < 2) return null
                  return (
                    <div className="bg-white rounded-2xl shadow px-6 py-4">
                      <p className="text-xs font-bold text-gray-400 mb-3">校舎別集計</p>
                      <div className="flex flex-wrap gap-3">
                        {subs.map(([name, sub]) => {
                          const color = CAMPUS_COLORS[name] ?? DEFAULT_COLOR
                          return (
                            <div key={name} className="rounded-xl px-4 py-2.5" style={{ backgroundColor: color.bg }}>
                              <p className="font-bold text-sm flex items-center gap-2" style={{ color: color.text }}>
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color.border }} />
                                {name}
                              </p>
                              <p className="text-xs text-gray-600 mt-1 pl-4">
                                {sub.periods}コマ　業務時間 <span className="font-bold">{fmtMin(sub.workMin + sub.extraMin)}</span>
                              </p>
                              <p className="text-xs text-gray-500 pl-4">
                                （業務 {fmtMin(sub.workMin)}{sub.extraMin > 0 && ` ＋ その他 ${fmtMin(sub.extraMin)}`}）
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                {/* 新規追加フォーム */}
                {isAdding && (
                  <div className="bg-white rounded-2xl shadow p-6 border-2" style={{ borderColor: MAIN_COLOR }}>
                    <h3 className="text-lg font-bold text-gray-700 mb-5 pb-3 border-b border-gray-100">
                      新規記録を追加：{selectedTeacher.name} 先生
                    </h3>
                    <div className="grid grid-cols-2 gap-6">
                      {/* 左列 */}
                      <div className="space-y-5">
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">日付</label>
                          <input
                            type="date"
                            value={newRecord.date}
                            onChange={(e) => {
                              const newDate = e.target.value
                              const c = campuses.find(x => x.id === newRecord.campusId)
                              const work = c ? calcWorkMinutes(c, newRecord.periods, newDate) : 0
                              setNewRecord({ ...newRecord, date: newDate, workMinutes: work })
                            }}
                            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-[#F5C200]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">校舎</label>
                          <div className="space-y-2">
                            {campuses.map((c) => {
                              const color = CAMPUS_COLORS[c.name] ?? DEFAULT_COLOR
                              const isSel = newRecord.campusId === c.id
                              return (
                                <button
                                  key={c.id}
                                  onClick={() => {
                                    const work = calcWorkMinutes(c, newRecord.periods, newRecord.date)
                                    setNewRecord({ ...newRecord, campusId: c.id, workMinutes: work })
                                  }}
                                  className="w-full py-3 px-4 rounded-xl border-2 text-left font-semibold transition-all"
                                  style={isSel
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
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">コマ数</label>
                          <div className="grid grid-cols-4 gap-2">
                            {[0, 1, 2, 3].map((n) => (
                              <button
                                key={n}
                                onClick={() => {
                                  const c = campuses.find(x => x.id === newRecord.campusId)
                                  const work = c ? calcWorkMinutes(c, n, newRecord.date) : 0
                                  setNewRecord({ ...newRecord, periods: n, workMinutes: work })
                                }}
                                className="py-3 rounded-xl border-2 font-bold text-base transition-all"
                                style={newRecord.periods === n
                                  ? { backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR, color: '#1a1a1a' }
                                  : { borderColor: '#e5e7eb', color: '#374151' }
                                }
                              >
                                {n === 0 ? '授業なし' : `${n}コマ`}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">業務時間</label>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setNewRecord({ ...newRecord, workMinutes: Math.max(0, newRecord.workMinutes - 5) })}
                              disabled={newRecord.periods === 0 || newRecord.workMinutes === 0}
                              className="px-5 py-3 rounded-xl border-2 border-gray-300 font-bold text-gray-700 disabled:opacity-30 hover:bg-gray-50"
                            >
                              −5分
                            </button>
                            <span className="flex-1 text-center text-3xl font-bold" style={{ color: '#b08800' }}>
                              {newRecord.periods === 0 ? '0分' : `${newRecord.workMinutes}分`}
                            </span>
                            <button
                              onClick={() => setNewRecord({ ...newRecord, workMinutes: newRecord.workMinutes + 5 })}
                              disabled={newRecord.periods === 0}
                              className="px-5 py-3 rounded-xl border-2 font-bold disabled:opacity-30"
                              style={{ backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR }}
                            >
                              ＋5分
                            </button>
                          </div>
                          {newRecord.periods > 0 && (() => {
                            const c = campuses.find(x => x.id === newRecord.campusId)
                            const auto = c ? calcWorkMinutes(c, newRecord.periods, newRecord.date) : 0
                            const isManual = newRecord.workMinutes !== auto
                            return (
                              <p className="text-xs text-gray-500 mt-2 text-center">
                                自動計算：{auto}分
                                {isManual && (
                                  <button
                                    type="button"
                                    onClick={() => setNewRecord({ ...newRecord, workMinutes: auto })}
                                    className="ml-2 underline hover:text-gray-700"
                                  >
                                    自動値に戻す
                                  </button>
                                )}
                              </p>
                            )
                          })()}
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">その他業務時間</label>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setNewRecord({ ...newRecord, extraMinutes: Math.max(0, newRecord.extraMinutes - 10) })}
                              disabled={newRecord.extraMinutes === 0}
                              className="px-5 py-3 rounded-xl border-2 border-gray-300 font-bold text-gray-700 disabled:opacity-30 hover:bg-gray-50"
                            >
                              −10分
                            </button>
                            <span className="flex-1 text-center text-3xl font-bold" style={{ color: '#b08800' }}>
                              {newRecord.extraMinutes}分
                            </span>
                            <button
                              onClick={() => setNewRecord({ ...newRecord, extraMinutes: newRecord.extraMinutes + 10 })}
                              className="px-5 py-3 rounded-xl border-2 font-bold"
                              style={{ backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR }}
                            >
                              ＋10分
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">メモ</label>
                          <textarea
                            value={newRecord.notes}
                            onChange={(e) => setNewRecord({ ...newRecord, notes: e.target.value })}
                            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-[#F5C200] resize-none"
                            rows={3}
                          />
                        </div>
                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={() => setIsAdding(false)}
                            className="flex-1 py-3 rounded-xl border-2 border-gray-300 text-gray-600 font-semibold hover:bg-gray-50"
                          >
                            キャンセル
                          </button>
                          <button
                            onClick={handleAddNew}
                            disabled={addSaving || !newRecord.campusId}
                            className="flex-1 py-3 rounded-xl font-bold text-gray-900 disabled:opacity-60"
                            style={{ backgroundColor: MAIN_COLOR }}
                          >
                            {addSaving ? '追加中...' : '追加する'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 編集フォーム */}
                {editTarget && (
                  <div className="bg-white rounded-2xl shadow p-6">
                    <h3 className="text-lg font-bold text-gray-700 mb-5 pb-3 border-b border-gray-100">
                      記録を編集：{formatDate(editTarget.date)}
                    </h3>
                    <div className="grid grid-cols-2 gap-6">
                      {/* 左列 */}
                      <div className="space-y-5">
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">日付</label>
                          <input
                            type="date"
                            value={editTarget._editDate}
                            onChange={(e) => {
                              const newDate = e.target.value
                              const c = campuses.find(x => x.id === editTarget._editCampusId)
                              const work = c ? calcWorkMinutes(c, editTarget._editPeriods, newDate) : editTarget._editWorkMinutes
                              setEditTarget({ ...editTarget, _editDate: newDate, _editWorkMinutes: work })
                            }}
                            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-[#F5C200]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">校舎</label>
                          <div className="space-y-2">
                            {campuses.map((c) => {
                              const color = CAMPUS_COLORS[c.name] ?? DEFAULT_COLOR
                              const isSel = editTarget._editCampusId === c.id
                              return (
                                <button
                                  key={c.id}
                                  onClick={() => {
                                    const work = calcWorkMinutes(c, editTarget._editPeriods, editTarget._editDate)
                                    setEditTarget({ ...editTarget, _editCampusId: c.id, _editWorkMinutes: work })
                                  }}
                                  className="w-full py-3 px-4 rounded-xl border-2 text-left font-semibold transition-all"
                                  style={isSel
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
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">コマ数</label>
                          <div className="grid grid-cols-4 gap-2">
                            {[0, 1, 2, 3].map((n) => (
                              <button
                                key={n}
                                onClick={() => {
                                  const c = campuses.find(x => x.id === editTarget._editCampusId)
                                  const work = c ? calcWorkMinutes(c, n, editTarget._editDate) : 0
                                  setEditTarget({ ...editTarget, _editPeriods: n, _editWorkMinutes: work })
                                }}
                                className="py-3 rounded-xl border-2 font-bold text-base transition-all"
                                style={editTarget._editPeriods === n
                                  ? { backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR, color: '#1a1a1a' }
                                  : { borderColor: '#e5e7eb', color: '#374151' }
                                }
                              >
                                {n === 0 ? '授業なし' : `${n}コマ`}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">業務時間</label>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setEditTarget({ ...editTarget, _editWorkMinutes: Math.max(0, editTarget._editWorkMinutes - 5) })}
                              disabled={editTarget._editPeriods === 0 || editTarget._editWorkMinutes === 0}
                              className="px-5 py-3 rounded-xl border-2 border-gray-300 font-bold text-gray-700 disabled:opacity-30 hover:bg-gray-50"
                            >
                              −5分
                            </button>
                            <span className="flex-1 text-center text-3xl font-bold" style={{ color: '#b08800' }}>
                              {editTarget._editPeriods === 0 ? '0分' : `${editTarget._editWorkMinutes}分`}
                            </span>
                            <button
                              onClick={() => setEditTarget({ ...editTarget, _editWorkMinutes: editTarget._editWorkMinutes + 5 })}
                              disabled={editTarget._editPeriods === 0}
                              className="px-5 py-3 rounded-xl border-2 font-bold disabled:opacity-30"
                              style={{ backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR }}
                            >
                              ＋5分
                            </button>
                          </div>
                          {editTarget._editPeriods > 0 && (() => {
                            const c = campuses.find(x => x.id === editTarget._editCampusId)
                            const auto = c ? calcWorkMinutes(c, editTarget._editPeriods, editTarget._editDate) : 0
                            const isManual = editTarget._editWorkMinutes !== auto
                            return (
                              <p className="text-xs text-gray-500 mt-2 text-center">
                                自動計算：{auto}分
                                {isManual && (
                                  <button
                                    type="button"
                                    onClick={() => setEditTarget({ ...editTarget, _editWorkMinutes: auto })}
                                    className="ml-2 underline hover:text-gray-700"
                                  >
                                    自動値に戻す
                                  </button>
                                )}
                              </p>
                            )
                          })()}
                        </div>
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
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-2">メモ</label>
                          <textarea
                            value={editTarget._editNotes}
                            onChange={(e) => setEditTarget({ ...editTarget, _editNotes: e.target.value })}
                            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-[#F5C200] resize-none"
                            rows={3}
                          />
                        </div>
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
                {selectedTeacher.records.length > 0 && (
                  <div className="bg-white rounded-2xl shadow overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100" style={{ backgroundColor: '#FFF9E0' }}>
                          <th className="text-left px-6 py-3 text-sm font-bold text-gray-600">日付</th>
                          <th className="text-left px-4 py-3 text-sm font-bold text-gray-600">校舎</th>
                          <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">コマ数</th>
                          <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">業務時間</th>
                          <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">その他時間</th>
                          <th className="text-center px-4 py-3 text-sm font-bold" style={{ color: '#b08800' }}>合計</th>
                          <th className="text-left px-4 py-3 text-sm font-bold text-gray-600">メモ</th>
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
                                  className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full"
                                  style={{ backgroundColor: color.bg, color: color.text }}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color.border }} />
                                  {rec.campus.name}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-center text-base font-bold text-gray-800">
                                {rec.periods === 0 ? '授業なし' : `${rec.periods}コマ`}
                              </td>
                              <td className="px-4 py-4 text-center text-base text-gray-600">
                                {fmtMin(rec.work_minutes)}
                              </td>
                              <td className="px-4 py-4 text-center text-base text-gray-600">
                                {rec.extra_minutes > 0 ? fmtMin(rec.extra_minutes) : '−'}
                              </td>
                              <td className="px-4 py-4 text-center text-base font-bold" style={{ color: '#b08800' }}>
                                {fmtMin(rec.work_minutes + rec.extra_minutes)}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-700 max-w-[220px]">
                                {rec.notes ? (
                                  <p className="line-clamp-2 whitespace-pre-wrap break-words" title={rec.notes}>{rec.notes}</p>
                                ) : (
                                  <span className="text-gray-300">−</span>
                                )}
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
                      <tfoot>
                        <tr className="border-t-2 border-gray-300" style={{ backgroundColor: '#FFF9E0' }}>
                          <td colSpan={2} className="px-6 py-3 text-sm font-bold text-gray-700">
                            月合計（<span style={{ color: '#b08800' }}>勤務 {new Set(selectedTeacher.records.map(r => r.date)).size}日</span>）
                          </td>
                          <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">{selectedTeacher.totalPeriods}コマ</td>
                          <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">{fmtMin(selectedTeacher.totalWorkMinutes)}</td>
                          <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">
                            {selectedTeacher.totalExtraMinutes > 0 ? fmtMin(selectedTeacher.totalExtraMinutes) : '−'}
                          </td>
                          <td className="px-4 py-3 text-center text-base font-bold" style={{ color: '#b08800' }}>
                            {fmtMin(selectedTeacher.totalWorkMinutes + selectedTeacher.totalExtraMinutes)}
                          </td>
                          <td colSpan={2} className="px-4 py-3 text-sm text-gray-500">
                            業務時間の合計（その他業務時間を含む）
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )}

        {/* 日別ビュー：カレンダー＋下に詳細 */}
        {viewMode === 'day' && (
        <div className="space-y-4">
          {/* カレンダー */}
          <div ref={calendarRef} className="bg-white rounded-2xl shadow p-5">
            {loading ? (
              <div className="flex items-center justify-center gap-3 py-10">
                <span
                  className="block w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                  style={{ borderTopColor: '#F5C200' }}
                />
                <span className="text-gray-500">読み込み中</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-7 mb-2">
                  {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                    <div
                      key={d}
                      className="text-center text-sm font-bold py-2"
                      style={{ color: i === 0 ? '#DC2626' : i === 6 ? '#2563EB' : '#6B7280' }}
                    >
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {calendarCells.map((cell, idx) => {
                    if (!cell) {
                      return <div key={`empty-${idx}`} className="aspect-square" />
                    }
                    const isSelected = selectedDate === cell.dateStr
                    const isToday = cell.dateStr === TODAY_JST
                    const hasRecords = cell.records.length > 0
                    const dayColor = cell.dow === 0 ? '#DC2626' : cell.dow === 6 ? '#2563EB' : '#374151'
                    const teacherCount = new Set(cell.records.map(r => r.teacher.id)).size
                    const bgColor = isSelected
                      ? '#FFFBEB'
                      : hasRecords ? '#FAFAF9' : 'white'
                    const borderColor = isSelected
                      ? '#F5C200'
                      : hasRecords ? '#D4D4D8' : '#E5E7EB'
                    return (
                      <button
                        key={cell.dateStr}
                        onClick={() => setSelectedDate(isSelected ? null : cell.dateStr)}
                        className="aspect-square rounded-xl border-2 p-2 transition-all flex flex-col text-left hover:shadow hover:border-gray-400"
                        style={{ borderColor, backgroundColor: bgColor }}
                      >
                        <div className="flex items-baseline justify-between">
                          <span className="text-base font-bold" style={{ color: dayColor }}>
                            {cell.day}
                          </span>
                          {isToday && (
                            <span className="text-[10px] font-bold px-1 rounded" style={{ backgroundColor: '#F5C200', color: '#1a1a1a' }}>
                              今日
                            </span>
                          )}
                        </div>
                        {hasRecords && (
                          <>
                            <span className="text-sm font-bold text-gray-700 mt-1">{teacherCount}<span className="text-xs font-normal text-gray-500 ml-0.5">名</span></span>
                            <div className="mt-auto flex flex-wrap gap-0.5">
                              {cell.records.slice(0, 10).map((r) => {
                                const color = CAMPUS_COLORS[r.campus.name] ?? DEFAULT_COLOR
                                return (
                                  <span
                                    key={r.id}
                                    className="block w-2 h-2 rounded-full"
                                    style={{ backgroundColor: color.border }}
                                  />
                                )
                              })}
                            </div>
                          </>
                        )}
                      </button>
                    )
                  })}
                </div>
                {/* 凡例 */}
                <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-3 items-center text-xs text-gray-500">
                  <span className="font-bold text-gray-400">凡例：</span>
                  {campuses.map((c) => {
                    const color = CAMPUS_COLORS[c.name] ?? DEFAULT_COLOR
                    return (
                      <span key={c.id} className="inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color.border }} />
                        {c.name}
                      </span>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* 選択日の詳細 */}
          <div ref={dayDetailRef}>
          {selectedDate ? (() => {
            const dayRecords = (recordsByDate.get(selectedDate) ?? []).slice().sort((a, b) => a.teacher.code - b.teacher.code)
            const totalPeriods = dayRecords.reduce((s, r) => s + r.periods, 0)
            const totalWork = dayRecords.reduce((s, r) => s + r.work_minutes, 0)
            const totalExtra = dayRecords.reduce((s, r) => s + r.extra_minutes, 0)
            const teacherCount = new Set(dayRecords.map(r => r.teacher.id)).size
            return (
              <div className="bg-white rounded-2xl shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4" style={{ backgroundColor: '#FFF9E0' }}>
                  <div className="flex items-baseline gap-3 min-w-0">
                    <p className="text-lg font-bold text-gray-800 whitespace-nowrap">{formatDate(selectedDate)} の勤務</p>
                    {dayRecords.length > 0 && (
                      <p className="text-sm text-gray-500 whitespace-nowrap">{dayRecords.length}件 ／ {teacherCount}名</p>
                    )}
                  </div>
                  <button
                    onClick={closeDetailAndScrollUp}
                    className="text-sm font-semibold px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                  >
                    ↑ カレンダーに戻る
                  </button>
                </div>
                {dayRecords.length === 0 ? (
                  <p className="px-6 py-10 text-center text-gray-400">この日の記録はありません</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-6 py-3 text-sm font-bold text-gray-600">講師</th>
                        <th className="text-left px-4 py-3 text-sm font-bold text-gray-600">校舎</th>
                        <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">コマ数</th>
                        <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">業務時間</th>
                        <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">その他時間</th>
                        <th className="text-center px-4 py-3 text-sm font-bold" style={{ color: '#b08800' }}>合計</th>
                        <th className="text-left px-4 py-3 text-sm font-bold text-gray-600">メモ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {dayRecords.map((rec) => {
                        const color = CAMPUS_COLORS[rec.campus.name] ?? DEFAULT_COLOR
                        return (
                          <tr key={rec.id}>
                            <td className="px-6 py-4 text-base font-medium text-gray-800 whitespace-nowrap">
                              {rec.teacher.name}
                            </td>
                            <td className="px-4 py-4">
                              <span
                                className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full"
                                style={{ backgroundColor: color.bg, color: color.text }}
                              >
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color.border }} />
                                {rec.campus.name}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-center text-base font-bold text-gray-800">
                              {rec.periods === 0 ? '授業なし' : `${rec.periods}コマ`}
                            </td>
                            <td className="px-4 py-4 text-center text-base text-gray-600">
                              {fmtMin(rec.work_minutes)}
                            </td>
                            <td className="px-4 py-4 text-center text-base text-gray-600">
                              {rec.extra_minutes > 0 ? fmtMin(rec.extra_minutes) : '−'}
                            </td>
                            <td className="px-4 py-4 text-center text-base font-bold" style={{ color: '#b08800' }}>
                              {fmtMin(rec.work_minutes + rec.extra_minutes)}
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-700 max-w-[220px]">
                              {rec.notes ? (
                                <p className="line-clamp-2 whitespace-pre-wrap break-words" title={rec.notes}>{rec.notes}</p>
                              ) : (
                                <span className="text-gray-300">−</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300" style={{ backgroundColor: '#FFF9E0' }}>
                        <td colSpan={2} className="px-6 py-3 text-sm font-bold text-gray-700">合計</td>
                        <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">{totalPeriods}コマ</td>
                        <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">{fmtMin(totalWork)}</td>
                        <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">
                          {totalExtra > 0 ? fmtMin(totalExtra) : '−'}
                        </td>
                        <td className="px-4 py-3 text-center text-base font-bold" style={{ color: '#b08800' }}>
                          {fmtMin(totalWork + totalExtra)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">その他込み</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            )
          })() : (
            <div className="bg-white rounded-2xl shadow p-8 text-center text-gray-400">
              <p className="text-base">カレンダーの日付をクリックすると、その日の勤務詳細がここに表示されます</p>
            </div>
          )}
          </div>

          {/* フローティング「カレンダーに戻る」ボタン：日付選択中は常時表示 */}
          {selectedDate && (
            <button
              onClick={closeDetailAndScrollUp}
              className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-5 py-3 rounded-full font-bold text-sm shadow-lg hover:shadow-xl transition-shadow"
              style={{ backgroundColor: '#F5C200', color: '#1a1a1a' }}
              aria-label="カレンダーに戻る"
            >
              <span className="text-base leading-none">↑</span>
              カレンダーに戻る
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
