CREATE TABLE IF NOT EXISTS azienda (
      id INTEGER PRIMARY KEY DEFAULT 1,
      ragione_sociale TEXT DEFAULT '',
      indirizzo TEXT DEFAULT '',
      p_iva TEXT DEFAULT '',
      cod_fiscale TEXT DEFAULT '',
      email TEXT DEFAULT '',
      telefono TEXT DEFAULT '',
      banca TEXT DEFAULT '',
      iban TEXT DEFAULT ''
    , cap TEXT DEFAULT "", citta TEXT DEFAULT "", provincia TEXT DEFAULT "", stato TEXT DEFAULT "", pec TEXT DEFAULT "", sdi TEXT DEFAULT "", regime_fiscale TEXT DEFAULT "RF01", ritenuta_aliquota_default REAL DEFAULT 0, ritenuta_causale_default TEXT DEFAULT "", ritenuta_tipo_default TEXT DEFAULT "RT02", cassa_tipo_default TEXT DEFAULT "", cassa_aliquota_default REAL DEFAULT 0, cassa_iva_default REAL DEFAULT 0, logo TEXT DEFAULT "", smtp_host TEXT DEFAULT "", smtp_port INTEGER DEFAULT 587, smtp_user TEXT DEFAULT "", smtp_pass TEXT DEFAULT "", smtp_from TEXT DEFAULT "", smtp_secure INTEGER DEFAULT 0, sdi_api_url TEXT DEFAULT "", sdi_api_key TEXT DEFAULT "", riordino_automatico INTEGER DEFAULT 0, multi_utente_attivo INTEGER DEFAULT 0, numerazione_annuale INTEGER DEFAULT 1, numero_prefissi TEXT DEFAULT "{}", template_config TEXT DEFAULT NULL, email_mode TEXT DEFAULT 'SMTP', notifiche_config TEXT DEFAULT NULL, email_corpo_documento TEXT DEFAULT NULL, lock_documenti_default INTEGER NOT NULL DEFAULT 1, sdi_provider TEXT DEFAULT 'GENERICO', app_password_hash TEXT DEFAULT '', backup_config TEXT DEFAULT NULL, iva_periodicita TEXT DEFAULT 'trimestrale', sostituto_imposta INTEGER DEFAULT 0, decimali_prezzo INTEGER DEFAULT 2);
CREATE TABLE IF NOT EXISTS scadenze_fiscali (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chiave TEXT UNIQUE,             -- chiave naturale per le scadenze generate (NULL = manuale)
      data TEXT NOT NULL,             -- YYYY-MM-DD
      titolo TEXT NOT NULL,
      categoria TEXT DEFAULT 'Altro', -- IVA | LIPE | Ritenute | Imposte | Dichiarazioni | Altro
      importo REAL,
      note TEXT DEFAULT '',
      stato TEXT DEFAULT 'pendente',  -- pendente | fatto
      auto INTEGER DEFAULT 0,         -- 1 = generata automaticamente
      created_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS prodotti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      categoria TEXT DEFAULT '',
      descrizione TEXT DEFAULT '',
      prezzo REAL DEFAULT 0,
      quantita INTEGER DEFAULT 0,
      soglia_minima INTEGER DEFAULT 0,
      unita_misura TEXT DEFAULT 'pz',
      codice TEXT DEFAULT '',
      iva REAL DEFAULT 22
    , barcode TEXT DEFAULT "", ha_varianti INTEGER DEFAULT 0, codice_fornitore TEXT DEFAULT "", fornitore_id_preferito INTEGER, riordino_quantita REAL DEFAULT 0, prezzo_acquisto REAL DEFAULT NULL, peso REAL, dimensioni TEXT DEFAULT '', immagine TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS clienti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ragione_sociale TEXT NOT NULL,
      email TEXT DEFAULT '',
      telefono TEXT DEFAULT '',
      via TEXT DEFAULT '',
      cap TEXT DEFAULT '',
      citta TEXT DEFAULT '',
      provincia TEXT DEFAULT '',
      stato TEXT DEFAULT 'Italia',
      codice_fiscale TEXT DEFAULT '',
      p_iva TEXT DEFAULT ''
    , sdi TEXT DEFAULT "", pec TEXT DEFAULT "", tipo_pagamento_id INTEGER, cellulare TEXT DEFAULT "", listino_id INTEGER REFERENCES listini(id), tipo_soggetto TEXT DEFAULT 'PRIVATO', cig TEXT DEFAULT "", cup TEXT DEFAULT "", aliquota_iva_id INTEGER REFERENCES aliquote_iva(id), estero INTEGER DEFAULT 0, anche_fornitore INTEGER DEFAULT 0, fornitore_collegato_id INTEGER, agente_id INTEGER REFERENCES agenti(id), provvigione REAL);
