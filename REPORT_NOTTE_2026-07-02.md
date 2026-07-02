# Report notturno — 2 luglio 2026

## In due righe
Ho trovato e risolto un **bug critico** che contaminava il reparto sacro 11N, ho
chiuso l'**intera classe** di quel bug a livello database (ora è impossibile che
riaccada), ho fatto un audit riga-per-riga di tutte le scritture, delle policy di
sicurezza e delle query, e ho lasciato pronti i dati per i tuoi test manuali di
stamattina. Tutto committato, pushato e **già online** (bundle live = commit 0b16de1).

---

## 1) Bug critico trovato e risolto — contaminazione di 11N

**Sintomo:** durante il mio health-check finale ho visto 1 turno "cross-reparto" e
11N passato da 2024 a 2025 turni.

**Causa radice:** approvando/ripristinando un **cambio turno** (e nel ricalcolo
RM/RP), gli `upsert` su `turni` **non passavano `reparto_id`**. La colonna
`turni.reparto_id` aveva un DEFAULT = 11N, quindi il turno di BIADER (14/08, reparto
"Test URGENZE") è finito silenziosamente su **11N**, corrompendolo. È lo stesso
identico meccanismo del bug "copia reparto" che mi avevi chiesto di generalizzare
("che varrà anche per gli altri").

**Fix (commit e5c84f7):** aggiunto `reparto_id: repartoAttivo` a tutti e 3 gli
upsert in `GestioneCambiPage` (approva, ricalcola, ripristina).

**Pulizia dati:** riportato il turno di BIADER su Test URGENZE.
→ Verificato: **11N di nuovo a 2024 turni, 0 righe cross-reparto, 0 orfani.**

---

## 2) Difesa strutturale — ho chiuso la classe del bug per SEMPRE (commit acc9bfd)

Il vero problema era il **DEFAULT 11N** su 9 tabelle: qualsiasi scrittura che
dimenticava `reparto_id` finiva zitta-zitta su 11N invece di dare errore.

**Migration 052:** rimosso il DEFAULT da tutte e 9 le tabelle reparto-scoped
(`turni`, `cambi_turno`, `configurazione`, `ferie`, `festivita_custom`, `medici`,
`schemi_modello`, `turnazione_anteprima`, `turni_backup`). Le colonne sono già
`NOT NULL`, quindi ora un `reparto_id` mancante **fa fallire l'insert** invece di
contaminare 11N. "Fail loud" invece di "fail silent".

**Testato scientificamente:** ho provato a inserire un turno senza `reparto_id` →
```
ERROR: 23502: null value in column "reparto_id" ... violates not-null constraint
```
L'insert viene annullato, niente viene scritto. **Impossibile contaminare 11N d'ora in poi.**

Prima di applicarla ho verificato che fosse sicura: 0 righe NULL esistenti, e
**ogni** punto di scrittura (client + tutte le RPC) passa già `reparto_id`
esplicito. Reversibile in un attimo se mai servisse.

---

## 3) Incoerenza permessi risolta (commit 0b16de1)

**Migration 053:** `is_admin()` confrontava l'email in modo case-insensitive,
`is_super_admin()` no. Siccome `puo_gestire_reparto()` → `is_super_admin()` governa
TUTTE le policy di gestione, un admin che loggasse con maiuscole/minuscole diverse
avrebbe perso i poteri globali. Allineate (entrambe case-insensitive). Cambiamento
solo-più-permissivo per i soli admin; nessun impatto sui dati attuali.

---

## 4) Audit completo — cosa ho verificato (tutto ✓)

- **Tutte le scritture (client):** ogni insert/upsert su tabelle pericolose passa
  `reparto_id`. `GestioneCambiPage` era l'UNICO colpevole → risolto.
- **Tutte le RPC (server):** copia_setup_reparto, subentro, backup/restore →
  tutte impostano `reparto_id`. Nessuna con lo stesso bug.
- **Integrità DB completa:** 0 righe cross-reparto su turni/ferie/cambi, 0 orfani
  su nessuna tabella.
- **Policy RLS:** corrette. Gestione = `puo_gestire_reparto` (con WITH CHECK: un
  responsabile non può spostare righe verso reparti altrui). Creare reparti e
  nominare responsabili = **solo admin** (nessuna escalation possibile via API).
