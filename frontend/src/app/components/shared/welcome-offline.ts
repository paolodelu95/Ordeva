import { Component, OnInit, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { DataService } from '../../services/data.service';
import { DesktopService } from '../../services/desktop.service';
import { Azienda } from '../../models';
import { environment } from '../../../environments/environment';
import { I18nService, Lang, LANGS } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

/**
 * Schermata di benvenuto al PRIMO AVVIO dell'edizione offline desktop.
 * Compare a tutto schermo finché l'app è "vergine" (nessuna azienda configurata
 * e nessun dato), e propone due strade:
 *   1. inserire i dati della propria azienda per iniziare a lavorare;
 *   2. caricare dei dati demo per provare subito il gestionale.
 *
 * Stato persistito in localStorage: ordeva_offline_setup_done=1 (non si ripresenta).
 */
@Component({
  selector: 'app-welcome-offline',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatIconModule, MatButtonModule,
    MatInputModule, MatFormFieldModule, MatProgressSpinnerModule, MatCheckboxModule,
    TPipe,
  ],
  template: `
    @if (visible) {
      <div class="wel-overlay">
        <div class="wel-card">
          <div class="wel-brand"><span class="wel-logo">O</span> {{ 'welcome.brand' | t }}</div>

          @if (step === 'lang') {
            <h1 class="wel-title">{{ 'welcome.lang.title' | t }}</h1>
            <p class="wel-sub">{{ 'welcome.lang.sub' | t }}</p>
            <div class="wel-langs">
              @for (l of langs; track l) {
                <button type="button" class="wel-lang" [class.selected]="selectedLang === l" (click)="selectedLang = l">
                  {{ i18n.t('lang.' + l) }}
                </button>
              }
            </div>
            <div class="wel-actions">
              <button mat-flat-button color="primary" type="button" (click)="continueLang()">
                {{ 'welcome.lang.continue' | t }}
              </button>
            </div>
          }

          @else if (step === 'choice') {
            <h1 class="wel-title">{{ 'welcome.choice.title' | t }}</h1>
            <p class="wel-sub">{{ 'welcome.choice.sub' | t }}</p>

            <div class="wel-choices">
              <button class="wel-choice" type="button" (click)="step = 'form'">
                <span class="wel-choice-ic"><mat-icon>business</mat-icon></span>
                <span class="wel-choice-h">{{ 'welcome.choice.azienda.h' | t }}</span>
                <span class="wel-choice-t">{{ 'welcome.choice.azienda.t' | t }}</span>
              </button>
              <button class="wel-choice" type="button" [disabled]="loading" (click)="caricaDemo()">
                <span class="wel-choice-ic demo"><mat-icon>science</mat-icon></span>
                <span class="wel-choice-h">{{ 'welcome.choice.demo.h' | t }}</span>
                <span class="wel-choice-t">{{ 'welcome.choice.demo.t' | t }}</span>
              </button>
              <button class="wel-choice" type="button" (click)="step = 'restore'">
                <span class="wel-choice-ic restore"><mat-icon>settings_backup_restore</mat-icon></span>
                <span class="wel-choice-h">{{ 'welcome.choice.restore.h' | t }}</span>
                <span class="wel-choice-t">{{ 'welcome.choice.restore.t' | t }}</span>
              </button>
            </div>
            @if (errore) { <div class="wel-err">{{ errore }}</div> }
          }

          @else if (step === 'restore') {
            <h1 class="wel-title">{{ 'welcome.restore.title' | t }}</h1>
            <p class="wel-sub">{{ 'welcome.restore.sub' | t }}</p>
            <div class="wel-form">
              <div class="wel-folder">
                <button mat-stroked-button type="button" (click)="scegliFileRipristino()">
                  <mat-icon>upload_file</mat-icon> {{ 'welcome.restore.scegliFile' | t }}
                </button>
                @if (restoreFile) { <span class="wel-folder-path" [title]="restoreFile">{{ restoreFileName }}</span> }
                @else { <span class="wel-folder-empty">{{ 'welcome.restore.nessunFile' | t }}</span> }
              </div>
              @if (restoreEncrypted) {
                <mat-form-field appearance="outline" class="full">
                  <mat-label>{{ 'welcome.restore.passwordLabel' | t }}</mat-label>
                  <input matInput [(ngModel)]="restorePwd" type="password" autocomplete="off" />
                </mat-form-field>
              }
            </div>
            @if (errore) { <div class="wel-err">{{ errore }}</div> }
            <div class="wel-actions">
              <button mat-button type="button" [disabled]="loading" (click)="step = 'choice'">{{ 'welcome.indietro' | t }}</button>
              <button mat-flat-button color="primary" type="button" [disabled]="loading || !restoreFile" (click)="ripristina()">
                @if (loading) { <mat-spinner diameter="18"></mat-spinner> } @else { {{ 'welcome.restore.button' | t }} }
              </button>
            </div>
          }

          @else if (step === 'password') {
            <h1 class="wel-title">{{ 'welcome.password.title' | t }}</h1>
            <p class="wel-sub">
              {{ 'welcome.password.subPart1' | t }} <b>{{ 'welcome.password.opzionale' | t }}</b> {{ 'welcome.password.subPart2' | t }}
            </p>
            <div class="wel-form">
              <mat-form-field appearance="outline" class="full">
                <mat-label>{{ 'welcome.password.pwd1Label' | t }}</mat-label>
                <input matInput [(ngModel)]="pwd1" type="password" autocomplete="new-password" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="full">
                <mat-label>{{ 'welcome.password.pwd2Label' | t }}</mat-label>
                <input matInput [(ngModel)]="pwd2" type="password" autocomplete="new-password" />
              </mat-form-field>
            </div>
            @if (errore) { <div class="wel-err">{{ errore }}</div> }
            <div class="wel-actions">
              <button mat-button type="button" [disabled]="loading" (click)="vaiBackup()">{{ 'welcome.salta' | t }}</button>
              <button mat-flat-button color="primary" type="button" [disabled]="loading || !pwd1" (click)="impostaPassword()">
                @if (loading) { <mat-spinner diameter="18"></mat-spinner> } @else { {{ 'welcome.password.button' | t }} }
              </button>
            </div>
          }

          @else if (step === 'backup') {
            <h1 class="wel-title">{{ 'welcome.backup.title' | t }}</h1>
            <p class="wel-sub">
              {{ 'welcome.backup.subPart1' | t }} <b>{{ 'welcome.backup.googleDrive' | t }}</b> {{ 'welcome.backup.o' | t }} <b>{{ 'welcome.backup.dropbox' | t }}</b>{{ 'welcome.backup.subPart2' | t }}
            </p>
            <div class="wel-form">
              <div class="wel-folder">
                <button mat-stroked-button type="button" (click)="scegliCartella()">
                  <mat-icon>folder_open</mat-icon> {{ 'welcome.backup.scegliCartella' | t }}
                </button>
                @if (backupDir) { <span class="wel-folder-path" [title]="backupDir">{{ backupDir }}</span> }
                @else { <span class="wel-folder-empty">{{ 'welcome.backup.nessunaCartella' | t }}</span> }
              </div>
              @if (hadPassword) {
                <mat-checkbox [(ngModel)]="backupEncrypt" name="bkEnc">{{ 'welcome.backup.cifraCheckbox' | t }}</mat-checkbox>
              } @else {
                <p class="wel-note">{{ 'welcome.backup.noteNoPassword' | t }}</p>
              }
            </div>
            @if (errore) { <div class="wel-err">{{ errore }}</div> }
            <div class="wel-actions">
              <button mat-button type="button" [disabled]="loading" (click)="completa()">{{ 'welcome.salta' | t }}</button>
              <button mat-flat-button color="primary" type="button" [disabled]="loading || !backupDir" (click)="attivaBackup()">
                @if (loading) { <mat-spinner diameter="18"></mat-spinner> } @else { {{ 'welcome.backup.button' | t }} }
              </button>
            </div>
          }

          @else {
            <h1 class="wel-title">{{ 'welcome.form.title' | t }}</h1>
            <p class="wel-sub">{{ 'welcome.form.sub' | t }}</p>

            <div class="wel-form">
              <mat-form-field appearance="outline" class="full">
                <mat-label>{{ 'welcome.form.ragioneSociale' | t }}</mat-label>
                <input matInput [(ngModel)]="az.ragioneSociale" autocomplete="organization" />
              </mat-form-field>
              <div class="wel-row">
                <mat-form-field appearance="outline">
                  <mat-label>{{ 'welcome.form.partitaIva' | t }}</mat-label>
                  <input matInput [(ngModel)]="az.pIva" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>{{ 'welcome.form.codiceFiscale' | t }}</mat-label>
                  <input matInput [(ngModel)]="az.codFiscale" />
                </mat-form-field>
              </div>
              <mat-form-field appearance="outline" class="full">
                <mat-label>{{ 'welcome.form.indirizzo' | t }}</mat-label>
                <input matInput [(ngModel)]="az.indirizzo" autocomplete="street-address" />
              </mat-form-field>
              <div class="wel-row">
                <mat-form-field appearance="outline" class="cap">
                  <mat-label>{{ 'welcome.form.cap' | t }}</mat-label>
                  <input matInput [(ngModel)]="az.cap" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>{{ 'welcome.form.citta' | t }}</mat-label>
                  <input matInput [(ngModel)]="az.citta" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="prov">
                  <mat-label>{{ 'welcome.form.prov' | t }}</mat-label>
                  <input matInput [(ngModel)]="az.provincia" maxlength="2" />
                </mat-form-field>
              </div>
              <div class="wel-row">
                <mat-form-field appearance="outline">
                  <mat-label>{{ 'welcome.form.email' | t }}</mat-label>
                  <input matInput [(ngModel)]="az.email" type="email" autocomplete="email" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>{{ 'welcome.form.telefono' | t }}</mat-label>
                  <input matInput [(ngModel)]="az.telefono" autocomplete="tel" />
                </mat-form-field>
              </div>
            </div>

            @if (errore) { <div class="wel-err">{{ errore }}</div> }

            <div class="wel-actions">
              <button mat-button type="button" [disabled]="loading" (click)="step = 'choice'">{{ 'welcome.indietro' | t }}</button>
              <button mat-flat-button color="primary" type="button" [disabled]="loading || !az.ragioneSociale?.trim()" (click)="salvaAzienda()">
                @if (loading) { <mat-spinner diameter="18"></mat-spinner> } @else { {{ 'welcome.form.button' | t }} }
              </button>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .wel-overlay {
      position: fixed; inset: 0; z-index: 1000;
      display: flex; align-items: center; justify-content: center; padding: 20px;
      background: linear-gradient(135deg, #0e2a38 0%, #11769b 100%);
      overflow: auto;
    }
    .wel-card {
      background: #fff; border-radius: 18px; box-shadow: 0 24px 64px rgba(0,0,0,0.28);
      padding: 34px 36px; width: 100%; max-width: 560px;
    }
    .wel-brand { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 800; color: #0f172a; margin-bottom: 18px; }
    .wel-logo {
      width: 30px; height: 30px; border-radius: 8px; color: #fff; font-weight: 800;
      display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #11769b, #15a4a2);
    }
    .wel-title { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0 0 6px; letter-spacing: -0.02em; }
    .wel-sub { font-size: 14px; color: #64748b; margin: 0 0 22px; }
    .wel-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .wel-choice {
      display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: left;
      padding: 18px; border-radius: 14px; cursor: pointer;
      background: #fafbfd; border: 1.5px solid #eef0f4; transition: border-color .12s, transform .12s, box-shadow .12s;
    }
    .wel-choice:hover:not([disabled]) { border-color: #11769b; transform: translateY(-2px); box-shadow: 0 10px 24px rgba(17,118,155,0.12); }
    .wel-choice[disabled] { opacity: .6; cursor: default; }
    .wel-choice-ic {
      width: 42px; height: 42px; border-radius: 10px; margin-bottom: 4px;
      display: flex; align-items: center; justify-content: center; color: #fff;
      background: linear-gradient(135deg, #11769b, #15a4a2);
    }
    .wel-choice-ic.demo { background: linear-gradient(135deg, #7c3aed, #6d28d9); }
    .wel-choice-ic.restore { background: linear-gradient(135deg, #0891b2, #0e7490); }
    .wel-choice-h { font-size: 15px; font-weight: 700; color: #0f172a; }
    .wel-choice-t { font-size: 12.5px; color: #64748b; line-height: 1.4; }
    .wel-form { display: flex; flex-direction: column; gap: 2px; }
    .wel-form .full { width: 100%; }
    .wel-row { display: flex; gap: 12px; }
    .wel-row mat-form-field { flex: 1; }
    .wel-row .cap { max-width: 110px; }
    .wel-row .prov { max-width: 88px; }
    .wel-folder { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
    .wel-folder-path { font-size: 12.5px; color: #0f172a; word-break: break-all; max-width: 100%; }
    .wel-folder-empty { font-size: 12.5px; color: #94a3b8; }
    .wel-note { font-size: 12.5px; color: #64748b; margin: 2px 0 0; }
    .wel-langs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 6px; }
    .wel-lang {
      padding: 10px 18px; border: 1.5px solid #e2e8f0; border-radius: 10px;
      background: #fff; color: #0f172a; font-size: 14px; font-weight: 600;
      font-family: inherit; cursor: pointer; transition: border-color .15s, background .15s;
    }
    .wel-lang:hover { border-color: #11769b; }
    .wel-lang.selected { border-color: #11769b; background: rgba(17,118,155,0.08); color: #11769b; }
    .wel-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
    .wel-actions button mat-spinner { display: inline-block; }
    .wel-err { margin-top: 12px; padding: 10px 14px; border-radius: 10px; background: #fef2f2; color: #b91c1c; font-size: 13px; }
    @media (max-width: 560px) {
      .wel-card { padding: 24px 20px; }
      .wel-choices { grid-template-columns: 1fr; }
      .wel-row { flex-wrap: wrap; }
    }
  `],
})
export class WelcomeOfflineComponent implements OnInit {
  /** Emesso quando il setup è completato: il parent ricarica i dati. */
  @Output() done = new EventEmitter<void>();

