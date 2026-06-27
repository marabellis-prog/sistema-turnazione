import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { Users, Calendar, UserCheck, Zap, Table2, AlertCircle, ArrowRightLeft, Settings, Archive, CalendarClock } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import { useFerieRealtime } from '../../hooks/useFerieRealtime'
import { useCambiTurnoRealtime } from '../../hooks/useCambiTurnoRealtime'
import { useAutoBackup } from '../../hooks/useBackupManager'
import { supabase } from '../../lib/supabase'

const links = [
  { to: '/admin/schema',  label: 'Disegna Schema',    Icon: Table2 },
  { to: '/admin/genera',  label: 'Genera Calendario', Icon: Zap },
  { to: '/admin/anteprima-turnazione', label: 'Anteprima turnazione', Icon: CalendarClock },
  { to: '/admin/turni',   label: 'Modifica Turni',    Icon: Calendar },
  { to: '/admin/ferie',   label: 'Gestione Ferie',    Icon: Calendar },
  { to: '/admin/cambi',   label: 'Cambi Turno',       Icon: ArrowRightLeft },
  { to: '/admin/medici',  label: 'Medici/Turnisti',   Icon: Users },
  { to: '/admin/utenti',  label: 'Utenti',            Icon: UserCheck },
  { to: '/admin/config',  label: 'Impostazioni',      Icon: Settings },
  { to: '/admin/backup',  label: 'Backup/Ripristino', Icon: Archive },
]

export function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { navGuard } = usePendingActions()

  // Realtime sulle ferie + cambi turno: garantisce che i count dei badge
  // si aggiornino istantaneamente qualunque sia la sotto-pagina admin
  // attiva. Idempotente: piu` hook nello stesso tab ascoltano canali
  // distinti grazie al random suffix.
  useFerieRealtime()
  useCambiTurnoRealtime()

  // Auto-backup dei turni: al primo accesso admin se l'ultimo backup e`
  // piu` vecchio dell'intervallo configurato, crea uno snapshot + rotazione.
  // Mai blocca la UI: failures sono solo loggate in console.
  useAutoBackup()

  // Count ferie ancora da approvare → driver del badge arancione.
  const { data: ferieDaApprovare = 0 } = useQuery({
    queryKey: ['ferie-pending-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('ferie')
        .select('*', { count: 'exact', head: true })
        .eq('approvate', false)
      if (error) throw error
      return count ?? 0
    },
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchInterval:             30_000,
    refetchIntervalInBackground: false,
  })

  // Count richieste cambio turno pending → secondo badge arancione.
  const { data: cambiDaApprovare = 0 } = useQuery({
    queryKey: ['cambi-turno-pending-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('cambi_turno')
        .select('*', { count: 'exact', head: true })
        .eq('stato', 'pending')
      if (error) throw error
      return count ?? 0
    },
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchInterval:             30_000,
    refetchIntervalInBackground: false,
  })

  function handleNav(to: string) {
    if (location.pathname === to) return   // già sulla pagina
    if (navGuard) {
      // Il guard può bloccare la navigazione (es. modifiche non salvate in schema)
      const canProceed = navGuard(to)
      if (!canProceed) return   // il guard ha mostrato un modal
    }
    navigate(to)
  }

  // Helper per renderizzare un badge "X da approvare" uniforme.
  // Lo riuso per ferie e cambi turno con label/count diversi.
  function PendingBadge({ count, label, to }: { count: number; label: string; to: string }) {
    if (count === 0) return null
    return (
      <button
        onClick={() => handleNav(to)}
        className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-md text-xs font-semibold
                   transition-all animate-pulse hover:opacity-90 text-left"
        style={{ background: '#d97706', color: '#fff' }}
        title={`Vai a ${label} — ${count} richiest${count === 1 ? 'a' : 'e'} in attesa`}
      >
        <AlertCircle size={14} className="shrink-0" />
        <span className="leading-tight">
          {label}
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: 'rgba(255,255,255,0.25)' }}>
            {count}
          </span>
        </span>
      </button>
    )
  }

  return (
    <div className="flex h-[calc(100vh-48px)]">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 flex flex-col py-4 overflow-y-auto print:hidden"
        style={{ background: '#1c2818', color: '#c0d0b0' }}>
        <p className="px-4 text-[10px] uppercase tracking-widest mb-3 font-semibold"
          style={{ color: '#577a45' }}>
          Pannello Admin
        </p>
        {links.map(({ to, label, Icon }) => {
          const isActive = location.pathname.startsWith(to)
          return (
            <button
              key={to}
              onClick={() => handleNav(to)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm transition-colors text-left w-full"
              style={isActive
                ? { background: '#456b3a', color: '#fff' }
                : { color: '#9ab488' }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = '#fff' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = '#9ab488' }}
            >
              <Icon size={14} />
              {label}
            </button>
          )
        })}

        {/* Badge pending — sotto la lista link, una riga ciascuno (se presenti).
            Arancione = chiama attenzione senza essere allarmante come il rosso
            (riservato a "Rigenera calendario" nella navbar). Aggiornamento
            realtime via useFerieRealtime / useCambiTurnoRealtime + polling. */}
        <div className="mt-2">
          <PendingBadge count={ferieDaApprovare} label="Ferie da approvare" to="/admin/ferie" />
          <PendingBadge count={cambiDaApprovare} label="Cambi turno da approvare" to="/admin/cambi" />
        </div>
      </aside>

      {/* Contenuto */}
      <main className="flex-1 overflow-auto p-6" style={{ background: '#f4f1ea' }}>
        <Outlet />
      </main>
    </div>
  )
}