- **Guardia "schema in uso" (#36):** verificata sul campo. Per "urgenze secondo
  test", `schema_in_uso(schema 1) = true` → eliminare/azzerare quello schema ora dà
  **errore** (il bug che avevi trovato è chiuso, anche server-side).
- **Bug 1000 righe (#42/#43):** tutte le viste caricano i turni spezzando per mese
  (1 reparto × 1 mese ≈ 450 righe) o con paginazione. Il numero di reparti non
  influisce più su nessuna query. (Limite solo teorico: un singolo reparto con
  >33 turnisti attivi in un mese — irrealistico.)
- **Notifiche multi-reparto (#41):** l'etichetta del reparto si deriva da
  medico_id → reparto; il turnista vede i messaggi di tutti i suoi reparti. OK.
- **#26 descrizioni pagine:** riviste, già reparto-neutre. Niente di 11N-specifico
  fuorviante. Eventuali rifiniture di testo le facciamo insieme (gusto tuo).
- **Build:** `npm run build` pulito. **Deploy:** online e allineato al DB.

---

## 5) Cosa NON ho potuto testare io (serve la tua mano)

Il collaudo "da utente vero" (turnista/ospite/responsabile che clicca) richiede il
**login Google**, che io non posso fare; e comunque l'app è in **MODALITÀ
MANUTENZIONE** (solo il tuo account admin entra). Quindi ho verificato la logica di
permessi leggendo le policy e i dati, ma i clic finali li devi fare tu. Ho lasciato
i dati pronti (sotto).

---

## 6) CHECKLIST TEST MANUALI PER TE — stamattina

Dati già pronti su **entrambi** i reparti di test (NON 11N):
- **Test URGENZE:** 1 richiesta ferie pending (COGNATA Claudia, 18–22/08) + 1 cambio turno pending.
- **urgenze secondo test:** 1 richiesta ferie pending + 1 cambio turno pending.

### A. Come ADMIN (tu, marabelli)
1. [ ] Badge arancione: entra in Admin → controlla che il badge "Ferie/Cambi da
   approvare" mostri le richieste di **entrambi** i reparti e che cliccando
   "Vai alla richiesta" ti porti al reparto+sezione giusti (e la riga lampeggi).
2. [ ] Approva la ferie su Test URGENZE → il badge deve aggiornarsi **subito**
   (ho corretto il ritardo). Controlla che il turnista riceva la notifica.
3. [ ] Approva il cambio turno su urgenze secondo test → verifica che i turni
   cambino e che NON compaia nulla su 11N (Centro di Controllo: 11N deve restare
   a 2024 turni).
4. [ ] Modifica Turni: **clic su una cella** → si apre il popover vicino al mouse
   con turni + proprietà; prova ad assegnare proprietà diverse a mattina e
   pomeriggio (metà separate). Verifica che il drag-and-drop funzioni ancora.
5. [ ] Centro di Controllo: crea un reparto nuovo, nominagli un responsabile,
   usa "Copia da reparto" (deve copiare turnisti/ospiti, festività, schemi — NON
   generare turni; ferie e cambi vuoti). Controlla la nuova descrizione del modal.
6. [ ] Prova a **eliminare/azzerare lo schema in uso** (schema 1) di un reparto con
   turnazione attiva → deve dare **errore** ("Schema in uso… duplicalo per
   modificarlo").
7. [ ] Disegna Schema: di default vedi solo lo schema 1; "+" crea il numero
   successivo; elimina uno schema e verifica la rinumerazione (l'1 resta sempre).

### B. Come RESPONSABILE (impersona medicinadurgenza.ucsc — è "user", responsabile
di Test URGENZE + urgenze secondo test)
8. [ ] Deve poter approvare ferie/cambi **solo** dei suoi due reparti.
9. [ ] NON deve vedere il **Centro di Controllo** nel menu.
10. [ ] Deve poter usare Disegna Schema / Genera / Anteprima sui suoi reparti.
11. [ ] (Controprova) su 11N non deve poter gestire nulla.

### C. Come TURNISTA / OSPITE multi-reparto
12. [ ] Con un utente che è turnista in un reparto e ospite in un altro: nelle viste
    pubbliche (Calendario/Settimanale) deve vedere **entrambi** i reparti, con
    l'etichetta del reparto sulle notifiche.
13. [ ] L'ospite deve vedere in sola-lettura (niente richieste ferie/cambi dove non
    è turnista).

> Nota: per i test B/C dovrai usare l'impersonazione (doppelgänger) dal tuo
> account admin, oppure — se vuoi far entrare gli altri account — mettere
> temporaneamente `MANUTENZIONE = false` in `src/App.tsx`.

---

## 7) Cosa resta nella roadmap
- **#29 — Migrazione di 11N al motore dinamico:** ESCLUSA di proposito, come
  d'accordo. Da fare solo quando avrai validato che tutto il resto funziona.
  (Ora è anche più sicura: il DB rifiuta scritture senza reparto_id.)
- Tutto il resto della roadmap è **completato**.

---

## Commit di stanotte
- `e5c84f7` — FIX critico: cambi turno scrivevano turni senza reparto_id
- `acc9bfd` — Migration 052: rimosso DEFAULT 11N (fail-loud)
- `0b16de1` — Migration 053: is_super_admin case-insensitive

Buona giornata. 🌅
