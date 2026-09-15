import { Component, ElementRef, OnDestroy, ViewChild, AfterViewInit, Inject, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DataService } from '../../services/data.service';
import { Prodotto, ProdottoVariante } from '../../models';
import { findProdottoByCodice } from '../../utils/prodotto-match';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

declare const BarcodeDetector: any;

interface ConteggioRiga {
  key: string;
  prodottoId: number;
  varianteId: number | null;
  codice: string;
  variante: string;
  giacenza: number;
  contato: number;
  um: string;
}

// ── Inventario a scansione ────────────────────────────────────────────────────
// Apri la fotocamera, scansiona gli articoli (ogni lettura = +1 al contato, sempre
// modificabile a mano) e applica i conteggi in blocco. Inventario PARZIALE e NON
// distruttivo: vengono rettificati solo gli articoli effettivamente contati, gli
// altri restano invariati.
@Component({
  selector: 'app-inventario-scan',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatTooltipModule, MatSnackBarModule, TPipe,
  ],
  template: `
    <div class="inv-head">
      <h2>{{ 'magazzino.inventarioScansione' | t }}</h2>
      <button mat-icon-button (click)="chiudi()" [attr.aria-label]="'magazzino.inventarioScan.chiudiAria' | t"><mat-icon>close</mat-icon></button>
    </div>

    <div class="inv-body">
      <!-- Camera -->
      <div class="inv-cam">
        @if (errorMsg) {
          <div class="inv-cam-err">
            <mat-icon>photo_camera</mat-icon>
            <p>{{ errorMsg }}</p>
            <small>{{ 'magazzino.inventarioScan.puoiContareAMano' | t }}</small>
          </div>
        } @else {
          <video #video class="inv-video" playsinline muted autoplay></video>
          <div class="inv-overlay">
            <div class="inv-frame" [class.paused]="paused"></div>
            <p class="inv-hint">{{ (paused ? 'magazzino.inventarioScan.scansionePausa' : 'magazzino.inventarioScan.inquadraBarcode') | t }}</p>
          </div>
          <button mat-mini-fab class="inv-pause" (click)="paused = !paused"
                  [matTooltip]="(paused ? 'magazzino.inventarioScan.riprendi' : 'magazzino.inventarioScan.pausa') | t">
            <mat-icon>{{ paused ? 'play_arrow' : 'pause' }}</mat-icon>
          </button>
        }
      </div>

      <!-- Inserimento manuale (articoli senza barcode o etichetta rovinata) -->
      <mat-form-field appearance="outline" class="inv-manual">
        <mat-label>{{ 'magazzino.inventarioScan.codiceManuale' | t }}</mat-label>
        <input matInput [(ngModel)]="codiceManuale" (keyup.enter)="aggiungiManuale()"
               [placeholder]="'magazzino.inventarioScan.digitaPremiInvio' | t">
        <button matSuffix mat-icon-button (click)="aggiungiManuale()" [disabled]="!codiceManuale.trim()">
          <mat-icon>add</mat-icon>
        </button>
      </mat-form-field>

      <!-- Lista conteggio -->
      @if (righe.length) {
        <div class="inv-list">
          @for (r of righe; track r.key) {
            <div class="inv-row" [class.flash]="r.key === lastAddedKey">
              <div class="inv-row-main">
                <span class="inv-nome">{{ r.codice }}</span>
                @if (r.variante) { <span class="inv-var">{{ r.variante }}</span> }
                <span class="inv-giac">{{ 'magazzino.inventarioScan.era' | t }} {{ r.giacenza }}{{ r.um ? ' ' + r.um : '' }}</span>
              </div>
              <div class="inv-row-qty">
                <button mat-icon-button (click)="dec(r)" [disabled]="r.contato <= 0"><mat-icon>remove</mat-icon></button>
                <input type="number" step="0.001" min="0" [(ngModel)]="r.contato">
                <button mat-icon-button (click)="r.contato = (+r.contato || 0) + 1"><mat-icon>add</mat-icon></button>
              </div>
              <span class="inv-delta" [class.up]="delta(r) > 0" [class.down]="delta(r) < 0">
                {{ delta(r) > 0 ? '+' : '' }}{{ delta(r) }}
              </span>
              <button mat-icon-button class="inv-del" (click)="rimuovi(r)" [matTooltip]="'magazzino.inventarioScan.rimuovi' | t"><mat-icon>delete_outline</mat-icon></button>
            </div>
          }
        </div>
      } @else {
        <div class="inv-empty">
          <mat-icon>qr_code_scanner</mat-icon>
          <p>{{ 'magazzino.inventarioScan.scansionaPrimo' | t }}</p>
        </div>
      }
    </div>

    <div class="inv-foot">
      <div class="inv-summary">
        <span><b>{{ righe.length }}</b> {{ 'magazzino.inventarioScan.articoli' | t }}</span>
        <span><b>{{ totalePezzi }}</b> {{ 'magazzino.inventarioScan.pezziContati' | t }}</span>
      </div>
      <div class="inv-foot-actions">
        <button mat-button (click)="chiudi()">{{ 'fatture.dialog.annulla' | t }}</button>
        <button mat-flat-button color="primary" (click)="applica()" [disabled]="!righe.length || salvando">
          <mat-icon>inventory</mat-icon>
          {{ (salvando ? 'magazzino.inventarioScan.salvataggioInCorso' : 'magazzino.inventarioScan.applicaInventario') | t }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; max-height: 100%; background: var(--bg-surface); }
    .inv-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border-subtle); }
    .inv-head h2 { margin: 0; font-size: 17px; }
    .inv-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
    .inv-cam { position: relative; background: #000; border-radius: 12px; overflow: hidden; margin-bottom: 12px; }
    .inv-video { width: 100%; max-height: 38vh; display: block; object-fit: cover; background: #000; }
    .inv-overlay { position: absolute; inset: 0; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .inv-frame { width: 72%; height: 96px; border: 3px solid #15a4a2; border-radius: 10px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.4); transition: border-color .2s; }
    .inv-frame.paused { border-color: #94a3b8; }
    .inv-hint { color: #fff; font-size: 12px; margin-top: 12px; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
    .inv-pause { position: absolute; right: 12px; bottom: 12px; }
    .inv-cam-err { padding: 28px 20px; text-align: center; color: var(--text-secondary); }
    .inv-cam-err mat-icon { font-size: 40px; width: 40px; height: 40px; color: #f59e0b; }
    .inv-cam-err p { margin: 10px 0 4px; font-size: 14px; }
    .inv-cam-err small { font-size: 12px; color: var(--text-tertiary); }
    .inv-manual { width: 100%; }
    .inv-list { display: flex; flex-direction: column; gap: 6px; }
    .inv-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--bg-surface); transition: background .4s; }
    .inv-row.flash { background: var(--success-soft, #dcfce7); }
    .inv-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .inv-nome { font-size: 14px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .inv-var { font-size: 12px; color: var(--text-secondary); }
    .inv-giac { font-size: 11px; color: var(--text-tertiary); }
    .inv-row-qty { display: flex; align-items: center; gap: 2px; }
    .inv-row-qty input { width: 64px; text-align: center; border: 1px solid var(--border-strong); border-radius: 8px; padding: 6px; font-size: 14px; background: var(--bg-surface); color: var(--text-primary); }
    .inv-delta { min-width: 42px; text-align: right; font-size: 13px; font-weight: 700; color: var(--text-tertiary); }
    .inv-delta.up { color: #15803d; }
    .inv-delta.down { color: #dc2626; }
    .inv-del { color: var(--text-tertiary); }
    .inv-empty { text-align: center; padding: 32px 16px; color: var(--text-tertiary); }
    .inv-empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .inv-foot { border-top: 1px solid var(--border-subtle); padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .inv-summary { display: flex; gap: 16px; font-size: 13px; color: var(--text-secondary); }
    .inv-summary b { color: var(--text-primary); }
    .inv-foot-actions { display: flex; gap: 8px; }
  `]
})
export class InventarioScanComponent implements AfterViewInit, OnDestroy {
  i18n = inject(I18nService);
  @ViewChild('video') videoRef?: ElementRef<HTMLVideoElement>;
  errorMsg = '';
  paused = false;
  salvando = false;
  codiceManuale = '';
  righe: ConteggioRiga[] = [];
  lastAddedKey = '';

