import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { catchError, of, tap } from 'rxjs';
import { QC_API_BASE_URL } from './qc-api.config';

export type AuthUser = { id: string; username: string; role: string };

const STORAGE_KEY = 'qc_portal_jwt';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  readonly token = signal<string | null>(null);
  readonly user = signal<AuthUser | null>(null);
  readonly authReady = signal(false);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const t = localStorage.getItem(STORAGE_KEY);
      if (t) this.token.set(t);
    }
  }

  setToken(token: string | null): void {
    this.token.set(token);
    if (isPlatformBrowser(this.platformId)) {
      if (token) localStorage.setItem(STORAGE_KEY, token);
      else localStorage.removeItem(STORAGE_KEY);
    }
  }

  logout(): void {
    this.setToken(null);
    this.user.set(null);
    this.authReady.set(true);
  }

  applyLoginResponse(body: { token: string; user: AuthUser }): void {
    this.setToken(body.token);
    this.user.set(body.user);
  }

  refreshMe(done?: () => void): void {
    const t = this.token();
    if (!t) {
      this.user.set(null);
      this.authReady.set(true);
      done?.();
      return;
    }
    this.http
      .get<{ ok: boolean; user?: AuthUser }>(`${QC_API_BASE_URL}/api/auth/me`)
      .pipe(
        tap((b) => {
          if (b.ok && b.user) this.user.set(b.user);
          else this.logout();
        }),
        catchError(() => {
          this.logout();
          return of(null);
        }),
      )
      .subscribe(() => {
        this.authReady.set(true);
        done?.();
      });
  }
}
