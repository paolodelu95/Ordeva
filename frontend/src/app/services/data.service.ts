import { Injectable } from '@angular/core';
import { Observable, switchMap, shareReplay, map, of } from 'rxjs';
import { ModuloDto } from '../models';
import { ApiService } from './api.service';
import { environment } from '../../environments/environment';
import {
  Azienda, Prodotto, ProdottoVariante, ProdottoFornitore, Cliente, ClienteIndirizzo, Fornitore,
  Ddt, Fattura, NotaCredito, Ordine, Preventivo,
  Pagamento, ScadenzarioEntry, TipoPagamento, Acquisto,
  CategoriaProdotto, CausalePagamento, PropostaRiordino, UnitaMisura, AliquotaIva, Listino, ListinoPrezzo, ListinoSezione, ListinoCellaStile, PrezzoRisolto,
  ListinoRigaNonTrovata, ListinoMatchRisultato, CodiceAlias, VariazionePrezzo,
  MovimentoMagazzino, GiacenzaStorica, VenditaBanco, MarketplaceCanale, MarketplaceRigaDaAbbinare,
  Magazzino, Giacenza, ScadenzaLotto,
  ArrivoMerce, Utente, StatsVenditeMensili, StatsAcquistiMensili,
  StatsTopProdotto, StatsTopCliente, StatsCashflow, StatsKpiAnno, Sollecito,
  NotaRapida, BackupConfig, ScadenzaFiscale, Agente
} from '../models';

@Injectable({ providedIn: 'root' })
export class DataService {
  constructor(private api: ApiService) {}

  // Azienda
  getAzienda(): Observable<Azienda> { return this.api.get('azienda'); }
  updateAzienda(a: Azienda): Observable<any> { return this.api.put('azienda', a); }
  saveAzienda(a: Azienda): Observable<any> { return this.api.put('azienda', a); }

  // Setup primo avvio (solo edizione offline desktop)
  getSetupStatus(): Observable<{ aziendaConfigurata: boolean; hasDati: boolean }> { return this.api.get('setup/status'); }
  seedDemo(): Observable<{ success: boolean; prodotti: number; clienti: number; fornitori: number }> { return this.api.post('setup/seed-demo', {}); }
  // Password opzionale d'accesso (offline)
  getAppPasswordStatus(): Observable<{ enabled: boolean }> { return this.api.get('setup/password/status'); }
  setAppPassword(password: string, current?: string): Observable<{ success: boolean; enabled: boolean }> { return this.api.post('setup/password', { password, current }); }
  unlockApp(password: string): Observable<{ ok: boolean }> { return this.api.post('setup/unlock', { password }); }

  // Backup (offline)
  getBackupConfig(): Observable<BackupConfig> { return this.api.get('backup/config'); }
  saveBackupConfig(c: Partial<BackupConfig>): Observable<BackupConfig> { return this.api.put('backup/config', c); }
  runBackup(): Observable<BackupConfig & { success: boolean; file: string; encrypted: boolean }> { return this.api.post('backup/run', {}); }
  dismissBackupAlert(): Observable<BackupConfig> { return this.api.post('backup/alert-dismiss', {}); }
  listBackups(): Observable<{ files: { name: string; encrypted: boolean; size: number; mtime: string }[] }> { return this.api.get('backup/list'); }
  pruneOldBackups(): Observable<{ removed: number; files: { name: string; encrypted: boolean; size: number; mtime: string }[] }> { return this.api.post('backup/prune', {}); }
  restoreBackup(name: string): Observable<{ success: boolean }> { return this.api.post('backup/restore', { name }); }
  restoreBackupFromFile(filePath: string, password?: string): Observable<{ success: boolean }> { return this.api.post('backup/restore', { filePath, password }); }

  // Archivi (multi-database, offline): ogni archivio è un gestionale a sé.
  getArchivi(): Observable<{ archivi: { slug: string; nome: string; cifrato: boolean }[]; corrente: string | null }> { return this.api.get('archivi'); }
  creaArchivio(nome: string): Observable<{ archivio: { slug: string; nome: string; cifrato: boolean } }> { return this.api.post('archivi', { nome }); }
  duplicaArchivio(slug: string, nome: string): Observable<any> { return this.api.post(`archivi/${slug}/duplica`, { nome }); }
  rinominaArchivio(slug: string, nome: string): Observable<any> { return this.api.post(`archivi/${slug}/rinomina`, { nome }); }
  eliminaArchivio(slug: string): Observable<any> { return this.api.post(`archivi/${slug}/elimina`, {}); }
  cambiaArchivio(slug: string): Observable<any> { return this.api.post(`archivi/${slug}/cambia`, {}); }
  importaArchivio(file: string, nome: string): Observable<any> { return this.api.post('archivi/importa', { file, nome }); }
  esportaArchivio(slug: string, dest: string): Observable<any> { return this.api.post(`archivi/${slug}/esporta`, { dest }); }
  setPasswordArchivio(password: string): Observable<any> { return this.api.post('archivi/password', { password }); }
  rimuoviPasswordArchivio(): Observable<any> { return this.api.delete('archivi/password'); }

  // Sistema / dati (offline): cartella dati visibile e spostabile (anche su Dropbox)
  getSistemaPercorsi(): Observable<{ dataDir: string; configPath: string; files: { nome: string; esiste: boolean; bytes: number }[] }> { return this.api.get('sistema/percorsi'); }
  setSistemaDataDir(path: string): Observable<{ ok: boolean; riavvioRichiesto: boolean; dataDir: string }> { return this.api.post('sistema/data-dir', { path }); }
  getSistemaLock(): Observable<{ altraSessione: boolean; host?: string; heartbeatAt?: number }> { return this.api.get('sistema/lock'); }
  sistemaFlush(): Observable<{ ok: boolean }> { return this.api.post('sistema/flush', {}); }
  // Scadenze fiscali (calendario IVA/LIPE/ritenute/imposte)
  getScadenzeFiscali(anno?: number): Observable<{ anno: number; config: { ivaPeriodicita: string; sostitutoImposta: boolean }; scadenze: ScadenzaFiscale[] }> {
    return this.api.get(`scadenze-fiscali${anno ? `?anno=${anno}` : ''}`);
  }
  createScadenzaFiscale(s: Partial<ScadenzaFiscale>): Observable<{ id: number }> { return this.api.post('scadenze-fiscali', s); }
  updateScadenzaFiscale(id: number, patch: Partial<ScadenzaFiscale>): Observable<any> { return this.api.put(`scadenze-fiscali/${id}`, patch); }
  deleteScadenzaFiscale(id: number): Observable<any> { return this.api.delete(`scadenze-fiscali/${id}`); }
  setScadenzeFiscaliConfig(cfg: { ivaPeriodicita: string; sostitutoImposta: boolean }): Observable<any> { return this.api.put('scadenze-fiscali/config', cfg); }

