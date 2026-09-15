/**
 * Stili condivisi della tabella "righe" dei documenti (fatture, preventivi, ordini,
 * DDT, note di credito, acquisti, ricorrenti, vendita banco).
 *
 * UNICA FONTE DI VERITÀ per la griglia righe: prima era duplicata in 7 componenti
 * e aveva iniziato a divergere. Tutto è tokenizzato (dark-mode aware "by construction")
 * e ogni colonna si identifica per CLASSE SEMANTICA (.td-qta, .td-prezzo, ...),
 * MAI per posizione: così il card-stack mobile (in styles.scss) resta robusto anche
 * quando i documenti hanno colonne diverse o condizionali.
 *
 * CONTRATTO DI CLASSI (i template devono usare ESATTAMENTE questi nomi):
 *   Header:  .righe-header > .righe-header-title (label + errore) | .righe-actions (toggle + bottoni)
 *   Celle:   .td-drag .td-desc .td-search .td-history .td-qta .td-um .td-prezzo
 *            .td-sconto .td-iva .td-totale .td-actions  (+ opzionali .td-codfornitore .td-variante .td-nota)
 *   Input:   .riga-input (+ .riga-input--num / .riga-input--sconto ; alias legacy .num/.sconto)
 *   Codice:  .codice-desc-stack > .riga-codice (sopra) + .riga-input--desc (sotto)
 *   Note:    riga .riga-nota
 *   Totali:  usare .doc-totals-strip globale (NON più .righe-total)
 *
 * Il responsive (tablet/mobile card-stack per-classe) vive in styles.scss perché
 * deve applicarsi globalmente (anche ai pochi componenti che non importano questa stringa).
 */
