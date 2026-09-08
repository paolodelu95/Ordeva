import { Component, OnInit, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { DataService } from '../../services/data.service';
import { I18nService } from '../../services/i18n.service';
import { ConfirmService } from '../shared/confirm-dialog';
import { KeychainStato, KeychainEntry, KeychainEntryInput } from '../../models';
import { TPipe } from '../../pipes/t.pipe';

/** Dialog crea/modifica voce. Se `data.entry` è presente, `data.valori` porta password/note già decifrate. */
@Component({
  selector: 'app-keychain-entry-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ (data.entry ? 'portachiavi.entryDialog.modificaTitle' : 'portachiavi.entryDialog.nuovoTitle') | t }}</h2>
    <mat-dialog-content style="min-width:420px;max-width:520px">
      <mat-form-field appearance="outline" style="width:100%"><mat-label>{{ 'portachiavi.entryDialog.titolo' | t }}</mat-label>
        <input matInput [(ngModel)]="titolo" required>
      </mat-form-field>
      <mat-form-field appearance="outline" style="width:100%"><mat-label>{{ 'portachiavi.entryDialog.username' | t }}</mat-label>
        <input matInput [(ngModel)]="username">
      </mat-form-field>
      <mat-form-field appearance="outline" style="width:100%"><mat-label>{{ 'portachiavi.entryDialog.password' | t }}</mat-label>
        <input matInput [type]="mostraPassword ? 'text' : 'password'" [(ngModel)]="password" required>
        <button mat-icon-button matSuffix type="button" (click)="mostraPassword = !mostraPassword">
          <mat-icon>{{ mostraPassword ? 'visibility_off' : 'visibility' }}</mat-icon>
        </button>
      </mat-form-field>
      <div style="display:flex;gap:8px">
        <mat-form-field appearance="outline" style="flex:1"><mat-label>{{ 'portachiavi.entryDialog.url' | t }}</mat-label>
          <input matInput [(ngModel)]="url">
        </mat-form-field>
        <mat-form-field appearance="outline" style="flex:1"><mat-label>{{ 'portachiavi.entryDialog.categoria' | t }}</mat-label>
          <input matInput [(ngModel)]="categoria">
        </mat-form-field>
      </div>
      <mat-form-field appearance="outline" style="width:100%"><mat-label>{{ 'portachiavi.entryDialog.note' | t }}</mat-label>
        <textarea matInput rows="2" [(ngModel)]="note"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" [disabled]="!titolo || !password" (click)="salva()">
        <mat-icon>save</mat-icon> {{ 'fatture.dialog.salva' | t }}
      </button>
    </mat-dialog-actions>`,
})
export class KeychainEntryDialogComponent {
  titolo = ''; username = ''; url = ''; categoria = ''; password = ''; note = '';
  mostraPassword = false;

  constructor(public ref: MatDialogRef<KeychainEntryDialogComponent>,
              @Inject(MAT_DIALOG_DATA) public data: { entry?: KeychainEntry; valori?: { password: string; note?: string | null } }) {
    if (data.entry) {
      this.titolo = data.entry.titolo;
      this.username = data.entry.username || '';
      this.url = data.entry.url || '';
      this.categoria = data.entry.categoria || '';
      this.password = data.valori?.password || '';
      this.note = data.valori?.note || '';
    }
  }

  salva() {
    if (!this.titolo || !this.password) return;
    const result: KeychainEntryInput = {
      titolo: this.titolo, username: this.username, url: this.url,
      categoria: this.categoria, password: this.password, note: this.note,
    };
    this.ref.close(result);
  }
}

/** Dialog master password: `mode: 'imposta'` (prima configurazione) o `'cambia'` (già configurato). */
@Component({
  selector: 'app-keychain-master-password-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ (data.mode === 'imposta' ? 'portachiavi.dialog.impostaTitle' : 'portachiavi.dialog.cambiaTitle') | t }}</h2>
    <mat-dialog-content style="min-width:380px;max-width:440px">
      @if (data.mode === 'imposta') {
        <p style="font-size:12.5px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;line-height:1.4">
          <mat-icon style="vertical-align:middle;font-size:16px;width:16px;height:16px;margin-right:4px">warning_amber</mat-icon>
          {{ 'portachiavi.setup.avviso' | t }}
        </p>
      } @else {
        <mat-form-field appearance="outline" style="width:100%"><mat-label>{{ 'portachiavi.dialog.passwordAttuale' | t }}</mat-label>
          <input matInput type="password" [(ngModel)]="vecchia" required>
        </mat-form-field>
      }
      <mat-form-field appearance="outline" style="width:100%"><mat-label>{{ 'portachiavi.dialog.nuovaPassword' | t }}</mat-label>
        <input matInput type="password" [(ngModel)]="nuova" required>
      </mat-form-field>
      <mat-form-field appearance="outline" style="width:100%"><mat-label>{{ 'portachiavi.dialog.confermaPassword' | t }}</mat-label>
        <input matInput type="password" [(ngModel)]="conferma" required>
      </mat-form-field>
      @if (nuova && nuova.length < 8) {
        <p style="font-size:12px;color:#dc2626">{{ 'portachiavi.dialog.passwordTroppoCorta' | t }}</p>
      } @else if (conferma && nuova !== conferma) {
        <p style="font-size:12px;color:#dc2626">{{ 'portachiavi.dialog.passwordNonCoincidono' | t }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" [disabled]="!valido()" (click)="salva()">
        <mat-icon>save</mat-icon> {{ 'fatture.dialog.salva' | t }}
      </button>
    </mat-dialog-actions>`,
})
export class KeychainMasterPasswordDialogComponent {
  vecchia = ''; nuova = ''; conferma = '';

  constructor(public ref: MatDialogRef<KeychainMasterPasswordDialogComponent>,
              @Inject(MAT_DIALOG_DATA) public data: { mode: 'imposta' | 'cambia' }) {}

  valido(): boolean {
    if (this.nuova.length < 8 || this.nuova !== this.conferma) return false;
    if (this.data.mode === 'cambia' && !this.vecchia) return false;
    return true;
  }

  salva() {
    if (!this.valido()) return;
    this.ref.close(this.data.mode === 'imposta'
      ? { password: this.nuova }
      : { vecchia: this.vecchia, nuova: this.nuova });
  }
}

@Component({
  selector: 'app-portachiavi',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule,
            MatFormFieldModule, MatInputModule, MatDialogModule, MatSnackBarModule, TPipe],
  template: `
    <div class="pc-page">
      <div class="pc-header">
        <h1 class="page-title">{{ 'portachiavi.title' | t }}</h1>
        @if (stato?.configurato) {
          <span class="pc-status" [class.on]="stato?.sbloccato">
            <mat-icon>{{ stato?.sbloccato ? 'lock_open' : 'lock' }}</mat-icon>
            {{ (stato?.sbloccato ? 'portachiavi.sbloccato' : 'portachiavi.bloccato') | t }}
          </span>
        }
        <span class="pc-spacer"></span>
        @if (stato?.configurato) {
          @if (stato?.sbloccato) {
            <button mat-stroked-button (click)="blocca()">
              <mat-icon>lock</mat-icon> {{ 'portachiavi.blocca' | t }}
            </button>
          }
          <button mat-stroked-button (click)="cambiaPassword()">
            <mat-icon>key</mat-icon> {{ 'portachiavi.cambiaPassword' | t }}
          </button>
          <button mat-flat-button color="primary" (click)="nuovaVoce()">
            <mat-icon>add</mat-icon> {{ 'portachiavi.nuovaVoce' | t }}
          </button>
        }
      </div>

      @if (stato && !stato.configurato) {
        <div class="pc-setup">
          <mat-icon>vpn_key</mat-icon>
          <h2>{{ 'portachiavi.setup.titolo' | t }}</h2>
          <p>{{ 'portachiavi.setup.messaggio' | t }}</p>
          <button mat-flat-button color="primary" (click)="impostaPassword()">
            <mat-icon>lock</mat-icon> {{ 'portachiavi.setup.bottone' | t }}
          </button>
        </div>
      } @else if (stato) {
        <div class="pc-toolbar">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" style="width:320px">
            <mat-icon matPrefix style="margin-right:6px;color:#94a3b8">search</mat-icon>
            <input matInput [(ngModel)]="filtro" [placeholder]="'portachiavi.cercaPlaceholder' | t">
          </mat-form-field>
        </div>

        <div class="pc-list">
          @for (e of entriesFiltrate(); track e.id) {
            <div class="pc-row">
              <mat-icon class="pc-row-icon">vpn_key</mat-icon>
              <div class="pc-row-main">
                <div class="pc-row-titolo">
                  {{ e.titolo }}
                  @if (e.categoria) { <span class="pc-badge">{{ e.categoria }}</span> }
                </div>
                <div class="pc-row-sub">
                  {{ e.username || '—' }}
                  @if (e.url) { <span class="pc-row-url"> · {{ e.url }}</span> }
                </div>
              </div>
              <button mat-icon-button [matTooltip]="'portachiavi.copiaPassword' | t" (click)="copiaPassword(e)">
                <mat-icon>content_copy</mat-icon>
              </button>
              <button mat-icon-button [matMenuTriggerFor]="menu">
                <mat-icon>more_vert</mat-icon>
              </button>
              <mat-menu #menu="matMenu">
                <button mat-menu-item (click)="modificaVoce(e)">
                  <mat-icon>edit</mat-icon> {{ 'portachiavi.menu.modifica' | t }}
                </button>
                <button mat-menu-item (click)="eliminaVoce(e)">
                  <mat-icon>delete</mat-icon> {{ 'fatture.dialog.elimina' | t }}
                </button>
              </mat-menu>
            </div>
          }
          @if (!entriesFiltrate().length) {
            <div class="pc-empty">
              <mat-icon>vpn_key</mat-icon>
              <p>{{ 'portachiavi.nessunaVoce' | t }}</p>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .pc-page { padding: 18px; max-width: 900px; margin: 0 auto; }
    .pc-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .pc-header .page-title { margin: 0; }
    .pc-spacer { flex: 1; }
    .pc-status { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700;
      padding: 4px 10px; border-radius: 999px; background: #fef2f2; color: #b91c1c; }
    .pc-status.on { background: #f0fdf4; color: #15803d; }
    .pc-status mat-icon { font-size: 15px; width: 15px; height: 15px; }

    .pc-setup { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
      padding: 60px 20px; color: var(--text-secondary, #475569); }
    .pc-setup mat-icon { font-size: 44px; width: 44px; height: 44px; color: var(--primary, #11769b); opacity: .7; }
    .pc-setup h2 { margin: 0; }
    .pc-setup p { max-width: 420px; margin: 0; font-size: 13.5px; }

    .pc-toolbar { margin-bottom: 10px; }

    .pc-list { display: flex; flex-direction: column; gap: 6px; }
    .pc-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
      border: 1px solid var(--border-subtle, #e2e8f0); border-radius: 10px; background: var(--bg-surface, #fff); }
    .pc-row-icon { color: #94a3b8; }
    .pc-row-main { flex: 1; min-width: 0; }
    .pc-row-titolo { font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 8px; }
    .pc-row-sub { font-size: 12px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pc-badge { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em;
      background: #f1f5f9; color: #64748b; border-radius: 999px; padding: 2px 8px; }

    .pc-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 50px 20px; color: #94a3b8; }
    .pc-empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
  `],
})
export class PortachiaviComponent implements OnInit {
  private ds = inject(DataService);
  private i18n = inject(I18nService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private confirm = inject(ConfirmService);

  stato: KeychainStato | null = null;
  entries: KeychainEntry[] = [];
  filtro = '';

  ngOnInit() {
    this.caricaStato();
    this.caricaEntries();
  }

  private caricaStato() {
    this.ds.getKeychainStato().subscribe(s => this.stato = s);
  }

  private caricaEntries() {
    this.ds.getKeychainEntries().subscribe(e => this.entries = e);
  }

  entriesFiltrate(): KeychainEntry[] {
    const f = this.filtro.trim().toLowerCase();
    if (!f) return this.entries;
    return this.entries.filter(e =>
      e.titolo.toLowerCase().includes(f) ||
      (e.username || '').toLowerCase().includes(f) ||
      (e.categoria || '').toLowerCase().includes(f));
  }

  /** Garantisce la sessione sbloccata, chiedendo la master password se serve. */
  private async assicuraSbloccato(): Promise<boolean> {
    if (this.stato?.sbloccato) return true;
    const pw = await this.confirm.prompt({
      message: this.i18n.t('portachiavi.inserisciMasterPasswordMsg'),
      label: this.i18n.t('portachiavi.masterPassword'),
      confirmText: this.i18n.t('portachiavi.sblocca'),
      password: true,
    });
    if (!pw) return false;
    try {
      await firstValueFrom(this.ds.sbloccaKeychain(pw));
      this.stato = { ...(this.stato as KeychainStato), sbloccato: true };
      return true;
    } catch {
      this.snack.open(this.i18n.t('portachiavi.passwordErrata'), '', { duration: 3000 });
      return false;
    }
  }

  impostaPassword() {
    this.dialog.open(KeychainMasterPasswordDialogComponent, { data: { mode: 'imposta' } })
      .afterClosed().subscribe((r?: { password: string }) => {
        if (!r) return;
        this.ds.impostaKeychainPassword(r.password).subscribe({
          next: s => this.stato = s,
          error: e => this.snack.open(this.i18n.t('portachiavi.msg.errore', { msg: e.error?.error || e.message }), 'OK', { duration: 4000 }),
        });
      });
  }

  blocca() {
    this.ds.bloccaKeychain().subscribe(() => this.stato = { ...(this.stato as KeychainStato), sbloccato: false });
  }

  cambiaPassword() {
    this.dialog.open(KeychainMasterPasswordDialogComponent, { data: { mode: 'cambia' } })
      .afterClosed().subscribe((r?: { vecchia: string; nuova: string }) => {
        if (!r) return;
        this.ds.cambiaKeychainPassword(r.vecchia, r.nuova).subscribe({
          next: () => this.snack.open(this.i18n.t('portachiavi.passwordCambiata'), '', { duration: 2500 }),
          error: e => this.snack.open(this.i18n.t('portachiavi.msg.errore', { msg: e.error?.error || e.message }), 'OK', { duration: 4000 }),
        });
      });
  }

  async nuovaVoce() {
    if (!await this.assicuraSbloccato()) return;
    this.dialog.open(KeychainEntryDialogComponent, { data: {} })
      .afterClosed().subscribe((r?: KeychainEntryInput) => {
        if (!r) return;
        this.ds.createKeychainEntry(r).subscribe({
          next: () => this.caricaEntries(),
          error: e => this.snack.open(this.i18n.t('portachiavi.msg.errore', { msg: e.error?.error || e.message }), 'OK', { duration: 4000 }),
        });
      });
  }

  async modificaVoce(e: KeychainEntry) {
    if (!await this.assicuraSbloccato()) return;
    this.ds.rivelaKeychainEntry(e.id).subscribe({
      next: valori => {
        this.dialog.open(KeychainEntryDialogComponent, { data: { entry: e, valori } })
          .afterClosed().subscribe((r?: KeychainEntryInput) => {
            if (!r) return;
            this.ds.updateKeychainEntry(e.id, r).subscribe({
              next: () => this.caricaEntries(),
              error: err => this.snack.open(this.i18n.t('portachiavi.msg.errore', { msg: err.error?.error || err.message }), 'OK', { duration: 4000 }),
            });
          });
      },
      error: err => this.snack.open(this.i18n.t('portachiavi.msg.errore', { msg: err.error?.error || err.message }), 'OK', { duration: 4000 }),
    });
  }

  async eliminaVoce(e: KeychainEntry) {
    if (!await this.confirm.delete(this.i18n.t('portachiavi.confermaElimina', { titolo: e.titolo }))) return;
    this.ds.deleteKeychainEntry(e.id).subscribe(() => this.caricaEntries());
  }

  async copiaPassword(e: KeychainEntry) {
    if (!await this.assicuraSbloccato()) return;
    this.ds.rivelaKeychainEntry(e.id).subscribe({
      next: async v => {
        await navigator.clipboard.writeText(v.password);
        this.snack.open(this.i18n.t('portachiavi.passwordCopiata'), '', { duration: 2000 });
      },
      error: err => this.snack.open(this.i18n.t('portachiavi.msg.errore', { msg: err.error?.error || err.message }), 'OK', { duration: 4000 }),
    });
  }
}