  // Snapshot / cronologia versioni (offline)
  // Cifratura del database a riposo (offline)
  getCifratura(): Observable<{ attiva: boolean; passwordImpostata: boolean }> { return this.api.get('sistema/cifratura'); }
  setCifratura(enabled: boolean, password = ''): Observable<{ ok: boolean; attiva: boolean }> { return this.api.post('sistema/cifratura', { enabled, password }); }

  getSnapshots(): Observable<{ snapshots: { name: string; size: number; mtime: string }[] }> { return this.api.get('sistema/snapshots'); }
  createSnapshot(): Observable<{ ok: boolean; name: string }> { return this.api.post('sistema/snapshots', {}); }
  restoreSnapshot(name: string): Observable<{ ok: boolean }> { return this.api.post('sistema/snapshots/restore', { name }); }

  // Prodotti
  getProdotti(): Observable<Prodotto[]> { return this.api.get('prodotti'); }
  /** Dettaglio singolo prodotto: include l'immagine (esclusa dalla lista). */
  getProdotto(id: number): Observable<Prodotto> { return this.api.get(`prodotti/${id}`); }
  /** Schede sintetiche (immagine, peso, dimensioni) per la stampa dei preventivi. */
  getProdottoSchede(ids: number[]): Observable<{ id: number; nome: string; codice: string; peso: number | null; dimensioni: string; immagine: string }[]> {
    return this.api.get(`prodotti/schede?ids=${ids.join(',')}`);
  }
  getProdottiSottoSoglia(): Observable<Prodotto[]> { return this.api.get('prodotti/sotto-soglia'); }
  rettificaGiacenza(id: number, quantita: number, note?: string): Observable<any> {
    return this.api.post(`prodotti/${id}/rettifica`, { quantita, note: note || '' });
  }
  rettificaBulk(items: { prodottoId: number; varianteId?: number | null; quantita: number }[], note?: string): Observable<{ success: boolean; applied: number; movimenti: number }> {
    return this.api.post('prodotti/rettifica-bulk', { items, note: note || '' });
  }

  // Riordino scorte
  getProposteRiordino(): Observable<PropostaRiordino[]> { return this.api.get('riordino/proposte'); }
  generaRiordino(items: { prodottoId: number; quantita: number; fornitoreId: number }[]): Observable<{ created: { numero: string; fornitoreNome: string; righe: number }[] }> {
    return this.api.post('riordino/genera', { items });
  }
  getProdottiCount(): Observable<number> { return this.api.get('prodotti/count'); }
  getProdottiValore(): Observable<number> { return this.api.get('prodotti/valore'); }
  createProdotto(p: Prodotto): Observable<any> { return this.api.post('prodotti', p); }
  updateProdotto(p: Prodotto): Observable<any> { return this.api.put(`prodotti/${p.id}`, p); }
  deleteProdotto(id: number): Observable<any> { return this.api.delete(`prodotti/${id}`); }

  importProdotti(records: any[]): Observable<any> { return this.api.post('prodotti/import', records); }

  // Varianti prodotto
  getProdottoVarianti(prodottoId: number): Observable<ProdottoVariante[]> { return this.api.get(`prodotto-varianti/${prodottoId}`); }
  getProdottoFornitori(prodottoId: number): Observable<ProdottoFornitore[]> { return this.api.get(`prodotti/${prodottoId}/fornitori`); }
  /** Codici fornitore memorizzati per il prodotto (memoria degli import listino). */
  getCodiciAlias(prodottoId: number): Observable<CodiceAlias[]> { return this.api.get(`prodotti/${prodottoId}/codici-alias`); }
  deleteCodiceAlias(aliasId: number): Observable<any> { return this.api.delete(`prodotti/codici-alias/${aliasId}`); }
  importListino(
    fornitoreId: number, ivato: boolean,
    righe: { codice: any; prezzo: any; descrizione?: string }[],
  ): Observable<{ aggiornati: number; aggiornamenti: VariazionePrezzo[]; nonTrovati: ListinoRigaNonTrovata[] }> {
    return this.api.post('prodotti/import-listino', { fornitoreId, ivato, righe });
  }
  /** Propone i prodotti piu probabili per le righe di listino non abbinate (sola lettura). */
  matchListino(
    fornitoreId: number, righe: ListinoRigaNonTrovata[],
    opts?: { limit?: number; minScore?: number },
  ): Observable<{ risultati: ListinoMatchRisultato[] }> {
    return this.api.post('prodotti/import-listino/match', { fornitoreId, righe, ...(opts || {}) });
  }
  /** Conferma in batch gli abbinamenti scelti: attacca i codici fornitore ai prodotti. */
  abbinaListino(
    fornitoreId: number, ivato: boolean,
    abbinamenti: { codice: string; prodottoId: number; prezzo?: any }[],
  ): Observable<{ associati: number; aggiornati: number; saltati: { codice: string; motivo: string }[] }> {
    return this.api.post('prodotti/import-listino/abbina', { fornitoreId, ivato, abbinamenti });
  }
  searchByBarcode(barcode: string): Observable<{ prodotto: Prodotto; variante: ProdottoVariante | null }> {
    return this.api.get(`prodotto-varianti/barcode/${encodeURIComponent(barcode)}`);
  }

