import { useState } from 'react'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { Users, Calendar, Zap, Table2, AlertCircle, ArrowRightLeft, CalendarDays, Archive, CalendarClock, SlidersHorizontal, Tag } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import { useReparto, REPARTO_11N } from '../../contexts/RepartoContext'
import { useConfigReparto } from '../../hooks/useConfigReparto'
import { useSchemaLabeler } from '../../hooks/useSchemaLabel'
import { useFerieRealtime } from '../../hooks/useFerieRealtime'
import { useCambiTurnoRealtime } from '../../hooks/useCambiTurnoRealtime'
import { useAutoBackup } from '../../hooks/useBackupManager'
import { supabase } from '../../lib/supabase'
import type { Configurazione } from '../../types'

// Ordine = sequenza logica di creazione di una turnazione da zero:
// Turnisti → Tipi di turno → Regole → Schema → Genera → Anteprima → Modifica…
const links = [
  { to: '/admin/centro-controllo', label: 'Centro di controllo', Icon: SlidersHorizontal },
  { to: '/admin/medici',  label: 'Turnisti',          Icon: Users },
  { to: '/admin/config',  label: 'Festività',         Icon: CalendarDays },
  { to: '/admin/schema-nuovo', label: 'Disegna Schema ⚗️', Icon: Table2 },
  { to: '/admin/schema',  label: 'Schema classico (11N)', Icon: Tag },   // legacy: solo 11N, rimosso a fine migrazione
  { to: '/admin/genera',  label: 'Genera Calendario', Icon: Zap },
  { to: '/admin/anteprima-turnazione', label: 'Anteprima turni', Icon: CalendarClock },
  { to: '/admin/turni',   label: 'Modifica Turni',    Icon: Calendar },
  { to: '/admin/ferie',   label: 'Gestione Ferie',    Icon: Calendar },
  { to: '/admin/cambi',   label: 'Cambi Turno',       Icon: ArrowRightLeft },
  { to: '/admin/backup',  label: 'Backup/Ripristino', Icon: Archive },
  { to: '/admin/archivio', label: 'Archivio turnazioni', Icon: CalendarClock },
]

