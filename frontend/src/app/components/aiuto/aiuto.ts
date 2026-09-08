import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

interface Step { titolo: string; descrizione: string; }
interface Sezione {
  id: string;
  titolo: string;
  icona: string;
  colore: string;
  intro: string;
  passi: Step[];
}
interface Faq { domanda: string; risposta: string; }
interface Screenshot { file: string; titolo: string; descrizione: string; }

/**
 * Guida e manuale d'uso interno (loggato).
 *
 * Pagina che spiega come usare Ordeva, organizzata per area funzionale
 * con sezioni espandibili. Pensata per utenti non tecnici.
 */
@Component({
  selector: 'app-aiuto',
  standalone: true,
  imports: [
    CommonModule, RouterLink, FormsModule,
    MatIconModule, MatExpansionModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, TPipe,
  ],
  template: `
    <div class="aiuto-page">
      <!-- Hero -->
      <section class="hero">
        <div class="hero-icon">
          <mat-icon>menu_book</mat-icon>
        </div>
        <h1>{{ 'aiuto.title' | t }}</h1>
        <p>{{ 'aiuto.subtitle' | t }}</p>
        <mat-form-field appearance="outline" class="search-bar">
          <mat-icon matPrefix>search</mat-icon>
          <input matInput [placeholder]="'aiuto.searchPlaceholder' | t"
                 [(ngModel)]="query" (input)="filter()">
          @if (query) {
            <button mat-icon-button matSuffix (click)="query = ''; filter()">
              <mat-icon>close</mat-icon>
            </button>
          }
        </mat-form-field>
      </section>

      <!-- Quick start (mostra solo se non c'è ricerca attiva) -->
      @if (!query) {
        <section class="quick-start">
          <h2>{{ 'aiuto.quickStart.title' | t }}</h2>
          <div class="quick-grid">
            <a routerLink="/impostazioni" class="quick-card">
              <div class="qc-num">1</div>
              <b>{{ 'aiuto.quickStart.card1.titolo' | t }}</b>
              <span>{{ 'aiuto.quickStart.card1.desc' | t }}</span>
            </a>
            <a routerLink="/clienti" class="quick-card">
              <div class="qc-num">2</div>
              <b>{{ 'aiuto.quickStart.card2.titolo' | t }}</b>
              <span>{{ 'aiuto.quickStart.card2.desc' | t }}</span>
            </a>
            <a routerLink="/prodotti" class="quick-card">
              <div class="qc-num">3</div>
              <b>{{ 'aiuto.quickStart.card3.titolo' | t }}</b>
              <span>{{ 'aiuto.quickStart.card3.desc' | t }}</span>
            </a>
            <a routerLink="/fatture" class="quick-card">
              <div class="qc-num">4</div>
              <b>{{ 'aiuto.quickStart.card4.titolo' | t }}</b>
              <span>{{ 'aiuto.quickStart.card4.desc' | t }}</span>
            </a>
          </div>
        </section>
      }

      <!-- Galleria screenshot reali (visibile senza ricerca) -->
      @if (!query) {
        <section class="gallery">
          <h2>{{ 'aiuto.gallery.title' | t }}</h2>
          <p class="gallery-sub">{{ gallerySub }}</p>
          <div class="gallery-grid">
            @for (s of screenshots; track s.file) {
              <figure class="mockup">
                <a [href]="'help-shots/' + s.file" target="_blank" rel="noopener" [title]="('aiuto.gallery.apri' | t) + ' ' + s.titolo + ' ' + ('aiuto.gallery.aGrandezzaNaturale' | t)">
                  <img [src]="'help-shots/' + s.file" [alt]="s.titolo" loading="lazy" />
                </a>
                <figcaption><b>{{ s.titolo }}</b> — {{ s.descrizione }}</figcaption>
              </figure>
            }
          </div>
        </section>
      }

      <!-- Sezioni del manuale -->
      <section class="manual">
        @if (!query) { <h2>{{ 'aiuto.manual.title' | t }}</h2> }
        @if (query && filtered.length === 0) {
          <p class="no-results">{{ 'aiuto.noResults.part1' | t }} "<b>{{ query }}</b>". {{ 'aiuto.noResults.part2' | t }}</p>
        }

        @for (sez of (query ? filtered : sezioni); track sez.id) {
          <mat-expansion-panel class="section-panel" [id]="sez.id">
            <mat-expansion-panel-header>
              <mat-panel-title>
                <span class="section-icon" [style.background]="sez.colore">
                  <mat-icon>{{ sez.icona }}</mat-icon>
                </span>
                <span class="section-title">{{ sez.titolo }}</span>
              </mat-panel-title>
              <mat-panel-description>{{ sez.intro }}</mat-panel-description>
            </mat-expansion-panel-header>

            <div class="section-content">
              @for (passo of sez.passi; track passo.titolo) {
                <div class="step-item">
                  <div class="step-bullet">
                    <mat-icon>chevron_right</mat-icon>
                  </div>
                  <div class="step-text">
                    <h4>{{ passo.titolo }}</h4>
                    <p>{{ passo.descrizione }}</p>
                  </div>
                </div>
              }
            </div>
          </mat-expansion-panel>
        }
      </section>

      <!-- FAQ rapide -->
      @if (!query) {
        <section class="faq-section">
          <h2>{{ 'aiuto.faq.title' | t }}</h2>
          <mat-accordion class="faq-accordion">
            @for (f of faqs; track f.domanda) {
              <mat-expansion-panel>
                <mat-expansion-panel-header>
                  <mat-panel-title>{{ f.domanda }}</mat-panel-title>
                </mat-expansion-panel-header>
                <p>{{ f.risposta }}</p>
              </mat-expansion-panel>
            }
          </mat-accordion>
        </section>
      }

      <!-- Scorciatoie -->
      @if (!query) {
        <section class="shortcuts">
          <h2>{{ 'aiuto.shortcuts.title' | t }}</h2>
          <div class="kbd-grid">
            <div class="kbd-row"><div class="kbd-keys"><kbd>Cmd</kbd>+<kbd>K</kbd></div><span>{{ 'aiuto.shortcuts.search' | t }}</span></div>
            <div class="kbd-row"><div class="kbd-keys"><kbd>Cmd</kbd>+<kbd>S</kbd></div><span>{{ 'aiuto.shortcuts.save' | t }}</span></div>
            <div class="kbd-row"><div class="kbd-keys"><kbd>Cmd</kbd>+<kbd>N</kbd></div><span>{{ 'aiuto.shortcuts.new' | t }}</span></div>
            <div class="kbd-row"><div class="kbd-keys"><kbd>Esc</kbd></div><span>{{ 'aiuto.shortcuts.closeDialog' | t }}</span></div>
            <div class="kbd-row"><div class="kbd-keys"><kbd>/</kbd></div><span>{{ 'aiuto.shortcuts.openSearch' | t }}</span></div>
          </div>
          <p class="shortcut-note">{{ 'aiuto.shortcuts.notePart1' | t }} <kbd>Ctrl</kbd> {{ 'aiuto.shortcuts.notePart2' | t }} <kbd>Cmd</kbd>.</p>
        </section>
      }

      <!-- Contatti supporto -->
      @if (!query) {
        <section class="support">
          <div class="support-card">
            <mat-icon>support_agent</mat-icon>
            <div>
              <h3>{{ 'aiuto.support.title' | t }}</h3>
              @if (offline) {
                <p>{{ 'aiuto.support.textOffline.part1' | t }} <a href="mailto:contatti@ordeva.it">contatti&#64;ordeva.it</a> {{ 'aiuto.support.textOffline.part2' | t }}</p>
              } @else {
                <p>Scrivi a <a href="mailto:contatti@ordeva.it">contatti&#64;ordeva.it</a> e ti rispondiamo entro 24h lavorative. Sul piano Pro la risposta è garantita entro 4h.</p>
              }
            </div>
          </div>
        </section>
      }
    </div>
  `,
  styles: [`
    .aiuto-page {
      max-width: 980px;
      margin: 0 auto;
      padding: 32px 24px 60px;
      color: var(--text-primary);
    }

    /* Hero */
    .hero {
      text-align: center;
      margin-bottom: 36px;
    }
    .hero-icon {
      width: 64px; height: 64px;
      margin: 0 auto 16px;
      border-radius: 16px;
      background: linear-gradient(135deg, #11769b 0%, #15a4a2 100%);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 24px -4px rgba(17, 118, 155, 0.45);
    }
    .hero-icon mat-icon {
      color: #fff; font-size: 32px; width: 32px; height: 32px;
    }
    .hero h1 {
      font-size: 32px; font-weight: 800; letter-spacing: -0.025em;
      margin: 0 0 8px;
      color: var(--text-primary);
    }
    .hero p {
      font-size: 15px; color: var(--text-secondary);
      max-width: 540px; margin: 0 auto 24px;
    }
    .search-bar {
      width: 100%; max-width: 540px;
      ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    }

    /* Quick start */
    .quick-start { margin-bottom: 40px; }
    .quick-start h2,
    .manual h2,
    .faq-section h2,
    .shortcuts h2 {
      font-size: 18px; font-weight: 700;
      color: var(--text-primary);
      margin: 0 0 16px;
      letter-spacing: -0.01em;
    }
    .quick-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }
    .quick-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px 16px;
      text-decoration: none;
      color: var(--text-primary);
      transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
      display: flex; flex-direction: column; gap: 6px;
    }
    .quick-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 16px -6px rgba(15,23,42,0.10);
      border-color: var(--primary);
    }
    .qc-num {
      width: 26px; height: 26px;
      border-radius: 50%;
      background: linear-gradient(135deg, #11769b 0%, #15a4a2 100%);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 13px;
      margin-bottom: 4px;
    }
    .quick-card b {
      font-size: 14px; color: var(--text-primary);
      font-weight: 700;
    }
    .quick-card span {
      font-size: 12px; color: var(--text-secondary);
    }

    /* Manual sections */
    .manual { margin-bottom: 40px; }
    .section-panel {
      margin-bottom: 10px !important;
      border-radius: 10px !important;
      border: 1px solid var(--border) !important;
      box-shadow: var(--shadow-xs) !important;
      background: var(--bg-surface) !important;
    }
    ::ng-deep .section-panel .mat-expansion-panel-header {
      padding: 0 18px !important;
      height: 64px !important;
    }
    ::ng-deep .section-panel .mat-expansion-panel-header-title {
      align-items: center;
      gap: 12px;
      font-weight: 600 !important;
      flex: 0 0 auto;
      color: var(--text-primary) !important;
    }
    ::ng-deep .section-panel .mat-expansion-panel-header-description {
      color: var(--text-secondary) !important;
      font-size: 13px;
      flex: 1 1 auto;
      margin-right: 16px;
    }
    .section-icon {
      width: 36px; height: 36px;
      border-radius: 9px;
      display: inline-flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .section-icon mat-icon {
      color: #fff; font-size: 20px; width: 20px; height: 20px;
    }
    .section-title { font-size: 15px; }
    .section-content { padding: 8px 0 6px; }
    .step-item {
      display: flex; gap: 14px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .step-item:last-child { border-bottom: none; }
    .step-bullet {
      width: 28px; height: 28px;
      flex-shrink: 0;
      border-radius: 50%;
      background: var(--primary-soft);
      color: var(--primary);
      display: flex; align-items: center; justify-content: center;
    }
    .step-bullet mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .step-text { flex: 1; min-width: 0; }
    .step-text h4 {
      font-size: 14px; font-weight: 600;
      margin: 2px 0 4px;
      color: var(--text-primary);
    }
    .step-text p {
      font-size: 13px; color: var(--text-secondary);
      margin: 0; line-height: 1.55;
    }

    .no-results {
      text-align: center; padding: 24px 0;
      color: var(--text-secondary); font-size: 14px;
    }

    /* FAQ */
    .faq-section { margin-bottom: 40px; }
    .faq-accordion { display: block; }
    ::ng-deep .faq-accordion .mat-expansion-panel {
      margin-bottom: 8px !important;
      border-radius: 10px !important;
      border: 1px solid var(--border) !important;
      box-shadow: none !important;
      background: var(--bg-surface) !important;
    }
    ::ng-deep .faq-accordion .mat-expansion-panel-header { height: 52px !important; }
    ::ng-deep .faq-accordion .mat-expansion-panel-header-title {
      font-weight: 500 !important; font-size: 14px !important;
      color: var(--text-primary) !important;
    }
    .faq-accordion p {
      margin: 0; font-size: 13px; color: var(--text-secondary);
      line-height: 1.55;
    }

    /* Shortcuts */
    .shortcuts { margin-bottom: 40px; }
    .kbd-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 8px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 8px;
    }
    .kbd-row {
      display: flex; align-items: center; gap: 14px;
      padding: 10px 12px;
      border-radius: 8px;
      transition: background 0.15s;
    }
    .kbd-row:hover { background: var(--bg-subtle); }
    .kbd-keys { display: flex; align-items: center; gap: 4px; }
    kbd {
      display: inline-block;
      padding: 3px 7px;
      background: var(--bg-subtle);
      border: 1px solid var(--border-strong);
      border-radius: 5px;
      font-size: 11px; font-weight: 600;
      color: var(--text-primary);
      font-family: 'SF Mono', Menlo, monospace;
      box-shadow: 0 1px 0 var(--border-strong);
    }
    .kbd-row span { font-size: 13px; color: var(--text-secondary); }
    .shortcut-note {
      font-size: 12px; color: var(--text-tertiary);
      margin-top: 8px;
      kbd { font-size: 10px; padding: 1px 5px; }
    }

    /* Support */
    .support-card {
      display: flex; gap: 18px;
      background: linear-gradient(135deg, rgba(17,118,155,0.06) 0%, rgba(21,164,162,0.06) 100%);
      border: 1px solid rgba(17,118,155,0.18);
      border-radius: 14px;
      padding: 22px 24px;
    }
    .support-card mat-icon {
      color: #11769b; font-size: 36px; width: 36px; height: 36px;
      flex-shrink: 0;
    }
    .support-card h3 {
      margin: 0 0 6px;
      font-size: 16px; font-weight: 700;
      color: var(--text-primary);
    }
    .support-card p {
      margin: 0; font-size: 14px;
      color: var(--text-secondary);
    }
    .support-card a {
      color: #11769b; text-decoration: underline;
      text-underline-offset: 2px;
    }

    /* ── Gallery: screenshot reali (cliccabili a tutta pagina) ───────── */
    .gallery { margin-bottom: 44px; }
    .gallery-sub {
      font-size: 13px; color: var(--text-tertiary);
      margin: -10px 0 18px;
    }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 22px;
    }
    .mockup { margin: 0; }
    .mockup a {
      display: block;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid var(--border);
      background: var(--bg-surface);
      box-shadow: 0 4px 14px -4px rgba(15,23,42,0.10);
      transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s;
    }
    .mockup a:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 28px -8px rgba(15,23,42,0.18);
      border-color: var(--primary);
    }
    .mockup img {
      display: block;
      width: 100%;
      height: auto;
      object-fit: contain;
    }
    .mockup figcaption {
      font-size: 12px; color: var(--text-secondary);
      text-align: center; margin-top: 10px;
      line-height: 1.5;
    }
    .mockup figcaption b {
      color: var(--text-primary);
      font-weight: 700;
    }

    @media (max-width: 800px) {
      .gallery-grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 600px) {
      .aiuto-page { padding: 20px 14px 40px; }
      .hero h1 { font-size: 24px; }
      .hero-icon { width: 56px; height: 56px; }
      .hero-icon mat-icon { font-size: 28px; width: 28px; height: 28px; }
      ::ng-deep .section-panel .mat-expansion-panel-header-description { display: none; }
      .section-icon { width: 32px; height: 32px; }
      .support-card { flex-direction: column; align-items: flex-start; gap: 10px; }
    }
  `]
})
export class AiutoComponent {
  private i18n = inject(I18nService);
  query = '';
  filtered: Sezione[] = [];

