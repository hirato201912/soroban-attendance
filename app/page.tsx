'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

const MAIN_COLOR = '#F5C200'
const CHARA_SRC = '/pico 2026-04-12 211036.png'

export default function LoginPage() {
  const router = useRouter()
  const [teacherCode, setTeacherCode] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('soroban_teacher')
    if (saved) {
      const teacher = JSON.parse(saved)
      router.replace(teacher.is_soroban_admin ? '/admin' : '/attendance')
    }
  }, [router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data, error: err } = await supabase
      .from('itoshima_teachers')
      .select('id, name, password, is_soroban_admin')
      .eq('code', parseInt(teacherCode))
      .single()

    if (err || !data) {
      setError('講師IDが見つかりません')
      setLoading(false)
      return
    }

    if (data.password !== password) {
      setError('パスワードが正しくありません')
      setLoading(false)
      return
    }

    localStorage.setItem(
      'soroban_teacher',
      JSON.stringify({ id: data.id, name: data.name, is_soroban_admin: data.is_soroban_admin })
    )
    router.push(data.is_soroban_admin ? '/admin' : '/attendance')
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="py-6 text-center shadow-md" style={{ backgroundColor: MAIN_COLOR }}>
        <h1 className="text-gray-900 text-3xl font-bold tracking-wide">そろばん塾ピコ</h1>
        <p className="text-gray-700 text-base mt-1">講師 勤怠管理</p>
      </header>

      <div className="flex-1 flex items-center justify-center relative px-4 py-8 overflow-hidden">

        {/* PC：カード左右にキャラクターを大きく表示 */}
        <div className="hidden md:flex absolute left-4 bottom-0 select-none pointer-events-none">
          <Image
            src={CHARA_SRC}
            alt=""
            width={260}
            height={200}
            className="object-contain"
          />
        </div>
        <div className="hidden md:flex absolute right-4 bottom-0 select-none pointer-events-none opacity-30 scale-x-[-1]">
          <Image
            src={CHARA_SRC}
            alt=""
            width={200}
            height={155}
            className="object-contain"
          />
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-yellow-100 p-8 w-full max-w-sm z-10">

          {/* スマホ：カード上部にキャラクター */}
          <div className="md:hidden flex justify-center mb-4">
            <Image
              src={CHARA_SRC}
              alt=""
              width={160}
              height={120}
              className="object-contain"
            />
          </div>

          <h2 className="text-2xl font-bold text-center mb-8" style={{ color: '#b08800' }}>
            ログイン
          </h2>

          <form onSubmit={handleLogin} className="flex flex-col gap-6">
            <div>
              <label className="block text-lg font-semibold text-gray-700 mb-2">講師ID</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={teacherCode}
                onChange={(e) => setTeacherCode(e.target.value)}
                autoComplete="username"
                className="w-full border-2 border-gray-300 rounded-xl px-3 py-4 text-center text-3xl tracking-widest focus:outline-none focus:border-[#F5C200]"
                required
              />
            </div>
            <div>
              <label className="block text-lg font-semibold text-gray-700 mb-2">パスワード</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full border-2 border-gray-300 rounded-xl px-3 py-4 text-xl focus:outline-none focus:border-[#F5C200]"
                placeholder="パスワードを入力"
                required
              />
            </div>
            {error && (
              <p className="text-red-500 text-base text-center font-medium">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-5 rounded-xl text-gray-900 font-bold text-xl disabled:opacity-60 mt-1"
              style={{ backgroundColor: MAIN_COLOR }}
            >
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