CREATE TABLE IF NOT EXISTS fornitori (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ragione_sociale TEXT NOT NULL,
      email TEXT DEFAULT '',
      telefono TEXT DEFAULT '',
      via TEXT DEFAULT '',
      cap TEXT DEFAULT '',
      citta TEXT DEFAULT '',
      provincia TEXT DEFAULT '',
      stato TEXT DEFAULT 'Italia',
      p_iva TEXT DEFAULT ''
    , sdi TEXT DEFAULT "", pec TEXT DEFAULT "", cellulare TEXT DEFAULT "", estero INTEGER DEFAULT 0, anche_cliente INTEGER DEFAULT 0, cliente_collegato_id INTEGER);
CREATE TABLE IF NOT EXISTS ddt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL,
      data_emissione TEXT NOT NULL,
      cliente_id INTEGER,
      causale TEXT DEFAULT '',
      note TEXT DEFAULT '',
      stato TEXT DEFAULT 'EMESSO', data_ora_inizio_trasporto TEXT DEFAULT "", aspetto_beni TEXT DEFAULT "", porto TEXT DEFAULT "Franco", numero_colli INTEGER DEFAULT 0, peso_lordo REAL DEFAULT 0, incaricato_trasporto TEXT DEFAULT "Mittente", vettore TEXT DEFAULT "", destinazione_diversa TEXT DEFAULT "", note_trasporto TEXT DEFAULT "", causale_trasporto TEXT DEFAULT "", preventivo_id INTEGER, destinazione_id INTEGER, tipo TEXT DEFAULT 'CLIENTE', fornitore_id INTEGER,
      FOREIGN KEY (cliente_id) REFERENCES clienti(id)
    );
CREATE TABLE IF NOT EXISTS ddt_righe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ddt_id INTEGER NOT NULL,
      prodotto_id INTEGER,
      descrizione TEXT DEFAULT '',
      quantita REAL DEFAULT 1,
      prezzo REAL DEFAULT 0,
      iva REAL DEFAULT 22, unita_misura TEXT DEFAULT "", sconto REAL DEFAULT 0, scarica_magazzino INTEGER DEFAULT 1, variante_id INTEGER, variante_taglia TEXT DEFAULT "", variante_colore TEXT DEFAULT "", tipo TEXT DEFAULT "PRODOTTO", codice_iva TEXT DEFAULT "", codice_prodotto TEXT DEFAULT "",
      FOREIGN KEY (ddt_id) REFERENCES ddt(id) ON DELETE CASCADE,
      FOREIGN KEY (prodotto_id) REFERENCES prodotti(id)
    );
CREATE TABLE IF NOT EXISTS fatture (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL,
      data_emissione TEXT NOT NULL,
      cliente_id INTEGER,
      ddt_id INTEGER,
      note TEXT DEFAULT '',
      stato TEXT DEFAULT 'EMESSA', tipo_pagamento_id INTEGER, ritenuta_aliquota REAL DEFAULT 0, ritenuta_causale TEXT DEFAULT "", ritenuta_tipo TEXT DEFAULT "", ritenuta_su_cassa INTEGER DEFAULT 0, cassa_tipo TEXT DEFAULT "", cassa_aliquota REAL DEFAULT 0, cassa_iva REAL DEFAULT 0, bollo INTEGER DEFAULT 0, stato_sdi TEXT DEFAULT "", data_invio_sdi TEXT DEFAULT "", id_trasmissione_sdi TEXT DEFAULT "", cig TEXT DEFAULT "", cup TEXT DEFAULT "", agente_id INTEGER REFERENCES agenti(id), provvigione REAL,
      FOREIGN KEY (cliente_id) REFERENCES clienti(id),
      FOREIGN KEY (ddt_id) REFERENCES ddt(id)
    );
CREATE TABLE IF NOT EXISTS fatture_righe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fattura_id INTEGER NOT NULL,
      prodotto_id INTEGER,
      descrizione TEXT DEFAULT '',
      quantita REAL DEFAULT 1,
      prezzo REAL DEFAULT 0,
      iva REAL DEFAULT 22, unita_misura TEXT DEFAULT "", sconto REAL DEFAULT 0, scarica_magazzino INTEGER DEFAULT 1, variante_id INTEGER, variante_taglia TEXT DEFAULT "", variante_colore TEXT DEFAULT "", tipo TEXT DEFAULT "PRODOTTO", codice_iva TEXT DEFAULT "", codice_prodotto TEXT DEFAULT "", ddt_id INTEGER,
      FOREIGN KEY (fattura_id) REFERENCES fatture(id) ON DELETE CASCADE,
      FOREIGN KEY (prodotto_id) REFERENCES prodotti(id)
    );
CREATE TABLE IF NOT EXISTS note_credito (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL,
      data_emissione TEXT NOT NULL,
      cliente_id INTEGER,
      fattura_id INTEGER,
      note TEXT DEFAULT '',
      stato TEXT DEFAULT 'EMESSA', ritenuta_aliquota REAL DEFAULT 0, ritenuta_causale TEXT DEFAULT "", ritenuta_tipo TEXT DEFAULT "", ritenuta_su_cassa INTEGER DEFAULT 0, cassa_tipo TEXT DEFAULT "", cassa_aliquota REAL DEFAULT 0, cassa_iva REAL DEFAULT 0, bollo INTEGER DEFAULT 0, stato_sdi TEXT DEFAULT "", data_invio_sdi TEXT DEFAULT "", id_trasmissione_sdi TEXT DEFAULT "",
      FOREIGN KEY (cliente_id) REFERENCES clienti(id),
      FOREIGN KEY (fattura_id) REFERENCES fatture(id)
    );
