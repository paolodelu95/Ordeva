import { Component, Input, inject } from '@angular/core';
import { CityResult } from '../../services/city.service';
import { I18nService } from '../../services/i18n.service';

/**
 * Una voce della tendina dei comuni: nome a sinistra, provincia e CAP a destra.
 * La provincia distingue gli omonimi (Samone TO e Samone TN), il CAP dice subito
 * cosa verrà compilato; per le città con più CAP se ne dice il numero.
 */
@Component({
  selector: 'app-opzione-comune',
  standalone: true,
  template: `<span class="oc-nome">{{ c.name }}</span><span class="oc-info">{{ info }}</span>`,
  styles: [`
    :host { display: flex; align-items: baseline; gap: 10px; min-width: 0; width: 100%; }
    .oc-nome { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .oc-info { margin-left: auto; flex: none; font-size: 12px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
  `],
})
export class OpzioneComuneComponent {
  @Input({ required: true }) c!: CityResult;
  private i18n = inject(I18nService);

  get info(): string {
    const parti = [this.c.provincia];
    if (this.c.cap) parti.push(this.c.cap);
    else if (this.c.caps.length > 1) parti.push(this.i18n.t('shared.comune.piuCap', { n: this.c.caps.length }));
    if (this.c.localita) parti.push(this.i18n.t('shared.comune.localita'));
    return parti.filter(Boolean).join(' · ');
  }
}