  private stream?: MediaStream;
  private detector: any = null;
  private rafId: number | null = null;
  private stopped = false;
  private lastCode = '';
  private lastCodeAt = 0;
  private audioCtx?: AudioContext;

  constructor(
    private dialogRef: MatDialogRef<InventarioScanComponent, { applied: number; movimenti: number } | null>,
    @Inject(MAT_DIALOG_DATA) public data: { prodotti: Prodotto[] },
    private ds: DataService,
    private snack: MatSnackBar,
    private zone: NgZone,
  ) {}

  get totalePezzi(): number { return this.righe.reduce((s, r) => s + (+r.contato || 0), 0); }
  delta(r: ConteggioRiga): number { return Math.round(((+r.contato || 0) - r.giacenza) * 1000) / 1000; }

  async ngAfterViewInit() {
    if (typeof BarcodeDetector === 'undefined') {
      this.errorMsg = this.i18n.t('magazzino.inventarioScan.browserNonSupportato');
      return;
    }
    try {
      this.detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'] });
    } catch {
      this.errorMsg = this.i18n.t('magazzino.inventarioScan.msgFormatoNonSupportato');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e: any) {
      this.errorMsg = this.i18n.t('magazzino.inventarioScan.msgPermessoNegato', { err: e?.name || 'errore' });
      return;
    }
    if (this.videoRef && !this.stopped) {
      this.videoRef.nativeElement.srcObject = this.stream;
      try { await this.videoRef.nativeElement.play(); } catch {}
      this.zone.runOutsideAngular(() => this.scanLoop());
    }
  }