CREATE TABLE IF NOT EXISTS note_credito_righe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nota_credito_id INTEGER NOT NULL,
      prodotto_id INTEGER,
      descrizione TEXT DEFAULT '',
      quantita REAL DEFAULT 1,
      prezzo REAL DEFAULT 0,
      iva REAL DEFAULT 22, unita_misura TEXT DEFAULT "", sconto REAL DEFAULT 0, variante_id INTEGER, variante_taglia TEXT DEFAULT "", variante_colore TEXT DEFAULT "", tipo TEXT DEFAULT "PRODOTTO", codice_iva TEXT DEFAULT "", codice_prodotto TEXT DEFAULT "",
      FOREIGN KEY (nota_credito_id) REFERENCES note_credito(id) ON DELETE CASCADE,
      FOREIGN KEY (prodotto_id) REFERENCES prodotti(id)
    );
CREATE TABLE IF NOT EXISTS ordini (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL,
      data_ordine TEXT NOT NULL,
      cliente_id INTEGER,
      fornitore_id INTEGER,
      tipo TEXT DEFAULT 'CLIENTE',
      stato TEXT DEFAULT 'APERTO',
      note TEXT DEFAULT '', preventivo_id INTEGER, acquisto_id INTEGER,
      FOREIGN KEY (cliente_id) REFERENCES clienti(id),
      FOREIGN KEY (fornitore_id) REFERENCES fornitori(id)
    );
CREATE TABLE IF NOT EXISTS ordini_righe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ordine_id INTEGER NOT NULL,
      prodotto_id INTEGER,
      descrizione TEXT DEFAULT '',
      quantita REAL DEFAULT 1,
      prezzo REAL DEFAULT 0,
      iva REAL DEFAULT 22, unita_misura TEXT DEFAULT "", sconto REAL DEFAULT 0, variante_id INTEGER, variante_taglia TEXT DEFAULT "", variante_colore TEXT DEFAULT "", tipo TEXT DEFAULT "PRODOTTO", codice_iva TEXT DEFAULT "", codice_fornitore TEXT DEFAULT "", codice_prodotto TEXT DEFAULT "",
      FOREIGN KEY (ordine_id) REFERENCES ordini(id) ON DELETE CASCADE,
      FOREIGN KEY (prodotto_id) REFERENCES prodotti(id)
    );
CREATE TABLE IF NOT EXISTS preventivi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL,
      data_emissione TEXT NOT NULL,
      cliente_id INTEGER,
      validita INTEGER DEFAULT 30,
      stato TEXT DEFAULT 'INVIATO',
      note TEXT DEFAULT '', stampa_immagini INTEGER DEFAULT 1,
      FOREIGN KEY (cliente_id) REFERENCES clienti(id)
    );
CREATE TABLE IF NOT EXISTS preventivi_righe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preventivo_id INTEGER NOT NULL,
      prodotto_id INTEGER,
      descrizione TEXT DEFAULT '',
      quantita REAL DEFAULT 1,
      prezzo REAL DEFAULT 0,
      iva REAL DEFAULT 22, unita_misura TEXT DEFAULT "", sconto REAL DEFAULT 0, variante_id INTEGER, variante_taglia TEXT DEFAULT "", variante_colore TEXT DEFAULT "", tipo TEXT DEFAULT "PRODOTTO", codice_iva TEXT DEFAULT "", codice_prodotto TEXT DEFAULT "",
      FOREIGN KEY (preventivo_id) REFERENCES preventivi(id) ON DELETE CASCADE,
      FOREIGN KEY (prodotto_id) REFERENCES prodotti(id)
    );
CREATE TABLE IF NOT EXISTS pagamenti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fattura_id INTEGER,
      data_pagamento TEXT NOT NULL,
      importo REAL NOT NULL,
      metodo TEXT DEFAULT 'Bonifico',
      note TEXT DEFAULT '', tipo TEXT DEFAULT "ENTRATA", tipo_pagamento_id INTEGER, acquisto_id INTEGER, conto TEXT DEFAULT "BANCA", vendita_banco_id INTEGER, stripe_ref TEXT, causale TEXT DEFAULT "", saldato INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (fattura_id) REFERENCES fatture(id)
    );
CREATE TABLE IF NOT EXISTS tipi_pagamento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      conto TEXT DEFAULT 'BANCA',
      giorni_scadenza INTEGER DEFAULT 0,
      fine_mese INTEGER DEFAULT 0,
      immediato INTEGER DEFAULT 0,
      attivo INTEGER DEFAULT 1
    );
CREATE TABLE IF NOT EXISTS categorie_prodotto (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE
    , aliquota_iva_id INTEGER REFERENCES aliquote_iva(id));