  visible = false;
  step: 'lang' | 'choice' | 'form' | 'password' | 'backup' | 'restore' = 'lang';
  readonly langs = LANGS;
  selectedLang: Lang = this.guessLang();
  loading = false;
  errore = '';
  az: Azienda = { ragioneSociale: '' };
  pwd1 = '';
  pwd2 = '';
  hadPassword = false;
  backupDir = '';
  backupEncrypt = false;
  restoreFile = '';
  restorePwd = '';
  get restoreFileName(): string { return this.restoreFile.split(/[\\/]/).pop() || this.restoreFile; }
  get restoreEncrypted(): boolean { return /\.enc$/i.test(this.restoreFile); }

  /** Dismissione per la sola sessione corrente (dopo i dati demo): alla
   *  riapertura del programma la richiesta dei dati azienda riappare finché
   *  non vengono inseriti dati reali. Vive in sessionStorage, non localStorage. */
  private readonly SESSION_SEEN = 'ordeva_offline_welcome_seen';
  /** Una volta scelto come partire (azienda / demo / ripristino) non si ripresenta più. */
  private readonly SETUP_DONE = 'ordeva_offline_setup_done';
  /** Hint per la lock screen: evita il flash all'avvio sapendo subito se c'è password. */
  private readonly PWD_HINT = 'ordeva_app_password_enabled';