  // Clienti
  getClienti(): Observable<Cliente[]> { return this.api.get('clienti'); }
  getClientiCount(): Observable<number> { return this.api.get('clienti/count'); }
  createCliente(c: Cliente): Observable<any> { return this.api.post('clienti', c); }
  updateCliente(c: Cliente): Observable<any> { return this.api.put(`clienti/${c.id}`, c); }
  deleteCliente(id: number): Observable<any> { return this.api.delete(`clienti/${id}`); }
  importClienti(records: any[]): Observable<any> { return this.api.post('clienti/import', records); }
  getClienteIndirizzi(clienteId: number): Observable<ClienteIndirizzo[]> { return this.api.get(`clienti/${clienteId}/indirizzi`); }
  getFattureInsoluteCliente(clienteId: number): Observable<{ id: number; numero: string; dataEmissione: string; totale: number; stato: string }[]> {
    return this.api.get(`clienti/${clienteId}/fatture-insolute`);
  }
  createClienteIndirizzo(clienteId: number, a: ClienteIndirizzo): Observable<any> { return this.api.post(`clienti/${clienteId}/indirizzi`, a); }
  updateClienteIndirizzo(clienteId: number, a: ClienteIndirizzo): Observable<any> { return this.api.put(`clienti/${clienteId}/indirizzi/${a.id}`, a); }
  deleteClienteIndirizzo(clienteId: number, id: number): Observable<any> { return this.api.delete(`clienti/${clienteId}/indirizzi/${id}`); }

  // Fornitori
  getFornitori(): Observable<Fornitore[]> { return this.api.get('fornitori'); }
  createFornitore(f: Fornitore): Observable<any> { return this.api.post('fornitori', f); }
  updateFornitore(f: Fornitore): Observable<any> { return this.api.put(`fornitori/${f.id}`, f); }
  deleteFornitore(id: number): Observable<any> { return this.api.delete(`fornitori/${id}`); }
  importFornitori(records: any[]): Observable<any> { return this.api.post('fornitori/import', records); }

  // DDT
  getDdt(): Observable<Ddt[]> { return this.api.get('ddt'); }
  getDdtById(id: number): Observable<Ddt> { return this.api.get(`ddt/${id}`); }
  getDdtNonFatturati(): Observable<Ddt[]> { return this.api.get('ddt/non-fatturati'); }
  createDdt(d: Ddt): Observable<any> { return this.api.post('ddt', d); }
  updateDdt(d: Ddt): Observable<any> { return this.api.put(`ddt/${d.id}`, d); }
  deleteDdt(id: number): Observable<any> { return this.api.delete(`ddt/${id}`); }

  // Fatture
  getFatture(): Observable<Fattura[]> { return this.api.get('fatture'); }
  getFatturaById(id: number): Observable<Fattura> { return this.api.get(`fatture/${id}`); }
  createFattura(f: Fattura): Observable<any> { return this.api.post('fatture', f); }
  updateFattura(f: Fattura): Observable<any> { return this.api.put(`fatture/${f.id}`, f); }
  deleteFattura(id: number): Observable<any> { return this.api.delete(`fatture/${id}`); }
  generaFattureDaDdt(items: { clienteId: number | null; ddtIds: number[]; tipoPagamentoId: number | null }[]): Observable<{ fatture: { id: number; numero: string; clienteNome: string; ddtNums: string }[] }> {
    return this.api.post('fatture/da-ddt', { items });
  }

  // Note di Credito
  getNoteCredito(): Observable<NotaCredito[]> { return this.api.get('note-credito'); }
  getNotaCreditoById(id: number): Observable<NotaCredito> { return this.api.get(`note-credito/${id}`); }
  createNotaCredito(n: NotaCredito): Observable<any> { return this.api.post('note-credito', n); }
  updateNotaCredito(n: NotaCredito): Observable<any> { return this.api.put(`note-credito/${n.id}`, n); }
  deleteNotaCredito(id: number): Observable<any> { return this.api.delete(`note-credito/${id}`); }

  // Ordini
  getOrdini(): Observable<Ordine[]> { return this.api.get('ordini'); }
  getOrdiniApertiCount(): Observable<number> { return this.api.get('ordini/count-aperti'); }
  getOrdineById(id: number): Observable<Ordine> { return this.api.get(`ordini/${id}`); }
  createOrdine(o: Ordine): Observable<any> { return this.api.post('ordini', o); }
  updateOrdine(o: Ordine): Observable<any> { return this.api.put(`ordini/${o.id}`, o); }
  deleteOrdine(id: number): Observable<any> { return this.api.delete(`ordini/${id}`); }

  // Preventivi
  getPreventivi(): Observable<Preventivo[]> { return this.api.get('preventivi'); }
  getPreventivoById(id: number): Observable<Preventivo> { return this.api.get(`preventivi/${id}`); }
  createPreventivo(p: Preventivo): Observable<any> { return this.api.post('preventivi', p); }
  updatePreventivo(p: Preventivo): Observable<any> { return this.api.put(`preventivi/${p.id}`, p); }
  deletePreventivo(id: number): Observable<any> { return this.api.delete(`preventivi/${id}`); }

  // Print
  getFatturaPrint(id: number): Observable<any> { return this.api.get(`fatture/${id}/print`); }
  getDdtPrint(id: number): Observable<any> { return this.api.get(`ddt/${id}/print`); }
  getNotaCreditoPrint(id: number): Observable<any> { return this.api.get(`note-credito/${id}/print`); }
  getOrdinePrint(id: number): Observable<any> { return this.api.get(`ordini/${id}/print`); }
  getPreventivoePrint(id: number): Observable<any> { return this.api.get(`preventivi/${id}/print`); }
  getAcquistoPrint(id: number): Observable<any> { return this.api.get(`acquisti/${id}/print`); }

  // Utility
  getNextNumero(tipo: string): Observable<{ numero: number }> { return this.api.get(`next-number/${tipo}`); }
  setDdtStato(id: number, stato: string): Observable<any> { return this.api.patch(`ddt/${id}/stato`, { stato }); }
  setFatturaStato(id: number, stato: string): Observable<any> { return this.api.patch(`fatture/${id}/stato`, { stato }); }
  setNotaCreditoStato(id: number, stato: string): Observable<any> { return this.api.patch(`note-credito/${id}/stato`, { stato }); }
  setOrdineStato(id: number, stato: string): Observable<any> { return this.api.patch(`ordini/${id}/stato`, { stato }); }
  collegaAcquistoOrdine(id: number, acquistoId: number | null): Observable<any> { return this.api.patch(`ordini/${id}/acquisto`, { acquistoId }); }
  setPreventivoStato(id: number, stato: string): Observable<any> { return this.api.patch(`preventivi/${id}/stato`, { stato }); }

