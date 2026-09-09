-- Seed dati preset del tenant (estratti dal backend Node, canonici).
-- Applicato SOLO su tenant nuovo (gate: azienda vuota), come fa il bootstrap Node.

-- azienda — l'INSERT è posizionale: ogni colonna aggiunta ad `azienda` in
-- tenant.sql va aggiunta ANCHE qui, altrimenti il seed di un archivio nuovo
-- fallisce e l'app non riesce ad aprirlo (lo verifica seed_applicabile_su_schema_corrente).
INSERT INTO azienda VALUES(1,'','','','','','','','','','','','','','','RF01',0.0,'','RT02','',0.0,0.0,'','',587,'','','',0,'','',0,0,1,'{}',NULL,'SMTP',NULL,'Buongiorno,
in allegato trovate il documento richiesto.
Restiamo a disposizione per qualsiasi chiarimento.',1,'GENERICO','',NULL,'trimestrale',0,2);

-- aliquote_iva
INSERT INTO aliquote_iva VALUES(1,'Esente art. 10',0.0,1,'E10','N4: Esente','Esente art. 10 DPR 633/72','N4','',0);
INSERT INTO aliquote_iva VALUES(2,'Imponibile 4%',4.0,1,'4','Imponibile','Imponibile 4%',NULL,'',0);
INSERT INTO aliquote_iva VALUES(3,'Imponibile 10%',10.0,1,'10','Imponibile','Imponibile 10%',NULL,'',0);
INSERT INTO aliquote_iva VALUES(4,'Imponibile 22%',22.0,1,'22','Imponibile','Imponibile 22%',NULL,'',1);
INSERT INTO aliquote_iva VALUES(5,'Imp. 22% detr. al 50%',22.0,1,'22d','Imponibile','Imp. 22% detr. al 50%',NULL,'50% indetraibile',0);
INSERT INTO aliquote_iva VALUES(6,'Imp. 22% detr. al 40%',22.0,1,'22d40','Imponibile','Imp. 22% detr. al 40%',NULL,'40% indetraibile',0);
INSERT INTO aliquote_iva VALUES(7,'Imp. 22% indetraibile',22.0,1,'22i','Imponibile','Imp. 22% indetraibile',NULL,'IVA totalmente indetraibile',0);
INSERT INTO aliquote_iva VALUES(8,'Imponibile 5%',5.0,1,'5','Imponibile','Imponibile 5%',NULL,'',0);
INSERT INTO aliquote_iva VALUES(9,'Imp. 22% acquisti rev. charge art. 17',22.0,1,'22r','Acq. reverse charge','Imp. 22% acquisti rev. charge art. 17',NULL,'',0);
INSERT INTO aliquote_iva VALUES(10,'Imp. 22% acquisti rev. charge art. 74',22.0,1,'22r74','Acq. reverse charge','Imp. 22% acquisti rev. charge art. 74',NULL,'',0);
INSERT INTO aliquote_iva VALUES(11,'Imp. 22% acquisti UE',22.0,1,'22u','Acq. reverse charge','Imp. 22% acquisti UE',NULL,'',0);
INSERT INTO aliquote_iva VALUES(12,'Imp. 22% acquisti extra-UE',22.0,1,'22x','Acq. reverse charge','Imp. 22% acquisti extra-UE',NULL,'',0);
INSERT INTO aliquote_iva VALUES(13,'Imp. 10% acquisti UE',10.0,1,'10u','Acq. reverse charge','Imp. 10% acquisti UE',NULL,'',0);
INSERT INTO aliquote_iva VALUES(14,'Imp. 10% acquisti extra-UE',10.0,1,'10x','Acq. reverse charge','Imp. 10% acquisti extra-UE',NULL,'',0);
INSERT INTO aliquote_iva VALUES(15,'Imp. 4% acquisti UE',4.0,1,'4u','Acq. reverse charge','Imp. 4% acquisti UE',NULL,'',0);
INSERT INTO aliquote_iva VALUES(16,'Imp. 4% acquisti extra-UE',4.0,1,'4x','Acq. reverse charge','Imp. 4% acquisti extra-UE',NULL,'',0);
INSERT INTO aliquote_iva VALUES(17,'Imp. 22% con scissione pagamenti',22.0,1,'22sp','Split payment','Imp. 22% con scissione pagamenti',NULL,'Split payment verso P.A.',0);
INSERT INTO aliquote_iva VALUES(18,'Imp. 10% con scissione pagamenti',10.0,1,'10sp','Split payment','Imp. 10% con scissione pagamenti',NULL,'Split payment verso P.A.',0);
INSERT INTO aliquote_iva VALUES(19,'Imp. 5% con scissione pagamenti',5.0,1,'5sp','Split payment','Imp. 5% con scissione pagamenti',NULL,'Split payment verso P.A.',0);
INSERT INTO aliquote_iva VALUES(20,'Imp. 4% con scissione pagamenti',4.0,1,'4sp','Split payment','Imp. 4% con scissione pagamenti',NULL,'Split payment verso P.A.',0);
INSERT INTO aliquote_iva VALUES(21,'Escluso art. 15 DPR 633/72',0.0,1,'X15','N1: Escluso art. 15','Escluso art. 15 DPR 633/72','N1','Spese per conto dei clienti',0);
INSERT INTO aliquote_iva VALUES(22,'Inv. contabile art. 7-ter DPR 633/72 UE',0.0,1,'NS7u','N2.1','Inv. contabile art. 7-ter DPR 633/72 UE','N2.1','Prestaz. servizi UE',0);
INSERT INTO aliquote_iva VALUES(23,'Non sogg. art. 7-ter DPR 633/72 extra-UE',0.0,1,'NS7x','N2.1','Non sogg. art. 7-ter DPR 633/72 extra-UE','N2.1','Prestaz. servizi extra-UE',0);
INSERT INTO aliquote_iva VALUES(24,'Fuori campo IVA',0.0,1,'FC','N2.2','Fuori campo IVA','N2.2','Riservato alle Spese fuori campo IVA',0);
INSERT INTO aliquote_iva VALUES(25,'Fuori campo art. 13 c. 5 DPR 633/72',0.0,1,'FC13','N2.2','Fuori campo art. 13 c. 5 DPR 633/72','N2.2','Cessione acquisti con IVA parz. indetraibile',0);
INSERT INTO aliquote_iva VALUES(26,'Non sogg. art. 26 c. 3 DPR 633/72',0.0,1,'NS26','N2.2','Non sogg. art. 26 c. 3 DPR 633/72','N2.2','Nota di credito del solo imponibile',0);
INSERT INTO aliquote_iva VALUES(27,'Non sogg. art. 74 c. 1 DPR 633/72',0.0,1,'NS74','N2.2','Non sogg. art. 74 c. 1 DPR 633/72','N2.2','Tabacchi, editoria, ric. telefoniche',0);
INSERT INTO aliquote_iva VALUES(28,'Art. 1 c.54-89 L.190/2014 Reg. forfettario',0.0,1,'RF','N2.2','Art. 1 c.54-89 L.190/2014 Reg. forfettario','N2.2','Regime forfettario',0);
INSERT INTO aliquote_iva VALUES(29,'Non imp. art. 8 c. 1 lett. a DPR 633/72',0.0,1,'N8a','N3.1','Non imp. art. 8 c. 1 lett. a DPR 633/72','N3.1','Cessioni extra-UE',0);
INSERT INTO aliquote_iva VALUES(30,'Non imp. art. 8 c. 1 lett. b DPR 633/72',0.0,1,'N8b','N3.1','Non imp. art. 8 c. 1 lett. b DPR 633/72','N3.1','Cessioni extra-UE (trasp. a cura del cliente)',0);
INSERT INTO aliquote_iva VALUES(31,'Non imp. art. 41 D.L. 331/93',0.0,1,'N41','N3.2','Non imp. art. 41 D.L. 331/93','N3.2','Cessioni UE',0);
INSERT INTO aliquote_iva VALUES(32,'Non imp. art. 71 DPR 633/72 San Marino',0.0,1,'N71','N3.3','Non imp. art. 71 DPR 633/72 San Marino','N3.3','Cessioni San Marino',0);
INSERT INTO aliquote_iva VALUES(33,'Non imp. art. 9 DPR 633/72',0.0,1,'N9','N3.4','Non imp. art. 9 DPR 633/72','N3.4','Trasporti extra-UE',0);
INSERT INTO aliquote_iva VALUES(34,'Non imp. art. 8 c. 1 lett. c DPR 633/72',0.0,1,'N8c','N3.5','Non imp. art. 8 c. 1 lett. c DPR 633/72','N3.5','Dichiarazione d''intento',0);
INSERT INTO aliquote_iva VALUES(35,'Esente D.Lgs n. 504/95 e D.Lgs n. 398/95 art. 10',0.0,1,'E10/72/49','N4: Esente','Esente D.Lgs n. 504/95 e D.Lgs n. 398/95 art. 10','N4','',0);
INSERT INTO aliquote_iva VALUES(36,'Esente art. 124 D.L. 34/2020',0.0,1,'E124','N4: Esente','Esente art. 124 D.L. 34/2020','N4','Cessione beni emergenza Covid-19',0);
INSERT INTO aliquote_iva VALUES(37,'Esente art. 74 Comma 7 e 8 DPR 633/72',0.0,1,'Ei','N4: Esente','Esente art. 74 Comma 7 e 8 DPR 633/72','N4','',0);
INSERT INTO aliquote_iva VALUES(38,'Omaggi art. 2 c. 2 n. 4 DPR 633/72',0.0,1,'OMG','N4: Esente','Omaggi art. 2 c. 2 n. 4 DPR 633/72','N4','Cessione gratuita beni oggetto dell''attività',0);
INSERT INTO aliquote_iva VALUES(39,'Regime del margine art. 36 DL 41/95',0.0,1,'RM','N5: Regime del margine','Regime del margine art. 36 DL 41/95','N5','Regime del margine',0);
INSERT INTO aliquote_iva VALUES(40,'Esente art. 74 Comma 7 e 8 DPR 633/72',0.0,1,'EiRc','N6','Esente art. 74 Comma 7 e 8 DPR 633/72','N6','',0);
INSERT INTO aliquote_iva VALUES(41,'Rev. charge art. 74 c. 7-8 DPR 633/72',0.0,1,'R74','N6.1','Rev. charge art. 74 c. 7-8 DPR 633/72','N6.1','Cessione rottami',0);
INSERT INTO aliquote_iva VALUES(42,'Rev. charge art. 17 c. 6/a DPR 633/72',0.0,1,'R17a','N6.3','Rev. charge art. 17 c. 6/a DPR 633/72','N6.3','Subappalto edilizia',0);
INSERT INTO aliquote_iva VALUES(43,'Rev. charge art. 17 c. 6/a-bis DPR 633/72',0.0,1,'R17ab','N6.4','Rev. charge art. 17 c. 6/a-bis DPR 633/72','N6.4','Cessione fabbricati',0);
INSERT INTO aliquote_iva VALUES(44,'Rev. charge art. 17 c. 6/b DPR 633/72',0.0,1,'R17b','N6.5','Rev. charge art. 17 c. 6/b DPR 633/72','N6.5','Cessione cellulari',0);
INSERT INTO aliquote_iva VALUES(45,'Rev. charge art. 17 c. 6/c DPR 633/72',0.0,1,'R17c','N6.6','Rev. charge art. 17 c. 6/c DPR 633/72','N6.6','Cessione microprocessori',0);
INSERT INTO aliquote_iva VALUES(46,'Rev. charge art. 17 c. 6/a-ter DPR 633/72',0.0,1,'R17t','N6.7','Rev. charge art. 17 c. 6/a-ter DPR 633/72','N6.7','Prestazioni servizi su edifici',0);

-- unita_misura
INSERT INTO unita_misura VALUES(1,'Pezzo','pz');
INSERT INTO unita_misura VALUES(2,'Chilogrammo','kg');
INSERT INTO unita_misura VALUES(3,'Litro','lt');
INSERT INTO unita_misura VALUES(4,'Metro','mt');
INSERT INTO unita_misura VALUES(5,'Ora','h');
INSERT INTO unita_misura VALUES(6,'Metro quadro','m²');
INSERT INTO unita_misura VALUES(7,'Metro cubo','m³');
INSERT INTO unita_misura VALUES(8,'Set','set');

-- tipi_pagamento
INSERT INTO tipi_pagamento VALUES(1,'Contanti','CASSA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(2,'POS','BANCA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(3,'Bonifico anticipato','BANCA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(4,'Bonifico vista fattura','BANCA',0,0,0,1);
INSERT INTO tipi_pagamento VALUES(5,'Bonifico 30 gg.','BANCA',30,0,0,1);
INSERT INTO tipi_pagamento VALUES(6,'Bonifico 30 gg F.M.','BANCA',30,1,0,1);
INSERT INTO tipi_pagamento VALUES(7,'Bonifico 60 gg.','BANCA',60,0,0,1);
INSERT INTO tipi_pagamento VALUES(8,'Bonifico 60 gg F.M.','BANCA',60,1,0,1);
INSERT INTO tipi_pagamento VALUES(9,'Assegno','BANCA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(10,'Assegno circolare','BANCA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(11,'Bancomat','BANCA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(12,'Carta di pagamento','BANCA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(13,'Contanti presso Tesoreria','CASSA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(14,'Contrassegno','CASSA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(15,'Incasso corrispettivi','CASSA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(16,'PayPal','BANCA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(17,'Satispay','BANCA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(18,'TeamSystem Pay','BANCA',0,0,1,1);
INSERT INTO tipi_pagamento VALUES(19,'BONIFICO','BANCA',0,0,0,1);
INSERT INTO tipi_pagamento VALUES(20,'Bonifico F.M.','BANCA',0,1,0,1);
INSERT INTO tipi_pagamento VALUES(21,'Da definire','BANCA',0,0,0,1);
INSERT INTO tipi_pagamento VALUES(22,'Pagato come da relativi documenti sopra indicati','BANCA',0,0,0,1);
INSERT INTO tipi_pagamento VALUES(23,'RIMESSA DIRETTA','BANCA',0,0,0,1);
INSERT INTO tipi_pagamento VALUES(24,'Segue fattura','BANCA',0,0,0,1);
INSERT INTO tipi_pagamento VALUES(25,'Trattenuta su somme già riscosse','BANCA',0,0,0,1);
INSERT INTO tipi_pagamento VALUES(26,'30 gg. F.M.','BANCA',30,1,0,1);
INSERT INTO tipi_pagamento VALUES(27,'BONIFICO 30 gg D.F.F.M.','BANCA',30,1,0,1);
INSERT INTO tipi_pagamento VALUES(28,'BONIFICO 30-60 gg. D.F.F.M.','BANCA',30,1,0,1);
INSERT INTO tipi_pagamento VALUES(29,'BONIFICO 60 gg D.F.F.M.','BANCA',60,1,0,1);
INSERT INTO tipi_pagamento VALUES(30,'BONIFICO 90 gg. F.M.','BANCA',90,1,0,1);
INSERT INTO tipi_pagamento VALUES(31,'Domiciliazione bancaria','BANCA',30,0,0,1);
INSERT INTO tipi_pagamento VALUES(32,'RIBA 30 gg F.M.','BANCA',30,1,0,1);
INSERT INTO tipi_pagamento VALUES(33,'RIBA 30-60 gg F.M.','BANCA',30,1,0,1);
INSERT INTO tipi_pagamento VALUES(34,'RIBA 30-60-90 gg F.M.','BANCA',30,1,0,1);
INSERT INTO tipi_pagamento VALUES(35,'RIBA 60 gg F.M.','BANCA',60,1,0,1);
INSERT INTO tipi_pagamento VALUES(36,'RIBA 90 gg F.M.','BANCA',90,1,0,1);
INSERT INTO tipi_pagamento VALUES(37,'Rid','BANCA',30,0,0,1);
INSERT INTO tipi_pagamento VALUES(38,'Rim. diretta 120gg. DFFM','BANCA',120,1,0,1);
INSERT INTO tipi_pagamento VALUES(39,'SDD B2B','BANCA',30,0,0,1);
INSERT INTO tipi_pagamento VALUES(40,'SDD Core','BANCA',30,0,0,1);

-- conti_acquisto
INSERT INTO conti_acquisto VALUES(1,'Abbonamenti riviste, giornali','',1);
INSERT INTO conti_acquisto VALUES(2,'Abbuoni e arrot. attivi','',1);
INSERT INTO conti_acquisto VALUES(3,'Abbuoni e arrot. passivi','',1);
INSERT INTO conti_acquisto VALUES(4,'Acquisto carburanti','',1);
INSERT INTO conti_acquisto VALUES(5,'Acquisto imballaggi','',1);
INSERT INTO conti_acquisto VALUES(6,'Acquisto libri e giornali','',1);
INSERT INTO conti_acquisto VALUES(7,'Acquisto ricariche, biglietti, bollo','',1);
INSERT INTO conti_acquisto VALUES(8,'Acquisto valori bollati','',1);
INSERT INTO conti_acquisto VALUES(9,'Altri costi del personale','',1);
INSERT INTO conti_acquisto VALUES(10,'Altri costi per servizi','',1);
INSERT INTO conti_acquisto VALUES(11,'Assicurazioni auto','',1);
INSERT INTO conti_acquisto VALUES(12,'Autocarri/autovetture','',1);
INSERT INTO conti_acquisto VALUES(13,'Autovetture (inded. 80%)','',1);
INSERT INTO conti_acquisto VALUES(14,'Bolli auto','',1);
INSERT INTO conti_acquisto VALUES(15,'Cancelleria e stampati','',1);
INSERT INTO conti_acquisto VALUES(16,'Canone affitto','',1);
INSERT INTO conti_acquisto VALUES(17,'Canone di manutenzione','',1);
INSERT INTO conti_acquisto VALUES(18,'Canoni di leasing veicoli','',1);
INSERT INTO conti_acquisto VALUES(19,'Carburanti e lubrificanti','',1);
INSERT INTO conti_acquisto VALUES(20,'Consulenze commercialisti','',1);
INSERT INTO conti_acquisto VALUES(21,'Consulenze del lavoro','',1);
INSERT INTO conti_acquisto VALUES(22,'Contributi enasarco','',1);
INSERT INTO conti_acquisto VALUES(23,'Costi di ampliamento','',1);
INSERT INTO conti_acquisto VALUES(24,'Diritti camerali','',1);
INSERT INTO conti_acquisto VALUES(25,'Fabbricati Ind.li e comm.li','',1);
INSERT INTO conti_acquisto VALUES(26,'Fitti passivi','',1);
INSERT INTO conti_acquisto VALUES(27,'Impianti generici','',1);
INSERT INTO conti_acquisto VALUES(28,'Imposte e tasse deducibili','',1);
INSERT INTO conti_acquisto VALUES(29,'Imposte e tasse indeducibili','',1);
INSERT INTO conti_acquisto VALUES(30,'Indumenti di lavoro','',1);
INSERT INTO conti_acquisto VALUES(31,'Interessi passivi v/fornitori','',1);
INSERT INTO conti_acquisto VALUES(32,'Lavorazioni di terzi p/produzione di beni','',1);
INSERT INTO conti_acquisto VALUES(33,'Licenze d''uso software','',1);
INSERT INTO conti_acquisto VALUES(34,'Macchine elettromec. d''ufficio','',1);
INSERT INTO conti_acquisto VALUES(35,'Manutenzione e rip. veicoli parz. ded.','',1);
INSERT INTO conti_acquisto VALUES(36,'Materiale pubblicitario','',1);
INSERT INTO conti_acquisto VALUES(37,'Materie di consumo c/acquisti','',1);
INSERT INTO conti_acquisto VALUES(38,'Materie prime c/acquisti','',1);
INSERT INTO conti_acquisto VALUES(39,'Materie prime c/acquisti per produzione servizi','',1);
INSERT INTO conti_acquisto VALUES(40,'Materie sussidiarie c/acquisti','',1);
INSERT INTO conti_acquisto VALUES(41,'Merci c/acquisti','Acquisti / Prestaz. servizi',1);
INSERT INTO conti_acquisto VALUES(42,'Merci c/acquisti per produzione servizi','',1);
INSERT INTO conti_acquisto VALUES(43,'Mobili e arredi ufficio','',1);
INSERT INTO conti_acquisto VALUES(44,'Multe e sanzioni indeducibili','',1);
INSERT INTO conti_acquisto VALUES(45,'Note spese amministratori','',1);
INSERT INTO conti_acquisto VALUES(46,'Note spese dipendenti','',1);
INSERT INTO conti_acquisto VALUES(47,'Omaggi da fornitori','',1);
INSERT INTO conti_acquisto VALUES(48,'Oneri bancari','',1);
INSERT INTO conti_acquisto VALUES(49,'Oneri sociali cassa edile','',1);
INSERT INTO conti_acquisto VALUES(50,'Oneri sociali INAIL','',1);
INSERT INTO conti_acquisto VALUES(51,'Oneri sociali INPS','',1);
INSERT INTO conti_acquisto VALUES(52,'Pedaggi autostradali','',1);
INSERT INTO conti_acquisto VALUES(53,'Provvigioni a intermediari','',1);
INSERT INTO conti_acquisto VALUES(54,'Rit. d''acconto','Rit. d''acconto',1);
INSERT INTO conti_acquisto VALUES(55,'Sconti e abbuoni su acquisti merci','',1);
INSERT INTO conti_acquisto VALUES(56,'Servizi di pulizia','',1);
INSERT INTO conti_acquisto VALUES(57,'Servizi internet','',1);
INSERT INTO conti_acquisto VALUES(58,'Spese condominiali','',1);
INSERT INTO conti_acquisto VALUES(59,'Spese di pubblicità','',1);
INSERT INTO conti_acquisto VALUES(60,'Spese di rappresentanza','',1);
INSERT INTO conti_acquisto VALUES(61,'Spese di trasferta','',1);
INSERT INTO conti_acquisto VALUES(62,'Spese legali e notarili','',1);
INSERT INTO conti_acquisto VALUES(63,'Spese postali','',1);
INSERT INTO conti_acquisto VALUES(64,'Spese recupero crediti (insoluti, protesti..)','',1);
INSERT INTO conti_acquisto VALUES(65,'Spese telefoniche','',1);
INSERT INTO conti_acquisto VALUES(66,'Stipendi','',1);
INSERT INTO conti_acquisto VALUES(67,'Tassa sui rifiuti','',1);
INSERT INTO conti_acquisto VALUES(68,'Terreni','',1);
INSERT INTO conti_acquisto VALUES(69,'TFR','',1);
INSERT INTO conti_acquisto VALUES(70,'TFR destinato a fondi pensione (-50 dip.)','',1);
INSERT INTO conti_acquisto VALUES(71,'Trasporti su acquisti','',1);
INSERT INTO conti_acquisto VALUES(72,'Trasporti su vendite','',1);
INSERT INTO conti_acquisto VALUES(73,'Utenze acqua','',1);
INSERT INTO conti_acquisto VALUES(74,'Utenze energia elettrica','',1);
INSERT INTO conti_acquisto VALUES(75,'Utenze gas riscaldamento','',1);
INSERT INTO conti_acquisto VALUES(76,'Vigilanza','',1);

-- causali_pagamento
INSERT INTO causali_pagamento VALUES(1,'Acquisto Prodotti',1,1);
INSERT INTO causali_pagamento VALUES(2,'Acquisto valori bollati',2,1);
INSERT INTO causali_pagamento VALUES(3,'Addebiti POS',3,1);
INSERT INTO causali_pagamento VALUES(4,'Affitto negozio',4,1);
INSERT INTO causali_pagamento VALUES(5,'Assicurazione Negozio',5,1);
INSERT INTO causali_pagamento VALUES(6,'Bolletta Luce',6,1);
INSERT INTO causali_pagamento VALUES(7,'Bolletta telefono',7,1);
INSERT INTO causali_pagamento VALUES(8,'Bollino Registratore di Cassa',8,1);
INSERT INTO causali_pagamento VALUES(9,'CIG ... CUP ...',9,1);
INSERT INTO causali_pagamento VALUES(10,'Contributi dipendente',10,1);
INSERT INTO causali_pagamento VALUES(11,'Pagamento inps',11,1);
INSERT INTO causali_pagamento VALUES(12,'Pagamento iva',12,1);
INSERT INTO causali_pagamento VALUES(13,'Scontrini',13,1);
INSERT INTO causali_pagamento VALUES(14,'Spese commercialista',14,1);
INSERT INTO causali_pagamento VALUES(15,'Spese furgoncino',15,1);
INSERT INTO causali_pagamento VALUES(16,'Spese postali',16,1);
INSERT INTO causali_pagamento VALUES(17,'Spese programma Danea',17,1);
INSERT INTO causali_pagamento VALUES(18,'Spese pubblicitarie',18,1);
INSERT INTO causali_pagamento VALUES(19,'Spese Varie',19,1);
INSERT INTO causali_pagamento VALUES(20,'Stipendi',20,1);
INSERT INTO causali_pagamento VALUES(21,'Tassa camera commercio',21,1);
INSERT INTO causali_pagamento VALUES(22,'Versamento',22,1);

-- crm_stage
INSERT INTO crm_stage VALUES(1,'Lead',1,'#94a3b8',0,0);
INSERT INTO crm_stage VALUES(2,'Qualificato',2,'#6366f1',0,0);
INSERT INTO crm_stage VALUES(3,'Proposta',3,'#f59e0b',0,0);
INSERT INTO crm_stage VALUES(4,'Trattativa',4,'#8b5cf6',0,0);
INSERT INTO crm_stage VALUES(5,'Vinto',5,'#16a34a',1,0);
INSERT INTO crm_stage VALUES(6,'Perso',6,'#dc2626',0,1);

-- magazzini
INSERT INTO magazzini VALUES(1,'PRINC','Principale','',1,1);