  constructor(private ds: DataService, private desktop: DesktopService, public i18n: I18nService) {}

  /** Preseleziona la lingua del sistema operativo, se tra quelle disponibili — altrimenti italiano. */
  private guessLang(): Lang {
    const nav = (typeof navigator !== 'undefined' ? navigator.language : '').slice(0, 2).toLowerCase();
    return (this.langs as string[]).includes(nav) ? (nav as Lang) : 'it';
  }

  continueLang(): void {
    this.i18n.setLang(this.selectedLang);
    this.step = 'choice';
  }

  ngOnInit(): void {
    if (!environment.offline) return;
    if (sessionStorage.getItem(this.SESSION_SEEN) === '1') return;   // già gestito in questa sessione
    if (localStorage.getItem(this.SETUP_DONE) === '1') return;       // scelta già fatta in passato

    this.ds.getSetupStatus().pipe(catchError(() => of(null))).subscribe(st => {
      if (!st) return;                       // backend non pronto: niente overlay
      // Mostra il benvenuto solo su un'app davvero "vergine": nessuna azienda
      // configurata E nessun dato. Se ci sono dati (azienda o demo già caricati)
      // non si ripresenta — evita anche il blocco "non posso sovrascrivere".
      if (st.aziendaConfigurata || st.hasDati) { localStorage.setItem(this.SETUP_DONE, '1'); return; }
      this.visible = true;
    });
  }