  /** Edizione offline desktop: cambia ciò che la guida deve raccontare (dati sul
   *  computer, backup locale, niente login/server/abbonamento). */
  readonly offline = environment.offline;

  /** Sottotitolo della galleria: in offline non c'è login né tenant demo. */
  get gallerySub(): string {
    return this.offline
      ? this.i18n.t('aiuto.gallery.subOffline')
      : 'Anteprime reali dell\'app con dati interamente inventati ("Mario Rossi SRL", "ACME SpA", ecc.) creati appositamente in un tenant demo dedicato. I tuoi dati reali compaiono solo dopo il login.';
  }

  get screenshots(): Screenshot[] {
    const t = (k: string) => this.i18n.t(k);
    return [
      { file: 'home.png',        titolo: t('aiuto.screenshot.home.titolo'),        descrizione: t('aiuto.screenshot.home.desc') },
      { file: 'dashboard.png',   titolo: t('aiuto.screenshot.dashboard.titolo'),   descrizione: t('aiuto.screenshot.dashboard.desc') },
      { file: 'prodotti.png',    titolo: t('aiuto.screenshot.prodotti.titolo'),    descrizione: t('aiuto.screenshot.prodotti.desc') },
      { file: 'fatture.png',     titolo: t('aiuto.screenshot.fatture.titolo'),     descrizione: t('aiuto.screenshot.fatture.desc') },
      { file: 'agenda.png',      titolo: t('aiuto.screenshot.agenda.titolo'),      descrizione: t('aiuto.screenshot.agenda.desc') },
      { file: 'scadenzario.png', titolo: t('aiuto.screenshot.scadenzario.titolo'), descrizione: t('aiuto.screenshot.scadenzario.desc') },
    ];
  }

