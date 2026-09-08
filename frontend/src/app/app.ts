import { Component, OnInit, AfterViewInit, AfterViewChecked, OnDestroy, HostListener, ElementRef, ViewChild, NgZone, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { DataService } from './services/data.service';
import { AuthService } from './services/auth.service';
import { NotificationService, NotificationBadges } from './services/notifications.service';
import { RemindersService, Reminder } from './services/reminders.service';
import { OfflineService } from './services/offline.service';
import { ModuliService } from './services/moduli.service';
import { DocLockService } from './services/doc-lock.service';
import { LayoutService } from './services/layout.service';
import { I18nService } from './services/i18n.service';
import { TPipe } from './pipes/t.pipe';
import { WindowTitleService } from './services/window-title.service';
import { NativeMenuService } from './services/native-menu.service';
import { DesktopService } from './services/desktop.service';
import { ShortcutsDialogComponent } from './components/shared/shortcuts-dialog';
import { LoginComponent } from './components/login/login';
import { CookieConsentComponent } from './components/shared/cookie-consent';
import { LockScreenComponent } from './components/shared/lock-screen';
import { Azienda } from './models';
import { SwUpdate } from '@angular/service-worker';
import { lsGet, lsSet } from './utils/safe-storage';
import { environment } from '../environments/environment';
import { UpdateService } from './services/update.service';

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  children?: NavItem[];
  /** Se true, la voce è visibile solo agli utenti con ruolo SUPERADMIN. */
  superadminOnly?: boolean;
  /** Se true, la voce è visibile a SUPERADMIN o ADMIN. */
  adminOnly?: boolean;
  /** Se true, la voce è nascosta nell'edizione offline desktop (parti SaaS/cloud). */
  hideOffline?: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, RouterOutlet, RouterLink, RouterLinkActive,
    MatToolbarModule, MatListModule,
    MatIconModule, MatExpansionModule, MatMenuModule, MatButtonModule, MatTooltipModule,
    MatBadgeModule, MatInputModule, MatFormFieldModule, FormsModule,
    LoginComponent, CookieConsentComponent, LockScreenComponent,
    TPipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, AfterViewInit, AfterViewChecked, OnDestroy {
  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;
  /** Container della barra superiore: serve a calcolare quante voci entrano. */
  @ViewChild('topNavEl') topNavEl?: ElementRef<HTMLElement>;
  /** Data nella topbar: serve a misurarne lo spazio e scegliere il formato. */
  @ViewChild('topbarDate') topbarDateRef?: ElementRef<HTMLElement>;

  azienda: Azienda | null = null;
  collapsed = false;
  loggedIn = false;
  /** Edizione offline desktop: nasconde le parti SaaS (logout, banner trial/verifica/installa). */
  readonly offline = environment.offline;
  /**
   * Edizione offline: app bloccata in attesa della password d'accesso.
   * Stato iniziale ottimistico (da hint locale) per evitare il flash della UI;
   * poi confermato/corretto col backend in ngOnInit.
   */
  // Lo sblocco dei dati è ora gestito all'avvio dal selettore archivi (cifratura
  // per-archivio, lato Rust): niente più lock-screen della password-programma in-app.
  locked = false;

  /**
   * Data odierna nella topbar, dal formato più lungo al più corto. Lo spazio al
   * centro dipende dalla larghezza schermo E dalla lunghezza della ragione
   * sociale, quindi scegliamo via misura (updateDateLabel) il formato che entra.
   */
  private readonly dateFormats: string[] = App.buildDateFormats();
  /** Formato attualmente mostrato (stringa vuota = non c'è spazio, nascosta). */
  oggiLabel = this.dateFormats[0];
  private dateMeasureCtx: CanvasRenderingContext2D | null = null;

  private static buildDateFormats(): string[] {
    const d = new Date();
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const fmt = (o: Intl.DateTimeFormatOptions) =>
      cap(d.toLocaleDateString('it-IT', o).replace(/\./g, '').replace(/,/g, ''));
    const p = (n: number) => String(n).padStart(2, '0');
    const dmy = `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
    return [
      fmt({ weekday: 'long',  day: 'numeric', month: 'long',  year: 'numeric' }), // Lunedì 8 giugno 2026
      fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), // Lun 8 giu 2026
      `${dmy}/${d.getFullYear()}`,                                                // 08/06/2026
      `${dmy}/${String(d.getFullYear()).slice(2)}`,                              // 08/06/26
    ];
  }

  // ── Barra superiore: priority-nav ("⋯ Altro") ───────────────────────────────
  /** Quante voci mostrare in barra; le restanti finiscono nel menu "Altro". */
  navMaxVisible = 99;
  /** Larghezze reali (px) delle voci dock, misurate quando sono tutte renderizzate. */
  private navItemWidths: number[] = [];
  private navLastTotal = -1;
  private navRecomputePending = false;
  private navRO?: ResizeObserver;
  private navObservedEl?: HTMLElement;
  /**
   * True quando l'URL corrente è una route pubblica (es. /faq).
   * Le public route NON richiedono autenticazione: vengono renderizzate
   * direttamente senza login overlay né sidebar/shell. Sono pagine
   * statiche che NON chiamano API protette — quindi non rappresentano
   * un bypass dell'auth, che resta enforced dal backend.
   */
  publicRoute = false;
  private readonly PUBLIC_PATHS = ['/faq', '/guida', '/termini', '/privacy', '/cookie', '/reset-password', '/verify-email', '/trial-expired'];
  badges: NotificationBadges = { scadenzeScadute: 0, prodottiSottoSoglia: 0, solleciti: 0 };
  searchQuery = '';
  searchResults: { label: string; tipo: string; route: string; id: number }[] = [];
  /** Comandi di navigazione/azione filtrati (palette ⌘K). */
  commandResults: { label: string; icon: string; route: string; state?: Record<string, any> }[] = [];
  /** Risposta/bozza interpretata dalla barra comandi (parser deterministico server). */
  smartItem: any = null;
  /** Indice evidenziato nella palette (navigazione con ↑/↓). */
  highlightedIndex = 0;
  showSearch = false;
  showNotif = false;
  notifItems: any[] = [];
  loadingNotif = false;
  /** Promemoria agenda scattati (campanella in topbar). */
  reminders: Reminder[] = [];
  showReminders = false;
  readonly quickActions: { label: string; icon: string; route: string; state?: Record<string, any> }[] = [
    { label: 'Nuova fattura',     icon: 'receipt_long',   route: '/fatture',    state: { nuovaBozza: {} } },
    { label: 'Nuovo cliente',     icon: 'person_add',     route: '/clienti',    state: { prefill: {} } },
    { label: 'Nuovo prodotto',    icon: 'add_box',        route: '/prodotti',   state: { prefill: {} } },
    { label: 'Nuovo preventivo',  icon: 'description',    route: '/preventivi', state: { nuovaBozza: {} } },
    { label: 'Nuovo documento di trasporto', icon: 'local_shipping', route: '/ddt', state: { nuovaBozza: {} } },
    { label: 'Vendita al banco',  icon: 'point_of_sale',  route: '/vendita-banco' },
    { label: 'Vai a dashboard',   icon: 'dashboard',      route: '/dashboard' },
    { label: 'Vai a magazzino',   icon: 'inventory',      route: '/magazzino' },
    { label: 'Vai a scadenzario', icon: 'event',          route: '/scadenzario' },
    { label: 'Vai a report',      icon: 'analytics',      route: '/report' },
  ];
  showInstallBanner = false;
  showUpdateBanner = false;
  showEmailVerifyBanner = false;
  resendingVerification = false;
  /** Giorni residui del trial; null se non in trial o oltre 7gg. */
  trialDaysLeft: number | null = null;
  isOffline = false;
  private searchSubject = new Subject<string>();
  private cmdSubject = new Subject<string>();
  private installPromptEvent: any = null;

  constructor(
    private ds: DataService,
    private authSvc: AuthService,
    private notifSvc: NotificationService,
    private remindersSvc: RemindersService,
    private router: Router,
    private elRef: ElementRef,
    private swUpdate: SwUpdate,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    private offlineSvc: OfflineService,
    public moduli: ModuliService,
    private docLockSvc: DocLockService,
    public layout: LayoutService,
    private zone: NgZone,
    public update: UpdateService,
    private windowTitle: WindowTitleService,
    private nativeMenu: NativeMenuService,
    private desktop: DesktopService,
    private i18n: I18nService,
  ) {
    this.loggedIn = authSvc.isLoggedIn();
    this.updatePublicRoute(this.router.url);
    this.router.events.subscribe(e => {
      if (e instanceof NavigationEnd) this.updatePublicRoute(e.urlAfterRedirects);
    });
    // Tema "liquid glass" attivo col layout fluttuante: classe sul <body> così
    // coprono anche gli overlay (dialog/menu) renderizzati fuori dalla shell.
    effect(() => {
      const floating = this.layout.navLayout() === 'floating';
      document.body.classList.toggle('glass-ui', floating);
      // Il layout cambia la larghezza della topbar → rivaluto il formato data.
      requestAnimationFrame(() => this.zone.run(() => this.updateDateLabel()));
    });
  }

  private updatePublicRoute(url: string) {
    const path = (url.split('?')[0] || '').toLowerCase();
    this.publicRoute = this.PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'));
  }

  ngOnInit() {
    this.nativeMenu.start();   // ponte menu nativo → azioni SPA (no-op su web)
    this.setupNativeFeel();    // comportamenti "da app" (solo desktop offline)
    // Tema chiaro/scuro: applicato dal costruttore di LayoutService (stesso
    // meccanismo di navLayout/density, spostato in Impostazioni → Aspetto).

    // (La vecchia password-programma in-app è stata sostituita dalla password
    // per-archivio, richiesta all'avvio dal selettore archivi: nessun controllo qui.)
    // Se non c'è blocco password, valuta subito l'avviso di backup scaduto.
    if (this.offline && !this.locked) this.checkBackupAlert();

    // Controllo aggiornamenti (edizione offline): rispetta la frequenza scelta in
    // Impostazioni → Aggiornamenti; se attiva l'auto-installazione, aggiorna da solo.
    if (this.offline) this.update.checkAuto();

    // Uso del DB su Dropbox da più PC: se all'avvio risulta una sessione aperta su un
    // altro computer, avviso (lavorarci contemporaneamente può corrompere i dati).
    if (this.offline && this.desktop.isDesktop) this.checkDropboxLock();

    // Quando cambiano i moduli attivi (login, caricamento, modifiche in Impostazioni)
    // cambia il numero di voci in barra: ricalcolo l'overflow del priority-nav.
    this.moduli.attivi$.subscribe(() =>
      requestAnimationFrame(() => this.zone.run(() => this.computeNavOverflow())));

    this.offlineSvc.offline$.subscribe(v => this.isOffline = v);
    // Edizione desktop: il backend è in-process (ordeva.localhost) e NON dipende da
    // internet, quindi un calo di connessione del PC non significa "backend non
    // raggiungibile". Lì il banner lo decide solo l'esito reale delle chiamate API
    // (vedi authInterceptor, con soglia anti falsi-positivi). Su web invece lo stato
    // di rete del browser è un segnale valido.
    if (this.offline) {
      this.offlineSvc.setOffline(false);
    } else {
      window.addEventListener('online',  () => this.offlineSvc.setOffline(false));
      window.addEventListener('offline', () => this.offlineSvc.setOffline(true));
    }

    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.installPromptEvent = e;
      if (lsGet('pwa-install-dismissed') !== '1') {
        this.showInstallBanner = true;
      }
    });

    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.subscribe(evt => {
        if (evt.type === 'VERSION_READY') this.showUpdateBanner = true;
      });
    }

    if (!this.loggedIn) return;
    this.ds.getAzienda().subscribe({
      next: a => {
        this.azienda = a;
        this.windowTitle.setAzienda(a?.ragioneSociale);
        // La ragione sociale cambia la larghezza occupata a sinistra: ricalcolo
        // il formato della data (dopo il render del nuovo nome).
        requestAnimationFrame(() => this.zone.run(() => this.updateDateLabel()));
        // Inizializza il flag globale "blocca documenti salvati" dal valore
        // persistito sull'azienda; default true se non impostato.
        this.docLockSvc.setEnabled(a?.lockDocumentiDefault !== false);
      },
      error: () => {},
    });
    this.moduli.load().subscribe();
    if (window.innerWidth < 768) this.collapsed = true;

    // Verifica freshness dello stato email del'utente: se ha appena confermato
    // da un altro tab, il banner deve sparire automaticamente.
    this.authSvc.refreshUser().subscribe({
      next: (u: any) => {
        const dismissed = sessionStorage.getItem('email-verify-dismissed') === '1';
        this.showEmailVerifyBanner = !!u && u.emailVerified === false && !dismissed;
        // Countdown trial
        if (u?.piano === 'trial' && u?.trialScadeIl) {
          const diff = (new Date(u.trialScadeIl + 'T23:59:59').getTime() - Date.now()) / 86400000;
          this.trialDaysLeft = diff >= 0 && diff <= 7 ? Math.ceil(diff) : null;
        } else {
          this.trialDaysLeft = null;
        }
      },
      error: () => {},
    });

    this.notifSvc.start();
    this.notifSvc.badges.subscribe(b => this.badges = b);

    // Promemoria agenda: avvio la sorveglianza e mostro un toast quando scattano.
    this.remindersSvc.start();
    this.remindersSvc.attivi.subscribe(list => this.reminders = list);
    this.remindersSvc.scattato.subscribe(r => this.onReminderScattato(r));

    this.searchSubject.pipe(
      debounceTime(250), distinctUntilChanged(),
      switchMap(q => q.length >= 2 ? this.ds.searchGlobal(q) : [{ clienti: [], fornitori: [], prodotti: [], fatture: [], ddt: [], ordini: [], preventivi: [] }])
    ).subscribe(r => {
      this.searchResults = [
        ...r.clienti.map((x: any)    => ({ ...x, tipo: 'Cliente' })),
        ...r.fornitori.map((x: any)  => ({ ...x, tipo: 'Fornitore' })),
        ...r.prodotti.map((x: any)   => ({ ...x, tipo: 'Prodotto' })),
        ...r.fatture.map((x: any)    => ({ ...x, tipo: 'Fattura' })),
        ...r.ddt.map((x: any)        => ({ ...x, tipo: 'Doc. di trasporto' })),
        ...r.ordini.map((x: any)     => ({ ...x, tipo: 'Ordine' })),
        ...r.preventivi.map((x: any) => ({ ...x, tipo: 'Preventivo' })),
      ];
      this.showSearch = this.searchResults.length > 0;
    });

    // Barra comandi: interpreta la frase lato server (parser deterministico, nessun
    // costo). Per frasi corte non chiama nulla. Il risultato diventa la prima voce
    // della palette; se non riconosce nulla, smartItem=null e resta la ricerca.
    this.cmdSubject.pipe(
      debounceTime(280), distinctUntilChanged(),
      switchMap(q => q.trim().length >= 3 ? this.ds.interpretaComando(q) : [{ tipo: 'nessuno' }])
    ).subscribe({
      next: r => {
        this.smartItem = (r && r.tipo && r.tipo !== 'nessuno') ? r : null;
        if (this.smartItem) this.showSearch = true;
      },
      error: () => { this.smartItem = null; },
    });
  }

  onLogin() {
    this.loggedIn = true;
    this.ds.getAzienda().subscribe({ next: a => { this.azienda = a; this.windowTitle.setAzienda(a?.ragioneSociale); }, error: () => {} });
    this.moduli.load(true).subscribe();
    if (window.innerWidth < 768) this.collapsed = true;
    this.notifSvc.start();
    this.remindersSvc.start();
  }

  /** Sbloccata l'app dalla lock screen offline. */
  onUnlocked() { this.locked = false; this.checkBackupAlert(); }

  /** Edizione offline: banner che ricorda di eseguire il backup se scaduto. */
  backupAlert = false;

  private checkBackupAlert() {
    if (!this.offline) return;
    this.ds.getBackupConfig().subscribe({
      next: c => { this.backupAlert = !!c.alertDue; },
      error: () => {},
    });
  }
  /**
   * Edizione offline: avvisa se all'avvio il DB risulta già aperto su un altro computer
   * (cartella dati condivisa su Dropbox). L'azione "Esci" chiude l'app per evitare
   * modifiche concorrenti che corromperebbero SQLite.
   */
  private checkDropboxLock() {
    this.ds.getSistemaLock().subscribe({
      next: l => {
        if (!l.altraSessione) return;
        const ref = this.snack.open(
          `Attenzione: Ordeva risulta aperto su un altro computer${l.host ? ` (${l.host})` : ''}. ` +
          `Usarlo su due computer contemporaneamente con i dati su Dropbox può corrompere i dati.`,
          'Esci', { duration: 15000, panelClass: 'snack-warn' });
        ref.onAction().subscribe(() => this.desktop.exit(0));
      },
      error: () => {},
    });
  }

  /** "Più tardi": l'avviso riapparirà dopo i giorni configurati. */
  dismissBackupAlert() { this.backupAlert = false; this.ds.dismissBackupAlert().subscribe({ next: () => {}, error: () => {} }); }
  /** "Non mostrare più": riattivabile da Impostazioni → Backup. */
  disableBackupAlert() { this.backupAlert = false; this.ds.saveBackupConfig({ alertDisabled: true }).subscribe({ next: () => {}, error: () => {} }); }
  goBackupSettings() { this.backupAlert = false; this.router.navigate(['/impostazioni']); }

  logout() {
    this.authSvc.logout();
    this.loggedIn = false;
    this.azienda = null;
    this.notifSvc.stop();
    this.remindersSvc.stop();
    this.reminders = [];
    this.moduli.reset();
    this.ds.invalidateModuli();
  }

  // ── Promemoria agenda (campanella) ───────────────────────────────────────────
  toggleReminders(e: Event) {
    e.stopPropagation();
    this.showReminders = !this.showReminders;
    this.showSearch = false;
  }
  /** Apre l'agenda sul promemoria e lo ignora (così non resta a campanella). */
  openReminder(r: Reminder) {
    this.showReminders = false;
    this.router.navigate(['/agenda']);
  }
  dismissReminder(r: Reminder, e: Event) {
    e.stopPropagation();
    this.remindersSvc.dismiss(r);
  }
  async enableDesktopNotifications() {
    await this.remindersSvc.requestDesktop();
  }
  get desktopPermission(): string { return this.remindersSvc.desktopPermission(); }

  /** Etichetta "Alle HH:MM · tra N min" per un promemoria. */
  reminderWhen(r: Reminder): string {
    const d = new Date(r.inizio);
    if (isNaN(d.getTime())) return '';
    const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const minuti = Math.round((d.getTime() - Date.now()) / 60000);
    if (minuti <= 0) return `Alle ${ora} · ora`;
    if (minuti < 60) return `Alle ${ora} · tra ${minuti} min`;
    const h = Math.floor(minuti / 60), m = minuti % 60;
    return `Alle ${ora} · tra ${h}h${m ? ' ' + m + 'm' : ''}`;
  }

  /** Toast in-app quando un promemoria scatta (con azione "Apri"). */
  private onReminderScattato(r: Reminder) {
    const ora = new Date(r.inizio).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    // Nel layout flottante il dock è in basso al centro: mostro il promemoria in
    // ALTO (come una notifica del telefono), così non finisce mai dietro la barra.
    const inAlto = this.layout.navLayout() === 'floating';
    const ref = this.snack.open(`Promemoria: ${r.titolo} — alle ${ora}`, 'Apri', {
      duration: 8000,
      verticalPosition: inAlto ? 'top' : 'bottom',
      panelClass: 'snack-reminder',
    });
    ref.onAction().subscribe(() => this.router.navigate(['/agenda']));
  }

  @HostListener('window:resize')
  onResize() {
    if (window.innerWidth < 768) this.collapsed = true;
    this.updateDateLabel();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      this.searchInputRef?.nativeElement.focus();
      this.searchInputRef?.nativeElement.select();
      this.showSearch = true;
    }
    if (e.key === 'Escape' && this.showSearch) {
      this.showSearch = false;
      this.searchQuery = '';
      this.searchResults = [];
      this.smartItem = null;
    }
    // "?" apre il cheat-sheet delle scorciatoie, ma non mentre si scrive in un campo.
    if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (!typing && this.dialog.openDialogs.length === 0) {
        e.preventDefault();
        this.dialog.open(ShortcutsDialogComponent, { width: '440px', autoFocus: false });
      }
    }
  }

  onSearchFocus() {
    // Apri SEMPRE il pannello al focus/click (anche con testo residuo nella casella,
    // altrimenti dopo un click-fuori non si riaprirebbe). Se c'è già del testo ma i
    // risultati erano stati svuotati, li ricalcola.
    this.showSearch = true;
    const q = (this.searchQuery || '').trim();
    if (q.length >= 2 && !this.searchResults.length) this.searchSubject.next(this.searchQuery);
    if (q.length >= 3 && !this.smartItem) this.cmdSubject.next(this.searchQuery);
  }

  navigateToAction(a: { route: string; state?: Record<string, any> }) {
    this.showSearch = false;
    this.searchQuery = '';
    this.router.navigate([a.route], a.state ? { state: a.state } : undefined);
  }

  toggleNotif(e: MouseEvent) {
    e.stopPropagation();
    this.showNotif = !this.showNotif;
    if (this.showNotif && !this.notifItems.length) this.loadNotif();
  }

  loadNotif() {
    this.loadingNotif = true;
    this.ds.getScadenzarioFull().subscribe({
      next: items => {
        this.notifItems = (items || [])
          .filter((i: any) => i.scaduto || (i.giorniMancanti !== null && i.giorniMancanti <= 7))
          .slice(0, 20);
        this.loadingNotif = false;
      },
      error: () => { this.notifItems = []; this.loadingNotif = false; }
    });
  }

  navigateToScadenzario() {
    this.showNotif = false;
    this.router.navigate(['/scadenzario']);
  }

  get notifBadgeCount(): number {
    return this.badges.scadenzeScadute || 0;
  }

  toggleSidebar() { this.collapsed = !this.collapsed; }
  closeOnMobile() { if (window.innerWidth < 768) this.collapsed = true; }

  // ── Barra superiore/dock: priority-nav ("⋯ Altro") ──────────────────────────
  /** True per i layout a riga singola che misurano lo spazio e deferiscono le
   *  voci in eccesso nel menu "Altro" (dock fluttuante e barra superiore). */
  get usesPriorityNav(): boolean {
    const l = this.layout.navLayout();
    return l === 'floating' || l === 'top';
  }
  /** Voci mostrate direttamente in barra. */
  get priorityNavItems(): NavItem[] {
    if (!this.usesPriorityNav) return this.visibleNavItems;
    return this.visibleNavItems.slice(0, this.navMaxVisible);
  }
  /** Voci che non entrano → finiscono nel menu "Altro". */
  get overflowNavItems(): NavItem[] {
    if (!this.usesPriorityNav) return [];
    return this.visibleNavItems.slice(this.navMaxVisible);
  }
  get hasNavOverflow(): boolean { return this.overflowNavItems.length > 0; }
  /** Versione flat delle voci in overflow (i gruppi diventano i loro figli). */
  get overflowFlatNavItems(): NavItem[] {
    return this.overflowNavItems.flatMap(it => it.children ?? [it]);
  }
  /** True se una voce in overflow ha un badge: lo segnaliamo sul bottone "Altro". */
  get overflowHasBadge(): boolean {
    return this.overflowFlatNavItems.some(o =>
      o.route === '/pagamenti' && this.badges.scadenzeScadute > 0);
  }

  /** True se `route` corrisponde alla rotta corrente (anche come prefisso, es. /prodotti/123). */
  private isRouteActive(route?: string): boolean {
    if (!route) return false;
    const url = this.router.url.split(/[?#]/)[0];
    return url === route || url.startsWith(route + '/');
  }
  /**
   * True se la voce è quella attiva: per un gruppo controlla i figli. Serve a
   * colorare il pulsante-gruppo del dock (che usa matMenuTriggerFor e non ha
   * routerLink, quindi routerLinkActive non lo evidenzierebbe mai).
   */
  isGroupActive(item: NavItem): boolean {
    if (item.children) return item.children.some(c => this.isRouteActive(c.route));
    return this.isRouteActive(item.route);
  }
  /** True se una qualsiasi voce in overflow ("Altro") è quella attiva. */
  get overflowActive(): boolean {
    return this.overflowNavItems.some(it => this.isGroupActive(it));
  }

  ngAfterViewInit() {
    this.syncNavObserver();
    requestAnimationFrame(() => this.zone.run(() => this.updateDateLabel()));
  }

  ngAfterViewChecked() {
    this.syncNavObserver();
    if (!this.usesPriorityNav) return;
    // Ricalcola se cambia il numero di voci (login/moduli/ruolo) senza un resize.
    const total = this.visibleNavItems.length;
    if (total !== this.navLastTotal && !this.navRecomputePending) {
      this.navRecomputePending = true;
      requestAnimationFrame(() => {
        this.navRecomputePending = false;
        this.zone.run(() => this.computeNavOverflow());
      });
    }
  }

  /** Edizione desktop offline: toglie i comportamenti "da pagina web" (menu del
   *  tasto destro del browser, zoom Ctrl+/-, ricarica F5/Ctrl+R, selezione del
   *  testo a casaccio) così l'app si comporta come un programma nativo. Sul web
   *  non si attiva: lì deve restare un sito a tutti gli effetti. */
  private setupNativeFeel() {
    if (!this.offline) return;
    document.body.classList.add('desktop-app');

    const isEditable = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable);
    };

    // Niente menu contestuale del browser (resta nei campi di testo, dove ha senso copia/incolla).
    window.addEventListener('contextmenu', e => { if (!isEditable(e.target)) e.preventDefault(); });

    // Niente zoom da tastiera (Ctrl/Cmd +/-/0) né ricarica pagina (F5, Ctrl/Cmd+R): non è un browser.
    window.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && ['+', '-', '=', '0'].includes(e.key)) { e.preventDefault(); return; }
      if (mod && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); return; }
      if (e.key === 'F5') e.preventDefault();
    });

    // Niente zoom con Ctrl + rotellina / pinch del trackpad.
    window.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  }

  ngOnDestroy() { this.navRO?.disconnect(); }

  /** Collega il ResizeObserver alla barra solo quando la top-nav è montata. */
  private syncNavObserver() {
    const el = this.usesPriorityNav ? this.topNavEl?.nativeElement : undefined;
    if (el) {
      if (this.navObservedEl !== el) {
        this.navRO?.disconnect();
        if (typeof ResizeObserver !== 'undefined') {
          this.navRO = new ResizeObserver(() => this.zone.run(() => this.computeNavOverflow()));
          this.navRO.observe(el);
        }
        this.navObservedEl = el;
        this.navLastTotal = -1;
        requestAnimationFrame(() => this.zone.run(() => this.computeNavOverflow()));
      }
    } else if (this.navObservedEl) {
      this.navRO?.disconnect();
      this.navObservedEl = undefined;
    }
  }

  /**
   * Decide quante voci mostrare in barra (le altre vanno nel menu "Altro"),
   * sommando le larghezze REALI di ogni voce — così entra il massimo possibile
   * senza tagliare nulla. Le larghezze (che dipendono dall'etichetta, non dallo
   * spazio) le misuro/cachenano quando sono tutte renderizzate (navMaxVisible
   * alto al primo giro), poi riuso la cache anche quando alcune sono in overflow.
   */
  computeNavOverflow() {
    if (!this.usesPriorityNav) return;
    const el = this.topNavEl?.nativeElement;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('.top-nav-item'));
    const total = this.visibleNavItems.length;
    this.navLastTotal = total;
    if (!items.length) return;

    const style = getComputedStyle(el);
    const gap = parseFloat(style.columnGap || style.gap) || 2;
    // Cache delle larghezze per voce: valida solo quando sono TUTTE renderizzate.
    if (items.length === total) {
      this.navItemWidths = items.map(i => i.offsetWidth);
    } else if (this.navItemWidths.length !== total) {
      // Cache non valida e non tutte in DOM (es. dopo un cambio di moduli): forzo
      // il render di TUTTE e ricalcolo al frame dopo. NB: devo schedularlo io —
      // su mobile il dock-inner è width:100% fisso, quindi il ResizeObserver non
      // scatta, e navLastTotal è già aggiornato: nessun altro trigger arriverebbe.
      this.navMaxVisible = 99;
      requestAnimationFrame(() => this.zone.run(() => this.computeNavOverflow()));
      return;
    }
    const widths = this.navItemWidths;

    // Capienza (border-box) disponibile per la barra (dock-inner o top-nav):
    // - lo spazio utile del contenitore padre, sempre affidabile;
    // - eventuale max-width ASSOLUTO in px (NON percentuali: "100%" non è 100px!);
    // - se la barra è già in overflow, il suo clientWidth È il cap reale.
    let capBox = Infinity;
    const parent = el.parentElement;
    if (parent) {
      const ps = getComputedStyle(parent);
      capBox = parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
    }
    if (style.maxWidth.endsWith('px')) {
      const px = parseFloat(style.maxWidth);
      if (px > 0) capBox = Math.min(capBox, px);
    }
    if (el.scrollWidth > el.clientWidth + 1) capBox = Math.min(capBox, el.clientWidth);
    if (!Number.isFinite(capBox)) capBox = el.clientWidth;
    const avail = capBox - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (avail <= 0 || !widths.length) return;

    // Tutte entrano? Niente "Altro".
    const sumAll = widths.reduce((s, w) => s + w, 0) + gap * (total - 1);
    let next: number;
    if (sumAll <= avail) {
      next = total;
    } else {
      // Riservo lo spazio del bottone "Altro" (≈ una voce) e impacchetto dalla prima.
      const budget = avail - ((widths[0] || 56) + gap);
      let used = 0;
      next = 0;
      for (let i = 0; i < total; i++) {
        used += widths[i] + (i > 0 ? gap : 0);
        if (used <= budget) next = i + 1; else break;
      }
      next = Math.max(1, next);
    }
    if (next !== this.navMaxVisible) this.navMaxVisible = next;
  }

  /**
   * Sceglie il formato della data più lungo che entra nello spazio centrale
   * della topbar, senza sovrapporsi al nome azienda (a sinistra) né alla ricerca
   * (a destra). Lo spazio è simmetrico perché la data è centrata in assoluto:
   * disponibile = 2 × (distanza minore tra centro e i due bordi). Se non entra
   * nemmeno "dd/mm/yy" la nasconde (stringa vuota).
   */
  updateDateLabel() {
    const el = this.topbarDateRef?.nativeElement;
    const bar = el?.parentElement;
    if (!el || !bar) return;
    const company = bar.querySelector<HTMLElement>('.company-info');
    const search = bar.querySelector<HTMLElement>('.search-box');
    const barRect = bar.getBoundingClientRect();
    const center = barRect.left + barRect.width / 2;
    const leftEdge = company ? company.getBoundingClientRect().right : barRect.left;
    const rightEdge = search ? search.getBoundingClientRect().left : barRect.right;
    const GAP = 16;                                   // respiro minimo dai vicini
    const avail = Math.max(0, Math.min(center - leftEdge, rightEdge - center) - GAP) * 2;

    const cs = getComputedStyle(el);
    const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const next = this.dateFormats.find(f => this.measureText(f, font) <= avail) ?? '';
    if (next !== this.oggiLabel) this.oggiLabel = next;
  }

  /** Larghezza in px di un testo per un dato font, via canvas (niente reflow). */
  private measureText(text: string, font: string): number {
    if (!this.dateMeasureCtx) {
      this.dateMeasureCtx = document.createElement('canvas').getContext('2d');
    }
    if (!this.dateMeasureCtx) return text.length * 8;   // fallback grezzo
    this.dateMeasureCtx.font = font;
    return this.dateMeasureCtx.measureText(text).width;
  }

  onSearchInput(q: string) {
    this.highlightedIndex = 0;
    const query = (q || '').trim().toLowerCase();
    // Comandi (sezioni navigabili + azioni rapide): match istantaneo dal 1° carattere.
    this.commandResults = query.length >= 1
      ? this.allCommands.filter(c => c.label.toLowerCase().includes(query)).slice(0, 8)
      : [];
    if (q.length < 2) this.searchResults = [];
    if (query.length < 3) this.smartItem = null;
    this.showSearch = this.commandResults.length > 0 || q.length >= 2 || !q;
    this.searchSubject.next(q);
    this.cmdSubject.next(q);
  }

  /** Sezioni navigabili (filtrate per ruolo/moduli) + azioni rapide → comandi della palette. */
  private get allCommands(): { label: string; icon: string; route: string; state?: Record<string, any> }[] {
    const sezioni = this.visibleFlatNavItems
      .filter(i => !!i.route)
      .map(i => ({ label: this.i18n.t(i.label), icon: i.icon, route: i.route! }));
    return [...this.quickActions, ...sezioni];
  }

  /** Lista unificata (comandi + risultati dati) per la navigazione da tastiera. */
  get paletteItems(): { kind: 'cmd' | 'data' | 'smart'; label: string; icon?: string; tipo?: string; route: string; dettaglio?: string; smart?: any }[] {
    const smart = this.smartItem
      ? [{ kind: 'smart' as const, label: this.smartItem.titolo, icon: this.smartItem.icona || 'auto_awesome', dettaglio: this.smartItem.dettaglio, route: this.smartItem.route || '#', smart: this.smartItem }]
      : [];
    return [
      ...smart,
      ...this.commandResults.map(c => ({ kind: 'cmd' as const, label: c.label, icon: c.icon, route: c.route, state: c.state })),
      ...this.searchResults.map(r => ({ kind: 'data' as const, label: r.label, tipo: r.tipo, route: r.route, id: r.id })),
    ];
  }

  /** Per cliente/fornitore/prodotto apre direttamente la scheda dell'elemento
   *  (non la lista). Restituisce true se ha gestito la navigazione. */
  private openCard(tipo?: string, id?: number): boolean {
    const rotte: Record<string, string> = { Cliente: '/clienti', Fornitore: '/fornitori', Prodotto: '/prodotti' };
    const route = tipo ? rotte[tipo] : undefined;
    if (!route || id == null) return false;
    const nav = () => this.router.navigate([route], { state: { openId: id } });
    // Se siamo già su quella pagina, Angular riuserebbe il componente senza
    // rilanciare ngOnInit: forziamo un rimbalzo così la scheda si apre comunque.
    if (this.router.url.split('?')[0] === route) {
      this.router.navigateByUrl('/', { skipLocationChange: true }).then(nav);
    } else { nav(); }
    return true;
  }

  paletteMove(delta: number) {
    const n = this.paletteItems.length;
    if (n) this.highlightedIndex = (this.highlightedIndex + delta + n) % n;
  }

  paletteEnter() {
    const it = this.paletteItems[this.highlightedIndex];
    if (it) this.executePalette(it);
  }

  executePalette(it: { kind?: string; route: string; tipo?: string; id?: number; smart?: any; state?: Record<string, any> }) {
    this.showSearch = false;
    this.searchQuery = '';
    this.searchResults = [];
    this.commandResults = [];
    this.smartItem = null;
    if (it.smart) { this.runSmart(it.smart); return; }
    if (it.kind === 'data' && this.openCard(it.tipo, it.id)) return;
    this.router.navigate([it.route], it.state ? { state: it.state } : undefined);
  }

  /** Esegue la voce "intelligente": apre la pagina con la bozza pre-compilata,
   *  oppure naviga al dettaglio per le risposte di lettura. */
  private runSmart(s: any) {
    if (s.tipo === 'bozza') {
      const rotte: Record<string, string> = {
        fattura: '/fatture', preventivo: '/preventivi', ddt: '/ddt',
        cliente: '/clienti', prodotto: '/prodotti',
      };
      const route = rotte[s.target];
      if (!route) return;
      const stateKey = (s.target === 'cliente' || s.target === 'prodotto') ? 'prefill' : 'nuovaBozza';
      this.router.navigate([route], { state: { [stateKey]: s.dati } });
    } else if (s.tipo === 'risposta' && s.route) {
      this.router.navigate([s.route]);
    }
  }

  navigateToResult(r: { route: string }) {
    this.showSearch = false;
    this.searchQuery = '';
    this.searchResults = [];
    this.router.navigate([r.route]);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    if (!this.elRef.nativeElement.querySelector('.search-box')?.contains(e.target)) {
      this.showSearch = false;
    }
    if (!this.elRef.nativeElement.querySelector('.notif-wrap')?.contains(e.target)) {
      this.showNotif = false;
      this.showReminders = false;
    }
  }

  installApp() {
    this.installPromptEvent?.prompt();
    this.installPromptEvent?.userChoice.then(() => {
      this.showInstallBanner = false;
      this.installPromptEvent = null;
    });
  }

  dismissInstall() {
    this.showInstallBanner = false;
    lsSet('pwa-install-dismissed', '1');
  }

  reloadForUpdate() {
    this.swUpdate.activateUpdate().then(() => window.location.reload());
  }

  dismissVerifyBanner() {
    this.showEmailVerifyBanner = false;
    sessionStorage.setItem('email-verify-dismissed', '1');
  }

  resendVerification() {
    if (this.resendingVerification) return;
    this.resendingVerification = true;
    this.authSvc.resendVerification().subscribe({
      next: () => {
        this.resendingVerification = false;
        this.showEmailVerifyBanner = false;
        sessionStorage.setItem('email-verify-dismissed', '1');
        this.snack.open(
          'Email di verifica inviata. Controlla la tua casella (anche spam).',
          'OK', { duration: 5000 },
        );
      },
      error: (err) => {
        this.resendingVerification = false;
        this.snack.open(
          err.error?.error || 'Errore durante l\'invio. Riprova più tardi.',
          'OK', { duration: 5000 },
        );
      },
    });
  }

  /** Apre il client di posta del sistema con una mail precompilata al supporto Ordeva. */
  openBugReport() {
    const pagina = this.router.url.replace(/^\//, '').split('/')[0] || 'home';
    const enc = (s: string) => encodeURIComponent(s);
    const subject = 'Segnalazione problema — Ordeva';
    const body = [
      'Descrivi il problema riscontrato:',
      '',
      '',
      '------------------------------',
      `Pagina: ${pagina}`,
      `Sistema: ${navigator.platform || 'n/d'}`,
      'Allega, se possibile, uno screenshot.',
    ].join('\n');
    const url = `mailto:contatti@ordeva.it?subject=${enc(subject)}&body=${enc(body)}`;
    const a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // I "label" sono chiavi di traduzione (I18nService/pipe `t`), non testo da
  // mostrare direttamente — vedi frontend/src/app/i18n/*.ts.
  readonly navItems: NavItem[] = [
    { label: 'nav.dashboard',    icon: 'dashboard',      route: '/dashboard' },
    {
      label: 'nav.anagrafiche', icon: 'contacts',
      children: [
        { label: 'nav.clienti',   icon: 'people',         route: '/clienti' },
        { label: 'nav.fornitori', icon: 'local_shipping', route: '/fornitori' },
      ]
    },
    {
      label: 'nav.vendite', icon: 'point_of_sale',
      children: [
        { label: 'nav.preventivi',     icon: 'request_quote',   route: '/preventivi' },
        { label: 'nav.ordiniCliente',  icon: 'shopping_cart',   route: '/ordini' },
        { label: 'nav.ddt',            icon: 'receipt_long',    route: '/ddt' },
        { label: 'nav.fatture',        icon: 'receipt',         route: '/fatture' },
        { label: 'nav.noteCredito',    icon: 'note_alt',        route: '/note-credito' },
        { label: 'nav.ricorrenti',     icon: 'autorenew',       route: '/fatture-ricorrenti' },
        { label: 'nav.venditaBanco',   icon: 'point_of_sale',   route: '/vendita-banco' },
        { label: 'nav.listini',        icon: 'sell',            route: '/listini' },
        { label: 'nav.agenti',         icon: 'support_agent',   route: '/agenti' },
      ]
    },
    {
      label: 'nav.acquisti', icon: 'shopping_bag',
      children: [
        { label: 'nav.acquisti',      icon: 'shopping_bag',     route: '/acquisti' },
        { label: 'nav.ordiniFornitore', icon: 'shopping_cart',  route: '/ordini-fornitore' },
        { label: 'nav.arriviMerce',   icon: 'move_to_inbox',    route: '/arrivi-merce' },
        { label: 'nav.ocrFatture',    icon: 'document_scanner', route: '/ocr-fatture', hideOffline: true },
      ]
    },
    {
      label: 'nav.fattureElettroniche', icon: 'cloud_sync',
      children: [
        { label: 'nav.emesseSdi',   icon: 'fact_check',      route: '/fatture-elettroniche' },
        { label: 'nav.ricevuteSdi', icon: 'cloud_download',  route: '/sdi-passive' },
      ]
    },
    {
      label: 'nav.magazzino', icon: 'warehouse',
      children: [
        { label: 'nav.prodotti',  icon: 'inventory_2', route: '/prodotti' },
        { label: 'nav.movimenti', icon: 'warehouse',   route: '/magazzino' },
      ]
    },
    {
      label: 'nav.contabilita', icon: 'account_balance',
      children: [
        { label: 'nav.pagamenti',       icon: 'payments',         route: '/pagamenti' },
        { label: 'nav.scadenzario',     icon: 'event',            route: '/scadenzario' },
        { label: 'nav.scadenzeFiscali', icon: 'event_available', route: '/scadenze-fiscali' },
        { label: 'nav.primaNota',       icon: 'menu_book',        route: '/prima-nota' },
        { label: 'nav.riconciliazione', icon: 'account_balance',  route: '/riconciliazione' },
        { label: 'nav.compliance',      icon: 'verified',         route: '/compliance' },
      ]
    },
    // Strumenti trasversali (non legati a un singolo flusso documentale) + Report:
    // un solo slot in barra invece di 5, per lasciare spazio ai moduli "fondamentali"
    // prima che scatti l'overflow "Altro" nei layout a priority-nav (barra superiore/dock).
    {
      label: 'nav.tool', icon: 'build',
      children: [
        { label: 'nav.agenda',    icon: 'event_note',     route: '/agenda' },
        { label: 'nav.lavagna',   icon: 'sticky_note_2',  route: '/lavagna' },
        { label: 'nav.portachiavi', icon: 'vpn_key',      route: '/portachiavi' },
        { label: 'nav.archivi',   icon: 'folder_copy',    route: '/archivi' },
        { label: 'nav.ecommerce', icon: 'shopping_basket', route: '/ecommerce' },
        { label: 'nav.andamento',       icon: 'analytics',   route: '/report' },
        { label: 'nav.reportTabellari', icon: 'table_chart', route: '/reports' },
      ]
    },
    {
      label: 'nav.sistema', icon: 'tune',
      children: [
        { label: 'nav.impostazioni', icon: 'settings', route: '/impostazioni' },
        { label: 'nav.account',      icon: 'person',   route: '/account', hideOffline: true },
        { label: 'nav.abbonamento',  icon: 'credit_card', route: '/billing', hideOffline: true },
        { label: 'nav.aiuto',        icon: 'menu_book', route: '/aiuto' },
        { label: 'nav.storico',      icon: 'history',  route: '/storico' },
      ]
    },
    // Amministrazione e Console SaaS ora sono schede dentro Impostazioni (gated per ruolo),
    // così non ingombrano la barra laterale/superiore. Le route /admin e /super-admin restano
    // attive per il deep-link diretto.
  ];

  /** Voci di menu filtrate dai moduli attivi e dal ruolo dell'utente. */
  get visibleNavItems(): NavItem[] {
    const ruolo = this.authSvc.getUser()?.ruolo;
    const isSuper = ruolo === 'SUPERADMIN';
    const isAdmin = isSuper || ruolo === 'ADMIN';
    const allowed = (it: NavItem) => {
      if (it.superadminOnly && !isSuper) return false;
      if (it.adminOnly && !isAdmin) return false;
      if (it.hideOffline && this.offline) return false;
      return true;
    };
    return this.navItems
      .filter(allowed)
      .map(item => {
        if (item.children) {
          const visibleChildren = item.children
            .filter(allowed)
            .filter(c => !c.route || this.moduli.routeAbilitata(c.route));
          return visibleChildren.length ? { ...item, children: visibleChildren } : null;
        }
        return (!item.route || this.moduli.routeAbilitata(item.route)) ? item : null;
      })
      .filter((x): x is NavItem => x !== null);
  }

  /** Versione "flat" delle voci visibili (per la sidebar collassata). */
  get visibleFlatNavItems(): NavItem[] {
    return this.visibleNavItems.flatMap(item => item.children ?? [item]);
  }

  get flatNavItems(): NavItem[] {
    return this.navItems.flatMap(item => item.children ?? [item]);
  }
}
