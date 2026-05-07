import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { Users, Calendar, UserCheck, Settings, Zap, Table2 } from 'lucide-react'
import { usePendingActions } from '../../contexts/PendingActionsContext'

const links = [
  { to: '/admin/genera',  label: 'Genera Calendario', Icon: Zap },
  { to: '/admin/turni',   label: 'Modifica Turni',    Icon: Calendar },
  { to: '/admin/ferie',   label: 'Gestione Ferie',    Icon: Calendar },
  { to: '/admin/schema',  label: 'Disegna Schema',    Icon: Table2 },
  { to: '/admin/medici',  label: 'Medici',            Icon: Users },
  { to: '/admin/utenti',  label: 'Utenti',            Icon: UserCheck },
  { to: '/admin/config',  label: 'Configurazione',    Icon: Settings },
]

export function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { navGuard } = usePendingActions()

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
                ? { background: '#374f30', color: '#fff' }
                : { color: '#9ab488' }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = '#fff' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = '#9ab488' }}
            >
              <Icon size={14} />
              {label}
            </button>
          )
        })}
      </aside>

      {/* Contenuto */}
      <main className="flex-1 overflow-auto p-6" style={{ background: '#f4f1ea' }}>
        <Outlet />
      </main>
    </div>
  )
}
