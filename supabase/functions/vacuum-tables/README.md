# Edge Function: `vacuum-tables`

Esegue `VACUUM FULL` sulle tabelle principali del DB per liberare lo spazio occupato da "dead tuples" (righe `DELETE` che PostgreSQL ha marcato come morte ma non rimosso fisicamente).

Usata dal pulsante **"Pulisci database"** in `/admin/backup`.

## Deploy (una tantum)

### 1. Installa Supabase CLI

Se non l'hai già:

```bash
# Windows (PowerShell con scoop)
scoop install supabase

# Oppure npm globale
npm install -g supabase

# Oppure download diretto da https://github.com/supabase/cli/releases
```

### 2. Login + link al progetto

```bash
cd "D:\Progetti AI\SISTEMA TURNAZIONE"
supabase login                    # apre browser per autenticarti
supabase link --project-ref mreftuajsrinrsvpeicq
```

### 3. Configura il PAT come secret

Devi creare/usare un Personal Access Token Supabase (https://supabase.com/dashboard/account/tokens).

Il PAT che hai già in `.env.local` va benissimo (`SUPABASE_PAT=sbp_...`).

```bash
# Imposta il secret (sostituisci con il TUO PAT)
supabase secrets set SUPABASE_PAT=sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4. Deploy della funzione

```bash
supabase functions deploy vacuum-tables
```

A questo punto il bottone "Pulisci database" in `/admin/backup` funziona.

## Test manuale dal terminale

```bash
# Recupera il tuo JWT (vai sull'app, devtools → Network → trova un'API request
# Supabase → copia il header "authorization: Bearer eyJ...")
JWT="eyJ..."

curl -X POST "https://mreftuajsrinrsvpeicq.supabase.co/functions/v1/vacuum-tables" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json"
```

Output atteso:
```json
{
  "size_before_bytes": 14000000,
  "size_after_bytes":  12500000,
  "freed_bytes":       1500000,
  "tables": {
    "turni_backup": "ok",
    "turni":        "ok",
    ...
  }
}
```

## Sicurezza

- La funzione verifica che il JWT del chiamante sia di un utente con `ruolo = 'admin'` (via `utenti_autorizzati`)
- Il PAT non viene mai esposto al client
- VACUUM FULL acquisisce lock esclusivo brevissimo (ms) per tabella, ma a queste dimensioni (~MB) e` invisibile

## Fallback CLI (se non hai Supabase CLI installata)

Vedi `scripts/vacuum-full.mjs` per uno script Node.js che fa la stessa cosa via Management API. Non serve deploy ma va lanciato manualmente da terminale.
