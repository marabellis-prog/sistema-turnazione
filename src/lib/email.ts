// Validazione "di coerenza" di un indirizzo email.
//
// Non è la RFC completa, ma intercetta gli errori reali di digitazione:
// manca la @ (o un carattere sbagliato al suo posto, es. '#'), spazi, manca il
// dominio o il punto del dominio.

export function emailValida(email: string): boolean {
  const e = (email ?? '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

/** Messaggio d'errore pronto se l'email non è valida, altrimenti ''. */
export function erroreEmail(email: string): string {
  return emailValida(email) ? '' : 'Indirizzo email non valido (controlla la @ e il dominio).'
}
