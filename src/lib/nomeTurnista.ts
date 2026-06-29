// Helper per il nominativo del turnista.
//
// L'identità (cognome + nome) vive sull'utente collegato ed è propagata sui
// medici; qui formattiamo per le viste.

/**
 * Formato breve per i CALENDARI: cognome in MAIUSCOLO + iniziale del nome
 * puntata, es. "DI VENANZIO M.". Se manca il nome proprio mostra solo il
 * cognome ("MARABELLI"). Se mancano del tutto i campi separati (medici vecchi
 * non ancora collegati a un utente) ripiega sul nome combinato `fallback`.
 */
export function nomeBreve(
  cognome?: string | null,
  nomeProprio?: string | null,
  fallback?: string | null,
): string {
  const cog = (cognome ?? '').trim()
  const nom = (nomeProprio ?? '').trim()
  if (cog) {
    return nom ? `${cog.toUpperCase()} ${nom[0]!.toUpperCase()}.` : cog.toUpperCase()
  }
  return (fallback ?? '').trim().toUpperCase()
}

/**
 * Nome completo leggibile per liste/anagrafica: "COGNOME Nome".
 * Ripiega su `fallback` (il nome combinato) o sul solo cognome.
 */
export function nomeCompleto(
  cognome?: string | null,
  nomeProprio?: string | null,
  fallback?: string | null,
): string {
  const cog = (cognome ?? '').trim()
  const nom = (nomeProprio ?? '').trim()
  if (cog) return nom ? `${cog.toUpperCase()} ${nom}` : cog.toUpperCase()
  return (fallback ?? '').trim()
}
