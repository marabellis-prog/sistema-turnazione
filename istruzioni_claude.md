# Sistema di Gestione Turni Medici – Documentazione Completa per Porting su Web App

> **Destinatario**: Claude Code (Anthropic).
> Questo documento descrive **in modo esaustivo e operativo** un sistema esistente, attualmente implementato su Google Sheets + Google Apps Script, che deve essere portato su una **web app moderna** con frontend su GitHub Pages e backend su Supabase.

---

## 1. Panoramica del Sistema

Il sistema gestisce i **turni di servizio clinico** di un gruppo di medici (da 10 a 12 "turnisti") su un orizzonte temporale configurabile (tipicamente da Maggio a Ottobre di un anno). I turni sono di tipo clinico (mattina, pomeriggio, libero, reperibilità) e di ricerca scientifica (RM, RP).

Il sistema è basato su un **algoritmo ciclico a rotazione**: ogni medico ha un numero fisso (da 1 a N) e ogni giorno, in base al tipo di giorno della settimana (lun/mar/mer/gio/ven/sab/dom) e al numero di settimane trascorse dall'inizio del calendario, il sistema calcola quale medico deve fare quale turno consultando una tabella-modello.

Il sistema esistente è composto da **un foglio Google Sheets** con sei fogli interni:
- `modelli` – configurazione e schemi rotativi
- `calendari` – il calendario principale generato automaticamente
- `calendario ferie` – vista lineare per la consultazione delle ferie
- `piano ferie` – gestione delle ferie dei medici
- un foglio settimanale
- un foglio di stampa

---

## 2. Struttura dei Fogli Google Sheets

### 2.1 Foglio `modelli`

Questo è il foglio di **configurazione principale**. Contiene:

#### Parametri di configurazione (in colonna A/B, nelle prime righe):
- `MESE INIZIO`: numero del mese di inizio (es. 5 = Maggio)
- `ANNO INIZIO`: anno di inizio (es. 2026)
- `MESE FINE`: numero del mese di fine (es. 10 = Ottobre)
- `ANNO FINE`: anno di fine (es. 2026)

