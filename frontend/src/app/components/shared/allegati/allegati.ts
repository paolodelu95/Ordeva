import { inject, Component, Input, OnInit, OnChanges, SimpleChanges, ViewChild, ElementRef } from '@angular/core';
import { EmptyStateComponent } from '../empty-state';
import { ConfirmService } from '../confirm-dialog';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DataService } from '../../../services/data.service';
import { I18nService } from '../../../services/i18n.service';
import { TPipe } from '../../../pipes/t.pipe';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-allegati',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    EmptyStateComponent,
    TPipe,
  ],
  templateUrl: './allegati.html',
  styleUrl: './allegati.scss',
})
export class AllegatiComponent implements OnInit, OnChanges {
  private confirm = inject(ConfirmService);
  private i18n = inject(I18nService);
  @Input() documentoTipo!: string;
  @Input() documentoId!: number | null;

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  allegati: any[] = [];
  uploading = false;

  constructor(
    private ds: DataService,
    private http: HttpClient,
    private snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['documentoId'] && !changes['documentoId'].firstChange) {
      this.load();
    }
  }

  load(): void {
    if (!this.documentoTipo || !this.documentoId) {
      this.allegati = [];
      return;
    }
    this.ds.getAllegati(this.documentoTipo, this.documentoId).subscribe({
      next: data => (this.allegati = data),
      error: () => (this.allegati = []),
    });
  }

  triggerUpload(): void {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.documentoId) return;

    this.uploading = true;
    const formData = new FormData();
    formData.append('file', file);

    const url = `${environment.apiUrl}/allegati?tipo=${this.documentoTipo}&id=${this.documentoId}`;
    this.http.post<any>(url, formData).subscribe({
      next: () => {
        this.uploading = false;
        input.value = '';
        this.load();
        this.snack.open(this.i18n.t('allegati.msg.caricato'), '', { duration: 2000 });
      },
      error: e => {
        this.uploading = false;
        input.value = '';
        this.snack.open(this.i18n.t('allegati.msg.erroreUpload', { errore: e.error?.error || e.message }), '', { duration: 4000 });
      },
    });
  }

  download(allegato: any): void {
    window.open(`${environment.apiUrl}/allegati/${allegato.id}/download`, '_blank');
  }

  async delete(allegato: any): Promise<void> {
    if (!await this.confirm.delete(this.i18n.t('allegati.confermaElimina', { nome: allegato.nomeFile }))) return;
    this.ds.deleteAllegato(allegato.id).subscribe({
      next: () => {
        this.load();
        this.snack.open(this.i18n.t('allegati.msg.eliminato'), '', { duration: 2000 });
      },
      error: e => this.snack.open(this.i18n.t('allegati.msg.errore', { errore: e.error?.error || e.message }), '', { duration: 4000 }),
    });
  }

  getFileIcon(mimeType: string): string {
    if (!mimeType) return 'attach_file';
    if (mimeType === 'application/pdf') return 'picture_as_pdf';
    if (mimeType.startsWith('image/')) return 'image';
    return 'attach_file';
  }

  formatSize(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