  private get sezioniBase(): Sezione[] {
    const t = (k: string) => this.i18n.t(k);
    return [
    {
      id: 'azienda',
      titolo: t('aiuto.sez.azienda.titolo'),
      icona: 'business',
      colore: 'linear-gradient(135deg,#0284c7,#0369a1)',
      intro: t('aiuto.sez.azienda.intro'),
      passi: [
        { titolo: t('aiuto.sez.azienda.passo0.titolo'), descrizione: t('aiuto.sez.azienda.passo0.descrizione') },
        { titolo: t('aiuto.sez.azienda.passo1.titolo'), descrizione: t('aiuto.sez.azienda.passo1.descrizione') },
        { titolo: t('aiuto.sez.azienda.passo2.titolo'), descrizione: t('aiuto.sez.azienda.passo2.descrizione') },
        { titolo: t('aiuto.sez.azienda.passo3.titolo'), descrizione: t('aiuto.sez.azienda.passo3.descrizione') },
      ],
    },
    {
      id: 'clienti',
      titolo: t('aiuto.sez.clienti.titolo'),
      icona: 'people',
      colore: 'linear-gradient(135deg,#0284c7,#0369a1)',
      intro: t('aiuto.sez.clienti.intro'),
      passi: [
        { titolo: t('aiuto.sez.clienti.passo0.titolo'), descrizione: t('aiuto.sez.clienti.passo0.descrizione') },
        { titolo: t('aiuto.sez.clienti.passo1.titolo'), descrizione: t('aiuto.sez.clienti.passo1.descrizione') },
        { titolo: t('aiuto.sez.clienti.passo2.titolo'), descrizione: t('aiuto.sez.clienti.passo2.descrizione') },
        { titolo: t('aiuto.sez.clienti.passo3.titolo'), descrizione: t('aiuto.sez.clienti.passo3.descrizione') },
      ],
    },
    {
      id: 'fornitori',
      titolo: t('aiuto.sez.fornitori.titolo'),
      icona: 'local_shipping',
      colore: 'linear-gradient(135deg,#0891b2,#0e7490)',
      intro: t('aiuto.sez.fornitori.intro'),
      passi: [
        { titolo: t('aiuto.sez.fornitori.passo0.titolo'), descrizione: t('aiuto.sez.fornitori.passo0.descrizione') },
        { titolo: t('aiuto.sez.fornitori.passo1.titolo'), descrizione: t('aiuto.sez.fornitori.passo1.descrizione') },
      ],
    },
    {
      id: 'prodotti',
      titolo: t('aiuto.sez.prodotti.titolo'),
      icona: 'inventory_2',
      colore: 'linear-gradient(135deg,#22d3ee,#06b6d4)',
      intro: t('aiuto.sez.prodotti.intro'),
      passi: [
        { titolo: t('aiuto.sez.prodotti.passo0.titolo'), descrizione: t('aiuto.sez.prodotti.passo0.descrizione') },
        { titolo: t('aiuto.sez.prodotti.passo1.titolo'), descrizione: t('aiuto.sez.prodotti.passo1.descrizione') },
        { titolo: t('aiuto.sez.prodotti.passo2.titolo'), descrizione: t('aiuto.sez.prodotti.passo2.descrizione') },
        { titolo: t('aiuto.sez.prodotti.passo3.titolo'), descrizione: t('aiuto.sez.prodotti.passo3.descrizione') },
      ],
    },
    {
      id: 'fatture',
      titolo: t('aiuto.sez.fatture.titolo'),
      icona: 'receipt',
      colore: 'linear-gradient(135deg,#0e7490,#155e75)',
      intro: t('aiuto.sez.fatture.intro'),
      passi: [
        { titolo: t('aiuto.sez.fatture.passo0.titolo'), descrizione: t('aiuto.sez.fatture.passo0.descrizione') },
        { titolo: t('aiuto.sez.fatture.passo1.titolo'), descrizione: t('aiuto.sez.fatture.passo1.descrizione') },
        { titolo: t('aiuto.sez.fatture.passo2.titolo'), descrizione: t('aiuto.sez.fatture.passo2.descrizione') },
        { titolo: t('aiuto.sez.fatture.passo3.titolo'), descrizione: t('aiuto.sez.fatture.passo3.descrizione') },
        { titolo: t('aiuto.sez.fatture.passo4.titolo'), descrizione: t('aiuto.sez.fatture.passo4.descrizione') },
        { titolo: t('aiuto.sez.fatture.passo5.titolo'), descrizione: t('aiuto.sez.fatture.passo5.descrizione') },
      ],
    },
    {
      id: 'ddt',
      titolo: t('aiuto.sez.ddt.titolo'),
      icona: 'receipt_long',
      colore: 'linear-gradient(135deg,#38bdf8,#0ea5e9)',
      intro: t('aiuto.sez.ddt.intro'),
      passi: [
        { titolo: t('aiuto.sez.ddt.passo0.titolo'), descrizione: t('aiuto.sez.ddt.passo0.descrizione') },
        { titolo: t('aiuto.sez.ddt.passo1.titolo'), descrizione: t('aiuto.sez.ddt.passo1.descrizione') },
      ],
    },
    {
      id: 'preventivi',
      titolo: t('aiuto.sez.preventivi.titolo'),
      icona: 'request_quote',
      colore: 'linear-gradient(135deg,#4f46e5,#4338ca)',
      intro: t('aiuto.sez.preventivi.intro'),
      passi: [
        { titolo: t('aiuto.sez.preventivi.passo0.titolo'), descrizione: t('aiuto.sez.preventivi.passo0.descrizione') },
        { titolo: t('aiuto.sez.preventivi.passo1.titolo'), descrizione: t('aiuto.sez.preventivi.passo1.descrizione') },
      ],
    },
    {
      id: 'acquisti',
      titolo: t('aiuto.sez.acquisti.titolo'),
      icona: 'shopping_bag',
      colore: 'linear-gradient(135deg,#d97706,#b45309)',
      intro: t('aiuto.sez.acquisti.intro'),
      passi: [
        { titolo: t('aiuto.sez.acquisti.passo0.titolo'), descrizione: t('aiuto.sez.acquisti.passo0.descrizione') },
        { titolo: t('aiuto.sez.acquisti.passo1.titolo'), descrizione: t('aiuto.sez.acquisti.passo1.descrizione') },
        { titolo: t('aiuto.sez.acquisti.passo2.titolo'), descrizione: t('aiuto.sez.acquisti.passo2.descrizione') },
      ],
    },
    {
      id: 'magazzino',
      titolo: t('aiuto.sez.magazzino.titolo'),
      icona: 'warehouse',
      colore: 'linear-gradient(135deg,#65a30d,#4d7c0f)',
      intro: t('aiuto.sez.magazzino.intro'),
      passi: [
        { titolo: t('aiuto.sez.magazzino.passo0.titolo'), descrizione: t('aiuto.sez.magazzino.passo0.descrizione') },
        { titolo: t('aiuto.sez.magazzino.passo1.titolo'), descrizione: t('aiuto.sez.magazzino.passo1.descrizione') },
        { titolo: t('aiuto.sez.magazzino.passo2.titolo'), descrizione: t('aiuto.sez.magazzino.passo2.descrizione') },
      ],
    },
    {
      id: 'pagamenti',
      titolo: t('aiuto.sez.pagamenti.titolo'),
      icona: 'payments',
      colore: 'linear-gradient(135deg,#16a34a,#15803d)',
      intro: t('aiuto.sez.pagamenti.intro'),
      passi: [
        { titolo: t('aiuto.sez.pagamenti.passo0.titolo'), descrizione: t('aiuto.sez.pagamenti.passo0.descrizione') },
        { titolo: t('aiuto.sez.pagamenti.passo1.titolo'), descrizione: t('aiuto.sez.pagamenti.passo1.descrizione') },
        { titolo: t('aiuto.sez.pagamenti.passo2.titolo'), descrizione: t('aiuto.sez.pagamenti.passo2.descrizione') },
      ],
    },
    {
      id: 'riconciliazione',
      titolo: t('aiuto.sez.riconciliazione.titolo'),
      icona: 'account_balance',
      colore: 'linear-gradient(135deg,#155e75,#134e6c)',
      intro: t('aiuto.sez.riconciliazione.intro'),
      passi: [
        { titolo: t('aiuto.sez.riconciliazione.passo0.titolo'), descrizione: t('aiuto.sez.riconciliazione.passo0.descrizione') },
        { titolo: t('aiuto.sez.riconciliazione.passo1.titolo'), descrizione: t('aiuto.sez.riconciliazione.passo1.descrizione') },
        { titolo: t('aiuto.sez.riconciliazione.passo2.titolo'), descrizione: t('aiuto.sez.riconciliazione.passo2.descrizione') },
      ],
    },
    {
      id: 'agenda',
      titolo: t('aiuto.sez.agenda.titolo'),
      icona: 'event_note',
      colore: 'linear-gradient(135deg,#4f46e5,#4338ca)',
      intro: t('aiuto.sez.agenda.intro'),
      passi: [
        { titolo: t('aiuto.sez.agenda.passo0.titolo'), descrizione: t('aiuto.sez.agenda.passo0.descrizione') },
        { titolo: t('aiuto.sez.agenda.passo1.titolo'), descrizione: t('aiuto.sez.agenda.passo1.descrizione') },
        { titolo: t('aiuto.sez.agenda.passo2.titolo'), descrizione: t('aiuto.sez.agenda.passo2.descrizione') },
        { titolo: t('aiuto.sez.agenda.passo3.titolo'), descrizione: t('aiuto.sez.agenda.passo3.descrizione') },
      ],
    },
    {
      id: 'vendita-banco',
      titolo: t('aiuto.sez.venditaBanco.titolo'),
      icona: 'point_of_sale',
      colore: 'linear-gradient(135deg,#38bdf8,#0284c7)',
      intro: t('aiuto.sez.venditaBanco.intro'),
      passi: [
        { titolo: t('aiuto.sez.venditaBanco.passo0.titolo'), descrizione: t('aiuto.sez.venditaBanco.passo0.descrizione') },
        { titolo: t('aiuto.sez.venditaBanco.passo1.titolo'), descrizione: t('aiuto.sez.venditaBanco.passo1.descrizione') },
        { titolo: t('aiuto.sez.venditaBanco.passo2.titolo'), descrizione: t('aiuto.sez.venditaBanco.passo2.descrizione') },
      ],
    },
    {
      id: 'sincronizzazione',
      titolo: t('aiuto.sez.sincronizzazione.titolo'),
      icona: 'sync',
      colore: 'linear-gradient(135deg,#0891b2,#0e7490)',
      intro: t('aiuto.sez.sincronizzazione.intro'),
      passi: [
        { titolo: t('aiuto.sez.sincronizzazione.passo0.titolo'), descrizione: t('aiuto.sez.sincronizzazione.passo0.descrizione') },
        { titolo: t('aiuto.sez.sincronizzazione.passo1.titolo'), descrizione: t('aiuto.sez.sincronizzazione.passo1.descrizione') },
        { titolo: t('aiuto.sez.sincronizzazione.passo2.titolo'), descrizione: t('aiuto.sez.sincronizzazione.passo2.descrizione') },
        { titolo: t('aiuto.sez.sincronizzazione.passo3.titolo'), descrizione: t('aiuto.sez.sincronizzazione.passo3.descrizione') },
      ],
    },
    {
      id: 'marketplace',
      titolo: t('aiuto.sez.marketplace.titolo'),
      icona: 'storefront',
      colore: 'linear-gradient(135deg,#f59e0b,#d97706)',
      intro: t('aiuto.sez.marketplace.intro'),
      passi: [
        { titolo: t('aiuto.sez.marketplace.passo0.titolo'), descrizione: t('aiuto.sez.marketplace.passo0.descrizione') },
        { titolo: t('aiuto.sez.marketplace.passo1.titolo'), descrizione: t('aiuto.sez.marketplace.passo1.descrizione') },
        { titolo: t('aiuto.sez.marketplace.passo2.titolo'), descrizione: t('aiuto.sez.marketplace.passo2.descrizione') },
      ],
    },
    {
      id: 'portachiavi',
      titolo: t('aiuto.sez.portachiavi.titolo'),
      icona: 'vpn_key',
      colore: 'linear-gradient(135deg,#7c3aed,#5b21b6)',
      intro: t('aiuto.sez.portachiavi.intro'),
      passi: [
        { titolo: t('aiuto.sez.portachiavi.passo0.titolo'), descrizione: t('aiuto.sez.portachiavi.passo0.descrizione') },
        { titolo: t('aiuto.sez.portachiavi.passo1.titolo'), descrizione: t('aiuto.sez.portachiavi.passo1.descrizione') },
        { titolo: t('aiuto.sez.portachiavi.passo2.titolo'), descrizione: t('aiuto.sez.portachiavi.passo2.descrizione') },
      ],
    },
    {
      id: 'lavagna',
      titolo: t('aiuto.sez.lavagna.titolo'),
      icona: 'sticky_note_2',
      colore: 'linear-gradient(135deg,#ec4899,#db2777)',
      intro: t('aiuto.sez.lavagna.intro'),
      passi: [
        { titolo: t('aiuto.sez.lavagna.passo0.titolo'), descrizione: t('aiuto.sez.lavagna.passo0.descrizione') },
        { titolo: t('aiuto.sez.lavagna.passo1.titolo'), descrizione: t('aiuto.sez.lavagna.passo1.descrizione') },
      ],
    },
    {
      id: 'utenti',
      titolo: 'Gestire utenti e ruoli',
      icona: 'people_outline',
      colore: 'linear-gradient(135deg,#0d9488,#0f766e)',
      intro: 'Invitare il team con permessi differenziati',
      passi: [
        { titolo: 'Creare un utente nuovo', descrizione: 'Solo Owner e Admin possono. "Utenti" → "Nuovo". Username (email), password temporanea, ruolo, nome.' },
        { titolo: 'Ruoli disponibili', descrizione: 'OWNER (full access), ADMIN (full access escluse modifiche fatturazione/piano), COMMERCIALE (clienti, vendite), CONTABILE (fatture, pagamenti, contabilità), MAGAZZINIERE (prodotti, magazzino, documenti di trasporto), OPERATORE (solo lettura più aree base).' },
        { titolo: 'Gruppi per agenda condivisa', descrizione: 'In Impostazioni → Gruppi crea team (es. "Commerciali", "Amministrazione"). Gli appuntamenti condivisi sono visibili solo ai membri dello stesso gruppo.' },
      ],
    },
    {
      id: 'sicurezza',
      titolo: 'Sicurezza dei dati',
      icona: 'shield',
      colore: 'linear-gradient(135deg,#0e2a38,#1e293b)',
      intro: 'Cosa fa Ordeva per proteggere i tuoi dati',
      passi: [
        { titolo: 'Database isolato per azienda', descrizione: 'I dati della tua azienda sono fisicamente separati da quelli di tutti gli altri clienti Ordeva. Nessuna possibilità di leak tra aziende.' },
        { titolo: 'Backup giornalieri automatici', descrizione: 'Ogni notte alle 2:00 viene fatta una copia completa dei tuoi dati. Niente da configurare.' },
        { titolo: 'Connessioni cifrate HTTPS', descrizione: 'Tutti i dati in transito tra il tuo browser e il server sono cifrati TLS. I server sono in Germania (Francoforte), GDPR-compliant.' },
        { titolo: 'Esportazione dati', descrizione: 'In qualsiasi momento, dalla sezione "Impostazioni → Esporta dati" scarichi l\'intero archivio (clienti, fatture, prodotti, contabilità) in formato CSV/JSON. I tuoi dati restano sempre tuoi.' },
      ],
    },
    ];
  }