  // Pagamenti
  getPagamenti(tipo?: string): Observable<Pagamento[]> {
    return this.api.get(tipo ? `pagamenti?tipo=${tipo}` : 'pagamenti');
  }
  getScadenzario(): Observable<ScadenzarioEntry[]> { return this.api.get('pagamenti/scadenzario'); }
  getScadenzarioFull(mese?: string): Observable<any[]> {
    const q = mese ? `?mese=${mese}` : '';
    return this.api.get(`scadenzario${q}`);
  }
  createPagamento(p: Pagamento): Observable<any> { return this.api.post('pagamenti', p); }
  updatePagamento(p: Pagamento): Observable<any> { return this.api.put(`pagamenti/${p.id}`, p); }
  deletePagamento(id: number): Observable<any> { return this.api.delete(`pagamenti/${id}`); }
  saldaPagamento(id: number): Observable<any> { return this.api.patch(`pagamenti/${id}/salda`, {}); }

  // Tipi Pagamento
  getTipiPagamento(): Observable<TipoPagamento[]> { return this.api.get('tipi-pagamento'); }
  createTipoPagamento(t: TipoPagamento): Observable<any> { return this.api.post('tipi-pagamento', t); }
  updateTipoPagamento(t: TipoPagamento): Observable<any> { return this.api.put(`tipi-pagamento/${t.id}`, t); }
  deleteTipoPagamento(id: number): Observable<any> { return this.api.delete(`tipi-pagamento/${id}`); }

  // Causali pagamento
  getCausali(): Observable<CausalePagamento[]> { return this.api.get('causali'); }
  createCausale(c: CausalePagamento): Observable<any> { return this.api.post('causali', c); }
  updateCausale(c: CausalePagamento): Observable<any> { return this.api.put(`causali/${c.id}`, c); }
  deleteCausale(id: number): Observable<any> { return this.api.delete(`causali/${id}`); }

  // Categorie Prodotto
  getCategorieProdotto(): Observable<CategoriaProdotto[]> { return this.api.get('categorie-prodotto'); }
  createCategoriaProdotto(c: CategoriaProdotto): Observable<any> { return this.api.post('categorie-prodotto', c); }
  updateCategoriaProdotto(c: CategoriaProdotto): Observable<any> { return this.api.put(`categorie-prodotto/${c.id}`, c); }
  deleteCategoriaProdotto(id: number): Observable<any> { return this.api.delete(`categorie-prodotto/${id}`); }

  // Listini personalizzati
  getListini(): Observable<Listino[]> { return this.api.get('listini'); }
  getListino(id: number): Observable<Listino> { return this.api.get(`listini/${id}`); }
  createListino(l: Listino): Observable<any> { return this.api.post('listini', l); }
  updateListino(l: Listino): Observable<any> { return this.api.put(`listini/${l.id}`, l); }
  deleteListino(id: number): Observable<any> { return this.api.delete(`listini/${id}`); }

  getListinoPrezzi(listinoId: number): Observable<ListinoPrezzo[]> {
    return this.api.get(`listini/${listinoId}/prezzi`);
  }
  upsertListinoPrezzo(listinoId: number, p: { prodottoId: number; prezzo?: number | null; sconto?: number | null; datiExtra?: Record<string, string>; stili?: Record<string, ListinoCellaStile> }): Observable<any> {
    return this.api.post(`listini/${listinoId}/prezzi`, p);
  }
  /** Aggiunta massiva di prodotti al listino (quelli già presenti vengono ignorati). */
  bulkAddListinoPrezzi(listinoId: number, prodottoIds: number[], sconto?: number | null): Observable<{ aggiunti: number }> {
    return this.api.post(`listini/${listinoId}/prezzi/bulk`, { prodottoIds, sconto: sconto ?? null });
  }
  /** Ordinamento manuale misto di sezioni e prodotti (sequenza unica). */
  riordinaListino(listinoId: number, items: { tipo: 'sezione' | 'prezzo'; id: number }[]): Observable<any> {
    return this.api.put(`listini/${listinoId}/riordina`, { items });
  }

  getListinoSezioni(listinoId: number): Observable<ListinoSezione[]> {
    return this.api.get(`listini/${listinoId}/sezioni`);
  }
  createListinoSezione(listinoId: number, nome: string): Observable<{ id: number }> {
    return this.api.post(`listini/${listinoId}/sezioni`, { nome });
  }
  updateListinoSezione(listinoId: number, sezioneId: number, nome: string): Observable<any> {
    return this.api.put(`listini/${listinoId}/sezioni/${sezioneId}`, { nome });
  }
  deleteListinoSezione(listinoId: number, sezioneId: number): Observable<any> {
    return this.api.delete(`listini/${listinoId}/sezioni/${sezioneId}`);
  }
  deleteListinoPrezzo(listinoId: number, prezzoId: number): Observable<any> {
    return this.api.delete(`listini/${listinoId}/prezzi/${prezzoId}`);
  }
  resolvePrezzoCliente(clienteId: number, prodottoId: number): Observable<PrezzoRisolto> {
    return this.api.get(`listini/resolve/${clienteId}/${prodottoId}`);
  }

  // Unità di Misura
  getUnitaMisura(): Observable<UnitaMisura[]> { return this.api.get('unita-misura'); }
  createUnitaMisura(u: UnitaMisura): Observable<any> { return this.api.post('unita-misura', u); }
  updateUnitaMisura(u: UnitaMisura): Observable<any> { return this.api.put(`unita-misura/${u.id}`, u); }
  deleteUnitaMisura(id: number): Observable<any> { return this.api.delete(`unita-misura/${id}`); }

  // Aliquote IVA
  getAliquoteIva(): Observable<AliquotaIva[]> { return this.api.get('aliquote-iva'); }
  createAliquotaIva(a: AliquotaIva): Observable<any> { return this.api.post('aliquote-iva', a); }
  updateAliquotaIva(a: AliquotaIva): Observable<any> { return this.api.put(`aliquote-iva/${a.id}`, a); }
  deleteAliquotaIva(id: number): Observable<any> { return this.api.delete(`aliquote-iva/${id}`); }