  salvaAzienda(): void {
    if (!this.az.ragioneSociale?.trim() || this.loading) return;
    this.loading = true; this.errore = '';
    this.ds.saveAzienda(this.az).subscribe({
      next: () => { this.loading = false; this.step = 'backup'; },   // la password ora è per-archivio (selettore all'avvio)
      error: () => { this.errore = this.i18n.t('welcome.msg.salvataggioNonRiuscito'); this.loading = false; },
    });
  }

  impostaPassword(): void {
    if (this.loading) return;
    if (!this.pwd1) { this.vaiBackup(); return; }
    if (this.pwd1 !== this.pwd2) { this.errore = this.i18n.t('welcome.msg.passwordNonCoincidono'); return; }
    this.loading = true; this.errore = '';
    this.ds.setAppPassword(this.pwd1).subscribe({
      next: () => {
        localStorage.setItem(this.PWD_HINT, '1');
        this.hadPassword = true;
        this.loading = false;
        this.vaiBackup();
      },
      error: () => { this.errore = this.i18n.t('welcome.msg.passwordNonRiuscita'); this.loading = false; },
    });
  }

  vaiBackup(): void { this.errore = ''; this.step = 'backup'; }

  async scegliFileRipristino(): Promise<void> {
    const f = await this.desktop.pickBackupFile();
    if (f) { this.restoreFile = f; this.errore = ''; }
  }