  /** Sezioni mostrate. In offline: aggiungo "Dati, backup e sincronizzazione",
   *  riscrivo "Sicurezza" (dati sul computer, backup locale) e tolgo "Gestire utenti"
   *  (la gestione multi-utente non fa parte dell'edizione offline). */
  get sezioni(): Sezione[] {
    if (!this.offline) return this.sezioniBase;
    return this.sezioniBase
      .filter(s => s.id !== 'utenti')
      .map(s => (s.id === 'sicurezza' ? this.sicurezzaOffline : s))
      .concat(this.datiOffline);
  }

  /** Nuova sezione (solo offline): dove sono i dati, come spostarli/sincronizzarli. */
  private get datiOffline(): Sezione {
    const t = (k: string) => this.i18n.t(k);
    return {
      id: 'dati',
      titolo: t('aiuto.sez.dati.titolo'),
      icona: 'folder_shared',
      colore: 'linear-gradient(135deg,#11769b,#15a4a2)',
      intro: t('aiuto.sez.dati.intro'),
      passi: [
        { titolo: t('aiuto.sez.dati.passo0.titolo'), descrizione: t('aiuto.sez.dati.passo0.descrizione') },
        { titolo: t('aiuto.sez.dati.passo1.titolo'), descrizione: t('aiuto.sez.dati.passo1.descrizione') },
        { titolo: t('aiuto.sez.dati.passo2.titolo'), descrizione: t('aiuto.sez.dati.passo2.descrizione') },
        { titolo: t('aiuto.sez.dati.passo3.titolo'), descrizione: t('aiuto.sez.dati.passo3.descrizione') },
        { titolo: t('aiuto.sez.dati.passo4.titolo'), descrizione: t('aiuto.sez.dati.passo4.descrizione') },
      ],
    };
  }

