import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';

/**
 * Pagina FAQ / Guida pubblica.
 *
 * Sicurezza: questo componente non effettua nessuna chiamata HTTP
 * verso /api/*. È contenuto puramente statico. Anche se accessibile
 * senza login, NON espone dati né bypassa l'autenticazione delle API,
 * che restano protette dal middleware authMiddleware sul backend.
 */
@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule, MatExpansionModule, MatButtonModule],
  template: `
    <div class="faq-page">
      <!-- Header -->
      <header class="faq-header">
        <div class="faq-header-inner">
          <a routerLink="/" class="brand">
            <img src="icons/ordeva-icon.png" alt="Ordeva" width="36" height="36">
            <span>Ordeva</span>
          </a>
          <nav class="faq-nav">
            <a href="#cose" class="nav-link">Cos'è</a>
            <a href="#funzioni" class="nav-link">Funzioni</a>
            <a href="#sicurezza" class="nav-link">Sicurezza</a>
            <a href="#prezzi" class="nav-link">Prezzi</a>
            <a routerLink="/" class="login-btn">Accedi</a>
          </nav>
        </div>
      </header>

      <!-- Hero -->
      <section class="hero">
        <h1>Il gestionale che <em>fa quadrare</em> i conti.</h1>
        <p class="hero-sub">
          Fatture elettroniche SDI, magazzino, contabilità, agenda.
          Tutto in un'unica app, accessibile da browser o telefono.
          Pensato per PMI italiane.
        </p>
        <div class="hero-cta">
          <a routerLink="/" class="cta-primary">
            <mat-icon>rocket_launch</mat-icon>
            Inizia gratis — 14 giorni di prova
          </a>
          <a href="#funzioni" class="cta-secondary">Scopri tutte le funzioni</a>
        </div>
      </section>

      <!-- Cos'è -->
      <section id="cose" class="section">
        <div class="section-inner">
          <h2>Cos'è Ordeva</h2>
          <p class="section-lead">
            Un gestionale ERP cloud-native per piccole e medie imprese italiane,
            studi professionali e artigiani. Sostituisce 4-5 software diversi
            (gestionale, fatturazione, contabilità, magazzino) con
            un'unica piattaforma integrata.
          </p>
          <div class="card-grid card-grid-3">
            <div class="card">
              <mat-icon>cloud_done</mat-icon>
              <h3>Cloud, niente installazioni</h3>
              <p>Accedi da qualsiasi browser. I dati sono al sicuro su server europei (Francoforte, GDPR-compliant). Backup giornalieri automatici.</p>
            </div>
            <div class="card">
              <mat-icon>phone_iphone</mat-icon>
              <h3>Funziona anche da mobile</h3>
              <p>PWA installabile su iPhone e Android: emetti fatture, controlla magazzino e firma documenti di trasporto direttamente dal telefono.</p>
            </div>
            <div class="card">
              <mat-icon>group</mat-icon>
              <h3>Multi-utente con ruoli</h3>
              <p>Inviti il tuo team, assegni ruoli (Owner, Admin, Commerciale, Contabile, Operatore) e ognuno vede solo quello che deve.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Funzioni -->
      <section id="funzioni" class="section section-alt">
        <div class="section-inner">
          <h2>Tutto quello che ti serve, niente di superfluo</h2>
          <div class="feature-grid">
            <div class="feature">
              <div class="feature-icon" style="background:linear-gradient(135deg,#0284c7,#0369a1)"><mat-icon>people</mat-icon></div>
              <h3>Anagrafica</h3>
              <p>Clienti, fornitori, prodotti, varianti, listini differenziati. Lookup veloce, import CSV, ricerca globale.</p>
            </div>
            <div class="feature">
              <div class="feature-icon" style="background:linear-gradient(135deg,#7c3aed,#6d28d9)"><mat-icon>receipt_long</mat-icon></div>
              <h3>Fatturazione elettronica SDI</h3>
              <p>Genera XML conformi, invia tramite il tuo provider SDI, scarica le ricevute. Note di credito, ricorrenti, autofatture.</p>
            </div>
            <div class="feature">
              <div class="feature-icon" style="background:linear-gradient(135deg,#d97706,#b45309)"><mat-icon>shopping_bag</mat-icon></div>
              <h3>Acquisti + OCR fatture</h3>
              <p>Carica una fattura passiva PDF e l'OCR estrae automaticamente fornitore, righe, totali. Niente più data entry.</p>
            </div>
            <div class="feature">
              <div class="feature-icon" style="background:linear-gradient(135deg,#65a30d,#4d7c0f)"><mat-icon>warehouse</mat-icon></div>
              <h3>Magazzino in tempo reale</h3>
              <p>Carichi, scarichi, varianti per taglia/colore, soglie minime con alert. Storico movimenti completo.</p>
            </div>
            <div class="feature">
              <div class="feature-icon" style="background:linear-gradient(135deg,#16a34a,#15803d)"><mat-icon>payments</mat-icon></div>
              <h3>Contabilità + scadenzario</h3>
              <p>Prima nota, scadenze attive/passive, riconciliazione bancaria via import CSV/OFX. Solleciti automatici via email.</p>
            </div>
            <div class="feature">
              <div class="feature-icon" style="background:linear-gradient(135deg,#0d9488,#0f766e)"><mat-icon>verified</mat-icon></div>
              <h3>Compliance fiscale</h3>
              <p>LIPE, esterometro, export per commercialista. Numeri sempre in ordine, niente sorprese a fine trimestre.</p>
            </div>
            <div class="feature">
              <div class="feature-icon" style="background:linear-gradient(135deg,#4f46e5,#4338ca)"><mat-icon>event_note</mat-icon></div>
              <h3>Agenda condivisa</h3>
              <p>Appuntamenti, todo, scadenze su un'unica vista calendario. Sync ICS con Google Calendar, Outlook, Apple Calendar.</p>
            </div>
            <div class="feature">
              <div class="feature-icon" style="background:linear-gradient(135deg,#dc2626,#b91c1c)"><mat-icon>point_of_sale</mat-icon></div>
              <h3>Vendita al banco</h3>
              <p>Cassa veloce per negozi: scansiona codice a barre, incassa, stampa scontrino o emetti fattura immediata.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Sicurezza -->
      <section id="sicurezza" class="section">
        <div class="section-inner">
          <h2>I tuoi dati, sicuri come in cassaforte</h2>
          <div class="card-grid card-grid-2">
            <div class="card">
              <mat-icon>shield</mat-icon>
              <h3>Isolamento totale per azienda</h3>
              <p>Ogni cliente ha il proprio database fisicamente separato. È impossibile che un'altra azienda registrata possa vedere i tuoi dati, anche per errore.</p>
            </div>
            <div class="card">
              <mat-icon>backup</mat-icon>
              <h3>Backup giornalieri automatici</h3>
              <p>Ogni notte facciamo un backup completo dei dati della tua azienda. Niente da configurare, niente da ricordarsi.</p>
            </div>
            <div class="card">
              <mat-icon>https</mat-icon>
              <h3>Crittografia in transito</h3>
              <p>Tutte le connessioni sono HTTPS con certificato Let's Encrypt. Le password sono cifrate con bcrypt (10 rounds).</p>
            </div>
            <div class="card">
              <mat-icon>eu</mat-icon>
              <h3>Server in UE, GDPR-compliant</h3>
              <p>I dati sono fisicamente custoditi a Francoforte (Germania). Mai trasferimenti extra-UE senza il tuo consenso.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Prezzi (placeholder) -->
      <section id="prezzi" class="section section-alt">
        <div class="section-inner">
          <h2>Prezzi semplici, niente sorprese</h2>
          <p class="section-lead">Provi 14 giorni completamente gratis, senza inserire la carta. Se ti piace, scegli il piano.</p>
          <div class="card-grid card-grid-3 pricing">
            <div class="card pricing-card">
              <h3>Trial</h3>
              <div class="price"><span class="amount">€ 0</span><span class="period">/ 14 giorni</span></div>
              <ul class="check-list">
                <li><mat-icon>check_circle</mat-icon> Tutte le funzioni attive</li>
                <li><mat-icon>check_circle</mat-icon> 3 utenti</li>
                <li><mat-icon>check_circle</mat-icon> Nessuna carta richiesta</li>
                <li><mat-icon>check_circle</mat-icon> Cancellazione automatica a fine prova</li>
              </ul>
              <a routerLink="/" class="pricing-cta">Inizia ora</a>
            </div>
            <div class="card pricing-card pricing-featured">
              <div class="pricing-badge">Più scelto</div>
              <h3>Business</h3>
              <div class="price"><span class="amount">€ 29</span><span class="period">/ mese</span></div>
              <ul class="check-list">
                <li><mat-icon>check_circle</mat-icon> Fino a 10 utenti</li>
                <li><mat-icon>check_circle</mat-icon> Fatture e documenti di trasporto illimitati</li>
                <li><mat-icon>check_circle</mat-icon> SDI integrato</li>
                <li><mat-icon>check_circle</mat-icon> OCR fatture (50/mese)</li>
                <li><mat-icon>check_circle</mat-icon> Supporto email</li>
              </ul>
              <a routerLink="/" class="pricing-cta pricing-cta-primary">Inizia il trial</a>
            </div>
            <div class="card pricing-card">
              <h3>Pro</h3>
              <div class="price"><span class="amount">€ 79</span><span class="period">/ mese</span></div>
              <ul class="check-list">
                <li><mat-icon>check_circle</mat-icon> Utenti illimitati</li>
                <li><mat-icon>check_circle</mat-icon> OCR fatture illimitato</li>
                <li><mat-icon>check_circle</mat-icon> Import ordini da eBay, Amazon e Shopify</li>
                <li><mat-icon>check_circle</mat-icon> API access</li>
                <li><mat-icon>check_circle</mat-icon> Supporto prioritario</li>
              </ul>
              <a routerLink="/" class="pricing-cta">Contattaci</a>
            </div>
          </div>
          <p class="pricing-note">
            Prezzi IVA esclusa. Pagamento mensile via Stripe (carta o SEPA).
            Disdetta in qualsiasi momento, niente vincoli.
          </p>
        </div>
      </section>

      <!-- FAQ -->
      <section class="section">
        <div class="section-inner">
          <h2>Domande frequenti</h2>
          <mat-accordion class="faq-accordion">

            <mat-expansion-panel>
              <mat-expansion-panel-header>
                <mat-panel-title>Devo installare qualcosa sul mio computer?</mat-panel-title>
              </mat-expansion-panel-header>
              <p>No. Ordeva funziona interamente nel browser. Da telefono puoi installare la PWA come fosse un'app nativa (dal menu condivisione di Safari / Chrome → "Aggiungi alla schermata Home") ma non è obbligatorio.</p>
            </mat-expansion-panel>

            <mat-expansion-panel>
              <mat-expansion-panel-header>
                <mat-panel-title>I miei dati restano miei?</mat-panel-title>
              </mat-expansion-panel-header>
              <p>Sì, sempre. In qualsiasi momento puoi esportare l'intero database della tua azienda (clienti, fatture, magazzino, tutto) in formato standard. Se decidi di andartene, te lo portano via in 5 minuti.</p>
            </mat-expansion-panel>

            <mat-expansion-panel>
              <mat-expansion-panel-header>
                <mat-panel-title>Come funziona la fatturazione elettronica verso SDI?</mat-panel-title>
              </mat-expansion-panel-header>
              <p>Ordeva genera l'XML conforme alle specifiche dell'Agenzia delle Entrate. L'invio al Sistema di Interscambio (SDI) avviene tramite un provider intermediario che configuri nelle impostazioni (sono compatibili tutti i principali: Aruba, Fattura24, FattureinCloud, intermediari del commercialista, ecc.).</p>
            </mat-expansion-panel>

            <mat-expansion-panel>
              <mat-expansion-panel-header>
                <mat-panel-title>Posso usarlo da telefono?</mat-panel-title>
              </mat-expansion-panel-header>
              <p>Sì, Ordeva è una PWA (Progressive Web App): si installa come un'app vera su iPhone e Android, funziona anche offline per le funzioni di sola lettura, e ha un layout ottimizzato per schermi piccoli (19.5:9 e 20:9 supportati nativamente).</p>
            </mat-expansion-panel>

            <mat-expansion-panel>
              <mat-expansion-panel-header>
                <mat-panel-title>Quante persone della mia azienda possono usarlo?</mat-panel-title>
              </mat-expansion-panel-header>
              <p>Dipende dal piano. Trial: 3 utenti. Business: 10 utenti. Pro: illimitati. Ogni utente ha il suo accesso con username/password e ruolo (Owner, Admin, Commerciale, Contabile, Operatore). I ruoli decidono cosa può vedere e modificare.</p>
            </mat-expansion-panel>

            <mat-expansion-panel>
              <mat-expansion-panel-header>
                <mat-panel-title>Come posso annullare il mio abbonamento?</mat-panel-title>
              </mat-expansion-panel-header>
              <p>Dalla pagina "Impostazioni → Account" un clic e fatto. Nessuna penale, nessun periodo di vincolo. Il servizio resta attivo fino alla fine del periodo già pagato, poi viene sospeso. Puoi sempre scaricare i tuoi dati prima.</p>
            </mat-expansion-panel>

            <mat-expansion-panel>
              <mat-expansion-panel-header>
                <mat-panel-title>Cosa succede se dimentico la password?</mat-panel-title>
              </mat-expansion-panel-header>
              <p>Dalla schermata di login c'è il link "Password dimenticata?" — inserisci la tua email e ti arriva un messaggio con un link temporaneo per impostarne una nuova. Se sei amministratore della tua azienda puoi resettare anche le password degli altri utenti del tuo team dalla sezione Utenti.</p>
            </mat-expansion-panel>

            <mat-expansion-panel>
              <mat-expansion-panel-header>
                <mat-panel-title>Posso integrare il mio commercialista?</mat-panel-title>
              </mat-expansion-panel-header>
              <p>Sì. Puoi creare un utente per il commercialista (ruolo Contabile) che vede solo il modulo Contabilità + Compliance, oppure usare l'export periodico (LIPE, registri IVA, prima nota) che invii via email.</p>
            </mat-expansion-panel>

            <mat-expansion-panel>
              <mat-expansion-panel-header>
                <mat-panel-title>Quanto costa il supporto?</mat-panel-title>
              </mat-expansion-panel-header>
              <p>Il supporto via email è sempre incluso. Sul piano Pro c'è anche il supporto prioritario con risposta garantita entro 4 ore lavorative. Se serve assistenza one-to-one (formazione, migrazione da altro gestionale) è un servizio opzionale a parte.</p>
            </mat-expansion-panel>

          </mat-accordion>
        </div>
      </section>

      <!-- Footer -->
      <footer class="footer">
        <div class="footer-inner">
          <div class="footer-brand">
            <img src="icons/ordeva-icon.png" alt="Ordeva" width="28" height="28">
            <span>Ordeva</span>
          </div>
          <nav class="footer-nav">
            <a href="#cose">Cos'è</a>
            <a href="#funzioni">Funzioni</a>
            <a href="#prezzi">Prezzi</a>
            <a routerLink="/termini">Termini</a>
            <a routerLink="/privacy">Privacy</a>
            <a routerLink="/cookie">Cookie</a>
            <a routerLink="/">Accedi</a>
          </nav>
          <p class="footer-legal">
            © {{ year }} Ordeva — Gestionale ERP per PMI italiane<br>
            Operato da [Ragione Sociale] · P.IVA [P.IVA] · Sede [Indirizzo]
          </p>
        </div>
      </footer>
    </div>
  `,
  styles: [`
    .faq-page {
      background: #f6f7fb;
      min-height: 100vh;
      color: #0f172a;
      font-family: 'Inter', 'Roboto', system-ui, -apple-system, sans-serif;
      line-height: 1.55;
    }

    /* Header */
    .faq-header {
      position: sticky; top: 0; z-index: 50;
      background: rgba(255,255,255,0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid #e6e8ee;
    }
    .faq-header-inner {
      max-width: 1100px; margin: 0 auto;
      padding: 14px 24px;
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px;
    }
    .brand {
      display: flex; align-items: center; gap: 10px;
      text-decoration: none; color: #0e2a38;
      font-weight: 800; font-size: 18px; letter-spacing: -0.01em;
    }
    .faq-nav { display: flex; align-items: center; gap: 28px; }
    .nav-link {
      color: #475569; text-decoration: none; font-weight: 500; font-size: 14px;
      transition: color 0.15s;
    }
    .nav-link:hover { color: #11769b; }
    .login-btn {
      background: linear-gradient(135deg, #11769b 0%, #15a4a2 100%);
      color: #fff; text-decoration: none;
      padding: 8px 18px; border-radius: 8px;
      font-weight: 600; font-size: 14px;
      box-shadow: 0 4px 12px -2px rgba(17,118,155,0.35);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .login-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px -2px rgba(17,118,155,0.50);
    }
    @media (max-width: 640px) {
      .faq-nav { gap: 14px; }
      .nav-link:not(.login-btn) { display: none; }
    }

    /* Hero */
    .hero {
      max-width: 1100px; margin: 0 auto;
      padding: 80px 24px 60px;
      text-align: center;
    }
    .hero h1 {
      font-size: clamp(32px, 5vw, 56px);
      font-weight: 800; letter-spacing: -0.025em;
      margin: 0 0 18px;
      color: #0e2a38;
    }
    .hero h1 em {
      font-style: normal;
      background: linear-gradient(135deg, #11769b 0%, #15a4a2 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .hero-sub {
      font-size: 18px;
      color: #475569;
      max-width: 680px; margin: 0 auto 32px;
    }
    .hero-cta {
      display: flex; gap: 16px; justify-content: center;
      flex-wrap: wrap;
    }
    .cta-primary {
      display: inline-flex; align-items: center; gap: 8px;
      background: linear-gradient(135deg, #11769b 0%, #15a4a2 100%);
      color: #fff; text-decoration: none;
      padding: 14px 28px; border-radius: 10px;
      font-weight: 600; font-size: 16px;
      box-shadow: 0 8px 24px -4px rgba(17,118,155,0.45);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .cta-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 32px -4px rgba(17,118,155,0.60);
    }
    .cta-primary mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .cta-secondary {
      color: #11769b; text-decoration: none;
      padding: 14px 18px; font-weight: 500; font-size: 15px;
      border-bottom: 1px solid transparent; transition: border-color 0.15s;
    }
    .cta-secondary:hover { border-bottom-color: #11769b; }

    /* Sections */
    .section { padding: 70px 0; }
    .section-alt { background: #fff; }
    .section-inner { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
    .section h2 {
      font-size: clamp(26px, 3.5vw, 38px);
      font-weight: 800; letter-spacing: -0.02em;
      margin: 0 0 16px; color: #0e2a38;
      text-align: center;
    }
    .section-lead {
      font-size: 17px; color: #64748b;
      max-width: 720px; margin: 0 auto 48px;
      text-align: center;
    }

    /* Card grid */
    .card-grid { display: grid; gap: 20px; }
    .card-grid-2 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .card-grid-3 { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .card {
      background: #fff;
      border: 1px solid #e6e8ee;
      border-radius: 14px;
      padding: 24px;
      transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s;
    }
    .section-alt .card { background: #f8fafc; }
    .card:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 24px -8px rgba(15,23,42,0.10);
      border-color: #d4d7df;
    }
    .card mat-icon {
      font-size: 32px; width: 32px; height: 32px;
      color: #11769b; margin-bottom: 12px;
    }
    .card h3 {
      font-size: 17px; font-weight: 700; letter-spacing: -0.01em;
      margin: 0 0 8px; color: #0e2a38;
    }
    .card p {
      font-size: 14px; color: #475569; margin: 0;
    }

    /* Feature grid */
    .feature-grid {
      display: grid; gap: 28px;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
    .feature {
      text-align: left;
    }
    .feature-icon {
      width: 48px; height: 48px;
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 14px;
      box-shadow: 0 4px 12px -2px rgba(15,23,42,0.10);
    }
    .feature-icon mat-icon {
      color: #fff; font-size: 24px; width: 24px; height: 24px; margin: 0;
    }
    .feature h3 {
      font-size: 17px; font-weight: 700; letter-spacing: -0.01em;
      margin: 0 0 6px; color: #0e2a38;
    }
    .feature p {
      font-size: 14px; color: #64748b; margin: 0;
    }

    /* Pricing */
    .pricing { align-items: stretch; }
    .pricing-card {
      display: flex; flex-direction: column;
      text-align: left; padding: 28px 24px;
      position: relative;
    }
    .pricing-card h3 {
      font-size: 14px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: #94a3b8;
      margin: 0 0 8px;
    }
    .pricing-card .price {
      display: flex; align-items: baseline; gap: 8px;
      margin-bottom: 20px;
    }
    .pricing-card .amount {
      font-size: 36px; font-weight: 800; letter-spacing: -0.03em;
      color: #0e2a38;
    }
    .pricing-card .period {
      font-size: 14px; color: #64748b;
    }
    .check-list {
      list-style: none; padding: 0; margin: 0 0 24px;
      flex: 1;
    }
    .check-list li {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 0; font-size: 14px; color: #334155;
    }
    .check-list mat-icon {
      font-size: 18px; width: 18px; height: 18px;
      color: #15a4a2; margin: 0;
    }
    .pricing-cta {
      display: block; text-align: center;
      padding: 11px 18px; border-radius: 10px;
      font-weight: 600; font-size: 14px;
      text-decoration: none;
      border: 1px solid #d4d7df;
      color: #0e2a38;
      transition: background 0.15s, border-color 0.15s;
    }
    .pricing-cta:hover { background: #f6f7fb; border-color: #94a3b8; }
    .pricing-cta-primary {
      background: linear-gradient(135deg, #11769b 0%, #15a4a2 100%);
      color: #fff; border-color: transparent;
      box-shadow: 0 4px 12px -2px rgba(17,118,155,0.35);
    }
    .pricing-cta-primary:hover {
      background: linear-gradient(135deg, #0e6480 0%, #128498 100%);
      border-color: transparent;
    }
    .pricing-featured {
      border-color: #11769b;
      box-shadow: 0 8px 24px -8px rgba(17,118,155,0.20);
      transform: scale(1.02);
    }
    .pricing-featured .amount { color: #11769b; }
    .pricing-badge {
      position: absolute; top: -10px; right: 16px;
      background: linear-gradient(135deg, #11769b 0%, #15a4a2 100%);
      color: #fff; font-size: 11px; font-weight: 700;
      padding: 4px 12px; border-radius: 999px;
      letter-spacing: 0.04em; text-transform: uppercase;
    }
    .pricing-note {
      text-align: center; color: #94a3b8;
      font-size: 13px; margin-top: 32px;
    }

    /* FAQ accordion */
    .faq-accordion {
      max-width: 760px; margin: 0 auto;
      display: block;
    }
    ::ng-deep .faq-accordion .mat-expansion-panel {
      margin-bottom: 12px !important;
      border-radius: 10px !important;
      box-shadow: 0 1px 2px rgba(15,23,42,0.05) !important;
      border: 1px solid #e6e8ee !important;
    }
    ::ng-deep .faq-accordion .mat-expansion-panel-header {
      padding: 0 22px !important;
      height: 60px !important;
    }
    ::ng-deep .faq-accordion .mat-expansion-panel-header-title {
      font-weight: 600 !important;
      color: #0e2a38 !important;
      font-size: 15px !important;
    }
    ::ng-deep .faq-accordion .mat-expansion-panel-body {
      padding: 0 22px 18px !important;
    }
    ::ng-deep .faq-accordion .mat-expansion-panel-body p {
      margin: 0;
      color: #475569; font-size: 14px;
    }

    /* Footer */
    .footer {
      background: #0e2a38;
      color: #cbd5e1;
      padding: 50px 0;
      margin-top: 40px;
    }
    .footer-inner {
      max-width: 1100px; margin: 0 auto;
      padding: 0 24px;
      display: flex; flex-direction: column; align-items: center;
      gap: 22px;
    }
    .footer-brand {
      display: flex; align-items: center; gap: 10px;
      font-weight: 800; font-size: 17px; color: #fff;
    }
    .footer-nav {
      display: flex; gap: 28px;
      flex-wrap: wrap; justify-content: center;
    }
    .footer-nav a {
      color: #94a3b8; text-decoration: none;
      font-size: 14px; font-weight: 500;
      transition: color 0.15s;
    }
    .footer-nav a:hover { color: #5eead4; }
    .footer-legal {
      text-align: center;
      font-size: 12px;
      color: #64748b;
      margin: 0; line-height: 1.7;
    }
  `]
})
export class FaqComponent {
  readonly year = new Date().getFullYear();
}
