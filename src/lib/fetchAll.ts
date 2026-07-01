// ════════════════════════════════════════════════════════════════════
// fetchAllRows — SELECT paginata che aggira il limite di 1000 righe di
// default di PostgREST/Supabase.
//
// PERCHÉ: qualunque `.select()` SENZA `.range()`/`.limit()` esplicito viene
// troncato a 1000 righe SENZA errore → dati mancanti silenziosi (bug 31/07,
// task #42). Su tabelle che crescono (turni, o liste cross-reparto di medici/
// ferie/cambi/messaggi) il limite si supera col tempo o coi reparti.
//
// COME: si passa una factory `makeQuery(from, to)` che costruisce la query con
// `.range(from, to)` applicato; l'helper cicla finché una pagina torna meno di
// `page` righe. NON serve conoscere il count in anticipo (niente round-trip
// extra): la paginazione si ferma da sola.
//
// COSTO: per risultati < page è UNA sola andata/ritorno (identico a prima) →
// si può usare liberamente anche dove le righe sono poche. Solo i result-set
// grandi fanno più chiamate.
//
// USO:
//   const medici = await fetchAllRows<Medico>((from, to) =>
//     supabase.from('medici').select('*').eq('attivo', true)
//       .order('numero_ordine').range(from, to))
// ════════════════════════════════════════════════════════════════════

/** La factory deve applicare `.range(from, to)` e restituire la query
 *  (thenable) che risolve in `{ data, error }`. */
type RangedQuery<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: unknown }>

export async function fetchAllRows<T>(
  makeQuery: RangedQuery<T>,
  page = 1000,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await makeQuery(from, from + page - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < page) break   // ultima pagina (parziale) → stop
    from += page
  }
  return all
}
