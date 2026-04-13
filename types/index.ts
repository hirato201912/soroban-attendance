export type LoggedInTeacher = {
  id: string
  name: string
  is_soroban_admin: boolean
}

export type Campus = {
  id: string
  name: string
  cleanup_minutes: number
  sort_order: number
}

export type SorobanAttendance = {
  id: string
  teacher_id: string
  date: string
  campus_id: string
  periods: number
  work_minutes: number
  extra_minutes: number
  notes: string | null
  created_at: string
}

export type AttendanceWithRelations = SorobanAttendance & {
  teacher: { id: string; name: string; code: number }
  campus: { id: string; name: string; minutes_per_period: number }
}
