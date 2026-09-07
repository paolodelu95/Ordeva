import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { DataService } from '../../services/data.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

interface OnbStep {
  label: string;
  desc: string;
  cta: string;
  route: string;
  done: boolean;
}

/**
 * Checklist di primo accesso (F0.4). Mostrata in cima alla Home finché l'utente
 * non ha completato i 4 passi base o non la chiude. Niente tutorial passivo:
 * ogni passo porta direttamente alla schermata giusta.
 *
 * Stato persistito in localStorage:
 *  - ordeva_onboarding_done=1      → tutti i passi completati (non si rifà il fetch)
 *  - ordeva_onboarding_dismissed=1 → l'utente l'ha nascosta volontariamente
 */
@Component({
  selector: 'app-onboarding-checklist',
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule, MatButtonModule, MatTooltipModule, TPipe],
  template: `
    @if (!hidden) {
      <div class="onb-card">
        <button class="onb-close" type="button" (click)="dismiss()"
                [matTooltip]="'onboarding.nascondi' | t" matTooltipPosition="left"><mat-icon>close</mat-icon></button>
        <div class="onb-head">
          <div class="onb-hero-icon"><mat-icon>rocket_launch</mat-icon></div>
          <div class="onb-head-text">
            <div class="onb-title">{{ 'onboarding.title' | t }}</div>
            <div class="onb-sub">{{ i18n.t('onboarding.sub', { completati: completati, totale: steps.length }) }}</div>
          </div>
        </div>
        <div class="onb-progress"><div class="onb-progress-bar" [style.width.%]="progressPct"></div></div>
        <div class="onb-steps">
          @for (s of steps; track s.route) {
            <div class="onb-step" [class.done]="s.done">
              <mat-icon class="onb-step-ic">{{ s.done ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
              <div class="onb-step-text">
                <div class="onb-step-label">{{ s.label }}</div>
                <div class="onb-step-desc">{{ s.desc }}</div>
              </div>
              @if (s.done) {
                <span class="onb-step-badge">{{ 'onboarding.fatto' | t }}</span>
              } @else {
                <a mat-flat-button color="primary" [routerLink]="s.route">{{ s.cta }}</a>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .onb-card {
      position: relative;
      background: var(--bg-surface, #fff);
      border: 1px solid var(--border-subtle, #eef0f4);
      border-radius: var(--radius-lg, 12px);
      box-shadow: var(--shadow-sm);
      padding: 20px 22px; margin-bottom: 28px;
    }
    .onb-close {
      position: absolute; top: 12px; right: 12px;
      border: none; background: transparent; cursor: pointer;
      color: var(--text-tertiary, #94a3b8); border-radius: 50%;
      width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
      transition: background 0.12s, color 0.12s;
    }
    .onb-close:hover { background: var(--bg-subtle, #f3f4f8); color: var(--text-secondary, #475569); }
    .onb-head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
    .onb-hero-icon {
      width: 46px; height: 46px; border-radius: var(--radius-md, 8px); flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; color: #fff;
      background: linear-gradient(135deg, var(--primary, #11769b) 0%, var(--brand-teal, #15a4a2) 100%);
    }
    .onb-hero-icon mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .onb-title { font-size: 17px; font-weight: 700; color: var(--text-primary, #0f172a); }
    .onb-sub { font-size: 13px; color: var(--text-tertiary, #94a3b8); margin-top: 2px; }
    .onb-progress {
      height: 6px; border-radius: 99px; background: var(--bg-subtle, #f3f4f8);
      overflow: hidden; margin-bottom: 16px;
    }
    .onb-progress-bar {
      height: 100%; border-radius: 99px; transition: width 0.4s ease;
      background: linear-gradient(90deg, var(--primary, #11769b), var(--brand-teal, #15a4a2));
    }
    .onb-steps { display: flex; flex-direction: column; gap: 8px; }
    .onb-step {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; border-radius: var(--radius-md, 8px);
      background: var(--bg-surface-2, #fafbfd); border: 1px solid var(--border-subtle, #eef0f4);
    }
    .onb-step.done { opacity: 0.72; }
    .onb-step-ic { flex-shrink: 0; color: var(--text-muted, #b6bdc9); }
    .onb-step.done .onb-step-ic { color: var(--success, #10b981); }
    .onb-step-text { flex: 1; min-width: 0; }
    .onb-step-label { font-size: 14px; font-weight: 600; color: var(--text-primary, #0f172a); }
    .onb-step.done .onb-step-label { text-decoration: line-through; text-decoration-color: var(--text-muted, #b6bdc9); }
    .onb-step-desc { font-size: 12.5px; color: var(--text-tertiary, #94a3b8); margin-top: 1px; }
    .onb-step-badge {
      font-size: 12px; font-weight: 700; color: var(--success-on, #047857);
      background: var(--success-soft, #d1fae5); padding: 4px 10px; border-radius: 99px;
    }
    @media (max-width: 640px) {
      .onb-step { flex-wrap: wrap; }
      .onb-step a, .onb-step .onb-step-badge { margin-left: 34px; }
    }
  `],
})
export class OnboardingChecklistComponent implements OnInit {
  i18n = inject(I18nService);
  hidden = true;
  steps: OnbStep[] = [];

  get completati(): number { return this.steps.filter(s => s.done).length; }
  get progressPct(): number { return this.steps.length ? Math.round((this.completati / this.steps.length) * 100) : 0; }

  constructor(private ds: DataService) {}

  ngOnInit(): void {
    if (localStorage.getItem('ordeva_onboarding_done') === '1') return;
    if (localStorage.getItem('ordeva_onboarding_dismissed') === '1') return;

    forkJoin({
      azienda:  this.ds.getAzienda().pipe(catchError(() => of(null as any))),
      clienti:  this.ds.getClienti().pipe(catchError(() => of([] as any[]))),
      prodotti: this.ds.getProdotti().pipe(catchError(() => of([] as any[]))),
      fatture:  this.ds.getFatture().pipe(catchError(() => of([] as any[]))),
    }).subscribe(({ azienda, clienti, prodotti, fatture }) => {
      const az: any = azienda;
      const t = (k: string) => this.i18n.t(k);
      this.steps = [
        { label: t('onboarding.step1.label'), desc: t('onboarding.step1.desc'),
          cta: t('onboarding.step1.cta'), route: '/impostazioni', done: !!(az?.ragioneSociale && (az?.pIva || az?.piva)) },
        { label: t('onboarding.step2.label'), desc: t('onboarding.step2.desc'),
          cta: t('onboarding.step2.cta'), route: '/clienti', done: (clienti?.length || 0) > 0 },
        { label: t('onboarding.step3.label'), desc: t('onboarding.step3.desc'),
          cta: t('onboarding.step3.cta'), route: '/prodotti', done: (prodotti?.length || 0) > 0 },
        { label: t('onboarding.step4.label'), desc: t('onboarding.step4.desc'),
          cta: t('onboarding.step4.cta'), route: '/fatture', done: (fatture?.length || 0) > 0 },
      ];
      if (this.steps.every(s => s.done)) {
        localStorage.setItem('ordeva_onboarding_done', '1');
        this.hidden = true;
      } else {
        this.hidden = false;
      }
    });
  }

  dismiss(): void {
    localStorage.setItem('ordeva_onboarding_dismissed', '1');
    this.hidden = true;
  }
}
