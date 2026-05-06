import { NavLink, Outlet } from 'react-router-dom'
import { Users, Calendar, UserCheck, Settings, Zap, Table2 } from 'lucide-react'

const links = [
  { to: '/admin/genera',  label: 'Genera Calendario', Icon: Zap },
  { to: '/admin/turni',   label: 'Modifica Turni',    Icon: Calendar },
  { to: '/admin/ferie',   label: 'Gestione Ferie',    Icon: Calendar },
  { to: '/admin/schema',  label: 'Schema Turni',      Icon: Table2 },
  { to: '/admin/medici',  label: 'Medici',            Icon: Users },
  { to: '/admin/utenti',  label: 'Utenti',            Icon: UserCheck },
  { to: '/admin/config',  label: 'Configurazione',    Icon: Settings },
]

export function AdminLayout() {
  return (
    <div className="flex h-[calc(100vh-48px)]">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 bg-gray-900 text-gray-300 flex flex-col py-4 overflow-y-auto print:hidden">
        <p className="px-4 text-[10px] uppercase tracking-widest text-gray-500 mb-3 font-semibold">
          Pannello Admin
        </p>
        {links.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-2.5 text-sm transition-colors
               ${isActive
                 ? 'bg-blue-700 text-white font-semibold'
                 : 'hover:bg-gray-700 hover:text-white'
               }`
            }
          >
            <Icon size={14} />
            {label}
          </NavLink>
        ))}
      </aside>

      {/* Contenuto */}
      <main className="flex-1 overflow-auto bg-gray-50 p-6">
        <Outlet />
      </main>
    </div>
  )
}