export function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { navGuard } = usePendingActions()
  const { reparti, repartoAttivo, setRepartoAttivo, repartoCorrente, isSuperAdmin } = useReparto()

  // Realtime sulle ferie + cambi turno: garantisce che i count dei badge
  // si aggiornino istantaneamente qualunque sia la sotto-pagina admin
  // attiva. Idempotente: piu` hook nello stesso tab ascoltano canali
  // distinti grazie al random suffix.
  useFerieRealtime()
  useCambiTurnoRealtime()

  // Auto-backup dei turni del REPARTO ATTIVO: se l'ultimo backup di questo
  // reparto e` piu` vecchio dell'intervallo (policy globale), crea uno
  // snapshot + rotazione. Mai blocca la UI: failures solo in console.
  useAutoBackup(repartoAttivo)

  // Pending ferie/cambi su TUTTI i reparti gestiti (badge CROSS-REPARTO): così
  // non si perde una richiesta in un reparto non attivo. Ordinate per data →
  // la più vecchia guida il "Vai alla richiesta".
  const repartiIds = reparti.map(r => r.id)
  const { data: feriePending = [] } = useQuery<{ id: string; reparto_id: string }[]>({
    queryKey: ['ferie-pending-multi', repartiIds.join(',')],
    queryFn: async () => {
      if (repartiIds.length === 0) return []
      const { data, error } = await supabase.from('ferie')
        .select('id, reparto_id, created_at')
        .in('reparto_id', repartiIds).eq('approvate', false)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as { id: string; reparto_id: string }[]
    },
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchInterval:             30_000,
    refetchIntervalInBackground: false,
  })

  const { data: cambiPending = [] } = useQuery<{ id: string; reparto_id: string }[]>({
    queryKey: ['cambi-pending-multi', repartiIds.join(',')],
    queryFn: async () => {
      if (repartiIds.length === 0) return []
      const { data, error } = await supabase.from('cambi_turno')
        .select('id, reparto_id, created_at')
        .in('reparto_id', repartiIds).eq('stato', 'pending')
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as { id: string; reparto_id: string }[]
    },
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchInterval:             30_000,
    refetchIntervalInBackground: false,
  })

  // Config: schema attivo + cronologia switch (per la sezione in fondo).
  const { data: config } = useConfigReparto()
  const labelSchema     = useSchemaLabeler(repartoAttivo)

  function handleNav(to: string) {
    if (location.pathname === to) return   // già sulla pagina
    if (navGuard) {
      // Il guard può bloccare la navigazione (es. modifiche non salvate in schema)
      const canProceed = navGuard(to)
      if (!canProceed) return   // il guard ha mostrato un modal
    }
    navigate(to)
  }

  // Vai alla richiesta pending "giusta": preferisci una del reparto attivo,
  // altrimenti la più vecchia in assoluto → cambia reparto + naviga + evidenzia
  // (la pagina target legge ?richiesta e fa scroll+flash).
  function vaiARichiesta(pending: { id: string; reparto_id: string }[], to: string) {
    if (pending.length === 0) return
    const target = pending.find(p => p.reparto_id === repartoAttivo) ?? pending[0]
    if (target.reparto_id !== repartoAttivo) setRepartoAttivo(target.reparto_id)
    handleNav(`${to}?richiesta=${target.id}`)
  }

  // Badge "X da approvare" CROSS-REPARTO. count = pending su TUTTI i reparti
  // gestiti; se alcune sono in altri reparti lo segnala.
  function PendingBadge({ pending, label, to }: { pending: { id: string; reparto_id: string }[]; label: string; to: string }) {
    const count = pending.length
    if (count === 0) return null
    const altri = pending.filter(p => p.reparto_id !== repartoAttivo).length
    return (
      <button
        onClick={() => vaiARichiesta(pending, to)}
        className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-md text-xs font-semibold
                   transition-all animate-pulse hover:opacity-90 text-left"
        style={{ background: '#d97706', color: '#fff' }}
        title={altri > 0
          ? `${label}: ${count} in attesa (${altri} in altri reparti) — vai alla più vecchia`
          : `Vai a ${label} — ${count} richiest${count === 1 ? 'a' : 'e'} in attesa`}
      >
        <AlertCircle size={14} className="shrink-0" />
        <span className="leading-tight">
          {label}
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: 'rgba(255,255,255,0.25)' }}>
            {count}
          </span>
          {altri > 0 && <span className="ml-1 text-[9px] opacity-90">· altri reparti</span>}
        </span>
      </button>
    )
  }

  return (
    <div className="flex h-[calc(100vh-48px)]">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 flex flex-col py-4 overflow-y-auto print:hidden"
        style={{ background: '#1c2818', color: '#c0d0b0' }}>
        <p className="px-4 text-[10px] uppercase tracking-widest mb-2 font-semibold"
          style={{ color: '#577a45' }}>
          Pannello Admin
        </p>

        {/* Selettore reparto attivo: tutte le funzioni per-reparto operano su
            questo reparto. */}
        <div className="px-3 mb-3">
          <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: '#577a45' }}>
            Reparto attivo
          </label>
          <select value={repartoAttivo} onChange={e => setRepartoAttivo(e.target.value)}
            className="w-full text-xs rounded px-2 py-1.5 font-bold cursor-pointer"
            style={{ background: '#2b3c24', color: '#e8f0e0', border: '1px solid #3a4a30' }}>
            {reparti.length === 0 && <option>—</option>}
            {reparti.map(r => (
              <option key={r.id} value={r.id}>{r.nome}{r.attivo ? '' : ' (off)'}</option>
            ))}
          </select>
        </div>

        {links
          .filter(l => isSuperAdmin || l.to !== '/admin/centro-controllo')
          // Lo "Schema classico" (vecchio designer) si vede solo su 11N: gli altri
          // reparti usano solo il nuovo "Disegna Schema". Niente confusione.
          .filter(l => l.to !== '/admin/schema' || repartoAttivo === REPARTO_11N)
          .map(({ to, label, Icon }) => {
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

        {/* ── Schema attivo / Schemi aggiornati ─────────────────────────
            Riga separatrice dopo l'ultima voce + stato schema. Se c'e' stato
            almeno un Aggiorna turnazione approvato (>=2 epoche) mostra
            "Schemi aggiornati" con freccia espandibile e l'elenco cronologico
            (schema → giorno dello switch). */}
        <div className="mx-3 mt-3 pt-3 px-1" style={{ borderTop: '1px solid #3a4a30' }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: '#577a45' }}>
            Reparto:
          </p>
          <p className="text-sm font-bold mt-0.5 mb-2.5" style={{ color: '#e8f0e0' }}>
            {repartoCorrente?.nome ?? '—'}
          </p>
          {/* Ultimo schema attivo generato — solo questo (niente cronologia:
              la lista degli aggiornamenti era poco chiara). */}
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: '#577a45' }}>
            Schema Attivo:
          </p>
          <p className="text-sm font-bold mt-0.5" style={{ color: '#e8f0e0' }}>
            {config?.schema_attivo != null ? labelSchema(config.schema_attivo) : '—'}
          </p>
        </div>

        {/* Badge pending — sotto la lista link, una riga ciascuno (se presenti).
            Arancione = chiama attenzione senza essere allarmante come il rosso
            (riservato a "Rigenera calendario" nella navbar). Aggiornamento
            realtime via useFerieRealtime / useCambiTurnoRealtime + polling. */}
        <div className="mt-2">
          <PendingBadge pending={feriePending} label="Ferie da approvare" to="/admin/ferie" />
          <PendingBadge pending={cambiPending} label="Cambi turno da approvare" to="/admin/cambi" />
        </div>
      </aside>

      {/* Contenuto */}
      <main className="flex-1 overflow-auto p-6" style={{ background: '#f4f1ea' }}>
        <Outlet />
      </main>
    </div>
  )
}