  /** Sezione "Sicurezza" riscritta per l'edizione offline (no server/cloud). */
  private get sicurezzaOffline(): Sezione {
    const t = (k: string) => this.i18n.t(k);
    return {
      id: 'sicurezza',
      titolo: t('aiuto.sez.sicurezza.titolo'),
      icona: 'shield',
      colore: 'linear-gradient(135deg,#0e2a38,#1e293b)',
      intro: t('aiuto.sez.sicurezza.intro'),
      passi: [
        { titolo: t('aiuto.sez.sicurezza.passo0.titolo'), descrizione: t('aiuto.sez.sicurezza.passo0.descrizione') },
        { titolo: t('aiuto.sez.sicurezza.passo1.titolo'), descrizione: t('aiuto.sez.sicurezza.passo1.descrizione') },
        { titolo: t('aiuto.sez.sicurezza.passo2.titolo'), descrizione: t('aiuto.sez.sicurezza.passo2.descrizione') },
        { titolo: t('aiuto.sez.sicurezza.passo3.titolo'), descrizione: t('aiuto.sez.sicurezza.passo3.descrizione') },
      ],
    };
  }

  private readonly faqsBase: Faq[] = [
    { domanda: 'Posso usare Ordeva da telefono?', risposta: 'Sì. Apri ordeva.it dal browser del telefono. Per averla come app, click sul menu condivisione di Safari (iPhone) o Chrome (Android) e scegli "Aggiungi alla schermata Home". Diventa una PWA identica a un\'app nativa.' },
    { domanda: 'Cosa succede se mi disconnetto da Internet?', risposta: 'La sola lettura funziona offline (puoi consultare dati già caricati). Per scrivere/salvare serve connessione. Quando torni online le modifiche vengono sincronizzate.' },
    { domanda: 'Posso esportare i miei dati e cambiare gestionale?', risposta: 'Sì. "Impostazioni → Esporta dati" scarica tutto in CSV/JSON. Nessun vincolo, nessun "lock-in". Anche se cancelli l\'account, puoi scaricare prima un export completo.' },
    { domanda: 'Cosa succede se cancello una fattura per errore?', risposta: 'Tutte le operazioni di cancellazione sono tracciate in "Storico" (sezione Sistema). Da lì può essere ripristinata. Solo gli Admin possono accedere allo storico.' },
    { domanda: 'Come faccio a connettere il mio commercialista?', risposta: 'Crea un utente con ruolo CONTABILE: vedrà solo fatturazione, contabilità e compliance. Oppure usa "Compliance → Esporta per commercialista" che genera tutto il pacchetto fiscale del trimestre in un click.' },
    { domanda: 'Le fatture XML sono valide per l\'Agenzia delle Entrate?', risposta: 'Sì, sono generate secondo le specifiche tecniche ufficiali (Fatturazione Elettronica B2B/B2C v1.7+). L\'invio al SDI passa attraverso il tuo provider intermediario configurato in Impostazioni.' },
    { domanda: 'Posso disdire l\'abbonamento in qualsiasi momento?', risposta: 'Sì, senza penali. Da "Impostazioni → Account" un click. Il servizio resta attivo fino alla fine del periodo già pagato, poi viene sospeso. Hai 30 giorni per riattivare o esportare prima della cancellazione definitiva.' },
    { domanda: 'Come funziona la prova gratuita di 14 giorni?', risposta: 'Tutte le funzioni sono attive durante la prova. Niente carta richiesta. Al 14° giorno o sottoscrivi un piano oppure l\'accesso viene sospeso (e i dati conservati 30 giorni per eventuale riattivazione).' },
    { domanda: 'Quanto tempo ci vuole per imparare ad usarlo?', risposta: 'Per emettere la prima fattura: 10-15 minuti se hai già dati cliente. Per padroneggiare tutti i moduli (magazzino, agenda, ecc.): circa una settimana di uso quotidiano. Questa guida ti accompagna step-by-step.' },
  ];