  // Prezzi recenti per prodotto+cliente
  getPrezziRecenti(prodottoId: number, clienteId?: number | null): Observable<any[]> {
    const params = clienteId ? `prodottoId=${prodottoId}&clienteId=${clienteId}` : `prodottoId=${prodottoId}`;
    return this.api.get(`prezzi-recenti?${params}`);
  }

  // Acquisti
  getAcquisti(): Observable<Acquisto[]> { return this.api.get('acquisti'); }
  getAcquistoById(id: number): Observable<Acquisto> { return this.api.get(`acquisti/${id}`); }
  createAcquisto(a: Acquisto): Observable<any> { return this.api.post('acquisti', a); }
  updateAcquisto(a: Acquisto): Observable<any> { return this.api.put(`acquisti/${a.id}`, a); }
  deleteAcquisto(id: number): Observable<any> { return this.api.delete(`acquisti/${id}`); }
  setAcquistoStato(id: number, stato: string): Observable<any> { return this.api.patch(`acquisti/${id}/stato`, { stato }); }
  getAnalisiMagazzino(acquistoId: number): Observable<any> { return this.api.get(`acquisti/${acquistoId}/analisi-magazzino`); }
  generaArrivoMerce(acquistoId: number, body: any): Observable<any> { return this.api.post(`acquisti/${acquistoId}/genera-arrivo-merce`, body); }

  // SDI — fatture passive (ricezione dal Sistema di Interscambio)
  getSdiRicevute(): Observable<any[]> { return this.api.get('sdi-passive/ricevute'); }
  getSdiProviders(): Observable<any[]> { return this.api.get('sdi-passive/providers'); }
  sdiImportXml(xml: string): Observable<any> { return this.api.post('sdi-passive/import-xml', { xml }); }
  sdiPoll(provider: string, fromDate?: string, toDate?: string): Observable<any> {
    return this.api.post(`sdi-passive/poll/${provider}`, { fromDate, toDate });
  }

  // SDI — stato fatture attive inviate
  updateStatoSdi(id: number, body: { statoSdi: string; dataInvioSdi?: string; idTrasmissioneSdi?: string }): Observable<any> {
    return this.api.patch(`fatture/${id}/stato-sdi`, body);
  }

  // Vendite al banco
  getVenditeBanco(): Observable<VenditaBanco[]> { return this.api.get('vendite-banco'); }
  getVenditaBancoPrint(id: number): Observable<any> { return this.api.get(`vendite-banco/${id}/print`); }
  createVenditaBanco(v: VenditaBanco): Observable<any> { return this.api.post('vendite-banco', v); }
  deleteVenditaBanco(id: number): Observable<any> { return this.api.delete(`vendite-banco/${id}`); }
  getNextNumberVenditaBanco(): Observable<{ numero: number }> { return this.api.get('next-number/vendite-banco'); }
  generaFatturaFromVendita(venditaId: number, clienteId: number): Observable<{ id: number; numero: string }> {
    return this.api.post(`vendite-banco/${venditaId}/genera-fattura`, { clienteId });
  }

  // Arrivi Merce
  getArriviMerce(): Observable<ArrivoMerce[]> { return this.api.get('arrivi-merce'); }
  getArrivoMerceById(id: number): Observable<ArrivoMerce> { return this.api.get(`arrivi-merce/${id}`); }
  createArrivoMerce(a: ArrivoMerce): Observable<any> { return this.api.post('arrivi-merce', a); }
  updateArrivoMerce(a: ArrivoMerce): Observable<any> { return this.api.put(`arrivi-merce/${a.id}`, a); }
  deleteArrivoMerce(id: number): Observable<any> { return this.api.delete(`arrivi-merce/${id}`); }
  setArrivoMerceStato(id: number, stato: string): Observable<any> { return this.api.patch(`arrivi-merce/${id}/stato`, { stato }); }
  importArrivoMerceFromAcquisto(acquistoId: number): Observable<Partial<ArrivoMerce>> {
    return this.api.post(`arrivi-merce/from-acquisto/${acquistoId}`, {});
  }

  // Magazzino
  getMovimentiMagazzino(filters: Record<string, any> = {}): Observable<MovimentoMagazzino[]> {
    const qs = Object.entries(filters)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return this.api.get(`movimenti-magazzino${qs ? '?' + qs : ''}`);
  }
  getMagazzinoStorico(data: string): Observable<GiacenzaStorica[]> {
    return this.api.get(`movimenti-magazzino/storico?data=${data}`);
  }

  // Magazzino avanzato: depositi, giacenze per deposito, trasferimenti, scadenze
  getMagazzini(): Observable<Magazzino[]> { return this.api.get('magazzini'); }
  createMagazzino(m: Partial<Magazzino>): Observable<{ id: number }> { return this.api.post('magazzini', m); }
  updateMagazzino(id: number, m: Partial<Magazzino>): Observable<any> { return this.api.put(`magazzini/${id}`, m); }
  deleteMagazzino(id: number): Observable<any> { return this.api.delete(`magazzini/${id}`); }
  getGiacenze(filters: Record<string, any> = {}): Observable<Giacenza[]> {
    const qs = Object.entries(filters)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return this.api.get(`magazzini/giacenze${qs ? '?' + qs : ''}`);
  }
  getGiacenzeProdotto(prodottoId: number): Observable<Giacenza[]> {
    return this.api.get(`magazzini/giacenze/prodotto/${prodottoId}`);
  }
  trasferimentoMagazzino(payload: any): Observable<any> { return this.api.post('magazzini/trasferimento', payload); }
  getScadenze(giorni = 30): Observable<ScadenzaLotto[]> { return this.api.get(`magazzini/scadenze?giorni=${giorni}`); }

