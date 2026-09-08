import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DragDropModule, CdkDragEnd } from '@angular/cdk/drag-drop';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { DataService } from '../../services/data.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

type TipoCorpo = 'testo' | 'elenco' | 'todo';

interface Voce { t: string; fatto?: boolean; }

interface PostIt {
  id: string;
  titolo: string;
  colore: string;
  x: number; y: number;
  w: number; h: number;
  tipo: TipoCorpo;
  testo: string;
  voci: Voce[];
  minimizzato: boolean;
}

/** Palette volutamente "spenta" (toni tenui, buon contrasto col testo scuro). */
const COLORI = [
  '#e8e1c4', // sabbia
  '#cfe0d2', // salvia
  '#cdd9e6', // azzurro polvere
  '#e6d2d2', // rosa antico
  '#ddd3e6', // lavanda
  '#e2dccb', // beige
  '#d6dde0', // grigio nebbia
  '#dde3cf', // verde oliva chiaro
];

@Component({
  selector: 'app-lavagna',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule, DragDropModule, TPipe],
  template: `
    <div class="lav-page">
      <div class="lav-header">
        <h1 class="page-title">{{ 'lavagna.title' | t }}</h1>
        <span class="lav-hint">{{ 'lavagna.hint' | t }}</span>
        <span class="lav-spacer"></span>
        <button mat-flat-button color="primary" type="button" (click)="aggiungi()">
          <mat-icon>add</mat-icon> {{ 'lavagna.nuovoPostIt' | t }}
        </button>
      </div>

      <div class="lav-body">
        <!-- Canvas scrollabile -->
        <div class="lav-board">
          <div class="lav-canvas">
            @for (n of attivi(); track n.id) {
              <div class="postit" cdkDrag
                   [cdkDragFreeDragPosition]="{ x: n.x, y: n.y }"
                   (cdkDragEnded)="onDragEnd(n, $event)"
                   [style.width.px]="n.w" [style.height.px]="n.h"
                   [style.background]="n.colore"
                   #el (mouseup)="onResize(n, el)">
                <div class="postit-bar">
                  <mat-icon class="grip" cdkDragHandle [matTooltip]="'lavagna.trascina' | t">drag_indicator</mat-icon>
                  <span class="bar-spacer"></span>
                  <button mat-icon-button type="button" [matMenuTriggerFor]="colorMenu" [matTooltip]="'lavagna.colore' | t">
                    <mat-icon>palette</mat-icon>
                  </button>
                  <mat-menu #colorMenu="matMenu" class="color-menu">
                    <div class="swatches">
                      @for (c of colori; track c) {
                        <button type="button" class="swatch" [style.background]="c"
                                [class.sel]="c === n.colore" (click)="setColore(n, c)"></button>
                      }
                    </div>
                  </mat-menu>
                  <button mat-icon-button type="button" [matTooltip]="'lavagna.riduci' | t" (click)="minimizza(n)">
                    <mat-icon>remove</mat-icon>
                  </button>
                  <button mat-icon-button type="button" [matTooltip]="'lavagna.elimina' | t" (click)="elimina(n)">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>

                <input class="postit-titolo" [(ngModel)]="n.titolo" (ngModelChange)="touch()"
                       [placeholder]="'lavagna.titoloPlaceholder' | t">

                <div class="postit-tipo">
                  <button type="button" [class.on]="n.tipo === 'testo'" (click)="setTipo(n, 'testo')" [matTooltip]="'lavagna.testoLibero' | t"><mat-icon>notes</mat-icon></button>
                  <button type="button" [class.on]="n.tipo === 'elenco'" (click)="setTipo(n, 'elenco')" [matTooltip]="'lavagna.elencoPuntato' | t"><mat-icon>format_list_bulleted</mat-icon></button>
                  <button type="button" [class.on]="n.tipo === 'todo'" (click)="setTipo(n, 'todo')" [matTooltip]="'lavagna.checklist' | t"><mat-icon>checklist</mat-icon></button>
                </div>

                <div class="postit-corpo">
                  @switch (n.tipo) {
                    @case ('testo') {
                      <textarea class="postit-text" [(ngModel)]="n.testo" (ngModelChange)="touch()"
                                [placeholder]="'lavagna.scriviQuiPlaceholder' | t"></textarea>
                    }
                    @default {
                      <div class="voci">
                        @for (v of n.voci; track $index) {
                          <div class="voce" [class.is-todo]="n.tipo === 'todo'">
                            @if (n.tipo === 'todo') {
                              <button type="button" class="chk" (click)="v.fatto = !v.fatto; touch()">
                                <mat-icon>{{ v.fatto ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
                              </button>
                            } @else {
                              <span class="bullet">•</span>
                            }
                            <input class="voce-input" [class.done]="n.tipo === 'todo' && v.fatto"
                                   [(ngModel)]="v.t" (ngModelChange)="touch()"
                                   (keydown.enter)="aggiungiVoce(n, $index + 1)"
                                   (keydown.backspace)="rimuoviVoceSeVuota(n, $index, $event)"
                                   [placeholder]="'lavagna.vocePlaceholder' | t">
                            <button type="button" class="voce-x" (click)="rimuoviVoce(n, $index)"><mat-icon>close</mat-icon></button>
                          </div>
                        }
                        <button type="button" class="add-voce" (click)="aggiungiVoce(n, n.voci.length)">
                          <mat-icon>add</mat-icon> {{ 'lavagna.aggiungiVoce' | t }}
                        </button>
                      </div>
                    }
                  }
                </div>
              </div>
            }
          </div>

          @if (!note.length) {
            <div class="lav-empty">
              <mat-icon>sticky_note_2</mat-icon>
              <p>{{ 'lavagna.nessunPostIt' | t }}</p>
            </div>
          }
        </div>

        <!-- Barra laterale dei ridotti -->
        @if (ridotti().length) {
          <div class="lav-side">
            <div class="side-title">{{ 'lavagna.ridotti' | t }}</div>
            @for (n of ridotti(); track n.id) {
              <button type="button" class="side-item" [style.borderLeftColor]="n.colore"
                      (click)="ripristina(n)" [matTooltip]="'lavagna.ripristina' | t">
                <span class="side-name">{{ n.titolo || ('lavagna.senzaTitolo' | t) }}</span>
                <mat-icon>open_in_full</mat-icon>
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .lav-page { display: flex; flex-direction: column; height: calc(100vh - var(--topbar-height, 56px)); box-sizing: border-box; }
    .lav-header { display: flex; align-items: center; gap: 12px; padding: 14px 18px; flex-wrap: wrap; }
    .lav-header .page-title { margin: 0; }
    .lav-hint { font-size: 12px; color: var(--text-tertiary); }
    .lav-spacer { flex: 1; }
    .lav-body { flex: 1; display: flex; min-height: 0; }

    .lav-board { position: relative; flex: 1; overflow: auto; background:
      radial-gradient(circle, var(--border-subtle) 1px, transparent 1px) 0 0 / 26px 26px,
      var(--bg-subtle); }
    .lav-canvas { position: relative; width: 2400px; height: 1600px; }

    .postit {
      position: absolute; top: 0; left: 0;
      display: flex; flex-direction: column;
      min-width: 180px; min-height: 140px;
      border-radius: 10px; box-shadow: var(--shadow-md, 0 6px 18px rgba(0,0,0,0.16));
      overflow: hidden; resize: both;
      color: #33312b; border: 1px solid rgba(0,0,0,0.08);
    }
    .postit-bar { display: flex; align-items: center; gap: 2px; padding: 2px 4px; }
    .postit-bar .grip { cursor: grab; color: rgba(0,0,0,0.45); }
    .bar-spacer { flex: 1; }
    .postit-bar .mat-mdc-icon-button { width: 30px; height: 30px; padding: 4px; color: rgba(0,0,0,0.55); }
    .postit-bar .mat-mdc-icon-button mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .postit-titolo {
      border: none; background: transparent; font-size: 18px; font-weight: 800;
      color: #2c2a24; padding: 0 12px 4px; outline: none; width: 100%; box-sizing: border-box;
    }
    .postit-titolo::placeholder { color: rgba(0,0,0,0.35); }

    .postit-tipo { display: flex; gap: 4px; padding: 0 10px 6px; }
    .postit-tipo button {
      border: none; background: rgba(0,0,0,0.06); border-radius: 6px; cursor: pointer;
      width: 26px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
      color: rgba(0,0,0,0.5);
    }
    .postit-tipo button mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .postit-tipo button.on { background: rgba(0,0,0,0.78); color: #fff; }

    .postit-corpo { flex: 1; overflow: auto; padding: 0 10px 10px; }
    .postit-text {
      width: 100%; height: 100%; min-height: 60px; border: none; background: transparent;
      resize: none; outline: none; font-size: 13.5px; color: #38362f; box-sizing: border-box;
      font-family: inherit; line-height: 1.45;
    }
    .voci { display: flex; flex-direction: column; gap: 2px; }
    .voce { display: flex; align-items: center; gap: 4px; }
    .voce .bullet { width: 18px; text-align: center; color: rgba(0,0,0,0.5); }
    .voce .chk { border: none; background: transparent; cursor: pointer; padding: 0; display: inline-flex; color: rgba(0,0,0,0.6); }
    .voce .chk mat-icon { font-size: 19px; width: 19px; height: 19px; }
    .voce-input {
      flex: 1; border: none; background: transparent; outline: none; font-size: 13.5px;
      color: #38362f; padding: 2px 0; font-family: inherit;
    }
    .voce-input.done { text-decoration: line-through; color: rgba(0,0,0,0.4); }
    .voce-x { border: none; background: transparent; cursor: pointer; color: rgba(0,0,0,0.3); padding: 0; display: inline-flex; opacity: 0; }
    .voce:hover .voce-x { opacity: 1; }
    .voce-x mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .add-voce {
      margin-top: 4px; border: none; background: transparent; cursor: pointer; color: rgba(0,0,0,0.45);
      display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 0;
    }
    .add-voce mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .swatches { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 8px; }
    .swatch { width: 28px; height: 28px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.15); cursor: pointer; }
    .swatch.sel { outline: 2px solid var(--primary); outline-offset: 1px; }

    .lav-side {
      width: 210px; flex-shrink: 0; border-left: 1px solid var(--border); background: var(--bg-surface);
      overflow: auto; padding: 10px;
    }
    .side-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text-tertiary); margin-bottom: 8px; }
    .side-item {
      display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
      border: 1px solid var(--border-subtle); border-left: 4px solid var(--border);
      background: var(--bg-surface-2); border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer;
      color: var(--text-primary);
    }
    .side-item:hover { background: var(--bg-subtle); }
    .side-name { flex: 1; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .side-item mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--text-tertiary); }

    .lav-empty { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: var(--text-tertiary); display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .lav-empty mat-icon { font-size: 44px; width: 44px; height: 44px; opacity: .5; }

    @media (max-width: 767px) {
      .lav-side { width: 140px; }
      .lav-canvas { width: 1400px; }
    }
  `],
})
export class LavagnaComponent implements OnInit, OnDestroy {
  note: PostIt[] = [];
  readonly colori = COLORI;
  private save$ = new Subject<void>();
  private sub: any;