#### Elenco dei nominativi:
- Una colonna A con i nomi dei medici, ordinati da 1 a N (es. 11 medici). L'ordine è CRITICO: il medico in posizione 1 è il "numero 1" nel ciclo, quello in posizione 2 è il "numero 2", ecc.
- Uno dei medici (normalmente l'ultimo, numero 11) è la "reperibilità", riconosciuto dal valore 11 in una cella del modello.

#### Schema del modello (tabella rotatoria):
Il cuore del sistema. Per ogni giorno della settimana (lunedì=1, ..., domenica=7), il modello definisce chi fa cosa. Il modello è strutturato come righe con colonne:
- `cM` (colonna Mattina): il "numero medico" che fa il turno di mattina
- `cP` (colonna Pomeriggio): il "numero medico" che fa il turno di pomeriggio
- `cRM` (colonna Ricerca Mattina): il "numero medico" che fa ricerca al mattino
- `cRP` (colonna Ricerca Pomeriggio): il "numero medico" che fa ricerca al pomeriggio

Il modello può avere più "schemi" (Schema 1, Schema 2, Schema 3...) che si trovano su colonne diverse dello stesso foglio. Ogni schema ha le sue 4 colonne (cM, cP, cRM, cRP).

La funzione `TrovaColonneSchema(wsModelli, schemaNum)` individua le colonne corrette per lo schema richiesto e restituisce `{ cM, cP, cRM, cRP }` come numeri di colonna 1-based.

#### Festività:
La funzione `IsFestivo(date)` è hardcoded nel codice GAS e controlla le festività italiane: Capodanno (1/1), Epifania (6/1), Pasqua (variabile), Lunedì dell'Angelo, Liberazione (25/4), Festa del Lavoro (1/5), Repubblica (2/6), Ferragosto (15/8), Ognissanti (1/11), Immacolata (8/12), Natale (25/12), Santo Stefano (26/12).

---

### 2.2 Foglio `calendari`

Questo è il foglio **principale di output** generato dalla funzione `GeneraCalendarioCompleto`. La struttura è verticale: per ogni mese ci sono due blocchi impilati dall'alto verso il basso.

#### Struttura di un blocco mensile (ripetuta per ogni mese):
```
Riga 1:  "GENNAIO 2026 SCHEMA 1"   ← titolo del blocco clinico
Riga 2:  NOMI | 01\nL | 02\nM | ... | 31\nD    ← intestazione giorni
Riga 3:  Rossi | M | P | "" | M | ...           ← turni di ogni medico
...
Riga N+2: TURNISTI PRESENTI | 2 | 2 | 0 | 2 | ... ← conteggio presenze al giorno
(riga vuota)
Riga N+4: "GENNAIO 2026 - RICERCA"  ← titolo del blocco ricerca
Riga N+5: NOMI | 01\nL | ...
Riga N+6: Rossi | RM | "" | RP | ...
...
(due righe vuote di separazione)
```

Dopodichè il mese successivo ricomincia.

In fondo al foglio, dopo tutti i mesi, c'è una tabella di **RIEPILOGO** con le colonne: `NOMI | M | P | L | S | D | F | TOT` (dove TOT = M + P + L*2).

#### Codici turno nel foglio `calendari`:
- `M` = mattina
- `P` = pomeriggio
- `L` = libero (fa sia M che P, cioè turno lungo)
- `REP` = reperibilità (font rosso, grassetto)
- `RM` = turno di ricerca al mattino
- `RP` = turno di ricerca al pomeriggio
- celle vuote = giorno libero/ferie/etc.
- celle con annotazioni come `(SUB)` o `(MED)` = modifiche manuali aggiunte dall'utente
- bordo `#00bfff` sulle celle = cambio turno rispetto allo schema teorico (indicato dall'algoritmo `AggiornaTurniRicerca`)

#### Colori nel foglio `calendari`:
- sfondo giallo `#fff2cc`: domenica o festività
- bordo blu `#00bfff` sulla cella: turno clinico modificato rispetto allo schema
- testo rosso: reperibilità
- grassetto: reperibilità o turno lungo (L)

---

### 2.3 Foglio `calendario ferie`

Questo foglio è una **vista lineare continua** (tutti i mesi in orizzontale, non verticale come in `calendari`). È generato dalla funzione `VisualizzazioneLineareFerie` / `GenerazioneLineareCore`.

#### Struttura:
```
Riga 1:  [intestazione mesi con merge] GEN | ... | APR | ... | OTT
Riga 2:  NOMI | 01 | 02 | ... | 31 | 01 | 02 | ... (tutti i giorni di tutti i mesi)
Riga 3:  Rossi | M  | P  | "" | M  | ...
...
```

Questo foglio è quello mostrato nella **web app di consultazione** (`getDatiPerWebApp` legge questo foglio). Contiene gli stessi dati di `calendari` ma in formato orizzontale continuo.

---

### 2.4 Foglio `piano ferie`

Gestione delle ferie. Struttura:
```
Colonna A: Nome del medico
Colonna B: Periodo ferie (stringa es. "15/07 - 22/07" oppure date multiple separate da virgola)
Colonna C: Checkbox Google Sheets (true/false) per attivare/applicare le ferie
```

Quando un checkbox viene spuntato (evento `onEdit` / `GestisciModifiche`), il sistema:
1. Chiede conferma all'utente
2. Chiama `EvidenziaFerieCompleto` che legge il foglio `calendari`, trova le celle del medico nelle date indicate, e le colora di verde `#d9ead3` come indicatore visivo di ferie
3. Non modifica il testo delle celle (il turno rimane scritto), solo il colore di sfondo cambia

---

## 3. Algoritmo di Calcolo dei Turni

L'algoritmo di rotazione è il nucleo del sistema. Di seguito la logica completa.

### 3.1 Parametri base
- `dataInizioGlobale`: primo giorno del calendario (es. 1 maggio 2026)
- `nominativi[]`: array dei nomi dei medici in ordine fisso (indice 0 = medico n°1, etc.)
- `numNomi`: numero totale di medici (es. 11)

### 3.2 Per ogni giorno `d` nel calendario:

**Step 1 – Calcola il numero di settimane trascorse (`sett`)**:
```javascript
function ContaLunedi(dataInizio, dataCorrente) {
  // Riporta dataInizio al lunedì della settimana di partenza
  var lunInizio = new Date(dataInizio);
  lunInizio.setDate(lunInizio.getDate() - ((lunInizio.getDay() + 6) % 7));
  var lunCorrente = new Date(dataCorrente);
  lunCorrente.setDate(lunCorrente.getDate() - ((lunCorrente.getDay() + 6) % 7));
  var diff = Math.round((lunCorrente - lunInizio) / (7 * 24 * 3600 * 1000));
  return diff < 0 ? 0 : diff;
}
```

**Step 2 – Trova il giorno della settimana** (`dWeek`: lun=1, mar=2, ..., dom=7)

**Step 3 – Trova la riga del modello** per quel tipo di giorno:
```javascript
function GetRigaModello(dWeek, colM, wsModelli) {
  // Cerca nel foglio modelli la riga dove la prima cella di quella colonna
  // contiene il giorno della settimana (es. "L", "M", "G", "V", "S", "D")
  // Restituisce il numero di riga 1-based
}
```

**Step 4 – Per ogni medico con indice `n` (0-based), calcola il suo "numero di turno" per quel giorno**:
```javascript
// Cerca quale testNum, quando spostato di sett settimane, dà indice n
for (var testNum = 1; testNum <= numNomi; testNum++) {
  var calcIdx = (testNum - 1 - sett) % numNomi;
  while (calcIdx < 0) calcIdx += numNomi;
  if (calcIdx === n) { calcNum = testNum; break; }
}
```

**Step 5 – Leggi il modello**: dal foglio `modelli`, riga `rMod` (e le 4 righe successive, per coprire tutti i turni del giorno), controlla se `calcNum` appare in colonna cM, cP, cRM o cRP. Da questo si determina se il medico n fa M, P, L (M+P), REP, RM, RP o niente.

**Step 6 – Confronto con il reale**: Il turno teorico viene confrontato con quello effettivo nella griglia. Se sono diversi, la cella riceve il bordo `#00bfff` (nel Google Sheets) o la classe `turno-cambiato` (nella web app).

---

## 4. Funzioni Principali del Codice GAS

### `GeneraCalendario()` (entry point da menu)
- Chiede all'utente quale schema usare
- Chiede conferma (distrugge tutto)
- Chiama `ResettaPianoFerieTotalmente`, `SincronizzaNominativi`, `GeneraCalendarioCompleto`

### `GeneraCalendarioCompleto(ss, schemaNum)`
- Genera completamente il foglio `calendari` da zero
- Itera su tutti i mesi dal mese inizio al mese fine
- Per ogni mese genera: blocco clinico (M/P/L/REP), blocco ricerca (RM/RP), con intestazioni, colori, bordi
- In fondo genera la tabella Riepilogo

### `VisualizzazioneLineareFerie()` / `GenerazioneLineareCore()`
- Genera il foglio `calendario ferie` come griglia orizzontale continua
- Sincronizza i dati da `calendari`

### `SincronizzaLineareDaCalendari()`
- Aggiorna il foglio `calendario ferie` sincronizzando i valori presenti nel foglio `calendari`
- Utile quando si fanno modifiche manuali nel foglio `calendari`

### `AggiornaTurniRicerca()`
- Funzione avanzata che aggiorna i turni RM/RP nel foglio `calendari`
- Implementa il meccanismo dei "vasi comunicanti": RM si assegna a chi fa P, RP si assegna a chi fa M
- Priorità ai medici il cui turno è "giallo" (cambiato rispetto allo schema)
- Scrive nel foglio e applica il bordo blu `#00bfff` alle celle cambiate

### `AggiornaRiepilogo(ss)`
- Ricalcola la tabella di riepilogo a fondo del foglio `calendari`
- Conta M, P, L, sabati, domeniche, festività e TOT per ogni medico

### `EvidenziaFerieCompleto(ss, nomeMedico, dateFerie)`
- Colora di verde le celle del medico nel foglio `calendari` per le date di ferie
- Colora di verde anche le celle in `calendario ferie`

### `ApplicaEtichetteSubMed()`
- Aggiunge annotazioni `(SUB)` o `(MED)` a celle specifiche
- Modifica le sostituzioni di turno con informazioni aggiuntive

### `GestisciModifiche(e)` (trigger onEdit)
- Gestisce le modifiche in tempo reale nel foglio
- Se modificato `modelli` colonna A → `ControllaModificheNomi()`
- Se modificato `piano ferie` colonna C (checkbox) → elabora ferie
- Se modificato `calendari` → `SincronizzaLineareDaCalendari()`

### `getDatiPerWebApp()`
- Funzione esposta via `doGet()` per la web app
- Legge il foglio `calendario ferie` (valori, sfondi, colori font, grassetto)
- Confronta ogni cella con lo schema teorico
- Restituisce JSON con: `values`, `backgrounds`, `fontColors`, `fontWeights`, `rows`, `cols`, `cambiCoordinate[]`

### `getDatiSettimanaleWeb()`
- Versione settimanale per la vista web
- Restituisce solo i 7 giorni della settimana corrente

---

## 5. Web App Esistente (Index.html)

La web app attuale è una **single-page app** servita da Google Apps Script (`doGet()`). Funzionalità:

1. **Al caricamento**: chiama `google.script.run.getDatiPerWebApp()` per ottenere i dati
2. **Costruzione tabella**: genera dinamicamente una tabella HTML con:
   - Prima riga: intestazione dei mesi (con colspan per i giorni di ogni mese)
   - Seconda riga: numeri dei giorni (con colori per domeniche/festività)
   - Righe successive: un medico per riga con tutti i suoi turni
3. **Colori**: le celle ricevono il background originale dal foglio Google Sheets
4. **Classe `turno-cambiato`**: celle in `cambiCoordinate` ricevono overlay azzurrino (CSS `::before` pseudoelement con `rgba(0, 150, 255, 0.25)`)
5. **Click su riga**: highlight giallo della riga selezionata (`selected-row`)
6. **Colonna nomi sticky**: la prima colonna (nomi medici) è fissa durante lo scroll orizzontale

---

## 6. Schema del Database da Implementare in Supabase

Per il porting, il database Supabase deve modellare tutte le entità del sistema.

### Tabella `medici`
```sql
CREATE TABLE medici (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  numero_ordine INTEGER NOT NULL,  -- posizione 1..N nella rotazione
  attivo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Tabella `configurazione`
```sql
CREATE TABLE configurazione (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anno_inizio INTEGER NOT NULL,
  mese_inizio INTEGER NOT NULL,   -- 1-12
  anno_fine INTEGER NOT NULL,
  mese_fine INTEGER NOT NULL,     -- 1-12
  schema_attivo INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Tabella `schemi_modello`
```sql
CREATE TABLE schemi_modello (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_num INTEGER NOT NULL,      -- 1, 2, 3...
  giorno_settimana INTEGER NOT NULL, -- 1=Lun ... 7=Dom
  slot INTEGER NOT NULL,             -- 0..4 (fino a 5 righe per giorno)
  numero_medico_mattina INTEGER,     -- numero 1..N o NULL
  numero_medico_pomeriggio INTEGER,
  numero_medico_rm INTEGER,          -- ricerca mattina
  numero_medico_rp INTEGER,          -- ricerca pomeriggio
  is_reperibilita BOOLEAN DEFAULT false
);
```

### Tabella `turni`
```sql
CREATE TABLE turni (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medico_id UUID REFERENCES medici(id),
  data DATE NOT NULL,
  turno_clinico TEXT,   -- 'M', 'P', 'L', 'REP', '' 
  turno_ricerca TEXT,   -- 'RM', 'RP', 'RM\nRP', ''
  note TEXT,            -- annotazioni SUB, MED, etc.
  modificato_manualmente BOOLEAN DEFAULT false,  -- era diverso dallo schema
  colore_sfondo TEXT,   -- hex del colore originale dal Google Sheet (per le ferie: #d9ead3)
  is_ferie BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(medico_id, data)
);
```

### Tabella `ferie`
```sql
CREATE TABLE ferie (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medico_id UUID REFERENCES medici(id),
  data_inizio DATE NOT NULL,
  data_fine DATE NOT NULL,
  approvate BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Tabella `riepilogo_mensile` (opzionale, oppure calcolata on-the-fly)
```sql
CREATE TABLE riepilogo_mensile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medico_id UUID REFERENCES medici(id),
  anno INTEGER NOT NULL,
  mese INTEGER NOT NULL,
  count_m INTEGER DEFAULT 0,
  count_p INTEGER DEFAULT 0,
  count_l INTEGER DEFAULT 0,
  count_sabato INTEGER DEFAULT 0,
  count_domenica INTEGER DEFAULT 0,
  count_festivo INTEGER DEFAULT 0,
  tot_turni INTEGER DEFAULT 0,  -- M + P + L*2
  UNIQUE(medico_id, anno, mese)
);
```

---

## 7. Funzionalità da Implementare nella Web App

### 7.1 Vista consultazione calendario (pubblica)
- Tabella orizzontale analoga al foglio `calendario ferie`
- Colonne = giorni (tutti i mesi in sequenza)
- Righe = medici
- Colori: domeniche/festività giallo, ferie verde, turni cambiati overlay azzurrino
- Click su riga per highlight
- Prima colonna sticky
- Responsive con scroll orizzontale

### 7.2 Vista gestione turni (amministrativa, con login)
- Modifica manuale del turno di un medico per un giorno
- Aggiornamento automatico del campo `modificato_manualmente = true`
- Ricalcolo dei turni ricerca (RM/RP) in cascata dopo ogni modifica clinica
- Indicatore visivo delle celle cambiate rispetto allo schema teorico

### 7.3 Vista gestione ferie (amministrativa)
- Input periodo ferie per ogni medico
- Conferma e applicazione (colore verde sul calendario)
- Elenco ferie approvate

### 7.4 Generazione calendario
- Interfaccia per scegliere schema, mese/anno inizio e fine
- Ricalcolo completo di tutti i turni (equivalente a `GeneraCalendarioCompleto`)
- Salvataggio in Supabase nella tabella `turni`

### 7.5 Vista riepilogo
- Tabella finale con M, P, L, S, D, F, TOT per ogni medico per ogni mese
- Equivalente alla tabella RIEPILOGO in fondo al foglio `calendari`

### 7.6 Gestione modello/schema
- CRUD degli schemi di rotazione (tabella `schemi_modello`)
- Interfaccia per modificare chi fa cosa per ogni giorno della settimana

---

## 8. Logica da Riscrivere nel Backend (Edge Functions o Frontend)

### 8.1 `calcolaCalendarioCompleto(config, schemi, medici)`
Riscrivere in TypeScript/JavaScript la funzione `GeneraCalendarioCompleto`:
- Input: configurazione (date inizio/fine, schema num), array schemi_modello, array medici
- Output: array di oggetti `{ medico_id, data, turno_clinico, turno_ricerca, modificato_manualmente: false }`
- Salva su Supabase nella tabella `turni`

### 8.2 `isFestivo(date: Date): boolean`
Riscrivere la funzione italiana delle festività:
- Capodanno, Epifania, Pasqua (algoritmo di Gauss), Lunedì dell'Angelo, 25 Aprile, 1 Maggio, 2 Giugno, Ferragosto, Ognissanti, Immacolata, Natale, Santo Stefano

### 8.3 `contaLunedi(dataInizio, dataCorrente): number`
Riscrivere la funzione che conta le settimane trascorse:
```typescript
function contaLunedi(dataInizio: Date, dataCorrente: Date): number {
  const lunInizio = new Date(dataInizio);
  lunInizio.setDate(lunInizio.getDate() - ((lunInizio.getDay() + 6) % 7));
  const lunCorrente = new Date(dataCorrente);
  lunCorrente.setDate(lunCorrente.getDate() - ((lunCorrente.getDay() + 6) % 7));
  const diff = Math.round((lunCorrente.getTime() - lunInizio.getTime()) / (7 * 24 * 3600 * 1000));
  return diff < 0 ? 0 : diff;
}
```

### 8.4 `calcolaTurnoTeorico(medico_indice, data, config, schemi, medici)`
La funzione centrale che per un dato medico e una data restituisce il turno teorico:
- Calcola `sett = contaLunedi(dataInizio, data)`
- Trova `dWeek` (1=lun..7=dom)
- Trova le righe del modello per quel `dWeek`
- Calcola `calcNum` per il medico dato il suo indice e `sett`
- Confronta `calcNum` con i valori nelle colonne cM, cP, cRM, cRP
- Restituisce `{ turno_clinico: 'M'|'P'|'L'|'REP'|'', turno_ricerca: 'RM'|'RP'|'RM\nRP'|'' }`

### 8.5 `aggiornaTurniRicerca(data, turniDelGiorno, schemi, medici)`
Il meccanismo dei "vasi comunicanti" per ricerca:
- RM si assegna a chi fa P quel giorno (priorità ai medici con turno "cambiato")
- RP si assegna a chi fa M quel giorno (stessa logica)
- Se un medico fa sia M che P (turno L), non riceve né RM né RP
- `poolRM` e `poolRP` determinano quanti slot di ricerca sono disponibili per quel giorno

---

## 9. Flusso Applicativo Completo

```
[Admin] Inserisce medici + configurazione date + schemi modello
    ↓
[Sistema] Genera automaticamente tutti i turni teorici (calcolaCalendarioCompleto)
    ↓
[Turni salvati in Supabase - modificato_manualmente = false per tutti]
    ↓
[Admin] Visualizza calendario, modifica manualmente alcuni turni
    ↓ (ogni modifica imposta modificato_manualmente = true)
[Sistema] Ricalcola automaticamente i turni di ricerca del giorno modificato
    ↓
[Admin] Inserisce le ferie per i medici
    ↓
[Sistema] Colora le celle di ferie (is_ferie = true, colore_sfondo = #d9ead3)
    ↓
[Tutti gli utenti] Consultano il calendario via web app pubblica
    ↓ (le celle con modificato_manualmente=true mostrano overlay azzurrino)
[Admin] Consulta il riepilogo mensile
```

---

## 10. Note Tecniche Importanti

### 10.1 Il numero `11` (reperibilità)
Nel sistema attuale il numero `11` è hardcoded come il "medico reperibilità". Nella nuova app questo deve diventare un flag nella tabella `medici` (`is_reperibilita BOOLEAN`). La funzione `IsReperibilita(val)` controlla `parseInt(val) === 11`, che nella nuova app corrisponde a controllare se il medico con `numero_ordine = n` ha `is_reperibilita = true`.

### 10.2 Gestione dello span del modello (5 righe per giorno)
Nel modello Google Sheets, ogni giorno della settimana può avere fino a 5 righe di turni (slot 0..4). Nella tabella `schemi_modello` in Supabase, il campo `slot` (0..4) gestisce questo. Al momento della generazione, il sistema deve iterare su tutti gli slot di quel `giorno_settimana` per lo `schema_num` dato.

### 10.3 Mesi che attraversano anni diversi
Se `mese_inizio > mese_fine`, il calendario attraversa un confine annuale (es. Ottobre 2025 – Febbraio 2026). La logica attuale gestisce questo con `if (meseIdx < mInizioAssoluto - 1) currDate.setFullYear(aInizioAssoluto + 1)`.

### 10.4 La colonna 0 del foglio è 1-based nel GAS
Nel codice GAS tutti gli indici di riga/colonna sono 1-based. Nella nuova app usare 0-based (standard JS/Postgres) e stare attenti ai +1/-1 nelle conversioni.

### 10.5 `getDisplayValues()` vs `getValues()`
Il foglio usa `getDisplayValues()` per mostrare i valori formattati (es. date come stringhe, numeri con decimali visualizzati). Nella nuova app i valori sono già stringhe nel DB, non serve conversione.

### 10.6 Annotazioni `(SUB)` e `(MED)`
Le celle nel foglio possono contenere stringhe del tipo `"M (SUB)"` o `"P (MED)"` per indicare sostituzioni. Il campo `note` nella tabella `turni` è dedicato a questo. Quando si calcola il turno teorico per il confronto, queste annotazioni vanno strip-pate (`replace(/\s*\(SUB\)/g, "").replace(/\s*\(MED\)/g, "").trim()`).

---

## 11. Stack Tecnologico Raccomandato per il Porting

- **Frontend**: React (Vite) o Next.js statico, deployato su GitHub Pages
- **Backend**: Supabase (PostgreSQL + Auth + Edge Functions per la logica di generazione)
- **Auth**: Supabase Auth (email/password) per separare vista pubblica da admin
- **UI**: Tailwind CSS + shadcn/ui per i componenti
- **Tabella calendario**: libreria per tabelle virtuali (TanStack Table o react-window) per gestire le ~300 colonne × 12 righe
- **State management**: Zustand o React Query per i dati dal backend
- **PDF/stampa**: react-to-print per la vista settimanale da stampare

---

## 12. Considerazioni sulla Migrazione Dati

Per migrare i dati esistenti da Google Sheets a Supabase:
1. Esportare il foglio `modelli` → popola `configurazione` e `schemi_modello`
2. Esportare l'elenco nomi → popola `medici`
3. Rieseguire l'algoritmo di generazione nel nuovo sistema → popola `turni` con i turni teorici
4. Esportare le modifiche manuali dal foglio `calendari` (celle con bordo `#00bfff`) → aggiorna `turni` con `modificato_manualmente = true` e i valori reali
5. Esportare le ferie da `piano ferie` → popola `ferie` e aggiorna `turni` con `is_ferie = true`