  // Stats / Dashboard
  getVenditeMensili(): Observable<StatsVenditeMensili[]> { return this.api.get('stats/vendite-mensili'); }
  getAcquistiMensili(): Observable<StatsAcquistiMensili[]> { return this.api.get('stats/acquisti-mensili'); }
  getTopProdotti(anno?: number): Observable<StatsTopProdotto[]> {
    return this.api.get(anno ? `stats/top-prodotti?anno=${anno}` : 'stats/top-prodotti');
  }
  getTopClienti(anno?: number): Observable<StatsTopCliente[]> {
    return this.api.get(anno ? `stats/top-clienti?anno=${anno}` : 'stats/top-clienti');
  }
  getCashflow(): Observable<StatsCashflow> { return this.api.get('stats/cashflow'); }
  getCashflowForecast(giorni = 60): Observable<{ giorni: number; saldoFinale: number; totEntrate: number; totUscite: number; items: { date: string; in: number; out: number; cumulativo: number }[] }> {
    return this.api.get(`stats/cashflow-forecast?giorni=${giorni}`);
  }
  getTopProdottiCliente(clienteId: number, limit = 5): Observable<{ id: number; nome: string; codice?: string; prezzo: number; iva: number; unitaMisura?: string; occorrenze: number; quantitaTotale: number; ultimaVendita: string }[]> {
    return this.api.get(`clienti/${clienteId}/top-prodotti?limit=${limit}`);
  }
  validateFatturaXml(id: number): Observable<{ ok: boolean; errors: string[]; warnings: string[]; totaleCalcolato: number }> {
    return this.api.get(`fattura-xml/${id}/validate`);
  }
  getIvaTrimestre(anno: number, trimestre: number): Observable<any> {
    return this.api.get(`stats/iva-trimestre?anno=${anno}&trimestre=${trimestre}`);
  }
  getExportContabile(dataDa: string, dataA: string): Observable<any> {
    return this.api.get(`stats/export-contabile?dataDa=${dataDa}&dataA=${dataA}`);
  }
  getKpiAnno(anno?: number): Observable<StatsKpiAnno> {
    return this.api.get(anno ? `stats/kpi-anno?anno=${anno}` : 'stats/kpi-anno');
  }

  getBiStats(anno?: number): Observable<any> {
    return this.api.get(anno ? `stats/bi?anno=${anno}` : 'stats/bi');
  }
  /** Margini (ricavo - costo) per prodotto e per cliente. */
  getMargini(anno?: number): Observable<any> {
    return this.api.get(anno ? `stats/margini?anno=${anno}` : 'stats/margini');
  }

