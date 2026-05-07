import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';

@Component({
  selector: 'app-user-guide',
  standalone: true,
  templateUrl: './user-guide.component.html',
  styleUrl: './user-guide.component.css',
})
export class UserGuideComponent {
  private readonly platformId = inject(PLATFORM_ID);

  /** Mục lục — id khớp các khối `#ug-*` trong template. */
  protected readonly tocLinks: ReadonlyArray<{ id: string; label: string }> = [
    { id: 'ug-intro', label: 'Tổng quan' },
    { id: 'ug-auth', label: 'Tài khoản và phiên' },
    { id: 'ug-nav', label: 'Sidebar và breadcrumb' },
    { id: 'ug-explorer', label: 'Explorer' },
    { id: 'ug-steps', label: 'Bước và Puppeteer' },
    { id: 'ug-prereq', label: 'Gói chạy trước' },
    { id: 'ug-packages', label: 'Gói thao tác' },
    { id: 'ug-run', label: 'Chạy và kết quả' },
    { id: 'ug-tabs', label: 'Dữ liệu và lịch sử' },
    { id: 'ug-ai', label: 'Trợ lý kịch bản' },
    { id: 'ug-notify', label: 'Thông báo' },
    { id: 'ug-schedules', label: 'Lịch tự động' },
    { id: 'ug-groups', label: 'Nhóm dự án' },
    { id: 'ug-settings', label: 'Cài đặt runner' },
    { id: 'ug-troubleshoot', label: 'Xử lý sự cố' },
  ];

  scrollToAnchor(id: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