  constructor(private ds: DataService) {}

  ngOnInit() {
    this.ds.getLavagna().subscribe(b => {
      this.note = (b?.note ?? []).map(n => this.normalizza(n));
    });
    this.sub = this.save$.pipe(debounceTime(600)).subscribe(() => {
      this.ds.saveLavagna({ note: this.note }).subscribe({ error: () => {} });
    });
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

  attivi(): PostIt[] { return this.note.filter(n => !n.minimizzato); }
  ridotti(): PostIt[] { return this.note.filter(n => n.minimizzato); }

  /** Segna modifica → salvataggio debounced. */
  touch() { this.save$.next(); }

  aggiungi() {
    const n = this.attivi().length;
    this.note.push({
      id: (crypto as any).randomUUID ? crypto.randomUUID() : 'p' + Date.now() + Math.random().toString(36).slice(2),
      titolo: '', colore: COLORI[this.note.length % COLORI.length],
      x: 40 + (n % 6) * 36, y: 40 + (n % 6) * 36,
      w: 250, h: 220, tipo: 'testo', testo: '', voci: [], minimizzato: false,
    });
    this.touch();
  }

  elimina(n: PostIt) { this.note = this.note.filter(x => x !== n); this.touch(); }

  setColore(n: PostIt, c: string) { n.colore = c; this.touch(); }

  setTipo(n: PostIt, t: TipoCorpo) {
    n.tipo = t;
    if ((t === 'elenco' || t === 'todo') && !n.voci.length) n.voci = [{ t: '' }];
    this.touch();
  }

  minimizza(n: PostIt) { n.minimizzato = true; this.touch(); }
  ripristina(n: PostIt) { n.minimizzato = false; this.touch(); }

  onDragEnd(n: PostIt, e: CdkDragEnd) {
    const p = e.source.getFreeDragPosition();
    n.x = Math.max(0, Math.round(p.x));
    n.y = Math.max(0, Math.round(p.y));
    this.touch();
  }

  onResize(n: PostIt, el: HTMLElement) {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w !== n.w || h !== n.h) { n.w = w; n.h = h; this.touch(); }
  }

  aggiungiVoce(n: PostIt, pos: number) {
    n.voci.splice(pos, 0, { t: '', fatto: false });
    this.touch();
  }
  rimuoviVoce(n: PostIt, i: number) { n.voci.splice(i, 1); this.touch(); }
  rimuoviVoceSeVuota(n: PostIt, i: number, ev: Event) {
    if (n.voci[i]?.t === '' && n.voci.length > 1) { ev.preventDefault(); n.voci.splice(i, 1); this.touch(); }
  }

  /** Riempie i campi mancanti dei dati salvati (robustezza su versioni vecchie). */
  private normalizza(n: any): PostIt {
    return {
      id: n.id ?? ('p' + Math.random().toString(36).slice(2)),
      titolo: n.titolo ?? '', colore: n.colore ?? COLORI[0],
      x: +n.x || 0, y: +n.y || 0, w: +n.w || 250, h: +n.h || 220,
      tipo: (['testo', 'elenco', 'todo'].includes(n.tipo) ? n.tipo : 'testo'),
      testo: n.testo ?? '', voci: Array.isArray(n.voci) ? n.voci.map((v: any) => ({ t: v?.t ?? '', fatto: !!v?.fatto })) : [],
      minimizzato: !!n.minimizzato,
    };
  }
}
