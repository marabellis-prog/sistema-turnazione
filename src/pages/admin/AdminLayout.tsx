import { NavLink, Outlet } from 'react-router-dom'
import { Users, Calendar, UserCheck, Settings, Zap, Table2 } from 'lucide-react'

const links = [
  { to: '/admin/genera',  label: 'Genera Calendario', Icon: Zap },
  { to: '/admin/turni',   label: 'Modifica Turni',    Icon: Calendar },
  { to: '/admin/ferie',   label: 'Gestione Ferie',    Icon: Calendar },
  { to: '/admin/schema',  label: 'Disegna Schema',     Icon: Table2 },
  { to: '/admin/medici',  label: 'Medici',            Icon: Users },
  { to: '/admin/utenti',  label: 'Utenti',            Icon: UserCheck },
  { to: '/admin/config',  label: 'Configurazione',    Icon: Settings },
]

export function AdminLayout() {
  return (
    <div className="flex h-[calc(100vh-48px)]">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 flex flex-col py-4 overflow-y-auto print:hidden"
        style={{ background: '#1c2818', color: '#c0d0b0' }}>
        <p className="px-4 text-[10px] uppercase tracking-widest mb-3 font-semibold"
          style={{ color: '#577a45' }}>
          Pannello Admin
        </p>
        {links.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-2.5 text-sm transition-colors
               ${isActive
                 ? 'font-semibold'
                 : 'hover:text-white'
               }`
            }
            style={({ isActive }) => isActive
              ? { background: '#374f30', color: '#fff' }
              : { color: '#9ab488' }
            }
          >
            <Icon size={14} />
            {label}
          </NavLink>
        ))}
      </aside>

      {/* Contenuto */}
      <main className="flex-1 overflow-auto p-6" style={{ background: '#f4f1ea' }}>
        <Outlet />
      </main>
    </div>
  )
}
