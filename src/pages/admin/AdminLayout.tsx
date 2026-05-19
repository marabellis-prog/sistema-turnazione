import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { Users, Calendar, UserCheck, Zap, Table2, AlertCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import { useFerieRealtime } from '../../hooks/useFerieRealtime'
import { supabase } from '../../lib/supabase'

const links = [
  { to: '/admin/schema',  label: 'Disegna Schema',    Icon: Table2 },
  { to: '/admin/genera',  label: 'Genera Calendario', Icon: Zap },
  { to: '/admin/turni',   label: 'Modifica Turni',    Icon: Calendar },
  { to: '/admin/ferie',   label: 'Gestione Ferie',    Icon: Calendar },
  { to: '/admin/medici',  label: 'Medici/Turnisti',   Icon: Users },
  { to: '/admin/utenti',  label: 'Utenti',            Icon: UserCheck },
]

export function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { navGuard } = usePendingActions()

  // Realtime sulle ferie: garantisce che il count di "Ferie da approvare"
  // si aggiorni istantaneamente qualunque sia la sotto-pagina admin
  // attiva (anche /admin/medici o /admin/utenti che non si occupano
  // di ferie autonomamente). Idempotente: piu` hook nello stesso tab
  // ascoltano canali distinti grazie al random suffix.
  useFerieRealtime()

  // Count ferie ancora da approvare → driver del badge arancione
  // nella sidebar. queryKey `ferie-pending-count` e` invalidata dal
  // useFerieRealtime ad ogni cambiamento sulla tabella ferie, e
  // dal polling 30s come safety net se realtime non e` attivo.
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

  function handleNav(to: string) {
    if (location.pathname === to) return   // già sulla pagina
    if (navGuard) {
      // Il guard può bloccare la navigazione (es. modifiche non salvate in schema)
      const canProceed = navGuard(to)
      if (!canProceed) return   // il guard ha mostrato un modal
    }
    navigate(to)
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

        {/* Badge "Ferie da approvare" — visibile SOLO se ci sono ferie
            in attesa. Cliccabile, porta direttamente a /admin/ferie.
            Arancione = chiama attenzione senza essere allarmante come il
            rosso (riservato a "Rigenera calendario" nella navbar). Si
            aggiorna in realtime via useFerieRealtime + polling 30s. */}
        {ferieDaApprovare > 0 && (
          <button
            onClick={() => handleNav('/admin/ferie')}
            className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-md text-xs font-semibold
                       transition-all animate-pulse hover:opacity-90 text-left"
            style={{ background: '#d97706', color: '#fff' }}
            title={`Vai a Gestione Ferie — ${ferieDaApprovare} richiest${ferieDaApprovare === 1 ? 'a' : 'e'} in attesa`}
          >
            <AlertCircle size={14} className="shrink-0" />
            <span className="leading-tight">
              Ferie da approvare
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: 'rgba(255,255,255,0.25)' }}>
                {ferieDaApprovare}
              </span>
            </span>
          </button>
        )}
      </aside>

      {/* Contenuto */}
      <main className="flex-1 overflow-auto p-6" style={{ background: '#f4f1ea' }}>
        <Outlet />
      </main>
    </div>
  )
}
