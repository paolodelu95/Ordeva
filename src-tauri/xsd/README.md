# Schema XSD FatturaPA

Usato dai test (`src/xml_corpus_tests.rs`) per validare ogni fattura generata.

- `FatturaPA.xsd`: schema ufficiale **v1.2.3** (specifiche tecniche 1.4), da
  <https://www.fatturapa.gov.it/it/norme-e-regole/documentazione-fattura-elettronica/formato-fatturapa/>
  (`Schema_VFPR12_v1.2.3.xsd`). Il sito pubblica anche `Schema_VFPA12_V1.2.3.xsd`,
  ma è lo stesso file byte per byte: FormatoTrasmissioneType ammette sia FPA12
  sia FPR12, quindi uno schema copre PA e privati.
- `xmldsig-core-schema.xsd`: schema W3C della firma, importato da FatturaPA.

Unica modifica rispetto agli originali: in `FatturaPA.xsd` l'import di xmldsig
punta alla copia locale (`schemaLocation="xmldsig-core-schema.xsd"`) invece che
a w3.org, così la validazione funziona senza rete.

**Per aggiornare**: scarica la nuova versione, sovrascrivi `FatturaPA.xsd`,
rifai la sostituzione di `schemaLocation`, aggiorna la versione qui sopra e
lancia `cargo test corpus`.