  ripristina(): void {
    if (this.loading || !this.restoreFile) return;
    if (this.restoreEncrypted && !this.restorePwd) { this.errore = this.i18n.t('welcome.msg.backupCifratoPassword'); return; }
    this.loading = true; this.errore = '';
    this.ds.restoreBackupFromFile(this.restoreFile, this.restorePwd || undefined).subscribe({
      next: () => { sessionStorage.setItem(this.SESSION_SEEN, '1'); this.visible = false; setTimeout(() => location.reload(), 400); },
      error: (e) => { this.errore = e?.error?.error || this.i18n.t('welcome.msg.ripristinoNonRiuscito'); this.loading = false; },
    });
  }

  async scegliCartella(): Promise<void> {
    const dir = await this.desktop.pickFolder();
    if (dir) this.backupDir = dir;
  }

  attivaBackup(): void {
    if (this.loading || !this.backupDir) return;
    this.loading = true; this.errore = '';
    this.ds.saveBackupConfig({
      dir: this.backupDir,
      enabled: true,
      encrypt: this.hadPassword && this.backupEncrypt,
    }).subscribe({
      next: () => { this.ds.runBackup().subscribe({ next: () => {}, error: () => {} }); this.completa(); },
      error: () => { this.errore = this.i18n.t('welcome.msg.attivazioneBackupNonRiuscita'); this.loading = false; },
    });
  }

  caricaDemo(): void {
    if (this.loading) return;
    this.loading = true; this.errore = '';
    this.ds.seedDemo().subscribe({
      next: () => this.completa(true),
      error: (e) => {
        this.errore = e?.error?.error || this.i18n.t('welcome.msg.demoNonRiuscito');
        this.loading = false;
      },
    });
  }

  completa(reload = false): void {
    // Scelta effettuata (azienda / demo / ripristino): non riproporre il benvenuto
    // ai prossimi avvii. Flag persistente + dismissione di sessione.
    localStorage.setItem(this.SETUP_DONE, '1');
    sessionStorage.setItem(this.SESSION_SEEN, '1');
    this.visible = false;
    this.loading = false;
    this.done.emit();
    // Dopo i dati demo serve ricaricare per popolare tutte le liste già in memoria.
    if (reload) setTimeout(() => location.reload(), 50);
  }
}
