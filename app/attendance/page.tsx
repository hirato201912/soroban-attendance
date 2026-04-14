'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { LoggedInTeacher, Campus } from '@/types'

const MAIN_COLOR = '#F5C200'
const TODAY = new Date().toISOString().split('T')[0]

// 校舎ごとの色（未選択時の背景・選択時の背景）
const CAMPUS_COLORS: Record<string, { bg: string; activeBg: string; text: string }> = {
  '前原前校': { bg: '#DBEAFE', activeBg: '#3B82F6', text: '#1D4ED8' },
  '可也校':   { bg: '#D1FAE5', activeBg: '#10B981', text: '#065F46' },
  '南校':     { bg: '#EDE9FE', activeBg: '#8B5CF6', text: '#5B21B6' },
  '春風校':   { bg: '#FCE7F3', activeBg: '#EC4899', text: '#9D174D' },
  '東校':     { bg: '#CFFAFE', activeBg: '#06B6D4', text: '#155E75' },
}
const DEFAULT_CAMPUS_COLOR = { bg: '#F3F4F6', activeBg: '#6B7280', text: '#374151' }

type Step = 'form' | 'confirm' | 'done'

export default function AttendancePage() {
  const router = useRouter()
  const [teacher, setTeacher] = useState<LoggedInTeacher | null>(null)
  const [campuses, setCampuses] = useState<Campus[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState<Step>('form')

  const [selectedCampus, setSelectedCampus] = useState<Campus | null>(null)
  const [selectedPeriods, setSelectedPeriods] = useState<number | null>(null)
  const [extraMinutes, setExtraMinutes] = useState(0)
  const [duplicateError, setDuplicateError] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('soroban_teacher')
    if (!saved) { router.replace('/'); return }
    const t = JSON.parse(saved) as LoggedInTeacher
    if (t.is_soroban_admin) { router.replace('/admin'); return }
    setTeacher(t)

    supabase
      .from('soroban_campuses')
      .select('*')
      .order('sort_order')
      .then(({ data }) => {
        setCampuses(data ?? [])
        setLoading(false)
      })
  }, [router])

  // 業務時間 = 片付け時間（1日一律・コマ数に関係なし）
  const workMinutes = selectedCampus ? selectedCampus.cleanup_minutes : 0

  const canConfirm = selectedCampus !== null && selectedPeriods !== null

  const handleSubmit = async () => {
    if (!teacher || !selectedCampus || selectedPeriods == null) return
    setSubmitting(true)
    setDuplicateError(false)

    // 重複チェック：同じ先生・同じ校舎・同じ日
    const { data: existing } = await supabase
      .from('soroban_attendances')
      .select('id')
      .eq('teacher_id', teacher.id)
      .eq('campus_id', selectedCampus.id)
      .eq('date', TODAY)
      .maybeSingle()

    if (existing) {
      setDuplicateError(true)
      setSubmitting(false)
      setStep('form')
      return
    }

    const { error } = await supabase.from('soroban_attendances').insert({
      teacher_id: teacher.id,
      date: TODAY,
      campus_id: selectedCampus.id,
      periods: selectedPeriods,
      work_minutes: workMinutes,
      extra_minutes: extraMinutes,
      notes: null,
    })

    if (error) {
      alert('送信に失敗しました。もう一度お試しください。')
      setSubmitting(false)
      return
    }
    setStep('done')
    setSubmitting(false)
  }

  const resetForm = () => {
    setSelectedCampus(null)
    setSelectedPeriods(null)
    setExtraMinutes(0)
    setDuplicateError(false)
    setStep('form')
  }

  const handleLogout = () => {
    localStorage.removeItem('soroban_teacher')
    router.push('/')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-xl text-gray-500">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 shadow-md" style={{ backgroundColor: MAIN_COLOR }}>
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <p className="text-gray-900 font-bold text-lg leading-tight">そろばん塾ピコ</p>
            <p className="text-gray-700 text-sm">{teacher?.name} 先生</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/history')}
              className="px-4 py-2 rounded-lg bg-white/40 text-gray-900 font-semibold text-base"
            >
              履歴
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-lg bg-white/40 text-gray-900 font-semibold text-base"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">

        {/* 完了画面 */}
        {step === 'done' && (
          <div className="bg-white rounded-2xl shadow p-8 text-center space-y-4">
            <p className="text-6xl mb-2">✅</p>
            <p className="text-2xl font-bold text-gray-800">送信しました</p>
            <p className="text-gray-500 text-lg">お疲れ様でした！</p>
            <div className="pt-4 space-y-3">
              <button
                onClick={() => router.push('/history')}
                className="w-full py-5 rounded-xl text-gray-900 font-bold text-xl"
                style={{ backgroundColor: MAIN_COLOR }}
              >
                勤務履歴を確認する
              </button>
              <button
                onClick={resetForm}
                className="w-full py-4 rounded-xl border-2 border-gray-300 text-gray-600 font-semibold text-lg"
              >
                別の校舎を入力する
              </button>
            </div>
          </div>
        )}

        {/* 確認画面 */}
        {step === 'confirm' && selectedCampus && selectedPeriods != null && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-gray-800 text-center">入力内容の確認</h2>
            <div className="bg-white rounded-2xl shadow divide-y divide-gray-100">
              <Row label="日付" value={TODAY} />
              <Row label="校舎" value={selectedCampus.name} />
              <Row label="授業コマ数" value={selectedPeriods === 0 ? '授業なし' : `${selectedPeriods}コマ`} />
              <Row label="業務時間" value={`${workMinutes}分`} note="授業準備・片付け含む" />
              {extraMinutes > 0 && (
                <Row label="その他業務時間" value={`${extraMinutes}分`} />
              )}
            </div>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-5 rounded-xl text-gray-900 font-bold text-xl disabled:opacity-60"
              style={{ backgroundColor: MAIN_COLOR }}
            >
              {submitting ? '送信中...' : 'この内容で送信する'}
            </button>
            <button
              onClick={() => setStep('form')}
              className="w-full py-4 rounded-xl border-2 border-gray-300 text-gray-700 font-semibold text-xl"
            >
              戻る
            </button>
          </div>
        )}

        {/* 入力フォーム */}
        {step === 'form' && (
          <div className="space-y-6">

            {/* 重複エラー */}
            {duplicateError && (
              <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 text-center">
                <p className="text-red-600 font-bold text-lg">この校舎の本日の記録はすでに送信されています</p>
                <p className="text-red-400 text-base mt-1">別の校舎を選んでください</p>
              </div>
            )}

            {/* 今日の日付 */}
            <div className="bg-white rounded-2xl shadow px-5 py-4 text-center">
              <p className="text-gray-500 text-base">勤務日</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{TODAY}</p>
            </div>

            {/* 校舎選択 */}
            <section className="bg-white rounded-2xl shadow p-5">
              {!selectedCampus && (
                <h2 className="text-xl font-bold text-gray-700 mb-4">校舎を選んでください</h2>
              )}
              {campuses.length === 0 ? (
                <p className="text-gray-400 text-lg text-center py-4">
                  校舎データがまだ登録されていません
                </p>
              ) : selectedCampus ? (
                /* 選択済み：選んだ校舎だけ表示 */
                <div className="flex flex-col gap-3">
                  {(() => {
                    const color = CAMPUS_COLORS[selectedCampus.name] ?? DEFAULT_CAMPUS_COLOR
                    return (
                      <>
                        <div
                          className="w-full py-6 rounded-2xl text-center font-bold text-2xl border-2"
                          style={{ backgroundColor: color.activeBg, borderColor: color.activeBg, color: '#fff' }}
                        >
                          {selectedCampus.name}
                        </div>
                        <p className="text-center text-base text-gray-500 px-2">
                          授業準備のため、業務時間が
                          <span className="font-bold text-gray-700">自動で {selectedCampus.cleanup_minutes}分</span>
                          追加されます
                        </p>
                      </>
                    )
                  })()}
                  <button
                    onClick={() => { setSelectedCampus(null); setSelectedPeriods(null) }}
                    className="w-full py-3 rounded-xl border-2 border-gray-300 text-gray-500 font-semibold text-lg"
                  >
                    変更する
                  </button>
                </div>
              ) : (
                /* 未選択：全校舎を表示 */
                <div className="flex flex-col gap-3">
                  {campuses.map((campus) => {
                    const color = CAMPUS_COLORS[campus.name] ?? DEFAULT_CAMPUS_COLOR
                    return (
                      <button
                        key={campus.id}
                        onClick={() => {
                          setSelectedCampus(campus)
                          setSelectedPeriods(null)
                        }}
                        className="w-full py-6 rounded-2xl text-center font-bold text-2xl transition-all border-2"
                        style={{ backgroundColor: '#fff', borderColor: color.activeBg, color: color.text }}
                      >
                        {campus.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </section>

            {/* コマ数選択（校舎が選ばれたら表示） */}
            {selectedCampus && (
              <section className="bg-white rounded-2xl shadow p-5">
                <h2 className="text-xl font-bold text-gray-700 mb-4">授業コマ数</h2>
                <div className="grid grid-cols-2 gap-4">
                  {[{ n: 0, label: '授業なし' }, { n: 1, label: '1コマ' }, { n: 2, label: '2コマ' }, { n: 3, label: '3コマ' }].map(({ n, label }) => (
                    <button
                      key={n}
                      onClick={() => setSelectedPeriods(n)}
                      className="py-6 rounded-2xl border-2 font-bold text-2xl transition-colors"
                      style={
                        selectedPeriods === n
                          ? { backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR, color: '#1a1a1a' }
                          : { backgroundColor: '#fff', borderColor: '#d1d5db', color: '#374151' }
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {selectedPeriods != null && (
                  <p className="mt-4 text-center text-lg text-gray-600">
                    業務時間：
                    <span className="font-bold text-xl" style={{ color: '#b08800' }}>
                      {workMinutes}分
                    </span>
                  </p>
                )}
              </section>
            )}

            {/* その他業務時間 */}
            {selectedCampus && (
              <section className="bg-white rounded-2xl shadow p-5">
                <h2 className="text-xl font-bold text-gray-700 mb-1">その他業務時間</h2>
                <p className="text-gray-400 text-base mb-5">会議などがあった場合、入力してください（10分単位）</p>
                <div className="flex items-center justify-between gap-4">
                  <button
                    onClick={() => setExtraMinutes(Math.max(0, extraMinutes - 10))}
                    disabled={extraMinutes === 0}
                    className="w-24 h-16 rounded-xl border-2 border-gray-300 text-xl font-bold text-gray-700 disabled:opacity-30"
                  >
                    −10分
                  </button>
                  <div className="flex-1 text-center">
                    <span className="text-5xl font-bold" style={{ color: '#b08800' }}>
                      {extraMinutes}
                    </span>
                    <span className="text-2xl text-gray-600 ml-1">分</span>
                  </div>
                  <button
                    onClick={() => setExtraMinutes(extraMinutes + 10)}
                    className="w-24 h-16 rounded-xl border-2 text-xl font-bold text-gray-900"
                    style={{ backgroundColor: MAIN_COLOR, borderColor: MAIN_COLOR }}
                  >
                    ＋10分
                  </button>
                </div>
              </section>
            )}

            {/* 確認ボタン */}
            <button
              onClick={() => setStep('confirm')}
              disabled={!canConfirm}
              className="w-full py-6 rounded-xl font-bold text-2xl transition-colors"
              style={
                canConfirm
                  ? { backgroundColor: MAIN_COLOR, color: '#1a1a1a' }
                  : { backgroundColor: '#e5e7eb', color: '#9ca3af' }
              }
            >
              入力内容を確認する
            </button>
            {!canConfirm && (
              <p className="text-center text-gray-400 text-base -mt-3">
                校舎とコマ数を選んでください
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex justify-between items-center px-5 py-4">
      <span className="text-gray-500 text-lg">{label}</span>
      <div className="text-right">
        <span className="text-gray-900 text-xl font-semibold">{value}</span>
        {note && <p className="text-gray-400 text-sm mt-0.5">{note}</p>}
      </div>
    </div>
  )
}
