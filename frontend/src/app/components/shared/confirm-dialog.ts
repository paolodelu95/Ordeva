import { Component, Inject, Injectable, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

/**
 * Conferma coerente e a tema per tutta l'app.
 * Sostituisce le `window.confirm()` native (popup grigi, fuori tema, bottoni "OK/Annulla").
 *
 * Uso tipico (drop-in del vecchio `if (!confirm('...')) return;`):
 *
 *   async delete(x) {
 *     if (!await this.confirm.delete(`Eliminare ${x.nome}?`)) return;
 *     ...azione...
 *   }
 *
 * Oppure conferma generica:
 *   if (!await this.confirm.ask('Procedere con l\'invio?')) return;
 */
export interface ConfirmOptions {
  /** Testo principale. Supporta gli a-capo (\n). */
  message: string;
  /** Titolo del dialog. Default: "Conferma" (o "Confermi l'azione?" se danger). */
  title?: string;
  /** Etichetta del bottone d'azione. Default: "Conferma". */
  confirmText?: string;
  /** Etichetta del bottone di annullamento. Default: "Annulla". */
  cancelText?: string;
  /** Azione distruttiva: bottone rosso + icona di avviso. */
  danger?: boolean;
  /** Nasconde "Annulla": avviso a sola lettura, con un solo bottone. Vedi `alert()`. */
  hideCancel?: boolean;
  /** Icona Material da mostrare. Default: "delete" se danger, altrimenti "help". */
  icon?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div mat-dialog-title class="cd-head">
      <span class="cd-icon" [class.danger]="data.danger"><mat-icon>{{ icon }}</mat-icon></span>
      <span class="cd-title">{{ title }}</span>
    </div>
    <mat-dialog-content>
      <p class="cd-message">{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (!data.hideCancel) {
        <button mat-stroked-button [mat-dialog-close]="false">{{ cancelText }}</button>
      }
      <button mat-flat-button [color]="data.danger ? 'warn' : 'primary'"
              [mat-dialog-close]="true" cdkFocusInitial>{{ confirmText }}</button>
    </mat-dialog-actions>`,
  styles: [`
    .cd-head { display: flex; align-items: center; gap: 12px; padding-bottom: 4px; }
    .cd-icon {
      width: 40px; height: 40px; border-radius: var(--radius-md);
      display: flex; align-items: center; justify-content: center;
      background: var(--primary-soft); color: var(--primary); flex-shrink: 0;
    }
    .cd-icon mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .cd-icon.danger { background: var(--danger-soft); color: var(--danger-on); }
    .cd-title { font-size: 18px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.01em; }
    .cd-message {
      font-size: 14px; line-height: 1.55; color: var(--text-secondary);
      margin: 4px 0 0; white-space: pre-line;
    }
  `],
})
export class ConfirmDialogComponent {
  private i18n = inject(I18nService);
  constructor(@Inject(MAT_DIALOG_DATA) public data: ConfirmOptions) {}

  get title(): string { return this.data.title || (this.data.danger ? this.i18n.t('shared.confirmDialog.confermiAzione') : this.i18n.t('shared.confirmDialog.conferma')); }
  get confirmText(): string { return this.data.confirmText || this.i18n.t('shared.confirmDialog.conferma'); }
  get cancelText(): string { return this.data.cancelText || this.i18n.t('shared.confirmDialog.annulla'); }
  get icon(): string { return this.data.icon || (this.data.danger ? 'delete' : 'help'); }
}

/** Opzioni della conferma con ridigitazione (vedi `ConfirmService.askTyping`). */
export interface TypedConfirmOptions extends ConfirmOptions {
  /** Parola che l'utente deve riscrivere per sbloccare il bottone d'azione. */
  parola: string;
  /** Etichetta del campo. Default: «Scrivi <parola> per confermare». */
  label?: string;
}

/**
 * Conferma per azioni irreversibili: il bottone resta disabilitato finché non si
 * riscrive esattamente la parola richiesta. Rimpiazza a tema il `prompt()` nativo
 * usato per lo stesso scopo.
 */
@Component({
  selector: 'app-typed-confirm-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
            MatFormFieldModule, MatInputModule, TPipe],
  template: `
    <div mat-dialog-title class="cd-head">
      <span class="cd-icon danger"><mat-icon>{{ data.icon || 'delete_forever' }}</mat-icon></span>
      <span class="cd-title">{{ data.title || ('shared.confirmDialog.confermiAzione' | t) }}</span>
    </div>
    <mat-dialog-content>
      <p class="cd-message">{{ data.message }}</p>
      <mat-form-field appearance="outline" class="cd-field">
        <mat-label>{{ data.label || ('shared.confirmDialog.scriviParola' | t:{ parola: data.parola }) }}</mat-label>
        <input matInput [(ngModel)]="digitato" autocomplete="off" spellcheck="false" cdkFocusInitial>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-stroked-button [mat-dialog-close]="false">{{ data.cancelText || ('shared.confirmDialog.annulla' | t) }}</button>
      <button mat-flat-button color="warn" [disabled]="digitato.trim() !== data.parola"
              [mat-dialog-close]="true">{{ data.confirmText || ('shared.confirmDialog.elimina' | t) }}</button>
    </mat-dialog-actions>`,
  styles: [`
    .cd-head { display: flex; align-items: center; gap: 12px; padding-bottom: 4px; }
    .cd-icon {
      width: 40px; height: 40px; border-radius: var(--radius-md);
      display: flex; align-items: center; justify-content: center;
      background: var(--danger-soft); color: var(--danger-on); flex-shrink: 0;
    }
    .cd-icon mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .cd-title { font-size: 18px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.01em; }
    .cd-message {
      font-size: 14px; line-height: 1.55; color: var(--text-secondary);
      margin: 4px 0 12px; white-space: pre-line;
    }
    .cd-field { width: 100%; }
  `],
})
export class TypedConfirmDialogComponent {
  digitato = '';
  constructor(@Inject(MAT_DIALOG_DATA) public data: TypedConfirmOptions) {}
}

/** Opzioni del prompt testuale (vedi `ConfirmService.prompt`). */
export interface PromptOptions {
  message: string;
  title?: string;
  /** Etichetta del campo. Default: "Valore". */
  label?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  /** Maschera il testo digitato (es. password). Default: false. */
  password?: boolean;
  icon?: string;
}

/**
 * Rimpiazzo a tema del `prompt()` nativo: chiede un valore testuale e lo
 * restituisce (a differenza di `askTyping`, pensato solo per la riscrittura di
 * una parola nota come conferma). Con `password: true` maschera l'input — cosa
 * che il `prompt()` nativo non può fare, quindi è anche un miglioramento per i
 * casi che chiedevano una password in chiaro.
 */
@Component({
  selector: 'app-prompt-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
            MatFormFieldModule, MatInputModule, TPipe],
  template: `
    <div mat-dialog-title class="cd-head">
      <span class="cd-icon"><mat-icon>{{ data.icon || 'edit' }}</mat-icon></span>
      <span class="cd-title">{{ data.title || ('shared.confirmDialog.conferma' | t) }}</span>
    </div>
    <mat-dialog-content>
      <p class="cd-message">{{ data.message }}</p>
      <mat-form-field appearance="outline" class="cd-field">
        <mat-label>{{ data.label || ('shared.confirmDialog.valore' | t) }}</mat-label>
        <input matInput [type]="data.password ? 'password' : 'text'" [(ngModel)]="valore"
               [placeholder]="data.placeholder || ''" autocomplete="off" spellcheck="false"
               cdkFocusInitial (keydown.enter)="valore.trim() && dialogRef.close(valore)">
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-stroked-button [mat-dialog-close]="null">{{ data.cancelText || ('shared.confirmDialog.annulla' | t) }}</button>
      <button mat-flat-button color="primary" [disabled]="!valore.trim()"
              [mat-dialog-close]="valore">{{ data.confirmText || ('shared.confirmDialog.conferma' | t) }}</button>
    </mat-dialog-actions>`,
  styles: [`
    .cd-head { display: flex; align-items: center; gap: 12px; padding-bottom: 4px; }
    .cd-icon {
      width: 40px; height: 40px; border-radius: var(--radius-md);
      display: flex; align-items: center; justify-content: center;
      background: var(--primary-soft); color: var(--primary); flex-shrink: 0;
    }
    .cd-icon mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .cd-title { font-size: 18px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.01em; }
    .cd-message { font-size: 14px; line-height: 1.55; color: var(--text-secondary); margin: 4px 0 12px; white-space: pre-line; }
    .cd-field { width: 100%; }
  `],
})
export class PromptDialogComponent {
  valore = '';
  constructor(@Inject(MAT_DIALOG_DATA) public data: PromptOptions, public dialogRef: MatDialogRef<PromptDialogComponent>) {}
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private i18n = inject(I18nService);
  constructor(private dialog: MatDialog) {}

  /** Conferma generica. Restituisce true se l'utente conferma. */
  ask(opts: string | ConfirmOptions): Promise<boolean> {
    const data: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data,
      width: '440px',
      maxWidth: '92vw',
      // Dialog piccolo: su mobile resta a misura di contenuto (vedi styles.scss).
      panelClass: 'dialog-compact',
      restoreFocus: true,
      // Per le azioni distruttive il focus iniziale va su "Annulla" (più sicuro);
      // per le conferme normali sul bottone d'azione (Invio = conferma).
      autoFocus: data.danger ? 'first-tabbable' : '[cdkFocusInitial]',
    });
    return firstValueFrom(ref.afterClosed()).then(r => r === true);
  }

  /**
   * Avviso a sola lettura: il rimpiazzo a tema di `alert()`, con un solo bottone.
   *
   * Esisteva già `ask()` per sostituire `confirm()`, ma non c'era nulla per
   * `alert()` — ed è il motivo per cui i popup di sistema sono rientrati dopo la
   * bonifica. Da usare quando il messaggio è lungo o va letto con calma (elenchi di
   * errori di validazione); per un semplice esito basta una snackbar.
   * Il testo supporta gli a-capo (`\n`).
   */
  alert(opts: string | ConfirmOptions): Promise<void> {
    const data: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts;
    return this.ask({
      title: this.i18n.t('shared.confirmDialog.attenzione'),
      icon: 'error_outline',
      confirmText: this.i18n.t('shared.confirmDialog.hoCapito'),
      ...data,
      hideCancel: true,
    }).then(() => undefined);
  }

  /**
   * Conferma per azioni irreversibili: chiede di riscrivere `parola` (di solito il
   * nome o il codice dell'elemento) prima di sbloccare il bottone.
   */
  askTyping(opts: TypedConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open(TypedConfirmDialogComponent, {
      data: opts,
      width: '460px',
      maxWidth: '92vw',
      // Dialog piccolo: su mobile resta a misura di contenuto (vedi styles.scss).
      panelClass: 'dialog-compact',
      restoreFocus: true,
    });
    return firstValueFrom(ref.afterClosed()).then(r => r === true);
  }

  /**
   * Rimpiazzo a tema di `prompt()`: chiede un valore testuale (es. una password
   * o un nome libero) e lo restituisce, o `null` se l'utente annulla.
   */
  prompt(opts: string | PromptOptions): Promise<string | null> {
    const data: PromptOptions = typeof opts === 'string' ? { message: opts } : opts;
    const ref = this.dialog.open(PromptDialogComponent, {
      data,
      width: '440px',
      maxWidth: '92vw',
      // Dialog piccolo: su mobile resta a misura di contenuto (vedi styles.scss).
      panelClass: 'dialog-compact',
      restoreFocus: true,
      autoFocus: '[cdkFocusInitial]',
    });
    return firstValueFrom(ref.afterClosed()).then(r => (typeof r === 'string' ? r : null));
  }

  /** Conferma di eliminazione (rossa, etichetta "Elimina"). */
  delete(message: string, opts: Partial<ConfirmOptions> = {}): Promise<boolean> {
    return this.ask({
      title: this.i18n.t('shared.confirmDialog.eliminazione'),
      confirmText: this.i18n.t('shared.confirmDialog.elimina'),
      danger: true,
      icon: 'delete',
      ...opts,
      message,
    });
  }
}