CREATE TABLE IF NOT EXISTS unita_misura (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      simbolo TEXT DEFAULT ''
    );
CREATE TABLE IF NOT EXISTS aliquote_iva (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      valore REAL NOT NULL,
      attiva INTEGER DEFAULT 1
    , codice TEXT DEFAULT "", categoria TEXT DEFAULT "", descrizione TEXT DEFAULT "", natura TEXT DEFAULT NULL, note TEXT DEFAULT "", predefinito INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS acquisti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL,
      data_emissione TEXT NOT NULL,
      fornitore_id INTEGER,
      tipo_pagamento_id INTEGER,
      note TEXT DEFAULT '',
      stato TEXT DEFAULT 'RICEVUTA', conto_acquisto_id INTEGER REFERENCES conti_acquisto(id),
      FOREIGN KEY (fornitore_id) REFERENCES fornitori(id),
      FOREIGN KEY (tipo_pagamento_id) REFERENCES tipi_pagamento(id)
    );
CREATE TABLE IF NOT EXISTS acquisti_righe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      acquisto_id INTEGER NOT NULL,
      prodotto_id INTEGER,
      descrizione TEXT DEFAULT '',
      quantita REAL DEFAULT 1,
      prezzo REAL DEFAULT 0,
      iva REAL DEFAULT 22, unita_misura TEXT DEFAULT "", sconto REAL DEFAULT 0, variante_id INTEGER, variante_taglia TEXT DEFAULT "", variante_colore TEXT DEFAULT "", tipo TEXT DEFAULT "PRODOTTO", codice_iva TEXT DEFAULT "", codice_prodotto TEXT DEFAULT "",
      FOREIGN KEY (acquisto_id) REFERENCES acquisti(id) ON DELETE CASCADE,
      FOREIGN KEY (prodotto_id) REFERENCES prodotti(id)
    );
CREATE TABLE IF NOT EXISTS prima_nota (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('ENTRATA','USCITA')),
      causale TEXT NOT NULL,
      importo REAL NOT NULL CHECK(importo > 0),
      conto TEXT DEFAULT 'CASSA' CHECK(conto IN ('CASSA','BANCA')),
      riferimento_tipo TEXT DEFAULT '',
      riferimento_id INTEGER DEFAULT NULL,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS allegati (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      documento_tipo TEXT NOT NULL,
      documento_id INTEGER NOT NULL,
      nome_file TEXT NOT NULL,
      percorso TEXT NOT NULL,
      dimensione INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS note_rapide (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      testo TEXT NOT NULL,
      ordine INTEGER DEFAULT 0
    );
CREATE TABLE IF NOT EXISTS causali_pagamento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      ordine INTEGER DEFAULT 0,
      attivo INTEGER DEFAULT 1
    );
CREATE TABLE IF NOT EXISTS prodotto_fornitori (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prodotto_id INTEGER NOT NULL,
      fornitore_id INTEGER NOT NULL,
      codice_fornitore TEXT DEFAULT '',
      prezzo_acquisto REAL,
      predefinito INTEGER DEFAULT 0,
      FOREIGN KEY (prodotto_id) REFERENCES prodotti(id) ON DELETE CASCADE,
      FOREIGN KEY (fornitore_id) REFERENCES fornitori(id) ON DELETE CASCADE
    );
CREATE INDEX IF NOT EXISTS idx_pf_prodotto ON prodotto_fornitori(prodotto_id);
CREATE INDEX IF NOT EXISTS idx_pf_fornitore ON prodotto_fornitori(fornitore_id);
CREATE TABLE IF NOT EXISTS clienti_indirizzi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      nome TEXT NOT NULL DEFAULT 'Sede',
      via TEXT DEFAULT '',
      cap TEXT DEFAULT '',
      citta TEXT DEFAULT '',
      provincia TEXT DEFAULT '',
      stato TEXT DEFAULT 'Italia',
      FOREIGN KEY (cliente_id) REFERENCES clienti(id) ON DELETE CASCADE
    );
CREATE TABLE IF NOT EXISTS bug_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titolo TEXT NOT NULL,
      descrizione TEXT NOT NULL,
      pagina TEXT DEFAULT '',
      priorita TEXT DEFAULT 'MEDIA' CHECK(priorita IN ('BASSA','MEDIA','ALTA')),
      stato TEXT DEFAULT 'APERTO' CHECK(stato IN ('APERTO','RISOLTO')),
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT DEFAULT NULL
    );
CREATE TABLE IF NOT EXISTS listini (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      descrizione TEXT DEFAULT '',
      sconto_default REAL DEFAULT 0,
      attivo INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    , colonne_extra TEXT DEFAULT '[]', colonne_standard TEXT DEFAULT '[]', stampa_due_colonne INTEGER DEFAULT 0, colonne_config TEXT DEFAULT '[]', griglia INTEGER DEFAULT 0, tema TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS listini_prezzi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listino_id INTEGER NOT NULL,
      prodotto_id INTEGER NOT NULL,
      prezzo REAL,
      sconto REAL, dati_extra TEXT DEFAULT '{}', ordine INTEGER DEFAULT 0, stili TEXT DEFAULT '{}',
      FOREIGN KEY (listino_id) REFERENCES listini(id) ON DELETE CASCADE,
      FOREIGN KEY (prodotto_id) REFERENCES prodotti(id) ON DELETE CASCADE,
      UNIQUE(listino_id, prodotto_id)
    );
