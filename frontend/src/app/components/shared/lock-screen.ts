import { Component, OnInit, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DataService } from '../../services/data.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

/**
 * Schermata di blocco all'avvio (solo edizione offline desktop).
 * Compare quando è impostata una password d'accesso e l'app non è ancora stata
 * sbloccata nella sessione corrente. Protegge i dati del magazzino su un PC
 * condiviso. Non è cifratura: è un deterrente d'accesso per l'uso quotidiano.
 */
@Component({
  selector: 'app-lock-screen',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatInputModule, MatFormFieldModule, MatProgressSpinnerModule, TPipe],
  template: `
    <div class="lock-overlay">
      <form class="lock-card" (ngSubmit)="unlock()">
        <div class="lock-logo">O</div>
        <h1 class="lock-title">Ordeva</h1>
        <p class="lock-sub">{{ 'lockScreen.sub' | t }}</p>
        <mat-form-field appearance="outline" class="full">
          <mat-label>{{ 'lockScreen.passwordLabel' | t }}</mat-label>
          <input matInput [(ngModel)]="password" name="password" type="password" autocomplete="current-password" autofocus />
        </mat-form-field>
        @if (errore) { <div class="lock-err">{{ errore }}</div> }
        <button mat-flat-button color="primary" type="submit" class="full" [disabled]="loading || !password">
          @if (loading) { <mat-spinner diameter="18"></mat-spinner> } @else { {{ 'lockScreen.sblocca' | t }} }
        </button>
      </form>
    </div>
  `,
  styles: [`
    .lock-overlay {
      position: fixed; inset: 0; z-index: 2000;
      display: flex; align-items: center; justify-content: center; padding: 20px;
      background: linear-gradient(135deg, #0e2a38 0%, #11769b 100%);
    }
    .lock-card {
      background: #fff; border-radius: 18px; box-shadow: 0 24px 64px rgba(0,0,0,0.3);
      padding: 34px 36px; width: 100%; max-width: 380px; text-align: center;
      display: flex; flex-direction: column; align-items: center;
    }
    .lock-logo {
      width: 52px; height: 52px; border-radius: 12px; color: #fff; font-weight: 800; font-size: 24px;
      display: flex; align-items: center; justify-content: center; margin-bottom: 14px;
      background: linear-gradient(135deg, #11769b, #15a4a2);
    }
    .lock-title { font-size: 22px; font-weight: 800; color: #0f172a; margin: 0 0 4px; }
    .lock-sub { font-size: 13.5px; color: #64748b; margin: 0 0 20px; }
    .full { width: 100%; }
    .lock-err { width: 100%; margin-bottom: 12px; padding: 9px 12px; border-radius: 9px; background: #fef2f2; color: #b91c1c; font-size: 13px; }
  `],
})
export class LockScreenComponent implements OnInit {
  private i18n = inject(I18nService);
  @Output() unlocked = new EventEmitter<void>();

  password = '';
  loading = false;
  errore = '';

  constructor(private ds: DataService) {}

  ngOnInit(): void {
    // Se nel frattempo la password risultasse non impostata, sblocca subito.
    this.ds.getAppPasswordStatus().subscribe({
      next: st => { if (!st.enabled) this.emitUnlock(); },
      error: () => {},
    });
  }

  unlock(): void {
    if (this.loading || !this.password) return;
    this.loading = true; this.errore = '';
    this.ds.unlockApp(this.password).subscribe({
      next: r => {
        if (r.ok) this.emitUnlock();
        else { this.errore = this.i18n.t('lockScreen.msg.passwordErrata'); this.loading = false; this.password = ''; }
      },
      error: () => { this.errore = this.i18n.t('lockScreen.msg.verificaNonRiuscita'); this.loading = false; },
    });
  }

  private emitUnlock(): void {
    sessionStorage.setItem('ordeva_unlocked', '1');
    this.loading = false;
    this.unlocked.emit();
  }
}
