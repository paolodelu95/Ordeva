import { I18nService } from '../../services/i18n.service';

/**
 * Glossario unico dei termini fiscali/tecnici dell'app, spiegati in linguaggio semplice.
 * Usato da <app-field-help term="..."> per dare aiuto in-context (niente più sigle oscure).
 *
 * Regole di scrittura:
 *  - descrizione: 1-2 frasi, linguaggio da persona comune, niente gergo non spiegato.
 *  - esempio: opzionale, un valore plausibile che chiarisce il formato.
 */
export interface GlossarioVoce {
  titolo: string;
  descrizione: string;
  esempio?: string;
}

export function glossario(i18n: I18nService): Record<string, GlossarioVoce> {
  const t = (k: string) => i18n.t(k);
  return {
    piva: {
      titolo: t('glossario.piva.titolo'),
      descrizione: t('glossario.piva.descrizione'),
      esempio: t('glossario.piva.esempio'),
    },
    codiceFiscale: {
      titolo: t('glossario.codiceFiscale.titolo'),
      descrizione: t('glossario.codiceFiscale.descrizione'),
      esempio: t('glossario.codiceFiscale.esempio'),
    },
    sdi: {
      titolo: t('glossario.sdi.titolo'),
      descrizione: t('glossario.sdi.descrizione'),
      esempio: t('glossario.sdi.esempio'),
    },
    pec: {
      titolo: t('glossario.pec.titolo'),
      descrizione: t('glossario.pec.descrizione'),
      esempio: t('glossario.pec.esempio'),
    },
    tipoSoggetto: {
      titolo: t('glossario.tipoSoggetto.titolo'),
      descrizione: t('glossario.tipoSoggetto.descrizione'),
    },
    cig: {
      titolo: t('glossario.cig.titolo'),
      descrizione: t('glossario.cig.descrizione'),
      esempio: t('glossario.cig.esempio'),
    },
    cup: {
      titolo: t('glossario.cup.titolo'),
      descrizione: t('glossario.cup.descrizione'),
      esempio: t('glossario.cup.esempio'),
    },
    aliquotaIva: {
      titolo: t('glossario.aliquotaIva.titolo'),
      descrizione: t('glossario.aliquotaIva.descrizione'),
      esempio: t('glossario.aliquotaIva.esempio'),
    },
    ritenuta: {
      titolo: t('glossario.ritenuta.titolo'),
      descrizione: t('glossario.ritenuta.descrizione'),
    },
    iban: {
      titolo: t('glossario.iban.titolo'),
      descrizione: t('glossario.iban.descrizione'),
      esempio: t('glossario.iban.esempio'),
    },
    splitPayment: {
      titolo: t('glossario.splitPayment.titolo'),
      descrizione: t('glossario.splitPayment.descrizione'),
    },
    reverseCharge: {
      titolo: t('glossario.reverseCharge.titolo'),
      descrizione: t('glossario.reverseCharge.descrizione'),
    },
    esterometro: {
      titolo: t('glossario.esterometro.titolo'),
      descrizione: t('glossario.esterometro.descrizione'),
    },
    lipe: {
      titolo: t('glossario.lipe.titolo'),
      descrizione: t('glossario.lipe.descrizione'),
    },
    ddt: {
      titolo: t('glossario.ddt.titolo'),
      descrizione: t('glossario.ddt.descrizione'),
    },
    listino: {
      titolo: t('glossario.listino.titolo'),
      descrizione: t('glossario.listino.descrizione'),
    },
  };
}
