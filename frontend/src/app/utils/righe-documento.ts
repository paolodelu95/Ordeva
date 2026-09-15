/**
 * Ripulitura delle righe di un documento prima del salvataggio.
 *
 * I dialog dei documenti partono con una riga già pronta e ne aggiungono una a
 * ogni "Aggiungi riga": quelle lasciate in bianco venivano salvate lo stesso.
 * Una riga vuota non si limita a stare lì — finisce nella stampa, entra nel
 * registro IVA con un'aliquota a zero e viaggia fino allo SdI come una linea
 * "Prodotto/Servizio" da 1 pezzo a 0 €, su una fattura elettronica vera.
 */

interface RigaSalvabile {
  tipo?: string;
  descrizione?: string;
  codiceProdotto?: string;
  prodottoId?: number | null;
}

/** Una riga conta se dice qualcosa: un prodotto, un codice o una descrizione. */
function haContenuto(r: RigaSalvabile): boolean {
  return !!(r.prodottoId || r.descrizione?.trim() || r.codiceProdotto?.trim());
}

/**
 * Toglie le righe rimaste in bianco. Le righe-nota valgono per il loro testo:
 * una nota senza testo è a sua volta da scartare.
 */
export function righeDaSalvare<T extends RigaSalvabile>(righe: T[]): T[] {
  return (righe ?? []).filter(r =>
    r.tipo === 'NOTA' ? !!r.descrizione?.trim() : haContenuto(r)
  );
}