CREATE TABLE IF NOT EXISTS fatture_riferimenti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fattura_id INTEGER NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      numero TEXT NOT NULL DEFAULT '',
      data TEXT DEFAULT '',
      cig TEXT DEFAULT '',
      cup TEXT DEFAULT '',
      commessa TEXT DEFAULT '',
      ordine INTEGER DEFAULT 0
    );
CREATE TABLE IF NOT EXISTS conti_acquisto (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      predefinito_per TEXT DEFAULT '',
      attivo INTEGER DEFAULT 1
    );
CREATE TABLE IF NOT EXISTS appuntamenti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titolo TEXT NOT NULL,
      descrizione TEXT DEFAULT '',
      inizio TEXT NOT NULL,
      fine TEXT,
      tutto_giorno INTEGER DEFAULT 0,
      luogo TEXT DEFAULT '',
      cliente_id INTEGER REFERENCES clienti(id) ON DELETE SET NULL,
      fornitore_id INTEGER REFERENCES fornitori(id) ON DELETE SET NULL,
      colore TEXT DEFAULT '#3b82f6',
      promemoria_min INTEGER,
      stato TEXT NOT NULL DEFAULT 'PIANIFICATO' CHECK(stato IN ('PIANIFICATO','COMPLETATO','ANNULLATO')),
      created_at TEXT DEFAULT (datetime('now'))
    , user_id INTEGER, condiviso INTEGER DEFAULT 0, google_event_id TEXT, google_etag TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_appuntamenti_inizio ON appuntamenti(inizio);
CREATE INDEX IF NOT EXISTS idx_appuntamenti_user ON appuntamenti(user_id);
CREATE TABLE IF NOT EXISTS todo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titolo TEXT NOT NULL,
      descrizione TEXT DEFAULT '',
      scadenza TEXT,
      priorita TEXT NOT NULL DEFAULT 'MEDIA' CHECK(priorita IN ('BASSA','MEDIA','ALTA')),
      stato TEXT NOT NULL DEFAULT 'DA_FARE' CHECK(stato IN ('DA_FARE','IN_CORSO','FATTA')),
      categoria TEXT DEFAULT '',
      completata_at TEXT,
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    , google_task_id TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_todo_scadenza ON todo(scadenza);
CREATE INDEX IF NOT EXISTS idx_todo_user ON todo(user_id);
CREATE TABLE IF NOT EXISTS google_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      access_token TEXT DEFAULT '',
      refresh_token TEXT DEFAULT '',
      account_label TEXT DEFAULT '',
      calendar_attivo INTEGER DEFAULT 0,
      calendar_sync_token TEXT,
      calendar_ultima_sync TEXT,
      tasks_attivo INTEGER DEFAULT 0,
      tasks_sync_token TEXT,
      tasks_ultima_sync TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    , connessione_in_corso INTEGER DEFAULT 0, ultimo_errore TEXT);