export const RIGHE_STYLES = `
  /* ===== Header sezione righe ===== */
  .righe-section { margin-top: var(--sp-5); }
  .righe-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--sp-3); flex-wrap: wrap; margin-bottom: var(--sp-3);
  }
  :host-context(html.density-compact) .righe-section { margin-top: var(--sp-3); }
  :host-context(html.density-compact) .righe-header { margin-bottom: var(--sp-2); }
  .righe-header-title {
    display: flex; align-items: center; gap: var(--sp-3);
    font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--text-tertiary);
  }
  .righe-actions { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }

  /* ===== Tabella ===== */
  .righe-table { width: 100%; border-collapse: collapse; }
  .righe-table th {
    background: var(--bg-surface-2); color: var(--text-tertiary);
    padding: var(--sp-2); font-size: 11px; font-weight: 600;
    text-align: left; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  .righe-table td {
    padding: var(--sp-2) var(--sp-1); border-bottom: 1px solid var(--border-subtle);
    vertical-align: middle;
  }
  .righe-table tbody tr:hover td { background: var(--bg-subtle); }

  /* ===== Input riga (grezzi, tokenizzati) ===== */
  .riga-input {
    border: 1px solid var(--row-input-border); border-radius: var(--radius-xs);
    background: var(--row-input-bg); color: var(--text-primary);
    padding: var(--sp-1) var(--sp-2); font-size: 13px;
    width: 100%; box-sizing: border-box;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }
  .riga-input:focus { outline: none; border-color: var(--primary); box-shadow: var(--shadow-focus); }
  .riga-input.num, .riga-input--num { width: 76px; }
  .riga-input.sconto, .riga-input--sconto { width: 64px; }
  .input-error { border-color: var(--danger) !important; }

  /* ===== Larghezze colonna PER CLASSE (niente magic inline, niente nth-of-type) ===== */
  .td-drag    { width: 32px; padding: 0 !important; cursor: grab; color: var(--text-muted); }
  .td-search  { width: 40px; padding: 0 !important; }
  .td-history { width: 40px; padding: 0 !important; }
  .td-desc    { min-width: 240px; }
  .td-qta     { width: 84px; }
  .td-um      { width: 92px; }
  .td-prezzo  { width: 120px; }
  .td-sconto  { width: 78px; }
  .td-iva     { width: 104px; }
  .td-totale  { width: 112px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .td-actions { width: 44px; padding: 0 !important; }
  .td-codfornitore { width: 130px; }   /* Ordini fornitore / Acquisti */
  .td-variante     { width: 140px; }   /* Vendita banco */
  /* Flag "scarica magazzino" per riga (Fatture / DDT) */
  .td-scarico { width: 58px; text-align: center; padding: 0 !important; }
  .td-scarico .riga-check { width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary); }
  /* Riga senza prodotto a catalogo: il flag scarico apre la creazione rapida prodotto */
  .td-scarico .riga-check--crea { outline: 1px dashed var(--primary); outline-offset: 2px; opacity: 0.7; }
  .td-scarico .riga-check--crea:hover { opacity: 1; }
  th.td-scarico .mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--text-tertiary); vertical-align: middle; }

  /* Cluster azioni di riga (search/history) raggruppate */
  .riga-tools { display: inline-flex; align-items: center; gap: 2px; }

  /* ===== Codice + descrizione impilati come field-group ===== */
  .codice-desc-stack { display: flex; flex-direction: column; gap: 0; }
  .riga-codice {
    font-size: 11px; color: var(--text-secondary);
    background: var(--bg-surface-2); border: 1px solid var(--row-input-border);
    border-bottom: none; border-radius: var(--radius-xs) var(--radius-xs) 0 0;
    padding: 3px var(--sp-2); box-sizing: border-box; width: 100%;
  }
  .riga-input--desc { border-radius: 0 0 var(--radius-xs) var(--radius-xs); }

  /* ===== Densità compatta (default desktop, html.density-compact) =====
   * Il resto della grid usa già padding minimi (--sp-1/--sp-2); qui si stringe
   * anche l'altezza di riga: con una fattura da 15-20 righe la versione "comoda"
   * costringe a scrollare dopo 3-4 righe visibili. */
  :host-context(html.density-compact) .righe-table td { padding: 3px var(--sp-1); }
  :host-context(html.density-compact) .riga-input { padding: 2px 6px; font-size: 12.5px; }
  :host-context(html.density-compact) .riga-codice { padding: 1px 6px; font-size: 10px; }
  /* Codice/descrizione sono il campo principale da compilare in ogni riga: a
     differenza dei campi numerici (qtà/prezzo/sconto/iva), restano leggibili
     anche in densità compatta invece di seguire lo shrink generale. */
  :host-context(html.density-compact) .riga-input--desc { padding: 5px 8px; font-size: 13.5px; }
  :host-context(html.density-compact) .riga-codice { padding: 3px 8px; font-size: 11.5px; }

  /* ===== Riga NOTA (tokenizzata) ===== */
  .riga-nota td { background: var(--warning-soft); }
  .riga-nota .riga-input, .riga-nota input { font-style: italic; color: var(--text-secondary); }

  /* ===== Menu prezzi recenti ===== */
  .prezzo-recente-item {
    display: flex; justify-content: space-between; gap: var(--sp-4);
    font-size: 13px; min-width: 220px; color: var(--text-primary);
  }
  .pr-meta { color: var(--text-tertiary); font-size: 11px; }

  /* ===== Errori ===== */
  .righe-error {
    display: flex; align-items: center; gap: var(--sp-1);
    color: var(--danger); font-size: 12px; font-weight: 600;
  }
  .righe-error mat-icon { font-size: 15px; width: 15px; height: 15px; }

  /* ===== DDT: colli ===== */
  .colli-row { display: flex; align-items: flex-end; gap: var(--sp-2); }
  .colli-calc-btn { margin-bottom: 20px; flex-shrink: 0; }
  /* Mobile: la .form-row impila in colonna (styles.scss) → niente margine fittizio
     d'allineamento, il bottone va a larghezza piena sotto al campo. */
  @media (max-width: 600px) {
    .colli-calc-btn { margin-bottom: 0; width: 100%; }
  }

  /* ===== CDK drag ===== */
  .cdk-drag-placeholder { opacity: 0.4; }
  .cdk-drag-animating { transition: transform 250ms cubic-bezier(0,0,0.2,1); }

  /* ===== Totali (legacy alias: i nuovi doc usano .doc-totals-strip globale) ===== */
  .righe-total {
    text-align: right; padding: var(--sp-3) var(--sp-4); font-weight: 700;
    background: var(--bg-surface-2); color: var(--text-primary);
    border-top: 2px solid var(--border);
    border-radius: 0 0 var(--radius-md) var(--radius-md);
  }

  /* Riga venduta sotto il costo d'acquisto: sta accanto al prezzo, dove si
     guarda mentre si applica uno sconto. Condiviso da fatture e vendita banco. */
  .sottocosto {
    display: flex; align-items: center; gap: 3px; margin-top: 2px;
    font-size: 11px; font-weight: 700; color: var(--danger-on, #b91c1c); cursor: default;
  }
  .sottocosto mat-icon { font-size: 13px; width: 13px; height: 13px; }
`;
