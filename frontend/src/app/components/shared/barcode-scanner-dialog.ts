import { Component, ElementRef, OnDestroy, ViewChild, AfterViewInit, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

declare const BarcodeDetector: any;

@Component({
  selector: 'app-barcode-scanner-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ 'barcodeScanner.title' | t }}</h2>
    <mat-dialog-content style="padding:0;position:relative;background:#000">
      @if (errorMsg) {
        <div class="bs-error">
          <mat-icon>error_outline</mat-icon>
          <p>{{ errorMsg }}</p>
        </div>
      } @else {
        <video #video class="bs-video" playsinline muted autoplay></video>
        <div class="bs-overlay">
          <div class="bs-frame"></div>
          <p class="bs-hint">{{ 'barcodeScanner.hint' | t }}</p>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">{{ 'fatture.dialog.annulla' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; }
    .bs-video {
      width: 100%;
      max-height: 70vh;
      display: block;
      background: #000;
      object-fit: cover;
    }
    .bs-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .bs-frame {
      width: 70%;
      height: 130px;
      border: 3px solid #11769b;
      border-radius: 12px;
      box-shadow: 0 0 0 9999px rgba(0,0,0,0.45);
    }
    .bs-hint {
      color: #fff;
      font-size: 13px;
      margin-top: 16px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.8);
    }
    .bs-error {
      padding: 40px 24px;
      text-align: center;
      color: #fff;
      mat-icon { font-size: 48px; width: 48px; height: 48px; color: #f59e0b; }
      p { margin-top: 12px; font-size: 14px; }
    }
  `]
})
export class BarcodeScannerDialogComponent implements AfterViewInit, OnDestroy {
  private i18n = inject(I18nService);
  @ViewChild('video') videoRef?: ElementRef<HTMLVideoElement>;
  errorMsg = '';
  private stream?: MediaStream;
  private detector: any = null;
  private rafId: number | null = null;
  private stopped = false;

  constructor(private dialogRef: MatDialogRef<BarcodeScannerDialogComponent, string | null>, private zone: NgZone) {}

  async ngAfterViewInit() {
    if (typeof BarcodeDetector === 'undefined') {
      this.errorMsg = this.i18n.t('barcodeScanner.errore.nonSupportato');
      return;
    }
    try {
      this.detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e'] });
    } catch {
      this.errorMsg = this.i18n.t('barcodeScanner.errore.formatoNonSupportato');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e: any) {
      this.errorMsg = this.i18n.t('barcodeScanner.errore.permessoNegato', { motivo: e?.name || this.i18n.t('barcodeScanner.errore.genericoLabel') });
      return;
    }
    if (this.videoRef && !this.stopped) {
      this.videoRef.nativeElement.srcObject = this.stream;
      try { await this.videoRef.nativeElement.play(); } catch {}
      this.zone.runOutsideAngular(() => this.scanLoop());
    }
  }

  private async scanLoop() {
    if (this.stopped || !this.videoRef?.nativeElement || !this.detector) return;
    try {
      const codes = await this.detector.detect(this.videoRef.nativeElement);
      if (codes?.length) {
        const code = codes[0].rawValue;
        this.zone.run(() => this.dialogRef.close(code));
        return;
      }
    } catch {}
    this.rafId = requestAnimationFrame(() => this.scanLoop());
  }

  cancel() { this.dialogRef.close(null); }

  ngOnDestroy() {
    this.stopped = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach(t => t.stop());
  }
}