CREATE TABLE IF NOT EXISTS google_calendar_tombstone (
      google_event_id TEXT PRIMARY KEY,
      deleted_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS google_tasks_tombstone (
      google_task_id TEXT PRIMARY KEY,
      deleted_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS keychain_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      password_hash TEXT DEFAULT '',
      salt BLOB,
      created_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS keychain_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titolo TEXT NOT NULL,
      username TEXT DEFAULT '',
      url TEXT DEFAULT '',
      categoria TEXT DEFAULT '',
      password_cifrata BLOB NOT NULL,
      note_cifrata BLOB,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS crm_stage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      ordine INTEGER DEFAULT 0,
      colore TEXT DEFAULT '#6366f1',
      vinto INTEGER DEFAULT 0,
      perso INTEGER DEFAULT 0
    );
CREATE TABLE IF NOT EXISTS crm_opportunita (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titolo TEXT NOT NULL,
      cliente_id INTEGER REFERENCES clienti(id) ON DELETE SET NULL,
      contatto TEXT DEFAULT '',
      email TEXT DEFAULT '',
      telefono TEXT DEFAULT '',
      stage_id INTEGER REFERENCES crm_stage(id) ON DELETE SET NULL,
      valore REAL DEFAULT 0,
      probabilita INTEGER DEFAULT 50,
      data_prevista TEXT DEFAULT '',
      assegnatario TEXT DEFAULT '',
      note TEXT DEFAULT '',
      ordine INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS crm_attivita (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunita_id INTEGER REFERENCES crm_opportunita(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK(tipo IN ('CHIAMATA','EMAIL','RIUNIONE','TASK','NOTA')),
      titolo TEXT NOT NULL,
      descrizione TEXT DEFAULT '',
      data_pianificata TEXT,
      data_completamento TEXT,
      completata INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS progetti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      descrizione TEXT DEFAULT '',
      cliente_id INTEGER REFERENCES clienti(id) ON DELETE SET NULL,
      stato TEXT DEFAULT 'APERTO' CHECK(stato IN ('APERTO','IN_CORSO','SOSPESO','CHIUSO')),
      data_inizio TEXT DEFAULT '',
      data_fine TEXT DEFAULT '',
      budget REAL DEFAULT 0,
      tariffa_oraria REAL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS timesheet_voci (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      progetto_id INTEGER REFERENCES progetti(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      ore REAL NOT NULL CHECK(ore > 0),
      descrizione TEXT DEFAULT '',
      utente TEXT DEFAULT '',
      fatturata INTEGER DEFAULT 0,
      fattura_id INTEGER REFERENCES fatture(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS fornitore_codice_alias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fornitore_id INTEGER NOT NULL,
      prodotto_id INTEGER NOT NULL,
      codice TEXT NOT NULL,
      codice_norm TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (fornitore_id) REFERENCES fornitori(id) ON DELETE CASCADE,
      FOREIGN KEY (prodotto_id) REFERENCES prodotti(id) ON DELETE CASCADE,
      UNIQUE (fornitore_id, codice_norm)
    );
CREATE INDEX IF NOT EXISTS idx_alias_lookup ON fornitore_codice_alias(fornitore_id, codice_norm);
CREATE INDEX IF NOT EXISTS idx_alias_prodotto ON fornitore_codice_alias(prodotto_id);
CREATE TABLE IF NOT EXISTS fornitore_layout_riga (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fornitore_id INTEGER NOT NULL,
      tipo_documento TEXT NOT NULL DEFAULT 'FATTURA',
      -- ruoli delle colonne lette, in ordine, separati da virgola:
      -- codice, descrizione, quantita, prezzo, iva, totale, ignora
      ruoli TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (fornitore_id) REFERENCES fornitori(id) ON DELETE CASCADE,
      UNIQUE (fornitore_id, tipo_documento)
    );
CREATE TABLE IF NOT EXISTS marketplace_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canale TEXT NOT NULL CHECK(canale IN ('EBAY','AMAZON','SHOPIFY')) UNIQUE,
      access_token TEXT DEFAULT '',
      refresh_token TEXT DEFAULT '',
      token_scade_il TEXT,
      account_label TEXT DEFAULT '',
      attivo INTEGER DEFAULT 1,
      ultima_sync TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS marketplace_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canale TEXT NOT NULL CHECK(canale IN ('EBAY','AMAZON','SHOPIFY')),
      sku TEXT NOT NULL,
      sku_norm TEXT NOT NULL,
      prodotto_id INTEGER NOT NULL REFERENCES prodotti(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(canale, sku_norm)
    );
CREATE INDEX IF NOT EXISTS idx_marketplace_mapping_lookup ON marketplace_mapping(canale, sku_norm);
CREATE TABLE IF NOT EXISTS listini_sezioni (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listino_id INTEGER NOT NULL REFERENCES listini(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      ordine INTEGER DEFAULT 0
    );
CREATE INDEX IF NOT EXISTS idx_listini_sezioni ON listini_sezioni(listino_id);
CREATE TABLE IF NOT EXISTS fatture_ricorrenti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      descrizione TEXT NOT NULL,
      frequenza TEXT NOT NULL CHECK(frequenza IN ('MENSILE','BIMESTRALE','TRIMESTRALE','SEMESTRALE','ANNUALE')),
      giorno_emissione INTEGER DEFAULT 1,
      prossima_emissione TEXT NOT NULL,
      attiva INTEGER DEFAULT 1,
      righe TEXT NOT NULL DEFAULT '[]',
      tipo_pagamento_id INTEGER,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS prodotto_varianti (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        prodotto_id INTEGER NOT NULL,
        taglia      TEXT DEFAULT '',
        colore      TEXT DEFAULT '',
        quantita    REAL DEFAULT 0,
        barcode     TEXT DEFAULT '',
        FOREIGN KEY (prodotto_id) REFERENCES prodotti(id) ON DELETE CASCADE
      );
CREATE INDEX IF NOT EXISTS idx_var_prodotto ON prodotto_varianti(prodotto_id);
CREATE INDEX IF NOT EXISTS idx_var_barcode  ON prodotto_varianti(barcode);
CREATE TABLE IF NOT EXISTS vendite_banco (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        numero            TEXT NOT NULL,
        data              TEXT NOT NULL,
        cliente_nome      TEXT DEFAULT '',
        metodo_pagamento  TEXT DEFAULT 'CONTANTI',
        note              TEXT DEFAULT '',
        stato             TEXT DEFAULT 'EMESSA',
        canale             TEXT DEFAULT 'BANCO' CHECK(canale IN ('BANCO','EBAY','AMAZON','SHOPIFY')),
        riferimento_esterno TEXT
      );
CREATE TABLE IF NOT EXISTS vendite_banco_righe (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        vendita_id  INTEGER NOT NULL,
        prodotto_id INTEGER,
        descrizione TEXT DEFAULT '',
        quantita    REAL DEFAULT 1,
        prezzo      REAL DEFAULT 0,
        sconto      REAL DEFAULT 0,
        iva         REAL DEFAULT 22,
        unita_misura TEXT DEFAULT '',
        variante_id     INTEGER,
        variante_taglia TEXT DEFAULT '',
        variante_colore TEXT DEFAULT '',
        FOREIGN KEY (vendita_id)  REFERENCES vendite_banco(id) ON DELETE CASCADE,
        FOREIGN KEY (prodotto_id) REFERENCES prodotti(id)
      );
CREATE TABLE IF NOT EXISTS movimenti_magazzino (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        data             TEXT NOT NULL,
        prodotto_id      INTEGER NOT NULL,
        prodotto_nome    TEXT DEFAULT '',
        tipo             TEXT NOT NULL,
        quantita         REAL NOT NULL,
        causale          TEXT DEFAULT '',
        documento_tipo   TEXT DEFAULT '',
        documento_id     INTEGER,
        documento_numero TEXT DEFAULT '',
        cliente_id       INTEGER,
        cliente_nome     TEXT DEFAULT '',
        fornitore_id     INTEGER,
        fornitore_nome   TEXT DEFAULT '',
        note             TEXT DEFAULT '',
        variante_id      INTEGER,
        variante_taglia  TEXT DEFAULT '',
        variante_colore  TEXT DEFAULT '', magazzino_id INTEGER, magazzino_dest_id INTEGER, lotto TEXT DEFAULT "", scadenza TEXT DEFAULT "",
        FOREIGN KEY (prodotto_id)  REFERENCES prodotti(id)  ON DELETE CASCADE,
        FOREIGN KEY (cliente_id)   REFERENCES clienti(id)   ON DELETE SET NULL,
        FOREIGN KEY (fornitore_id) REFERENCES fornitori(id) ON DELETE SET NULL
      );
CREATE INDEX IF NOT EXISTS idx_mov_data        ON movimenti_magazzino(data);
CREATE INDEX IF NOT EXISTS idx_mov_prodotto    ON movimenti_magazzino(prodotto_id);
CREATE INDEX IF NOT EXISTS idx_mov_cliente     ON movimenti_magazzino(cliente_id);
CREATE TABLE IF NOT EXISTS fatture_ddt (
        fattura_id INTEGER NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
        ddt_id     INTEGER NOT NULL REFERENCES ddt(id),
        PRIMARY KEY (fattura_id, ddt_id)
      );
CREATE TABLE IF NOT EXISTS utenti (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        nome          TEXT DEFAULT '',
        email         TEXT DEFAULT '',
        ruolo         TEXT DEFAULT 'OPERATORE',
        attivo        INTEGER DEFAULT 1
      );
CREATE TABLE IF NOT EXISTS solleciti (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        documento_tipo      TEXT NOT NULL,
        documento_id        INTEGER NOT NULL,
        email_destinatario  TEXT DEFAULT '',
        data_invio          TEXT NOT NULL,
        esito               TEXT DEFAULT 'INVIATO'
      );
CREATE INDEX IF NOT EXISTS idx_sol_doc ON solleciti(documento_tipo, documento_id);
CREATE TABLE IF NOT EXISTS contatori (
        tipo     TEXT NOT NULL,
        anno     INTEGER NOT NULL,
        contatore INTEGER DEFAULT 0,
        PRIMARY KEY (tipo, anno)
      );
CREATE TABLE IF NOT EXISTS arrivi_merce (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        numero                   TEXT NOT NULL,
        data                     TEXT NOT NULL,
        fornitore_id             INTEGER,
        acquisto_id              INTEGER,
        numero_documento_fornitore TEXT DEFAULT '',
        note                     TEXT DEFAULT '',
        stato                    TEXT DEFAULT 'RICEVUTO', magazzino_id INTEGER,
        FOREIGN KEY (fornitore_id) REFERENCES fornitori(id),
        FOREIGN KEY (acquisto_id)  REFERENCES acquisti(id)
      );
CREATE TABLE IF NOT EXISTS arrivi_merce_righe (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        arrivo_merce_id  INTEGER NOT NULL,
        prodotto_id      INTEGER,
        variante_id      INTEGER,
        descrizione      TEXT DEFAULT '',
        codice_fornitore TEXT DEFAULT '',
        quantita         REAL DEFAULT 1,
        unita_misura     TEXT DEFAULT '',
        prezzo_acquisto  REAL DEFAULT 0,
        variante_taglia  TEXT DEFAULT '',
        variante_colore  TEXT DEFAULT '', lotto TEXT DEFAULT "", scadenza TEXT DEFAULT "", magazzino_id INTEGER,
        FOREIGN KEY (arrivo_merce_id) REFERENCES arrivi_merce(id) ON DELETE CASCADE,
        FOREIGN KEY (prodotto_id)     REFERENCES prodotti(id),
        FOREIGN KEY (variante_id)     REFERENCES prodotto_varianti(id)
      );
CREATE INDEX IF NOT EXISTS idx_arr_fornitore ON arrivi_merce(fornitore_id);
CREATE INDEX IF NOT EXISTS idx_arr_data      ON arrivi_merce(data);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fatture_numero ON fatture(numero);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ddt_numero ON ddt(numero);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ordini_numero ON ordini(numero);
CREATE UNIQUE INDEX IF NOT EXISTS idx_preventivi_numero ON preventivi(numero);
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_credito_numero ON note_credito(numero);
CREATE UNIQUE INDEX IF NOT EXISTS idx_acquisti_numero ON acquisti(numero);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendite_banco_numero ON vendite_banco(numero);
CREATE UNIQUE INDEX IF NOT EXISTS idx_arrivi_merce_numero ON arrivi_merce(numero);
CREATE INDEX IF NOT EXISTS idx_fr_fattura       ON fatture_righe(fattura_id);
CREATE INDEX IF NOT EXISTS idx_dr_ddt           ON ddt_righe(ddt_id);
CREATE INDEX IF NOT EXISTS idx_ncr_nota         ON note_credito_righe(nota_credito_id);
CREATE INDEX IF NOT EXISTS idx_or_ordine        ON ordini_righe(ordine_id);
CREATE INDEX IF NOT EXISTS idx_pr_preventivo    ON preventivi_righe(preventivo_id);
CREATE INDEX IF NOT EXISTS idx_ar_acquisto      ON acquisti_righe(acquisto_id);
CREATE INDEX IF NOT EXISTS idx_vbr_vendita      ON vendite_banco_righe(vendita_id);
CREATE INDEX IF NOT EXISTS idx_pag_fattura      ON pagamenti(fattura_id);
CREATE INDEX IF NOT EXISTS idx_pag_acquisto     ON pagamenti(acquisto_id);
CREATE INDEX IF NOT EXISTS idx_pag_venditabanco ON pagamenti(vendita_banco_id);
CREATE INDEX IF NOT EXISTS idx_fatt_cliente     ON fatture(cliente_id);
CREATE INDEX IF NOT EXISTS idx_fatt_data        ON fatture(data_emissione);
CREATE INDEX IF NOT EXISTS idx_nc_cliente       ON note_credito(cliente_id);
CREATE INDEX IF NOT EXISTS idx_nc_fattura       ON note_credito(fattura_id);
CREATE INDEX IF NOT EXISTS idx_ddt_cliente      ON ddt(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ord_cliente      ON ordini(cliente_id);
CREATE INDEX IF NOT EXISTS idx_prev_cliente     ON preventivi(cliente_id);
CREATE INDEX IF NOT EXISTS idx_acq_fornitore    ON acquisti(fornitore_id);
CREATE INDEX IF NOT EXISTS idx_fddt_fattura     ON fatture_ddt(fattura_id);
CREATE INDEX IF NOT EXISTS idx_fddt_ddt         ON fatture_ddt(ddt_id);
CREATE INDEX IF NOT EXISTS idx_arr_acquisto     ON arrivi_merce(acquisto_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pag_stripe_ref ON pagamenti(stripe_ref) WHERE stripe_ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        payload TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE TABLE IF NOT EXISTS magazzini (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codice TEXT DEFAULT '',
        nome TEXT NOT NULL,
        indirizzo TEXT DEFAULT '',
        predefinito INTEGER DEFAULT 0,
        attivo INTEGER DEFAULT 1
      );
CREATE TABLE IF NOT EXISTS giacenze (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prodotto_id INTEGER NOT NULL REFERENCES prodotti(id) ON DELETE CASCADE,
        variante_id INTEGER REFERENCES prodotto_varianti(id) ON DELETE CASCADE,
        magazzino_id INTEGER NOT NULL REFERENCES magazzini(id) ON DELETE CASCADE,
        lotto TEXT DEFAULT '',
        scadenza TEXT DEFAULT '',
        quantita REAL DEFAULT 0
      );
CREATE UNIQUE INDEX IF NOT EXISTS idx_giac_chiave
        ON giacenze(prodotto_id, IFNULL(variante_id,0), magazzino_id, lotto, scadenza);
CREATE INDEX IF NOT EXISTS idx_giac_prodotto ON giacenze(prodotto_id);
CREATE INDEX IF NOT EXISTS idx_giac_magazzino ON giacenze(magazzino_id);

-- Bacheca post-it (un singolo blob JSON per tenant: posizioni, colori, contenuti).
-- Incluso nei backup perché vive nel DB del tenant.
CREATE TABLE IF NOT EXISTS lavagna (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        dati TEXT NOT NULL DEFAULT '{}'
      );

CREATE TABLE IF NOT EXISTS kit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        righe TEXT NOT NULL DEFAULT '[]',
        creato_il TEXT
      );

CREATE TABLE IF NOT EXISTS agenti (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT DEFAULT '',
        telefono TEXT DEFAULT '',
        base_provvigione TEXT DEFAULT 'IMPONIBILE',
        provvigione_default REAL DEFAULT 0,
        attivo INTEGER DEFAULT 1
      );