  private async scanLoop() {
    if (this.stopped || !this.videoRef?.nativeElement || !this.detector) return;
    if (!this.paused) {
      try {
        const codes = await this.detector.detect(this.videoRef.nativeElement);
        if (codes?.length) {
          const code = (codes[0].rawValue || '').toString();
          const now = Date.now();
          // Anti-doppione: ignora lo stesso codice riletto entro 1.2s.
          if (code && !(code === this.lastCode && now - this.lastCodeAt < 1200)) {
            this.lastCode = code;
            this.lastCodeAt = now;
            this.zone.run(() => this.onScan(code));
          }
        }
      } catch {}
    }
    this.rafId = requestAnimationFrame(() => this.scanLoop());
  }

  private onScan(code: string) {
    this.ds.searchByBarcode(code).subscribe({
      next: res => this.aggiungi(res.prodotto, res.variante, true),
      error: () => this.snack.open(this.i18n.t('magazzino.inventarioScan.msgBarcodeNonAssociato', { code }), 'OK', { duration: 2500 }),
    });
  }

  aggiungiManuale() {
    const q = this.codiceManuale.trim();
    if (!q) return;
    // Prima prova come barcode (gestisce anche le varianti), poi ripiega sul
    // match per codice/descrizione nell'elenco prodotti già in memoria.
    this.ds.searchByBarcode(q).subscribe({
      next: res => { this.aggiungi(res.prodotto, res.variante, false); this.codiceManuale = ''; },
      error: () => {
        const m = findProdottoByCodice(this.data.prodotti || [], q);
        const p = m.exact || (m.matches.length === 1 ? m.matches[0] : null);
        if (p) { this.aggiungi(p, null, false); this.codiceManuale = ''; }
        else this.snack.open(this.i18n.t('magazzino.inventarioScan.msgNessunProdottoTrovato', { q }), 'OK', { duration: 2500 });
      },
    });
  }

  private aggiungi(prodotto: Prodotto, variante: ProdottoVariante | null, feedback: boolean) {
    if (!prodotto?.id) return;
    const key = prodotto.id + ':' + (variante?.id ?? '');
    const esistente = this.righe.find(r => r.key === key);
    if (esistente) {
      esistente.contato = (+esistente.contato || 0) + 1;
    } else {
      this.righe.unshift({
        key,
        prodottoId: prodotto.id,
        varianteId: variante?.id ?? null,
        codice: prodotto.codice,
        variante: variante ? [variante.taglia, variante.colore].filter(Boolean).join(' / ') : '',
        giacenza: (variante ? variante.quantita : prodotto.quantita) ?? 0,
        contato: 1,
        um: prodotto.unitaMisura || '',
      });
    }
    this.lastAddedKey = key;
    if (feedback) { this.beep(); try { navigator.vibrate?.(60); } catch {} }
  }

  dec(r: ConteggioRiga) { r.contato = Math.max(0, (+r.contato || 0) - 1); }
  rimuovi(r: ConteggioRiga) { this.righe = this.righe.filter(x => x.key !== r.key); }

  applica() {
    // Salta le righe senza un conteggio valido (campo svuotato → null): inventario
    // non distruttivo, non azzeriamo una giacenza per una riga lasciata in bianco.
    const items = this.righe
      .filter(r => r.contato != null && (r.contato as any) !== '' && Number.isFinite(+r.contato))
      .map(r => ({ prodottoId: r.prodottoId, varianteId: r.varianteId, quantita: +r.contato }));
    if (!items.length) { this.snack.open(this.i18n.t('magazzino.inventarioScan.msgNessunConteggioValido'), '', { duration: 2500 }); return; }
    this.salvando = true;
    const note = 'Inventario ' + new Date().toLocaleDateString('it-IT');
    this.ds.rettificaBulk(items, note).subscribe({
      next: r => { this.salvando = false; this.dialogRef.close({ applied: r.applied, movimenti: r.movimenti }); },
      error: e => { this.salvando = false; this.snack.open(e.error?.error || this.i18n.t('magazzino.inventarioScan.msgErroreSalvataggio'), 'OK', { duration: 3500 }); },
    });
  }

  chiudi() { this.dialogRef.close(null); }

  private beep() {
    try {
      this.audioCtx = this.audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {}
  }

  ngOnDestroy() {
    this.stopped = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach(t => t.stop());
    try { this.audioCtx?.close(); } catch {}
  }
}