  // ── Moduli (Livello 2: attivazione moduli per tenant) ────────────────────
  private moduli$: Observable<ModuloDto[]> | null = null;
  getModuli(force = false): Observable<ModuloDto[]> {
    if (force || !this.moduli$) {
      this.moduli$ = this.api.get<ModuloDto[]>('moduli').pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.moduli$;
  }
  invalidateModuli() { this.moduli$ = null; }
  setModulo(slug: string, attivo: boolean): Observable<ModuloDto> {
    return this.api.put<ModuloDto>(`moduli/${slug}`, { attivo });
  }

  // ── Stripe pay link ───────────────────────────────────────────────────────
  getStripeStatus(): Observable<{ configured: boolean; webhookConfigured: boolean; mode: string }> {
    return this.api.get('pay-link/status');
  }
  generaPayLinkFattura(id: number): Observable<{ url: string; paymentLinkId: string; importo: number; currency: string }> {
    return this.api.post(`pay-link/fattura/${id}`, {});
  }

  // ── Agenda ────────────────────────────────────────────────────────────────
  getAgendaImminenti(giorni = 7): Observable<{ da: string; a: string; eventi: any[] }> {
    return this.api.get(`agenda/imminenti?giorni=${giorni}`);
  }
  getAgendaFeedUrl(): Observable<{ httpsUrl: string; webcalUrl: string; tenant: string }> {
    return this.api.get('agenda/feed-url');
  }
  getTodoList(stato?: string): Observable<any[]> {
    return this.api.get(stato ? `agenda/todo?stato=${stato}` : 'agenda/todo');
  }
  setTodoStato(id: number, stato: 'DA_FARE' | 'IN_CORSO' | 'FATTA'): Observable<any> {
    return this.api.put(`agenda/todo/${id}`, { stato });
  }

  // ── Gruppi ────────────────────────────────────────────────────────────────
  listGruppi(): Observable<any[]> { return this.api.get('gruppi'); }
  getGruppo(id: number): Observable<any> { return this.api.get(`gruppi/${id}`); }
  getMyGruppi(): Observable<any[]> { return this.api.get('gruppi/me/mine'); }
  createGruppo(g: { nome: string; descrizione?: string }): Observable<any> {
    return this.api.post('gruppi', g);
  }
  updateGruppo(id: number, g: { nome?: string; descrizione?: string }): Observable<any> {
    return this.api.put(`gruppi/${id}`, g);
  }
  deleteGruppo(id: number): Observable<any> { return this.api.delete(`gruppi/${id}`); }
  setGruppoMembri(id: number, userIds: number[]): Observable<any> {
    return this.api.put(`gruppi/${id}/membri`, { userIds });
  }
  /** Previsione cassa aggregata a 30/60/90 giorni. */
  getCashflow306090(): Observable<{
    saldoOggi: number;
    bucket30: { in: number; out: number; saldo: number };
    bucket60: { in: number; out: number; saldo: number };
    bucket90: { in: number; out: number; saldo: number };
  }> {
    return this.api.get('stats/cashflow-3060-90');
  }
  /** Scarica il file XML della Comunicazione Liquidazione Periodica IVA (LIPE). */
  downloadLipeXml(anno: number, opts: { trimestre?: number; mese?: number }): void {
    const q = opts.mese
      ? `anno=${anno}&mese=${opts.mese}`
      : `anno=${anno}&trimestre=${opts.trimestre || 1}`;
    this.api.getBlob(`stats/lipe-xml?${q}`).subscribe(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = opts.mese ? `LIPE_${anno}_${String(opts.mese).padStart(2,'0')}.xml` : `LIPE_${anno}_T${opts.trimestre}.xml`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    });
  }
  /** Scarica il CSV dell'Esterometro per il periodo. */
  downloadEsterometroCsv(dataDa: string, dataA: string): void {
    this.api.getBlob(`stats/esterometro-csv?dataDa=${dataDa}&dataA=${dataA}`).subscribe(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `Esterometro_${dataDa}_${dataA}.csv`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    });
  }

  // Email
  testSmtp(): Observable<any> { return this.api.post('email/test', {}); }
  sendEmail(to: string, subject: string, html?: string): Observable<any> {
    return this.api.post('email/send', { to, subject, html });
  }

  private emailMode$: Observable<Azienda['emailMode']> | null = null;
  /** Modalità invio (cache breve, evita una GET azienda per ogni invio). */
  getEmailMode(force = false): Observable<Azienda['emailMode']> {
    // Offline: niente SMTP, si usa sempre il client di sistema (mailto:).
    if (environment.offline) return of('MAILTO' as Azienda['emailMode']);
    if (force || !this.emailMode$) {
      this.emailMode$ = this.getAzienda().pipe(
        map(a => {
          const m = a?.emailMode;
          return ['SMTP','MAILTO','WEBMAIL_GMAIL','WEBMAIL_OUTLOOK'].includes(m as string) ? m : 'SMTP';
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.emailMode$;
  }
  /** Invalida la cache della modalità (da chiamare dopo aver salvato in Impostazioni). */
  invalidateEmailMode() { this.emailMode$ = null; }

  /** Apre il composer mail: client di sistema (mailto:) o webmail in un nuovo tab. */
  private openComposer(mode: Azienda['emailMode'], to: string, subject: string, body: string): void {
    const enc = (s: string) => encodeURIComponent(s || '');
    let url: string;
    let target = '_self';
    if (mode === 'WEBMAIL_GMAIL') {
      url = `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;
      target = '_blank';
    } else if (mode === 'WEBMAIL_OUTLOOK') {
      url = `https://outlook.live.com/mail/0/deeplink/compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`;
      target = '_blank';
    } else {
      url = `mailto:${enc(to)}?subject=${enc(subject)}&body=${enc(body)}`;
    }
    const a = document.createElement('a');
    a.href = url;
    a.target = target;
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} }, 0);
  }

  /** Dispatcher: invia un documento via SMTP backend, o apre il composer mail dell'utente. */
  private dispatchSend(tipo: string, id: number, to?: string, note?: string): Observable<any> {
    return this.getEmailMode().pipe(switchMap(mode => {
      if (mode === 'MAILTO' || mode === 'WEBMAIL_GMAIL' || mode === 'WEBMAIL_OUTLOOK') {
        return this.api.post<{ to: string; subject: string; body: string }>(`email/preview/${tipo}/${id}`, { to, note })
          .pipe(map(p => {
            this.openComposer(mode, p.to, p.subject, p.body);
            return { ok: true, mode };
          }));
      }
      const url = tipo.startsWith('sollecito-')
        ? `email/sollecito/${tipo === 'sollecito-fattura' ? 'fattura' : 'acquisto'}/${id}`
        : `email/${tipo}/${id}`;
      return this.api.post(url, { to, note });
    }));
  }

  sendFatturaEmail(id: number, to?: string, note?: string): Observable<any> {
    return this.dispatchSend('fattura', id, to, note);
  }
  sendAcquistoEmail(id: number, to?: string, note?: string): Observable<any> {
    return this.dispatchSend('acquisto', id, to, note);
  }
  sendDdtEmail(id: number, to?: string, note?: string): Observable<any> {
    return this.dispatchSend('ddt', id, to, note);
  }
  sendPreventivoEmail(id: number, to?: string, note?: string): Observable<any> {
    return this.dispatchSend('preventivo', id, to, note);
  }
  sendNotaCreditoEmail(id: number, to?: string, note?: string): Observable<any> {
    return this.dispatchSend('nota-credito', id, to, note);
  }
  sendOrdineEmail(id: number, to?: string, note?: string): Observable<any> {
    return this.dispatchSend('ordine', id, to, note);
  }
  sendSollecito(tipo: 'fattura' | 'acquisto', id: number, to?: string, note?: string): Observable<any> {
    return this.dispatchSend(`sollecito-${tipo}`, id, to, note);
  }
  getSolleciti(tipo: 'fattura' | 'acquisto', id: number): Observable<Sollecito[]> {
    return this.api.get(`email/solleciti/${tipo}/${id}`);
  }

  // Utenti
  getUtenti(): Observable<Utente[]> { return this.api.get('utenti'); }
  createUtente(u: Utente): Observable<any> { return this.api.post('utenti', u); }
  updateUtente(u: Utente): Observable<any> { return this.api.put(`utenti/${u.id}`, u); }
  deleteUtente(id: number): Observable<any> { return this.api.delete(`utenti/${id}`); }
  loginUtente(username: string, password: string): Observable<{ token: string; user: Utente }> {
    return this.api.post('utenti/login', { username, password });
  }

  // Barra comandi intelligente (parser deterministico lato server)
  interpretaComando(q: string): Observable<any> { return this.api.post('comandi', { q }); }

  // Allegati
  getAllegati(tipo: string, id: number): Observable<any[]> { return this.api.get(`allegati?tipo=${tipo}&id=${id}`); }
  deleteAllegato(id: number): Observable<any> { return this.api.delete(`allegati/${id}`); }

  // Fatture Ricorrenti
  getFattureRicorrenti(): Observable<any[]> { return this.api.get('fatture-ricorrenti'); }
  createFatturaRicorrente(f: any): Observable<any> { return this.api.post('fatture-ricorrenti', f); }
  updateFatturaRicorrente(f: any): Observable<any> { return this.api.put(`fatture-ricorrenti/${f.id}`, f); }
  deleteFatturaRicorrente(id: number): Observable<any> { return this.api.delete(`fatture-ricorrenti/${id}`); }
  emettiFatturaRicorrente(id: number): Observable<any> { return this.api.post(`fatture-ricorrenti/${id}/emetti`, {}); }

  // SDI
  inviaFatturaSdi(id: number): Observable<any> { return this.api.post(`fattura-xml/${id}/invia-sdi`, {}); }
  validateNotaXml(id: number): Observable<{ ok: boolean; errors: string[]; warnings: string[]; totaleCalcolato: number }> {
    return this.api.get(`fattura-xml/nota-credito/${id}/validate`);
  }
  inviaNotaSdi(id: number): Observable<any> { return this.api.post(`fattura-xml/nota-credito/${id}/invia-sdi`, {}); }

  // Note Rapide
  // Lavagna post-it (un blob JSON per tenant)
  getLavagna(): Observable<{ note?: any[] }> { return this.api.get('lavagna'); }
  saveLavagna(board: { note: any[] }): Observable<any> { return this.api.put('lavagna', board); }

  getNoteRapide(): Observable<NotaRapida[]> { return this.api.get('note-rapide'); }
  createNotaRapida(n: NotaRapida): Observable<any> { return this.api.post('note-rapide', n); }
  updateNotaRapida(n: NotaRapida): Observable<any> { return this.api.put(`note-rapide/${n.id}`, n); }
  deleteNotaRapida(id: number): Observable<any> { return this.api.delete(`note-rapide/${id}`); }

  // Catena documentale
  preventivoToDdt(id: number): Observable<{ id: number; numero: string }> {
    return this.api.post(`preventivi/${id}/to-ddt`, {});
  }
  preventivoToOrdine(id: number): Observable<{ id: number; numero: string }> {
    return this.api.post(`preventivi/${id}/to-ordine`, {});
  }
  ddtToFattura(id: number): Observable<{ id: number; numero: string }> {
    return this.api.post(`ddt/${id}/to-fattura`, {});
  }
  ordineToDD(id: number): Observable<{ id: number; numero: string }> {
    return this.api.post(`ordini/${id}/to-ddt`, {});
  }

  lookupPiva(piva: string): Observable<{ pIva: string; ragioneSociale: string | null; via: string | null; cap: string | null; citta: string | null; provincia: string | null; stato: string }> {
    return this.api.get(`piva/${piva.replace(/\s/g, '')}`);
  }

  checkPivaDuplicate(piva: string, tipo: 'clienti' | 'fornitori', excludeId?: number): Observable<{ exists: boolean; id?: number }> {
    const params = excludeId != null ? `piva=${piva}&excludeId=${excludeId}` : `piva=${piva}`;
    return this.api.get(`${tipo}/check-piva?${params}`);
  }

  searchAziendaByName(q: string): Observable<any[]> {
    return this.api.get(`piva/search-name?q=${encodeURIComponent(q)}`);
  }

  searchGlobal(q: string): Observable<{ clienti: any[]; fornitori: any[]; prodotti: any[]; fatture: any[]; ddt: any[]; ordini: any[]; preventivi: any[] }> {
    return this.api.get(`search?q=${encodeURIComponent(q)}`);
  }

  // Agenti e provvigioni
  getAgenti(): Observable<Agente[]> { return this.api.get('agenti'); }
  creaAgente(a: Partial<Agente>): Observable<{ id: number }> { return this.api.post('agenti', a); }
  aggiornaAgente(id: number, a: Partial<Agente>): Observable<{ ok: boolean }> { return this.api.put(`agenti/${id}`, a); }
  eliminaAgente(id: number): Observable<{ ok: boolean }> { return this.api.delete(`agenti/${id}`); }
  getProvvigioni(da: string, a: string): Observable<{ agenteId: number; agenteNome: string; base: string; baseTotale: number; provvigioneTotale: number; documenti: any[] }[]> {
    return this.api.get(`agenti/provvigioni?da=${encodeURIComponent(da)}&a=${encodeURIComponent(a)}`);
  }

  // Kit di righe riutilizzabili
  getKit(): Observable<{ id: number; nome: string; righe: any[]; creatoIl?: string }[]> { return this.api.get('kit'); }
  creaKit(nome: string, righe: any[]): Observable<{ id: number; nome: string }> { return this.api.post('kit', { nome, righe }); }
  eliminaKit(id: number): Observable<{ success: boolean }> { return this.api.delete(`kit/${id}`); }

  // Prima Nota
  getPrimaNota(mese?: string): Observable<any> { return this.api.get(`prima-nota${mese ? '?mese=' + mese : ''}`); }
  createPrimaNotaEntry(e: any): Observable<any> { return this.api.post('prima-nota', e); }
  updatePrimaNotaEntry(e: any): Observable<any> { return this.api.put(`prima-nota/${e.id}`, e); }
  deletePrimaNotaEntry(id: number): Observable<any> { return this.api.delete(`prima-nota/${id}`); }

  // Bug Reports
  getBugReports(): Observable<any[]> { return this.api.get('bug-reports'); }
  createBugReport(r: { titolo: string; descrizione: string; pagina?: string; priorita?: string }): Observable<any> { return this.api.post('bug-reports', r); }
  resolveBugReport(id: number): Observable<any> { return this.api.patch(`bug-reports/${id}/risolto`, {}); }
  reopenBugReport(id: number): Observable<any> { return this.api.patch(`bug-reports/${id}/riapri`, {}); }
  deleteBugReport(id: number): Observable<any> { return this.api.delete(`bug-reports/${id}`); }

  // Marketplace (import ordini eBay/Amazon: scarico magazzino + statistiche)
  getMarketplaceConfigs(): Observable<{ canali: MarketplaceCanale[]; amazonDisponibile: boolean }> { return this.api.get('marketplace/configs'); }
  getEbayAuthUrl(): Observable<{ url: string; state: string }> { return this.api.get('marketplace/ebay/auth-url'); }
  exchangeEbayCode(code: string): Observable<{ success: boolean }> { return this.api.post('marketplace/ebay/exchange-code', { code }); }
  syncEbay(): Observable<{ importati: number; daAbbinare: MarketplaceRigaDaAbbinare[] }> { return this.api.post('marketplace/ebay/sync', {}); }
  abbinaEbay(abbinamenti: (MarketplaceRigaDaAbbinare & { prodottoId: number })[]): Observable<{ importati: number }> { return this.api.post('marketplace/ebay/abbina', { abbinamenti }); }
  toggleMarketplace(canale: string): Observable<{ success: boolean }> { return this.api.post(`marketplace/configs/${canale}/toggle`, {}); }
  disconnettiMarketplace(canale: string): Observable<{ success: boolean }> { return this.api.post(`marketplace/configs/${canale}/disconnetti`, {}); }
}