  /** FAQ mostrate: in offline sostituisco quelle SaaS (PWA da telefono, sync online,
   *  abbonamento/prova) con quelle rilevanti per l'app desktop. */
  get faqs(): Faq[] {
    return this.offline ? this.faqsOffline : this.faqsBase;
  }

  private get faqsOffline(): Faq[] {
    const t = (k: string) => this.i18n.t(k);
    return [
      { domanda: t('aiuto.faqOffline.q0'), risposta: t('aiuto.faqOffline.a0') },
      { domanda: t('aiuto.faqOffline.q1'), risposta: t('aiuto.faqOffline.a1') },
      { domanda: t('aiuto.faqOffline.q2'), risposta: t('aiuto.faqOffline.a2') },
      { domanda: t('aiuto.faqOffline.q3'), risposta: t('aiuto.faqOffline.a3') },
      { domanda: t('aiuto.faqOffline.q4'), risposta: t('aiuto.faqOffline.a4') },
      { domanda: t('aiuto.faqOffline.q5'), risposta: t('aiuto.faqOffline.a5') },
      { domanda: t('aiuto.faqOffline.q6'), risposta: t('aiuto.faqOffline.a6') },
      { domanda: t('aiuto.faqOffline.q7'), risposta: t('aiuto.faqOffline.a7') },
    ];
  }

  filter() {
    const q = this.query.trim().toLowerCase();
    if (!q) { this.filtered = []; return; }
    this.filtered = this.sezioni.filter(s => {
      if (s.titolo.toLowerCase().includes(q)) return true;
      if (s.intro.toLowerCase().includes(q)) return true;
      return s.passi.some(p =>
        p.titolo.toLowerCase().includes(q) || p.descrizione.toLowerCase().includes(q));
    });
  }
}
