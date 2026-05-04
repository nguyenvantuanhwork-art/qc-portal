import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { QC_API_BASE_URL, QC_API_DEV_PORT } from './qc-api.config';
import { AuthService } from './auth.service';

type ChatResponse = { ok: true; text: string; model?: string } | { ok: false; error: string };

export interface AiFillItemDto {
  actionId: string;
  value: string;
  confidence?: number;
  notes?: string;
}

export type ActionKind = 'navigate' | 'click_selector' | 'click_text' | 'type' | 'wait';

export interface ProjectDto {
  id: string;
  key: string | null;
  name: string;
  description: string;
}

/** Khớp `ResolvedProjectSettings` từ qc-api — cài đặt cấp dự án. */
export interface ProjectSettingsDto {
  runner: {
    defaultStepTimeoutMs: number;
    navigateTimeoutMs: number;
    waitStepMaxMs: number;
    screenshotPolicy: 'every_step' | 'on_failure';
    headless: boolean;
    viewportWidth: number;
    viewportHeight: number;
    runRetries: number;
    defaultBaseUrl: string;
  };
  ai: {
    enabled: boolean;
  };
}

export interface ProjectMemberDto {
  userId: string;
  username: string;
  role: 'owner' | 'member';
}

export interface FeatureDto {
  id: string;
  projectId: string;
  key: string | null;
  name: string;
  description: string;
}

export interface TestCaseDto {
  id: string;
  featureId: string | null;
  key: string | null;
  name: string;
  description: string;
  status: string;
  priority: string;
}

/** Khớp qc-api `NotificationRow` — thông báo trong app. */
export interface NotificationItemDto {
  id: string;
  kind: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface TestActionDto {
  id: string;
  testCaseId: string;
  order: number;
  kind: ActionKind;
  name: string;
  enabled: boolean;
  config: {
    url?: string;
    selector?: string;
    matchText?: string;
    value?: string;
    waitMs?: number;
  };
  expectation?: string;
}

type AiFillResponse =
  | {
      ok: true;
      mode: 'preview' | 'apply';
      fills: AiFillItemDto[];
      model?: string;
      appliedActionIds?: string[];
      actions?: TestActionDto[];
    }
  | { ok: false; error: string };

export interface RunStepDto {
  actionId: string;
  order: number;
  name: string;
  kind: ActionKind;
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
  url?: string;
  screenshotBase64?: string;
  durationMs: number;
}

export interface RunResultDto {
  ok: boolean;
  testCaseId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  overallStatus: 'passed' | 'failed';
  steps: RunStepDto[];
  error?: string;
}

export type BatchRunJobStatus = 'queued' | 'running' | 'done' | 'error';

export interface BatchRunJob {
  id: string;
  testCaseId: string;
  testCaseLabel: string;
  featureLabel: string;
  status: BatchRunJobStatus;
  errorMessage?: string;
  result?: RunResultDto;
}

export interface RunToastItem {
  id: string;
  testCaseId: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface TestRunSummaryDto {
  id: string;
  testCaseId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  overallStatus: 'passed' | 'failed';
  triggeredByUsername?: string | null;
}

/** Lịch sử chạy gộp (sidebar) — có ngữ cảnh dự án / feature / testcase. */
export interface GlobalRunHistoryRow extends TestRunSummaryDto {
  testCaseName: string | null;
  testCaseKey: string | null;
  featureId: string | null;
  featureName: string | null;
  featureKey: string | null;
  projectId: string | null;
  projectName: string | null;
  projectKey: string | null;
  hasScreenshots: boolean;
}

/** Báo cáo tổng hợp (GET /api/reports/summary). */
export interface ReportDayBucketDto {
  day: string;
  totalRuns: number;
  passed: number;
  failed: number;
  avgDurationMs: number;
}

export interface ReportTopFailingDto {
  testCaseId: string;
  testCaseName: string | null;
  projectName: string | null;
  totalRuns: number;
  failedRuns: number;
}

export interface ReportErrorTrendDto {
  errorKey: string;
  count: number;
  lastSeenAt: string;
}

export interface ReportSummaryDto {
  days: number;
  projectId: string | null;
  totals: { totalRuns: number; passed: number; failed: number; passRate: number };
  series: ReportDayBucketDto[];
  topFailingTestCases: ReportTopFailingDto[];
  errorTrends: ReportErrorTrendDto[];
}

export interface ScheduleDto {
  id: string;
  testCaseId: string;
  name: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string;
  createdAt: string;
  testCaseName: string | null;
  featureId: string | null;
  featureName: string | null;
  projectId: string | null;
  projectName: string | null;
  scheduleGroupId?: string | null;
  staggerSeconds?: number;
}

/** Test case trong dự án — dùng cho form lịch (không phụ thuộc testcase đang mở). */
export interface SchedulePickerTcDto {
  id: string;
  testCaseName: string;
  featureId: string;
  featureName: string;
}

/** Kiểu lịch giao diện thân thiện (backend vẫn nhận cron hoặc @once / @in). */
export type ScheduleFrequencyMode =
  | 'once'
  | 'delay'
  | 'daily'
  | 'weekdays'
  | 'hourly'
  | 'weekly'
  | 'custom';

/** Múi giờ form: offset cố định (không DST) — khớp backend tính next_run. */
const SCHEDULE_TZ_OFFSET_HOURS: Record<string, number> = {
  UTC: 0,
  'Asia/Ho_Chi_Minh': 7,
  'Asia/Bangkok': 7,
};

export interface TestRunDetailDto extends TestRunSummaryDto {
  result: RunResultDto;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly auth = inject(AuthService);
  private readonly reportBarCanvas = viewChild<ElementRef<HTMLCanvasElement>>('reportBarCanvas');
  private readonly reportLineCanvas = viewChild<ElementRef<HTMLCanvasElement>>('reportLineCanvas');
  private reportBarChartInstance: { destroy: () => void } | null = null;
  private reportLineChartInstance: { destroy: () => void } | null = null;
  private notificationPollTimer: ReturnType<typeof setInterval> | null = null;

  // Selection state (Project → Feature → TestCase)
  protected readonly projects = signal<ProjectDto[]>([]);
  protected readonly features = signal<FeatureDto[]>([]);
  protected readonly testCases = signal<TestCaseDto[]>([]);
  protected readonly testCasesByFeature = signal<Record<string, TestCaseDto[]>>({});
  protected readonly selectedProjectId = signal<string | null>(null);
  protected readonly selectedFeatureId = signal<string | null>(null);
  protected readonly selectedTestCaseId = signal<string | null>(null);
  protected readonly currentSidebarSection = signal<
    | 'project'
    | 'members'
    | 'settings'
    | 'feature'
    | 'testcase'
    | 'runhistory'
    | 'schedules'
    | 'reports'
    | 'explorer'
    | 'none'
  >('testcase');

  // Header project selector
  protected readonly projectPickerOpen = signal(false);
  protected readonly featurePickerOpen = signal(false);

  // Explorer state
  protected readonly explorerQuery = signal('');
  protected readonly explorerExpandedFeatureIds = signal<string[]>([]);
  protected readonly explorerLoadingFeatureIds = signal<string[]>([]);

  protected readonly chatPrompt = signal('');
  protected readonly aiReply = signal<string | null>(null);
  protected readonly aiLoading = signal(false);
  protected readonly aiError = signal<string | null>(null);
  /** Phân tích kết quả chạy (panel bên phải) — gọi cùng API /api/ai/chat. */
  protected readonly runAnalysisText = signal<string | null>(null);
  protected readonly runAnalysisLoading = signal(false);
  protected readonly runAnalysisError = signal<string | null>(null);

  protected readonly aiFillLoading = signal(false);
  protected readonly aiFillError = signal<string | null>(null);
  protected readonly aiFillDraft = signal<{ fills: AiFillItemDto[]; model?: string } | null>(null);
  protected readonly aiFillUseDom = signal(false);

  protected readonly actions = signal<TestActionDto[]>([]);
  protected readonly actionsLoading = signal(false);
  protected readonly actionsError = signal<string | null>(null);

  protected readonly menuOpenForId = signal<string | null>(null);
  // Context menu (render as fixed overlay to avoid any overflow clipping)
  protected readonly menuX = signal(0);
  protected readonly menuY = signal(0);
  private draggedActionId: string | null = null;

  protected readonly editingId = signal<string | null>(null);
  protected readonly formName = signal('');
  protected readonly formKind = signal<ActionKind>('navigate');
  protected readonly formUrl = signal('');
  protected readonly formSelector = signal('');
  protected readonly formMatchText = signal('');
  protected readonly formValue = signal('');
  protected readonly formWaitMs = signal(1000);
  protected readonly formExpectation = signal('');

  protected readonly runLoading = signal(false);
  protected readonly runError = signal<string | null>(null);
  protected readonly runResult = signal<RunResultDto | null>(null);
  protected readonly runPanelTab = signal<'overview' | 'steps' | 'shots' | 'log'>('overview');
  protected readonly selectedShotIndex = signal(0);

  /** Chọn nhiều testcase trong Explorer để chạy tuần tự. */
  protected readonly explorerBatchSelectMode = signal(false);
  protected readonly batchSelectedTcIds = signal<readonly string[]>([]);
  protected readonly batchJobs = signal<BatchRunJob[]>([]);
  protected readonly batchRunnerBusy = signal(false);
  protected readonly batchPanelExpanded = signal(false);
  protected readonly runToasts = signal<RunToastItem[]>([]);
  private readonly runToastTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Test case tabs
  protected readonly testCaseTab = signal<'steps' | 'data' | 'settings' | 'history'>('steps');

  // Run history (per test case)
  protected readonly runHistoryLoading = signal(false);
  protected readonly runHistoryError = signal<string | null>(null);
  protected readonly runHistory = signal<TestRunSummaryDto[]>([]);

  protected readonly historyDetailOpen = signal(false);
  protected readonly historyDetailLoading = signal(false);
  protected readonly historyDetailError = signal<string | null>(null);
  protected readonly historyDetail = signal<TestRunDetailDto | null>(null);

  protected readonly globalRunHistoryLoading = signal(false);
  protected readonly globalRunHistoryError = signal<string | null>(null);
  protected readonly globalRunHistory = signal<GlobalRunHistoryRow[]>([]);

  protected readonly reportsLoading = signal(false);
  protected readonly reportsError = signal<string | null>(null);
  protected readonly reportSummary = signal<ReportSummaryDto | null>(null);
  /** Khoảng thời gian báo cáo (ngày). */
  protected readonly reportDays = signal(14);
  /** Rỗng = tất cả dự án được phép. */
  protected readonly reportProjectId = signal('');

  protected readonly schedulesLoading = signal(false);
  protected readonly schedulesError = signal<string | null>(null);
  protected readonly schedulesList = signal<ScheduleDto[]>([]);
  protected readonly scheduleFormName = signal('');
  protected readonly scheduleFormCron = signal('0 * * * *');
  protected readonly scheduleFormTz = signal('Asia/Ho_Chi_Minh');
  protected readonly scheduleFormSaving = signal(false);
  protected readonly scheduleFormError = signal<string | null>(null);
  protected readonly scheduleEditingId = signal<string | null>(null);
  protected readonly scheduleFrequencyMode = signal<ScheduleFrequencyMode>('daily');
  /** HH:mm — dùng cho daily / weekdays / weekly */
  protected readonly scheduleTimeLocal = signal('08:00');
  /** 0–6: CN–T7 (đúng chuẩn cron) */
  protected readonly scheduleWeekdays = signal<number[]>([1, 2, 3, 4, 5]);
  /** Mỗi giờ: chạy vào phút này (0–59) */
  protected readonly scheduleHourlyMinute = signal(0);
  /** Một lần: datetime-local YYYY-MM-DDTHH:mm theo múi giờ đã chọn */
  protected readonly scheduleOnceDatetime = signal('');
  /** Sau bao nhiêu phút (tính từ lúc lưu / cập nhật lịch) */
  protected readonly scheduleDelayMinutes = signal(30);

  /** Test case được tick khi tạo lịch hàng loạt (theo dự án hiện tại). */
  protected readonly scheduleFormSelectedTcIds = signal<string[]>([]);
  /** Khoảng cách (giây) giữa lần bắt đầu chạy từng testcase trong cùng một lần kích lịch. */
  protected readonly scheduleStaggerSeconds = signal(0);
  protected readonly schedulePickerTestCases = signal<SchedulePickerTcDto[]>([]);
  protected readonly schedulePickerLoading = signal(false);

  /** Popups theo yêu cầu: thêm/sửa/xóa/tạm tắt đều qua popup. */
  protected readonly addStepOpen = signal(false);
  protected readonly editStepOpen = signal(false);
  protected readonly deleteStepOpen = signal(false);
  protected readonly deleteTargetId = signal<string | null>(null);

  // CRUD modals: project / feature / testcase
  protected readonly crudModalOpen = signal(false);
  protected readonly crudEntity = signal<'project' | 'feature' | 'testcase' | null>(null);
  protected readonly crudMode = signal<'create' | 'edit' | 'delete'>('create');

  protected readonly crudEditingId = signal<string | null>(null);
  protected readonly crudFormId = signal(''); // for testcase id
  protected readonly crudFormKey = signal('');
  protected readonly crudFormName = signal('');
  protected readonly crudFormDescription = signal('');
  protected readonly crudFormStatus = signal('active');
  protected readonly crudFormPriority = signal('medium');
  /** Feature chứa testcase đang sửa/xóa — khớp URL API (không lấy selectedFeatureId khi hai khác nhau). */
  protected readonly crudTestCaseFeatureId = signal<string | null>(null);
  protected readonly crudError = signal<string | null>(null);
  protected readonly crudLoading = signal(false);

  /**
   * Legacy modal (không dùng nữa) — giữ lại để template cũ không lỗi build.
   * Sẽ xoá hẳn sau khi dọn template.
   */
  protected readonly flowModalOpen = signal(false);
  protected readonly flowModalTab = signal<'actions' | 'run'>('actions');

  protected readonly authTab = signal<'login' | 'register'>('login');
  protected readonly loginUsername = signal('');
  protected readonly loginPassword = signal('');
  protected readonly registerUsername = signal('');
  protected readonly registerPassword = signal('');
  protected readonly authFormError = signal<string | null>(null);
  protected readonly authSubmitting = signal(false);

  protected readonly projectMembers = signal<ProjectMemberDto[]>([]);
  protected readonly projectCanManage = signal(false);
  protected readonly projectMembersLoading = signal(false);
  protected readonly projectMembersError = signal<string | null>(null);
  protected readonly memberUsernameInput = signal('');
  protected readonly memberActionLoading = signal(false);

  protected readonly projectSettingsDraft = signal<ProjectSettingsDto | null>(null);
  protected readonly projectSettingsLoading = signal(false);
  protected readonly projectSettingsError = signal<string | null>(null);
  protected readonly projectSettingsSaving = signal(false);
  protected readonly projectSettingsCanManage = signal(false);

  protected readonly notificationPanelOpen = signal(false);
  protected readonly notifications = signal<NotificationItemDto[]>([]);
  protected readonly notificationsUnreadCount = signal(0);
  protected readonly notificationsLoading = signal(false);
  protected readonly notificationsError = signal<string | null>(null);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.auth.refreshMe(() => {
      if (this.auth.user()) this.afterLoginBootstrap();
    });
  }

  ngOnDestroy(): void {
    this.stopNotificationPolling();
    this.destroyReportCharts();
    for (const t of this.runToastTimers.values()) {
      clearTimeout(t);
    }
    this.runToastTimers.clear();
  }

  protected setAuthTab(tab: 'login' | 'register'): void {
    this.authTab.set(tab);
    this.authFormError.set(null);
  }

  protected onLoginUserInput(event: Event): void {
    this.loginUsername.set((event.target as HTMLInputElement).value);
  }

  protected onLoginPassInput(event: Event): void {
    this.loginPassword.set((event.target as HTMLInputElement).value);
  }

  protected onRegisterUserInput(event: Event): void {
    this.registerUsername.set((event.target as HTMLInputElement).value);
  }

  protected onRegisterPassInput(event: Event): void {
    this.registerPassword.set((event.target as HTMLInputElement).value);
  }

  protected submitLogin(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const u = this.loginUsername().trim().toLowerCase();
    const p = this.loginPassword();
    if (!u || !p) {
      this.authFormError.set('Nhập username và mật khẩu.');
      return;
    }
    this.authSubmitting.set(true);
    this.authFormError.set(null);
    this.http
      .post<{ ok: boolean; token?: string; user?: { id: string; username: string; role: string }; error?: string }>(
        `${QC_API_BASE_URL}/api/auth/login`,
        { username: u, password: p },
      )
      .subscribe({
        next: (body) => {
          this.authSubmitting.set(false);
          if (!body.ok || !body.token || !body.user) {
            this.authFormError.set(body.error ?? 'Đăng nhập thất bại.');
            return;
          }
          this.auth.applyLoginResponse({ token: body.token, user: body.user });
          this.loginPassword.set('');
          this.afterLoginBootstrap();
        },
        error: (e: HttpErrorResponse) => {
          this.authSubmitting.set(false);
          const msg =
            typeof e.error?.error === 'string' ? e.error.error : e.message || 'Lỗi mạng.';
          this.authFormError.set(msg);
        },
      });
  }

  protected submitRegister(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const u = this.registerUsername().trim().toLowerCase();
    const p = this.registerPassword();
    if (u.length < 3 || p.length < 4) {
      this.authFormError.set('Username ≥ 3 ký tự, mật khẩu ≥ 4 ký tự.');
      return;
    }
    this.authSubmitting.set(true);
    this.authFormError.set(null);
    this.http
      .post<{ ok: boolean; token?: string; user?: { id: string; username: string; role: string }; error?: string }>(
        `${QC_API_BASE_URL}/api/auth/register`,
        { username: u, password: p },
      )
      .subscribe({
        next: (body) => {
          this.authSubmitting.set(false);
          if (!body.ok || !body.token || !body.user) {
            this.authFormError.set(body.error ?? 'Đăng ký thất bại.');
            return;
          }
          this.auth.applyLoginResponse({ token: body.token, user: body.user });
          this.registerPassword.set('');
          this.afterLoginBootstrap();
        },
        error: (e: HttpErrorResponse) => {
          this.authSubmitting.set(false);
          const msg =
            typeof e.error?.error === 'string' ? e.error.error : e.message || 'Lỗi mạng.';
          this.authFormError.set(msg);
        },
      });
  }

  protected logout(): void {
    this.stopNotificationPolling();
    this.notificationPanelOpen.set(false);
    this.notifications.set([]);
    this.notificationsUnreadCount.set(0);
    this.auth.logout();
    this.projects.set([]);
    this.features.set([]);
    this.testCases.set([]);
    this.testCasesByFeature.set({});
    this.selectedProjectId.set(null);
    this.selectedFeatureId.set(null);
    this.selectedTestCaseId.set(null);
    this.actions.set([]);
    this.authFormError.set(null);
    this.loginUsername.set('');
    this.loginPassword.set('');
    this.registerUsername.set('');
    this.registerPassword.set('');
    this.projectMembers.set([]);
    this.projectCanManage.set(false);
    this.memberUsernameInput.set('');
  }

  protected loadProjectMembers(projectId: string | null): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!projectId) {
      this.projectMembers.set([]);
      this.projectCanManage.set(false);
      this.projectMembersError.set(null);
      return;
    }
    this.projectMembersLoading.set(true);
    this.projectMembersError.set(null);
    this.http
      .get<{
        ok: boolean;
        members?: ProjectMemberDto[];
        canManage?: boolean;
        error?: string;
      }>(`${QC_API_BASE_URL}/api/projects/${projectId}/members`)
      .subscribe({
        next: (body) => {
          this.projectMembersLoading.set(false);
          if (!body.ok) {
            this.projectMembersError.set(body.error ?? 'Không tải được thành viên');
            this.projectMembers.set([]);
            this.projectCanManage.set(false);
            return;
          }
          this.projectMembers.set(body.members ?? []);
          this.projectCanManage.set(Boolean(body.canManage));
        },
        error: (e: HttpErrorResponse) => {
          this.projectMembersLoading.set(false);
          this.projectMembersError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message || 'Lỗi mạng',
          );
          this.projectMembers.set([]);
          this.projectCanManage.set(false);
        },
      });
  }

  protected onMemberUsernameInput(event: Event): void {
    this.memberUsernameInput.set((event.target as HTMLInputElement).value);
  }

  protected addProjectMember(): void {
    const pid = this.selectedProjectId();
    if (!pid || !isPlatformBrowser(this.platformId)) return;
    const username = this.memberUsernameInput().trim().toLowerCase();
    if (!username) {
      this.projectMembersError.set('Nhập username.');
      return;
    }
    this.memberActionLoading.set(true);
    this.projectMembersError.set(null);
    this.http
      .post<{
        ok: boolean;
        members?: ProjectMemberDto[];
        error?: string;
      }>(`${QC_API_BASE_URL}/api/projects/${pid}/members`, { username })
      .subscribe({
        next: (body) => {
          this.memberActionLoading.set(false);
          if (!body.ok || !body.members) {
            this.projectMembersError.set(body.error ?? 'Không thêm được thành viên');
            return;
          }
          this.projectMembers.set(body.members);
          this.memberUsernameInput.set('');
          this.loadNotifications(false);
        },
        error: (e: HttpErrorResponse) => {
          this.memberActionLoading.set(false);
          this.projectMembersError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message || 'Lỗi mạng',
          );
        },
      });
  }

  protected removeProjectMember(m: ProjectMemberDto): void {
    const pid = this.selectedProjectId();
    if (!pid || m.role === 'owner' || !isPlatformBrowser(this.platformId)) return;
    this.memberActionLoading.set(true);
    this.projectMembersError.set(null);
    this.http
      .delete<{ ok: boolean; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${pid}/members/${m.userId}`,
      )
      .subscribe({
        next: (body) => {
          this.memberActionLoading.set(false);
          if (!body.ok) {
            this.projectMembersError.set(body.error ?? 'Không gỡ được thành viên');
            return;
          }
          this.loadProjectMembers(pid);
        },
        error: (e: HttpErrorResponse) => {
          this.memberActionLoading.set(false);
          this.projectMembersError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message || 'Lỗi mạng',
          );
        },
      });
  }

  protected loadProjectSettings(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const pid = this.selectedProjectId();
    if (!pid) {
      this.projectSettingsDraft.set(null);
      this.projectSettingsCanManage.set(false);
      this.projectSettingsError.set(null);
      return;
    }
    this.projectSettingsLoading.set(true);
    this.projectSettingsError.set(null);
    this.http
      .get<{
        ok: boolean;
        settings?: ProjectSettingsDto;
        canManage?: boolean;
        error?: string;
      }>(`${QC_API_BASE_URL}/api/projects/${pid}/settings`)
      .subscribe({
        next: (body) => {
          this.projectSettingsLoading.set(false);
          if (!body.ok || !body.settings) {
            this.projectSettingsError.set(body.error ?? 'Không tải được cài đặt');
            this.projectSettingsDraft.set(null);
            return;
          }
          this.projectSettingsDraft.set(JSON.parse(JSON.stringify(body.settings)) as ProjectSettingsDto);
          this.projectSettingsCanManage.set(Boolean(body.canManage));
        },
        error: (e: HttpErrorResponse) => {
          this.projectSettingsLoading.set(false);
          this.projectSettingsError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message || 'Lỗi mạng',
          );
          this.projectSettingsDraft.set(null);
        },
      });
  }

  protected saveProjectSettings(): void {
    const pid = this.selectedProjectId();
    const draft = this.projectSettingsDraft();
    if (!pid || !draft || !this.projectSettingsCanManage() || !isPlatformBrowser(this.platformId)) return;
    this.projectSettingsSaving.set(true);
    this.projectSettingsError.set(null);
    this.http
      .put<{ ok: boolean; settings?: ProjectSettingsDto; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${pid}/settings`,
        { runner: draft.runner, ai: draft.ai },
      )
      .subscribe({
        next: (body) => {
          this.projectSettingsSaving.set(false);
          if (!body.ok || !body.settings) {
            this.projectSettingsError.set(body.error ?? 'Không lưu được');
            return;
          }
          this.projectSettingsDraft.set(JSON.parse(JSON.stringify(body.settings)) as ProjectSettingsDto);
        },
        error: (e: HttpErrorResponse) => {
          this.projectSettingsSaving.set(false);
          this.projectSettingsError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message || 'Lỗi mạng',
          );
        },
      });
  }

  protected patchProjectSettingsRunner<K extends keyof ProjectSettingsDto['runner']>(
    key: K,
    value: ProjectSettingsDto['runner'][K],
  ): void {
    const d = this.projectSettingsDraft();
    if (!d) return;
    this.projectSettingsDraft.set({
      ...d,
      runner: { ...d.runner, [key]: value },
    });
  }

  protected onRunnerNumericInput(
    key: 'defaultStepTimeoutMs' | 'navigateTimeoutMs' | 'waitStepMaxMs' | 'viewportWidth' | 'viewportHeight' | 'runRetries',
    min: number,
    max: number,
    ev: Event,
  ): void {
    const raw = Number((ev.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    const v = Math.min(max, Math.max(min, Math.round(raw))) as ProjectSettingsDto['runner'][typeof key];
    this.patchProjectSettingsRunner(key, v);
  }

  protected onProjectSettingsBaseUrlInput(ev: Event): void {
    this.patchProjectSettingsRunner('defaultBaseUrl', (ev.target as HTMLInputElement).value);
  }

  protected onScreenshotPolicyChange(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    if (v === 'every_step' || v === 'on_failure') {
      this.patchProjectSettingsRunner('screenshotPolicy', v);
    }
  }

  protected setRunnerHeadless(ev: Event): void {
    this.patchProjectSettingsRunner('headless', (ev.target as HTMLInputElement).checked);
  }

  protected setAiEnabled(ev: Event): void {
    const d = this.projectSettingsDraft();
    if (!d) return;
    const enabled = (ev.target as HTMLInputElement).checked;
    this.projectSettingsDraft.set({ ...d, ai: { ...d.ai, enabled } });
  }

  private bootstrapNav(): void {
    // Load projects → pick first → load features → pick first → load test cases → pick first → load actions
    this.http
      .get<{ ok: boolean; projects?: ProjectDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/projects`,
      )
      .subscribe({
        next: (body) => {
          if (!body.ok || !body.projects) {
            this.actionsError.set(body.error ?? 'Không tải được dự án');
            return;
          }
          this.projects.set(body.projects);

          const preferred =
            body.projects.find((p) => p.key === 'google-search-demo') ??
            body.projects.find((p) => p.key === 'demo-web') ??
            body.projects[0] ??
            null;
          const projectId = preferred?.id ?? null;
          this.selectedProjectId.set(projectId);
          if (!projectId) return;

          this.loadProjectMembers(projectId);
          this.loadFeatures(projectId);
        },
        error: (e: HttpErrorResponse) => {
          this.actionsError.set(e.message || 'Lỗi tải dự án');
        },
      });
  }

  private afterLoginBootstrap(): void {
    this.bootstrapNav();
    this.loadNotifications(false);
    this.startNotificationPolling();
  }

  private startNotificationPolling(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.stopNotificationPolling();
    this.notificationPollTimer = setInterval(() => {
      if (this.auth.user() && !this.notificationPanelOpen()) {
        this.loadNotifications(false);
      }
    }, 45_000);
  }

  private stopNotificationPolling(): void {
    if (this.notificationPollTimer !== null) {
      clearInterval(this.notificationPollTimer);
      this.notificationPollTimer = null;
    }
  }

  protected loadNotifications(showSpinner = true): void {
    if (!isPlatformBrowser(this.platformId) || !this.auth.user()) return;
    if (showSpinner) this.notificationsLoading.set(true);
    this.notificationsError.set(null);
    this.http
      .get<{
        ok: boolean;
        notifications?: NotificationItemDto[];
        unreadCount?: number;
        error?: string;
      }>(`${QC_API_BASE_URL}/api/notifications`, { params: new HttpParams().set('limit', '50') })
      .subscribe({
        next: (body) => {
          this.notificationsLoading.set(false);
          if (body.ok && Array.isArray(body.notifications)) {
            this.notifications.set(body.notifications);
            this.notificationsUnreadCount.set(
              typeof body.unreadCount === 'number'
                ? body.unreadCount
                : body.notifications.filter((n) => !n.readAt).length,
            );
          } else {
            this.notificationsError.set(body.error ?? 'Không tải được thông báo');
          }
        },
        error: (e: HttpErrorResponse) => {
          this.notificationsLoading.set(false);
          this.notificationsError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message || 'Lỗi tải thông báo',
          );
        },
      });
  }

  protected toggleNotificationsPanel(ev: MouseEvent): void {
    ev.stopPropagation();
    const open = !this.notificationPanelOpen();
    this.notificationPanelOpen.set(open);
    if (open) this.loadNotifications(true);
  }

  protected closeNotificationsPanel(): void {
    this.notificationPanelOpen.set(false);
  }

  protected markNotificationReadItem(id: string): void {
    const prev = this.notifications().find((x) => x.id === id);
    const wasUnread = Boolean(prev && !prev.readAt);
    this.http
      .patch<{ ok: boolean }>(`${QC_API_BASE_URL}/api/notifications/${id}/read`, {})
      .subscribe({
        next: (body) => {
          if (!body.ok) return;
          const ts = new Date().toISOString();
          this.notifications.update((list) =>
            list.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? ts } : n)),
          );
          if (wasUnread) this.notificationsUnreadCount.update((c) => Math.max(0, c - 1));
        },
      });
  }

  protected markAllNotificationsRead(): void {
    this.http.post<{ ok: boolean }>(`${QC_API_BASE_URL}/api/notifications/read-all`, {}).subscribe({
      next: (body) => {
        if (!body.ok) return;
        const ts = new Date().toISOString();
        this.notifications.update((list) => list.map((n) => ({ ...n, readAt: n.readAt ?? ts })));
        this.notificationsUnreadCount.set(0);
      },
    });
  }

  protected notificationTimeAgo(iso: string): string {
    const t = new Date(iso).getTime();
    const d = Date.now() - t;
    if (!Number.isFinite(d) || d < 0) return '';
    if (d < 60_000) return 'Vừa xong';
    if (d < 3_600_000) return `${Math.floor(d / 60_000)} phút trước`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} giờ trước`;
    if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)} ngày trước`;
    return new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
  }

  protected notificationKindIcon(kind: string): string {
    switch (kind) {
      case 'test_run_finished':
        return 'play_circle';
      case 'project_member_added':
        return 'group_add';
      default:
        return 'notifications';
    }
  }

  protected onNotificationRowClick(n: NotificationItemDto): void {
    if (!n.readAt) this.markNotificationReadItem(n.id);
    const pid = typeof n.payload['projectId'] === 'string' ? (n.payload['projectId'] as string) : null;
    const fid = typeof n.payload['featureId'] === 'string' ? (n.payload['featureId'] as string) : null;
    const tcId = typeof n.payload['testCaseId'] === 'string' ? (n.payload['testCaseId'] as string) : null;
    if (n.kind === 'project_member_added' && pid) {
      const p = this.projects().find((x) => x.id === pid);
      if (p) {
        this.selectProject(p);
        this.openSidebarSection('members');
        this.closeNotificationsPanel();
      }
      return;
    }
    if (n.kind === 'test_run_finished' && fid && tcId) {
      if (pid && this.selectedProjectId() !== pid) {
        const p = this.projects().find((x) => x.id === pid);
        if (p) this.selectProject(p);
        this.closeNotificationsPanel();
        return;
      }
      const tc = this.findTestCaseById(tcId);
      if (tc) {
        this.selectExplorerTestCase(fid, tc);
        this.closeNotificationsPanel();
      }
    }
  }

  private loadFeatures(projectId: string): void {
    this.http
      .get<{ ok: boolean; features?: FeatureDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${projectId}/features`,
      )
      .subscribe({
        next: (body) => {
          if (!body.ok || !body.features) {
            this.actionsError.set(body.error ?? 'Không tải được feature');
            return;
          }
          this.features.set(body.features);
          const preferred = body.features.find((f) => f.key === 'dang-nhap') ?? body.features[0] ?? null;
          const featureId = preferred?.id ?? null;
          this.selectedFeatureId.set(featureId);
          if (!featureId) return;
          this.loadTestCases(projectId, featureId);
        },
        error: (e: HttpErrorResponse) => this.actionsError.set(e.message || 'Lỗi tải feature'),
      });
  }

  private loadTestCases(projectId: string, featureId: string): void {
    this.http
      .get<{ ok: boolean; testCases?: TestCaseDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${projectId}/features/${featureId}/test-cases`,
      )
      .subscribe({
        next: (body) => {
          if (!body.ok || !body.testCases) {
            this.actionsError.set(body.error ?? 'Không tải được test case');
            return;
          }
          this.testCases.set(body.testCases);
          this.testCasesByFeature.set({
            ...this.testCasesByFeature(),
            [featureId]: body.testCases,
          });
          const preferred =
            body.testCases.find((t) => t.id === 'tc-001') ??
            body.testCases.find((t) => t.id === 'tc-google-search') ??
            body.testCases[0] ??
            null;
          const tcId = preferred?.id ?? null;
          this.selectedTestCaseId.set(tcId);
          this.loadActions();
        },
        error: (e: HttpErrorResponse) => this.actionsError.set(e.message || 'Lỗi tải test case'),
      });
  }

  protected selectProject(p: ProjectDto): void {
    // Khi chọn dự án, hiển thị ngay màn Testcase
    this.currentSidebarSection.set('testcase');
    this.selectedProjectId.set(p.id);
    this.selectedFeatureId.set(null);
    this.selectedTestCaseId.set(null);
    this.features.set([]);
    this.testCases.set([]);
    this.actions.set([]);
    this.testCasesByFeature.set({});
    this.explorerExpandedFeatureIds.set([]);
    this.explorerLoadingFeatureIds.set([]);
    this.loadProjectMembers(p.id);
    this.loadFeatures(p.id);
  }

  protected selectFeature(f: FeatureDto): void {
    this.currentSidebarSection.set('feature');
    this.selectedFeatureId.set(f.id);
    this.selectedTestCaseId.set(null);
    this.testCases.set([]);
    this.actions.set([]);
    const pid = this.selectedProjectId();
    if (!pid) return;
    this.loadTestCases(pid, f.id);
  }

  /** Chọn feature nhưng không chuyển sang màn Feature (dùng cho dropdown + explorer). */
  protected pickFeature(f: FeatureDto): void {
    this.selectedFeatureId.set(f.id);
    this.selectedTestCaseId.set(null);
    this.testCases.set([]);
    this.actions.set([]);
    const pid = this.selectedProjectId();
    if (!pid) return;
    this.loadTestCases(pid, f.id);
  }

  protected selectTestCase(tc: TestCaseDto): void {
    this.currentSidebarSection.set('testcase');
    this.selectedTestCaseId.set(tc.id);
    this.menuOpenForId.set(null);
    this.loadActions();
    if (this.testCaseTab() === 'history') {
      this.loadRunHistory();
    }
  }

  /**
   * Explorer cho phép chọn testcase ở feature bất kỳ (không nhất thiết là feature đang chọn).
   * Khi click, cần đồng bộ selection Feature + list testcase đang hiển thị + load actions.
   */
  protected selectExplorerTestCase(featureId: string, tc: TestCaseDto): void {
    // Giống VSCode: click item trong Explorer sẽ mở chi tiết testcase
    this.currentSidebarSection.set('testcase');
    this.selectedFeatureId.set(featureId);

    const cached = this.testCasesByFeature()[featureId];
    if (Array.isArray(cached)) {
      this.testCases.set(cached);
    } else {
      const pid = this.selectedProjectId();
      if (pid) this.loadTestCases(pid, featureId);
    }

    this.selectedTestCaseId.set(tc.id);
    this.menuOpenForId.set(null);
    this.loadActions();
    if (this.testCaseTab() === 'history') {
      this.loadRunHistory();
    }
  }

  protected selectExplorerFeature(featureId: string): void {
    // Chỉ sync selection để breadcrumb + nút tạo testcase đúng feature; không đổi màn.
    this.selectedFeatureId.set(featureId);
    this.ensureFeatureTestCasesLoaded(featureId);
  }

  protected openSidebarSection(
    section:
      | 'project'
      | 'members'
      | 'settings'
      | 'feature'
      | 'testcase'
      | 'runhistory'
      | 'schedules'
      | 'reports',
  ): void {
    const prev = this.currentSidebarSection();
    this.currentSidebarSection.set(section);
    if (prev === 'reports' && section !== 'reports') {
      this.destroyReportCharts();
    }
    if (section === 'members') {
      const pid = this.selectedProjectId();
      if (pid) this.loadProjectMembers(pid);
    }
    if (section === 'settings') {
      this.loadProjectSettings();
    }
    if (section === 'runhistory') {
      this.loadGlobalRunHistory();
    }
    if (section === 'schedules') {
      this.loadSchedules();
    }
    if (section === 'reports') {
      this.loadReports();
    }
  }

  protected onReportDaysChange(e: Event): void {
    const v = Number((e.target as HTMLSelectElement).value);
    this.reportDays.set(Number.isFinite(v) ? v : 14);
    this.loadReports();
  }

  protected onReportProjectFilterChange(e: Event): void {
    this.reportProjectId.set((e.target as HTMLSelectElement).value);
    this.loadReports();
  }

  protected loadReports(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.reportsLoading.set(true);
    this.reportsError.set(null);
    let params = new HttpParams().set('days', String(this.reportDays()));
    const pid = this.reportProjectId().trim();
    if (pid) params = params.set('projectId', pid);
    this.http
      .get<
        | ({ ok: true } & ReportSummaryDto)
        | {
            ok: false;
            error?: string;
          }
      >(`${QC_API_BASE_URL}/api/reports/summary`, { params })
      .subscribe({
        next: async (body) => {
          this.reportsLoading.set(false);
          if (!body.ok) {
            this.reportsError.set(
              'error' in body && typeof body.error === 'string' ? body.error : 'Không tải được báo cáo',
            );
            this.reportSummary.set(null);
            this.destroyReportCharts();
            return;
          }
          const { ok: _ok, ...summary } = body;
          this.reportSummary.set(summary);
          setTimeout(() => void this.renderReportCharts(), 0);
        },
        error: (e: HttpErrorResponse) => {
          this.reportsLoading.set(false);
          this.reportsError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng',
          );
          this.reportSummary.set(null);
          this.destroyReportCharts();
        },
      });
  }

  private destroyReportCharts(): void {
    this.reportBarChartInstance?.destroy();
    this.reportBarChartInstance = null;
    this.reportLineChartInstance?.destroy();
    this.reportLineChartInstance = null;
  }

  private async renderReportCharts(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.currentSidebarSection() !== 'reports') return;
    const summary = this.reportSummary();
    if (!summary?.series?.length) {
      this.destroyReportCharts();
      return;
    }
    const barEl = this.reportBarCanvas()?.nativeElement;
    const lineEl = this.reportLineCanvas()?.nativeElement;
    if (!barEl || !lineEl) {
      setTimeout(() => void this.renderReportCharts(), 50);
      return;
    }
    this.destroyReportCharts();
    const { default: Chart } = await import('chart.js/auto');
    const labels = summary.series.map((s) => {
      const d = s.day;
      return d.length >= 10 ? d.slice(5) : d;
    });
    const grid = 'rgba(255,255,255,0.06)';
    const tick = '#9ca3af';
    const legend = '#d1d5db';

    this.reportBarChartInstance = new Chart(barEl, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Đạt',
            data: summary.series.map((s) => s.passed),
            backgroundColor: 'rgba(34,197,94,0.75)',
            borderRadius: 4,
          },
          {
            label: 'Lỗi',
            data: summary.series.map((s) => s.failed),
            backgroundColor: 'rgba(239,68,68,0.8)',
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: legend } },
          title: { display: true, text: 'Số lần chạy theo ngày (UTC)', color: legend, font: { size: 13 } },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: tick, maxRotation: 45 },
            grid: { color: grid },
          },
          y: {
            stacked: true,
            ticks: { color: tick, precision: 0 },
            grid: { color: grid },
          },
        },
      },
    });

    this.reportLineChartInstance = new Chart(lineEl, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Tỷ lệ đạt %',
            data: summary.series.map((s) =>
              s.totalRuns > 0 ? Math.round((s.passed / s.totalRuns) * 1000) / 10 : 0,
            ),
            borderColor: 'rgb(96,165,250)',
            backgroundColor: 'rgba(96,165,250,0.12)',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: legend } },
          title: { display: true, text: 'Xu hướng tỷ lệ đạt', color: legend, font: { size: 13 } },
        },
        scales: {
          x: { ticks: { color: tick, maxRotation: 45 }, grid: { color: grid } },
          y: {
            min: 0,
            max: 100,
            ticks: { color: tick, callback: (v) => `${v}%` },
            grid: { color: grid },
          },
        },
      },
    });
  }

  protected loadSchedules(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.schedulesLoading.set(true);
    this.schedulesError.set(null);
    this.http
      .get<{ ok: boolean; schedules?: ScheduleDto[]; error?: string }>(`${QC_API_BASE_URL}/api/schedules`)
      .subscribe({
        next: (body) => {
          this.schedulesLoading.set(false);
          if (!body.ok || !body.schedules) {
            this.schedulesError.set(body.error ?? 'Không tải được lịch');
            this.schedulesList.set([]);
            return;
          }
          this.schedulesList.set(body.schedules);
          this.loadSchedulePickerTestCases();
        },
        error: (e: HttpErrorResponse) => {
          this.schedulesLoading.set(false);
          this.schedulesError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng',
          );
          this.schedulesList.set([]);
        },
      });
  }

  /** Danh sách testcase trong dự án để gắn lịch (không cần chọn testcase trên breadcrumb). */
  protected loadSchedulePickerTestCases(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const pid = this.selectedProjectId();
    if (!pid) {
      this.schedulePickerTestCases.set([]);
      return;
    }
    this.schedulePickerLoading.set(true);
    this.http
      .get<{ ok: boolean; testCases?: SchedulePickerTcDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${pid}/schedule-test-cases`,
      )
      .subscribe({
        next: (body) => {
          this.schedulePickerLoading.set(false);
          if (!body.ok || !body.testCases) {
            this.schedulePickerTestCases.set([]);
            return;
          }
          this.schedulePickerTestCases.set(body.testCases);
        },
        error: () => {
          this.schedulePickerLoading.set(false);
          this.schedulePickerTestCases.set([]);
        },
      });
  }

  protected schedulePickerGrouped(): { featureName: string; items: SchedulePickerTcDto[] }[] {
    const map = new Map<string, SchedulePickerTcDto[]>();
    for (const t of this.schedulePickerTestCases()) {
      const fn = t.featureName?.trim() || '—';
      if (!map.has(fn)) map.set(fn, []);
      map.get(fn)!.push(t);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([featureName, items]) => ({
        featureName,
        items: items.sort((x, y) => x.testCaseName.localeCompare(y.testCaseName)),
      }));
  }

  protected toggleScheduleFormTc(tcId: string): void {
    const cur = this.scheduleFormSelectedTcIds();
    if (cur.includes(tcId)) this.scheduleFormSelectedTcIds.set(cur.filter((x) => x !== tcId));
    else this.scheduleFormSelectedTcIds.set([...cur, tcId]);
  }

  protected scheduleFormTcChecked(tcId: string): boolean {
    return this.scheduleFormSelectedTcIds().includes(tcId);
  }

  protected selectAllScheduleFormTcs(): void {
    this.scheduleFormSelectedTcIds.set(this.schedulePickerTestCases().map((t) => t.id));
  }

  protected clearScheduleFormTcSelection(): void {
    this.scheduleFormSelectedTcIds.set([]);
  }

  protected onScheduleStaggerSecondsInput(e: Event): void {
    const raw = Number((e.target as HTMLInputElement).value);
    this.scheduleStaggerSeconds.set(
      Number.isFinite(raw) ? Math.min(86_400, Math.max(0, Math.floor(raw))) : 0,
    );
  }

  protected onScheduleNameInput(e: Event): void {
    this.scheduleFormName.set((e.target as HTMLInputElement).value);
  }
  protected onScheduleCronInput(e: Event): void {
    this.scheduleFormCron.set((e.target as HTMLInputElement).value);
  }
  protected onScheduleTimeLocalInput(e: Event): void {
    this.scheduleTimeLocal.set((e.target as HTMLInputElement).value);
  }
  protected onScheduleHourlyMinuteInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.scheduleHourlyMinute.set(Number.isFinite(v) ? Math.min(59, Math.max(0, Math.floor(v))) : 0);
  }
  protected onScheduleOnceDatetimeInput(e: Event): void {
    this.scheduleOnceDatetime.set((e.target as HTMLInputElement).value);
  }
  protected onScheduleDelayMinutesInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    let n = Number.isFinite(v) ? Math.floor(v) : 30;
    n = Math.min(525_600, Math.max(1, n));
    this.scheduleDelayMinutes.set(n);
  }
  protected onScheduleTzChange(e: Event): void {
    this.scheduleFormTz.set((e.target as HTMLSelectElement).value);
  }

  protected setScheduleFrequencyMode(mode: ScheduleFrequencyMode): void {
    this.scheduleFrequencyMode.set(mode);
    this.scheduleFormError.set(null);
    if (mode === 'once' && !this.scheduleOnceDatetime().trim() && isPlatformBrowser(this.platformId)) {
      this.patchDefaultOnceDatetime();
    }
  }

  protected toggleScheduleWeekday(d: number): void {
    const cur = this.scheduleWeekdays();
    if (cur.includes(d)) {
      this.scheduleWeekdays.set(cur.filter((x) => x !== d));
    } else {
      this.scheduleWeekdays.set([...cur, d].sort((a, b) => a - b));
    }
  }

  protected weekdayShort(d: number): string {
    return ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d] ?? String(d);
  }

  /** Mô tả ngắn cho bảng danh sách */
  protected scheduleHumanSummary(cronExpression: string, timezone?: string): string {
    const raw = cronExpression.trim();
    const low = raw.toLowerCase();
    if (low.startsWith('@once:')) {
      const iso = raw.slice(6).trim();
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return cronExpression;
      const tz = (timezone || 'Asia/Ho_Chi_Minh').trim() || 'Asia/Ho_Chi_Minh';
      return `Một lần · ${d.toLocaleString('vi-VN', { timeZone: tz })}`;
    }
    if (low.startsWith('@in:')) {
      const n = Number(raw.slice(4).trim());
      if (!Number.isFinite(n)) return cronExpression;
      return `Sau ${n} phút (từ lúc lưu lịch)`;
    }
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length !== 5) return cronExpression;
    const [m, h, dom, mon, dow] = parts;
    const hm = () => `${this.padTimePart(h)}:${this.padTimePart(m)}`;
    if (dom !== '*' || mon !== '*') return cronExpression;
    if (h === '*' && dow === '*' && /^\d+$/.test(m)) {
      return `Mỗi giờ, phút ${m}`;
    }
    if (!/^\d+$/.test(m) || !/^\d+$/.test(h)) return cronExpression;
    if (dow === '*') return `Mỗi ngày ${hm()}`;
    if (dow === '1-5') return `Thứ 2–6 lúc ${hm()}`;
    if (dow !== '*') {
      const days = this.expandDowList(dow);
      if (days.length > 0) {
        return `${days.map((x) => this.weekdayShort(x)).join(', ')} · ${hm()}`;
      }
    }
    return cronExpression;
  }

  private padTimePart(x: string): string {
    const n = Number(x);
    return Number.isFinite(n) ? String(n).padStart(2, '0') : x;
  }

  private expandDowList(dow: string): number[] {
    const out = new Set<number>();
    for (const part of dow.split(',')) {
      const p = part.trim();
      if (/^\d+$/.test(p)) {
        const n = Number(p);
        if (n >= 0 && n <= 6) out.add(n);
      } else {
        const r = /^(\d)-(\d)$/.exec(p);
        if (r) {
          const a = Number(r[1]);
          const b = Number(r[2]);
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
            if (i >= 0 && i <= 6) out.add(i);
          }
        }
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  private patchDefaultOnceDatetime(): void {
    const off = SCHEDULE_TZ_OFFSET_HOURS[this.scheduleFormTz()] ?? 7;
    const ms = Date.now() + 3_600_000;
    const wall = new Date(ms + off * 3_600_000);
    const y = wall.getUTCFullYear();
    const mo = wall.getUTCMonth() + 1;
    const d = wall.getUTCDate();
    const h = wall.getUTCHours();
    const mi = wall.getUTCMinutes();
    this.scheduleOnceDatetime.set(
      `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
    );
  }

  private wallDatetimeLocalToUtcIso(localDatetime: string, ianaTz: string): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDatetime.trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    if ([y, mo, d, hour, minute].some((x) => !Number.isFinite(x))) return null;
    const off = SCHEDULE_TZ_OFFSET_HOURS[ianaTz];
    if (off === undefined) return null;
    const ms = Date.UTC(y, mo - 1, d, hour - off, minute, 0, 0);
    return new Date(ms).toISOString();
  }

  private utcIsoToWallDatetimeLocal(iso: string, ianaTz: string): string {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return '';
    const off = SCHEDULE_TZ_OFFSET_HOURS[ianaTz] ?? 7;
    const wall = new Date(ms + off * 3_600_000);
    const y = wall.getUTCFullYear();
    const mo = wall.getUTCMonth() + 1;
    const d = wall.getUTCDate();
    const h = wall.getUTCHours();
    const mi = wall.getUTCMinutes();
    return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }

  private applyServerCronToForm(cronExpr: string): void {
    const trimmed = cronExpr.trim();
    const low = trimmed.toLowerCase();
    if (low.startsWith('@once:')) {
      const iso = trimmed.slice(6).trim();
      this.scheduleFrequencyMode.set('once');
      this.scheduleOnceDatetime.set(this.utcIsoToWallDatetimeLocal(iso, this.scheduleFormTz()));
      this.scheduleFormCron.set(cronExpr);
      return;
    }
    if (low.startsWith('@in:')) {
      const n = Number(trimmed.slice(4).trim());
      this.scheduleFrequencyMode.set('delay');
      this.scheduleDelayMinutes.set(Number.isFinite(n) && n > 0 ? Math.floor(n) : 30);
      this.scheduleFormCron.set(cronExpr);
      return;
    }
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length !== 5) {
      this.scheduleFrequencyMode.set('custom');
      this.scheduleFormCron.set(cronExpr);
      return;
    }
    const [m, h, dom, mon, dow] = parts;
    if (dom !== '*' || mon !== '*') {
      this.scheduleFrequencyMode.set('custom');
      this.scheduleFormCron.set(cronExpr);
      return;
    }
    if (h === '*' && dow === '*' && /^\d+$/.test(m)) {
      this.scheduleFrequencyMode.set('hourly');
      this.scheduleHourlyMinute.set(Number(m));
      this.scheduleFormCron.set(cronExpr);
      return;
    }
    if (!/^\d+$/.test(m) || !/^\d+$/.test(h)) {
      this.scheduleFrequencyMode.set('custom');
      this.scheduleFormCron.set(cronExpr);
      return;
    }
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    this.scheduleTimeLocal.set(`${hh}:${mm}`);
    if (dow === '*') {
      this.scheduleFrequencyMode.set('daily');
      this.scheduleFormCron.set(cronExpr);
      return;
    }
    if (dow === '1-5') {
      this.scheduleFrequencyMode.set('weekdays');
      this.scheduleFormCron.set(cronExpr);
      return;
    }
    const days = this.expandDowList(dow);
    if (days.length > 0) {
      this.scheduleFrequencyMode.set('weekly');
      this.scheduleWeekdays.set(days);
      this.scheduleFormCron.set(cronExpr);
      return;
    }
    this.scheduleFrequencyMode.set('custom');
    this.scheduleFormCron.set(cronExpr);
  }

  private buildCronFromForm(): string | null {
    const mode = this.scheduleFrequencyMode();
    if (mode === 'custom') {
      const c = this.scheduleFormCron().trim();
      return c || null;
    }
    if (mode === 'once') {
      const local = this.scheduleOnceDatetime().trim();
      const iso = this.wallDatetimeLocalToUtcIso(local, this.scheduleFormTz());
      return iso ? `@once:${iso}` : null;
    }
    if (mode === 'delay') {
      const n = Math.floor(this.scheduleDelayMinutes());
      if (n < 1 || n > 525_600) return null;
      return `@in:${n}`;
    }
    if (mode === 'hourly') {
      const min = Math.min(59, Math.max(0, Math.floor(this.scheduleHourlyMinute())));
      return `${min} * * * *`;
    }
    const time = this.scheduleTimeLocal().trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
    if (mode === 'daily') {
      return `${minute} ${hour} * * *`;
    }
    if (mode === 'weekdays') {
      return `${minute} ${hour} * * 1-5`;
    }
    if (mode === 'weekly') {
      const days = [...new Set(this.scheduleWeekdays())].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
      if (days.length === 0) return null;
      return `${minute} ${hour} * * ${days.join(',')}`;
    }
    return null;
  }

  protected cancelScheduleForm(): void {
    this.scheduleEditingId.set(null);
    this.scheduleFormName.set('');
    this.scheduleFormCron.set('0 * * * *');
    this.scheduleFormTz.set('Asia/Ho_Chi_Minh');
    this.scheduleFormError.set(null);
    this.scheduleFrequencyMode.set('daily');
    this.scheduleTimeLocal.set('08:00');
    this.scheduleWeekdays.set([1, 2, 3, 4, 5]);
    this.scheduleHourlyMinute.set(0);
    this.scheduleDelayMinutes.set(30);
    this.scheduleOnceDatetime.set('');
    this.scheduleFormSelectedTcIds.set([]);
    this.scheduleStaggerSeconds.set(0);
  }

  protected editScheduleRow(s: ScheduleDto): void {
    this.scheduleEditingId.set(s.id);
    this.scheduleFormName.set(s.name);
    this.scheduleFormTz.set(s.timezone);
    this.scheduleFormError.set(null);
    this.applyServerCronToForm(s.cronExpression);
  }

  protected submitScheduleForm(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const editId = this.scheduleEditingId();
    const picked = [...new Set(this.scheduleFormSelectedTcIds())];
    const breadcrumbTc = this.selectedTestCaseId();
    if (!editId && picked.length === 0 && !breadcrumbTc) {
      this.scheduleFormError.set(
        'Chọn ít nhất một test case trong danh sách dự án bên dưới, hoặc chọn test case trên breadcrumb.',
      );
      return;
    }
    const name = this.scheduleFormName().trim();
    const cron = this.buildCronFromForm();
    const tz = this.scheduleFormTz().trim() || 'Asia/Ho_Chi_Minh';
    if (!cron) {
      const mode = this.scheduleFrequencyMode();
      this.scheduleFormError.set(
        mode === 'weekly'
          ? 'Chọn ít nhất một ngày trong tuần.'
          : mode === 'once'
            ? 'Chọn ngày giờ trong tương lai (theo múi giờ đã chọn).'
            : mode === 'delay'
              ? 'Số phút phải từ 1 đến 525600 (1 năm).'
              : 'Kiểm tra giờ hoặc biểu thức cron (nâng cao).',
      );
      return;
    }
    this.scheduleFormSaving.set(true);
    this.scheduleFormError.set(null);

    if (editId) {
      this.http
        .put<{ ok: boolean; schedule?: ScheduleDto; error?: string }>(
          `${QC_API_BASE_URL}/api/schedules/${editId}`,
          { name: name || 'Lịch chạy', cronExpression: cron, timezone: tz },
        )
        .subscribe({
          next: (body) => {
            this.scheduleFormSaving.set(false);
            if (!body.ok) {
              this.scheduleFormError.set(body.error ?? 'Cập nhật thất bại');
              return;
            }
            this.cancelScheduleForm();
            this.loadSchedules();
          },
          error: (e: HttpErrorResponse) => {
            this.scheduleFormSaving.set(false);
            this.scheduleFormError.set(
              typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng',
            );
          },
        });
      return;
    }

    const useBulk = picked.length > 0;
    if (useBulk) {
      this.http
        .post<{ ok: boolean; schedules?: ScheduleDto[]; error?: string }>(
          `${QC_API_BASE_URL}/api/schedules/bulk`,
          {
            testCaseIds: picked,
            namePrefix: name || 'Lịch chạy',
            cronExpression: cron,
            timezone: tz,
            enabled: true,
            staggerSeconds: this.scheduleStaggerSeconds(),
          },
        )
        .subscribe({
          next: (body) => {
            this.scheduleFormSaving.set(false);
            if (!body.ok || !body.schedules?.length) {
              this.scheduleFormError.set(body.error ?? 'Tạo lịch thất bại');
              return;
            }
            this.cancelScheduleForm();
            this.loadSchedules();
          },
          error: (e: HttpErrorResponse) => {
            this.scheduleFormSaving.set(false);
            this.scheduleFormError.set(
              typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng',
            );
          },
        });
      return;
    }

    this.http
      .post<{ ok: boolean; schedule?: ScheduleDto; error?: string }>(`${QC_API_BASE_URL}/api/schedules`, {
        testCaseId: breadcrumbTc!,
        name: name || 'Lịch chạy',
        cronExpression: cron,
        timezone: tz,
        enabled: true,
      })
      .subscribe({
        next: (body) => {
          this.scheduleFormSaving.set(false);
          if (!body.ok) {
            this.scheduleFormError.set(body.error ?? 'Tạo lịch thất bại');
            return;
          }
          this.cancelScheduleForm();
          this.loadSchedules();
        },
        error: (e: HttpErrorResponse) => {
          this.scheduleFormSaving.set(false);
          this.scheduleFormError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng',
          );
        },
      });
  }

  protected toggleScheduleEnabled(s: ScheduleDto): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.http
      .put<{ ok: boolean; error?: string }>(`${QC_API_BASE_URL}/api/schedules/${s.id}`, {
        enabled: !s.enabled,
      })
      .subscribe({
        next: (body) => {
          if (!body.ok) {
            this.schedulesError.set(body.error ?? 'Không cập nhật được');
            return;
          }
          this.loadSchedules();
        },
        error: (e: HttpErrorResponse) => {
          this.schedulesError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng',
          );
        },
      });
  }

  protected deleteScheduleRow(s: ScheduleDto): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!globalThis.confirm(`Xóa lịch «${s.name}» cho ${s.testCaseName ?? s.testCaseId}?`)) return;
    this.http.delete<{ ok: boolean; error?: string }>(`${QC_API_BASE_URL}/api/schedules/${s.id}`).subscribe({
      next: (body) => {
        if (!body.ok) {
          this.schedulesError.set(body.error ?? 'Xóa thất bại');
          return;
        }
        if (this.scheduleEditingId() === s.id) this.cancelScheduleForm();
        this.loadSchedules();
      },
      error: (e: HttpErrorResponse) => {
        this.schedulesError.set(
          typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng',
        );
      },
    });
  }

  protected loadGlobalRunHistory(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.globalRunHistoryLoading.set(true);
    this.globalRunHistoryError.set(null);
    this.http
      .get<{ ok: boolean; runs?: GlobalRunHistoryRow[]; error?: string }>(
        `${QC_API_BASE_URL}/api/run-history?limit=80`,
      )
      .subscribe({
        next: (body) => {
          this.globalRunHistoryLoading.set(false);
          if (!body.ok || !body.runs) {
            this.globalRunHistoryError.set(body.error ?? 'Không tải được lịch sử');
            this.globalRunHistory.set([]);
            return;
          }
          this.globalRunHistory.set(body.runs);
        },
        error: (e: HttpErrorResponse) => {
          this.globalRunHistoryLoading.set(false);
          this.globalRunHistoryError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng',
          );
          this.globalRunHistory.set([]);
        },
      });
  }

  protected globalRunBreadcrumb(row: GlobalRunHistoryRow): string {
    const parts = [row.projectName, row.featureName, row.testCaseName].filter(Boolean);
    return parts.length ? parts.join(' · ') : row.testCaseId;
  }

  protected toggleProjectPicker(): void {
    this.projectPickerOpen.set(!this.projectPickerOpen());
  }

  protected closeProjectPicker(): void {
    this.projectPickerOpen.set(false);
  }

  protected toggleFeaturePicker(): void {
    this.featurePickerOpen.set(!this.featurePickerOpen());
  }

  protected closeFeaturePicker(): void {
    this.featurePickerOpen.set(false);
  }

  protected openExplorer(): void {
    this.currentSidebarSection.set('explorer');
  }

  protected onExplorerQueryInput(event: Event): void {
    this.explorerQuery.set((event.target as HTMLInputElement).value);
    const q = this.explorerQuery().trim().toLowerCase();
    if (!q) return;
    // Khi search, đảm bảo feature đang mở thì có testcases để lọc (lazy load).
    // Không auto-load toàn bộ để tránh spam request; user expand feature nào thì load feature đó.
  }

  protected isExplorerFeatureExpanded(id: string): boolean {
    return this.explorerExpandedFeatureIds().includes(id);
  }

  protected toggleExplorerFeature(f: FeatureDto): void {
    const expanded = this.explorerExpandedFeatureIds();
    const next = expanded.includes(f.id)
      ? expanded.filter((x) => x !== f.id)
      : [...expanded, f.id];
    this.explorerExpandedFeatureIds.set(next);

    if (!expanded.includes(f.id)) {
      this.ensureFeatureTestCasesLoaded(f.id);
    }
  }

  private ensureFeatureTestCasesLoaded(featureId: string): void {
    const pid = this.selectedProjectId();
    if (!pid) return;
    const cache = this.testCasesByFeature();
    if (Array.isArray(cache[featureId])) return;
    if (this.explorerLoadingFeatureIds().includes(featureId)) return;

    this.explorerLoadingFeatureIds.set([...this.explorerLoadingFeatureIds(), featureId]);
    this.http
      .get<{ ok: boolean; testCases?: TestCaseDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${pid}/features/${featureId}/test-cases`,
      )
      .subscribe({
        next: (body) => {
          this.explorerLoadingFeatureIds.set(
            this.explorerLoadingFeatureIds().filter((x) => x !== featureId),
          );
          if (!body.ok || !body.testCases) return;
          this.testCasesByFeature.set({ ...this.testCasesByFeature(), [featureId]: body.testCases });
        },
        error: () => {
          this.explorerLoadingFeatureIds.set(
            this.explorerLoadingFeatureIds().filter((x) => x !== featureId),
          );
        },
      });
  }

  protected collapseAllExplorer(): void {
    this.explorerExpandedFeatureIds.set([]);
  }

  protected refreshExplorer(): void {
    const pid = this.selectedProjectId();
    if (!pid) return;

    this.http
      .get<{ ok: boolean; features?: FeatureDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${pid}/features`,
      )
      .subscribe({
        next: (body) => {
          if (!body.ok || !body.features) return;
          this.features.set(body.features);

          const currentFeatureId = this.selectedFeatureId();
          const stillExists = currentFeatureId
            ? body.features.some((f) => f.id === currentFeatureId)
            : false;
          const nextFeatureId = stillExists ? currentFeatureId : (body.features[0]?.id ?? null);
          this.selectedFeatureId.set(nextFeatureId);

          if (!nextFeatureId) {
            this.testCases.set([]);
            this.selectedTestCaseId.set(null);
            this.actions.set([]);
            return;
          }

          // Refresh list testcase của feature đang chọn
          this.loadTestCases(pid, nextFeatureId);
        },
      });
  }

  protected explorerFilteredFeatures(): FeatureDto[] {
    const q = this.explorerQuery().trim().toLowerCase();
    const list = this.features();
    if (!q) return list;
    const byFeature = this.testCasesByFeature();
    return list.filter((f) => {
      const hay = `${f.key ?? ''} ${f.name} ${f.description ?? ''}`.toLowerCase();
      if (hay.includes(q)) return true;
      const tcs = byFeature[f.id] ?? [];
      return tcs.some((tc) =>
        `${tc.key ?? ''} ${tc.id} ${tc.name} ${tc.description ?? ''}`.toLowerCase().includes(q),
      );
    });
  }

  protected explorerTestCasesForFeature(featureId: string): TestCaseDto[] {
    const q = this.explorerQuery().trim().toLowerCase();
    const list = this.testCasesByFeature()[featureId] ?? [];
    if (!q) return list;
    return list.filter((tc) =>
      `${tc.key ?? ''} ${tc.id} ${tc.name} ${tc.description ?? ''}`.toLowerCase().includes(q),
    );
  }

  protected openQuickCreateTestCaseForFeature(f: FeatureDto): void {
    // Cho phép tạo nhanh testcase theo đúng feature trong Explorer
    if (this.selectedFeatureId() !== f.id) {
      this.selectedFeatureId.set(f.id);
      // không đổi current section; Explorer vẫn mở
      this.selectedTestCaseId.set(null);
      this.testCases.set([]);
      this.actions.set([]);
      const pid = this.selectedProjectId();
      if (pid) this.loadTestCases(pid, f.id);
    }
    this.openCreateTestCase();
  }

  protected selectedProjectName(): string {
    const id = this.selectedProjectId();
    const p = this.projects().find((x) => x.id === id);
    return p?.name ?? '—';
  }

  /** Dự án đang chọn (theo header / breadcrumb). */
  protected selectedProject(): ProjectDto | null {
    const id = this.selectedProjectId();
    if (!id) return null;
    return this.projects().find((x) => x.id === id) ?? null;
  }

  protected selectedFeatureName(): string {
    const id = this.selectedFeatureId();
    const f = this.features().find((x) => x.id === id);
    return f?.name ?? '—';
  }

  protected selectedTestCaseLabel(): string {
    const id = this.selectedTestCaseId();
    const tc = this.testCases().find((x) => x.id === id);
    if (!tc) return id ?? '—';
    return `${tc.key ?? tc.id} - ${tc.name}`;
  }

  protected findTestCaseById(testCaseId: string): TestCaseDto | null {
    const by = this.testCasesByFeature();
    for (const fid of Object.keys(by)) {
      const tc = (by[fid] ?? []).find((t) => t.id === testCaseId);
      if (tc) return tc;
    }
    return null;
  }

  protected featureForTestCase(testCaseId: string): FeatureDto | null {
    const by = this.testCasesByFeature();
    for (const fid of Object.keys(by)) {
      const hit = (by[fid] ?? []).some((t) => t.id === testCaseId);
      if (hit) return this.features().find((f) => f.id === fid) ?? null;
    }
    return null;
  }

  protected enterExplorerBatchMode(): void {
    this.explorerBatchSelectMode.set(true);
  }

  protected exitExplorerBatchMode(): void {
    this.explorerBatchSelectMode.set(false);
    this.batchSelectedTcIds.set([]);
  }

  protected toggleExplorerBatchSelect(tcId: string, ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    const set = new Set(this.batchSelectedTcIds());
    if (set.has(tcId)) set.delete(tcId);
    else set.add(tcId);
    this.batchSelectedTcIds.set([...set]);
  }

  protected isExplorerBatchSelected(tcId: string): boolean {
    return this.batchSelectedTcIds().includes(tcId);
  }

  protected batchSelectCount(): number {
    return this.batchSelectedTcIds().length;
  }

  protected runSelectedBatch(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const ids = [...new Set(this.batchSelectedTcIds())];
    if (ids.length === 0) return;
    const newJobs: BatchRunJob[] = ids.map((testCaseId) => {
      const tc = this.findTestCaseById(testCaseId);
      const feat = this.featureForTestCase(testCaseId);
      return {
        id: crypto.randomUUID(),
        testCaseId,
        testCaseLabel: tc ? `${tc.key ?? tc.id} — ${tc.name}` : testCaseId,
        featureLabel: feat?.name ?? '',
        status: 'queued',
      };
    });
    this.batchJobs.update((q) => [...q, ...newJobs]);
    this.batchSelectedTcIds.set([]);
    this.batchPanelExpanded.set(true);
    this.drainBatchQueue();
  }

  private drainBatchQueue(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.batchRunnerBusy()) return;
    const queue = this.batchJobs();
    const idx = queue.findIndex((j) => j.status === 'queued');
    if (idx < 0) return;

    const job = queue[idx]!;
    this.batchRunnerBusy.set(true);
    this.batchJobs.set(queue.map((j, i) => (i === idx ? { ...j, status: 'running' as const } : j)));

    this.http
      .post<{ ok: boolean; result?: RunResultDto; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${job.testCaseId}/run`,
        {},
      )
      .subscribe({
        next: (body) => {
          const failed =
            !body.result ||
            body.result.overallStatus === 'failed' ||
            body.result.ok === false;
          const errMsg = failed
            ? body.result?.error ??
              body.result?.steps?.find((s) => s.status === 'failed')?.message ??
              body.error ??
              'Test thất bại'
            : undefined;

          this.batchJobs.update((list) =>
            list.map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    status: failed ? ('error' as const) : ('done' as const),
                    errorMessage: failed ? errMsg : undefined,
                    result: body.result,
                  }
                : j,
            ),
          );

          if (body.result && this.selectedTestCaseId() === job.testCaseId) {
            this.runResult.set(body.result);
            const steps = body.result.steps ?? [];
            const failedIdx = steps.findIndex((s) => s.status === 'failed');
            const lastOk = steps.length - 1;
            this.selectedShotIndex.set(failedIdx >= 0 ? failedIdx : lastOk >= 0 ? lastOk : 0);
            this.runPanelTab.set('overview');
            this.runAnalysisText.set(null);
            this.runAnalysisError.set(null);
            this.loadRunHistory();
          }

          this.enqueueRunToast(job.testCaseId, job.testCaseLabel, !failed, failed ? errMsg : undefined);
          this.loadNotifications(false);
          this.batchRunnerBusy.set(false);
          this.drainBatchQueue();
        },
        error: (err: HttpErrorResponse) => {
          const msg =
            typeof err.error?.error === 'string' ? err.error.error : err.message || 'Lỗi mạng';
          this.batchJobs.update((list) =>
            list.map((j) =>
              j.id === job.id ? { ...j, status: 'error' as const, errorMessage: msg } : j,
            ),
          );
          this.enqueueRunToast(job.testCaseId, job.testCaseLabel, false, msg);
          this.loadNotifications(false);
          this.batchRunnerBusy.set(false);
          this.drainBatchQueue();
        },
      });
  }

  private enqueueRunToast(testCaseId: string, label: string, ok: boolean, detail?: string): void {
    const id = crypto.randomUUID();
    this.runToasts.update((t) => [...t, { id, testCaseId, label, ok, detail }]);
    const timer = setTimeout(() => {
      this.runToasts.update((t) => t.filter((x) => x.id !== id));
      this.runToastTimers.delete(id);
    }, 6500);
    this.runToastTimers.set(id, timer);
  }

  protected dismissRunToast(id: string): void {
    const t = this.runToastTimers.get(id);
    if (t) clearTimeout(t);
    this.runToastTimers.delete(id);
    this.runToasts.update((list) => list.filter((x) => x.id !== id));
  }

  protected batchProgressPercent(): number {
    const jobs = this.batchJobs();
    if (jobs.length === 0) return 0;
    const done = jobs.filter((j) => j.status === 'done' || j.status === 'error').length;
    return Math.round((done / jobs.length) * 100);
  }

  protected batchSummaryLine(): string {
    const jobs = this.batchJobs();
    const n = jobs.length;
    const done = jobs.filter((j) => j.status === 'done' || j.status === 'error').length;
    const q = jobs.filter((j) => j.status === 'queued').length;
    const run = jobs.some((j) => j.status === 'running');
    if (run) return `Đang chạy · ${done}/${n} xong · ${q} chờ`;
    return `${done}/${n} hoàn tất`;
  }

  protected batchRunningJob(): BatchRunJob | undefined {
    return this.batchJobs().find((j) => j.status === 'running');
  }

  protected toggleBatchPanel(): void {
    this.batchPanelExpanded.update((v) => !v);
  }

  protected clearBatchTerminalJobs(): void {
    this.batchJobs.update((jobs) => jobs.filter((j) => j.status === 'queued' || j.status === 'running'));
  }

  protected dismissBatchRunnerPanel(): void {
    if (this.batchRunnerBusy()) return;
    if (this.batchJobs().some((j) => j.status === 'queued' || j.status === 'running')) return;
    this.batchJobs.set([]);
    this.batchPanelExpanded.set(false);
  }

  protected batchHasTerminalJobs(): boolean {
    return this.batchJobs().some((j) => j.status === 'done' || j.status === 'error');
  }

  protected batchDismissPanelDisabled(): boolean {
    return this.batchRunnerBusy() || this.batchJobs().some((j) => j.status === 'queued' || j.status === 'running');
  }

  protected kindLabel(kind: ActionKind): string {
    const m: Record<ActionKind, string> = {
      navigate: 'Navigate',
      click_selector: 'Click (selector)',
      click_text: 'Click (theo chữ)',
      type: 'Gõ text',
      wait: 'Chờ',
    };
    return m[kind] ?? kind;
  }

  protected actionDetailRow(a: TestActionDto): string {
    switch (a.kind) {
      case 'navigate':
        return a.config.url ?? '—';
      case 'click_selector':
        return a.config.selector ?? '—';
      case 'click_text':
        return a.config.matchText ?? '—';
      case 'type':
        return `Sel: ${a.config.selector ?? '—'} → "${a.config.value ?? ''}"`;
      case 'wait':
        return `${a.config.waitMs ?? 0} ms`;
      default:
        return '—';
    }
  }

  protected onChatInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    this.chatPrompt.set(el.value);
  }

  protected setQuickPrompt(text: string): void {
    this.chatPrompt.set(text);
    this.aiError.set(null);
  }

  protected buildRunResultAnalysisContext(): string {
    const r = this.runResult();
    if (!r) return '';
    const head = [
      `Dự án: ${this.selectedProjectName()}`,
      `Feature: ${this.selectedFeatureName()}`,
      `Test case: ${this.selectedTestCaseLabel()} (${r.testCaseId})`,
      `Kết quả tổng: ${r.overallStatus} (ok=${r.ok})`,
      `Thời lượng: ${(r.durationMs / 1000).toFixed(1)}s`,
      r.error ? `Thông báo lỗi tổng: ${r.error}` : null,
      '',
      'Từng bước:',
    ]
      .filter((x) => x !== null)
      .join('\n');
    const steps = r.steps
      .map(
        (s) =>
          `  ${s.order + 1}. [${s.kind}] ${s.name} → ${s.status}${s.message ? ` — ${s.message}` : ''}`,
      )
      .join('\n');
    return `${head}\n${steps}`;
  }

  protected analyzeRunResult(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const ctx = this.buildRunResultAnalysisContext();
    if (!ctx.trim()) {
      this.runAnalysisError.set('Chưa có kết quả chạy để phân tích.');
      return;
    }
    this.runAnalysisLoading.set(true);
    this.runAnalysisError.set(null);
    const message =
      'Bạn là QA lead. Trả lời TIẾNG VIỆT, CỰC NGẮN (tối đa ~900 ký tự). Chỉ dùng 4–6 gạch đầu dòng, mỗi dòng tối đa 1 câu. Nội dung bắt buộc: (1) Pass/Fail và 1 lý do; (2) bước hoặc vùng rủi ro chính (nếu có); (3) 2–3 gợi ý cải thiện. Không mở bài, không lặp lại context, không markdown dài.';
    this.http.post<ChatResponse>(`${QC_API_BASE_URL}/api/ai/chat`, { message, context: ctx }).subscribe({
      next: (body) => {
        this.runAnalysisLoading.set(false);
        if (body.ok) {
          this.runAnalysisText.set(body.text);
        } else {
          this.runAnalysisError.set(body.error ?? 'Không phân tích được.');
          this.runAnalysisText.set(null);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.runAnalysisLoading.set(false);
        const payload = err.error as { error?: string } | undefined;
        this.runAnalysisError.set(
          typeof payload?.error === 'string'
            ? payload.error
            : err.message || 'Lỗi khi gọi AI (kiểm tra qc-api và GEMINI_API_KEY).',
        );
        this.runAnalysisText.set(null);
      },
    });
  }

  protected sendChat(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const message = this.chatPrompt().trim();
    if (!message || this.aiLoading()) {
      return;
    }
    this.aiLoading.set(true);
    this.aiError.set(null);
    this.aiReply.set(null);

    const context = this.buildTestCaseContext();

    this.http
      .post<ChatResponse>(`${QC_API_BASE_URL}/api/ai/chat`, { message, context })
      .subscribe({
        next: (body) => {
          this.aiLoading.set(false);
          if (body.ok) {
            this.aiReply.set(body.text);
          } else {
            this.aiError.set(body.error ?? 'Lỗi không xác định');
          }
        },
        error: (err: HttpErrorResponse) => {
          this.aiLoading.set(false);
          const payload = err.error as { error?: string } | undefined;
          const msg =
            typeof payload?.error === 'string'
              ? payload.error
              : err.message ||
                `Không gọi được API. Chạy qc-api (npm run dev, port ${QC_API_DEV_PORT}), có GEMINI_API_KEY trong .env, proxy trùng port — restart ng serve.`;
          this.aiError.set(msg);
        },
      });
  }

  protected toggleAiFillUseDom(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    this.aiFillUseDom.set(el.checked);
  }

  protected aiFillRowLabel(actionId: string): string {
    const a = this.actions().find((x) => x.id === actionId);
    return a ? `${a.order + 1}. ${a.name}` : actionId;
  }

  /** Gemini: gợi ý giá trị cho các bước «Gõ text» đang trống. */
  protected aiFillPreview(): void {
    if (!isPlatformBrowser(this.platformId) || this.aiFillLoading()) {
      return;
    }
    const testCaseId = this.selectedTestCaseId();
    if (!testCaseId) {
      this.aiFillError.set('Chưa chọn test case');
      return;
    }
    this.aiFillLoading.set(true);
    this.aiFillError.set(null);

    this.http
      .post<AiFillResponse>(`${QC_API_BASE_URL}/api/test-cases/${testCaseId}/ai/fill`, {
        context: this.buildTestCaseContext(),
        mode: 'preview',
        useDomContext: this.aiFillUseDom(),
        onlyEmpty: true,
      })
      .subscribe({
        next: (body) => {
          this.aiFillLoading.set(false);
          if (!body.ok) {
            this.aiFillError.set(body.error ?? 'AI điền thất bại');
            return;
          }
          this.aiFillDraft.set({ fills: body.fills, model: body.model });
        },
        error: (err: HttpErrorResponse) => {
          this.aiFillLoading.set(false);
          const payload = err.error as { error?: string } | undefined;
          this.aiFillError.set(
            typeof payload?.error === 'string'
              ? payload.error
              : err.message || 'Lỗi khi gọi AI điền',
          );
        },
      });
  }

  /** Áp dụng bản preview hiện tại vào DB (không gọi lại LLM). */
  protected aiFillApply(): void {
    if (!isPlatformBrowser(this.platformId) || this.aiFillLoading()) {
      return;
    }
    const testCaseId = this.selectedTestCaseId();
    const draft = this.aiFillDraft();
    if (!testCaseId || !draft?.fills.length) {
      return;
    }
    this.aiFillLoading.set(true);
    this.aiFillError.set(null);

    this.http
      .post<AiFillResponse>(`${QC_API_BASE_URL}/api/test-cases/${testCaseId}/ai/fill`, {
        context: this.buildTestCaseContext(),
        mode: 'apply',
        fills: draft.fills.map((f) => ({
          actionId: f.actionId,
          value: f.value,
          confidence: f.confidence,
          notes: f.notes,
        })),
        onlyEmpty: true,
      })
      .subscribe({
        next: (body) => {
          this.aiFillLoading.set(false);
          if (!body.ok) {
            this.aiFillError.set(body.error ?? 'Áp dụng thất bại');
            return;
          }
          if (body.actions) {
            this.actions.set([...body.actions].sort((a, b) => a.order - b.order));
          }
          this.aiFillDraft.set(null);
        },
        error: (err: HttpErrorResponse) => {
          this.aiFillLoading.set(false);
          const payload = err.error as { error?: string } | undefined;
          this.aiFillError.set(
            typeof payload?.error === 'string'
              ? payload.error
              : err.message || 'Lỗi khi áp dụng',
          );
        },
      });
  }

  protected loadActions(): void {
    const testCaseId = this.selectedTestCaseId();
    if (!testCaseId) {
      this.actions.set([]);
      return;
    }
    this.actionsLoading.set(true);
    this.actionsError.set(null);
    const url = `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/actions`;
    this.http.get<{ ok: boolean; actions?: TestActionDto[]; error?: string }>(url).subscribe({
      next: (body) => {
        this.actionsLoading.set(false);
        if (body.ok && body.actions) {
          this.actions.set([...body.actions].sort((a, b) => a.order - b.order));
        } else {
          this.actionsError.set(body.error ?? 'Không tải được hành động');
        }
      },
      error: (err: HttpErrorResponse) => {
        this.actionsLoading.set(false);
        this.actionsError.set(err.message || 'Lỗi mạng khi tải hành động');
      },
    });
  }

  protected openAddStep(): void {
    this.resetForm();
    this.addStepOpen.set(true);
    this.menuOpenForId.set(null);
  }

  protected closeAddStep(): void {
    this.addStepOpen.set(false);
  }

  protected openEditStep(a: TestActionDto): void {
    this.startEdit(a);
    this.editStepOpen.set(true);
    this.menuOpenForId.set(null);
  }

  protected closeEditStep(): void {
    this.editStepOpen.set(false);
    this.resetForm();
  }

  protected openDeleteStep(id: string): void {
    this.deleteTargetId.set(id);
    this.deleteStepOpen.set(true);
    this.menuOpenForId.set(null);
  }

  protected closeDeleteStep(): void {
    this.deleteStepOpen.set(false);
    this.deleteTargetId.set(null);
  }

  protected toggleMenu(id: string, event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();

    const nextOpen = this.menuOpenForId() === id ? null : id;
    this.menuOpenForId.set(nextOpen);
    if (!nextOpen) return;
    if (!isPlatformBrowser(this.platformId)) return;

    const target = event?.currentTarget as HTMLElement | null;
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const menuWidth = 160; // w-40
    const itemH = 34;
    const padding = 8;
    const menuHeight = padding * 2 + itemH * 3; // Sửa/Xóa/Tạm tắt
    const margin = 8;

    // Prefer open downward, but flip if would overflow
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight + margin && rect.top > menuHeight + margin;

    let x = rect.right - menuWidth;
    let y = openUp ? rect.top - menuHeight : rect.bottom;

    // Clamp into viewport
    x = Math.max(margin, Math.min(x, window.innerWidth - menuWidth - margin));
    y = Math.max(margin, Math.min(y, window.innerHeight - menuHeight - margin));

    this.menuX.set(Math.round(x));
    this.menuY.set(Math.round(y));
  }

  protected closeMenu(): void {
    this.menuOpenForId.set(null);
  }

  // Legacy handlers (template cũ vẫn còn block flow modal)
  protected closeFlowModal(): void {
    this.flowModalOpen.set(false);
  }

  protected onFlowModalBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeFlowModal();
    }
  }

  protected setFlowModalTab(tab: 'actions' | 'run'): void {
    this.flowModalTab.set(tab);
  }

  protected onDragStart(actionId: string): void {
    this.draggedActionId = actionId;
    this.closeMenu();
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  protected onDrop(targetActionId: string): void {
    const fromId = this.draggedActionId;
    this.draggedActionId = null;
    if (!fromId || fromId === targetActionId) return;

    const list = [...this.actions()].sort((a, b) => a.order - b.order);
    const fromIdx = list.findIndex((a) => a.id === fromId);
    const toIdx = list.findIndex((a) => a.id === targetActionId);
    if (fromIdx < 0 || toIdx < 0) return;

    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    const ids = list.map((a) => a.id);

    this.http
      .put<{ ok: boolean; actions?: TestActionDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${this.selectedTestCaseId()}/actions-order`,
        { orderedIds: ids },
      )
      .subscribe({
        next: (body) => {
          if (body.ok && body.actions) {
            this.actions.set([...body.actions].sort((a, b) => a.order - b.order));
          } else {
            this.actionsError.set(body.error ?? 'Sắp xếp thất bại');
          }
        },
        error: (e: HttpErrorResponse) =>
          this.actionsError.set(e.error?.error ?? e.message ?? 'Lỗi sắp xếp'),
      });
  }

  protected onFormNameInput(e: Event): void {
    this.formName.set((e.target as HTMLInputElement).value);
  }

  protected onFormKindChange(e: Event): void {
    const v = (e.target as HTMLSelectElement).value as ActionKind;
    this.formKind.set(v);
  }

  protected onFormUrlInput(e: Event): void {
    this.formUrl.set((e.target as HTMLInputElement).value);
  }

  protected onFormSelectorInput(e: Event): void {
    this.formSelector.set((e.target as HTMLInputElement).value);
  }

  protected onFormMatchTextInput(e: Event): void {
    this.formMatchText.set((e.target as HTMLInputElement).value);
  }

  protected onFormValueInput(e: Event): void {
    this.formValue.set((e.target as HTMLInputElement).value);
  }

  protected onFormWaitMsInput(e: Event): void {
    const n = Number((e.target as HTMLInputElement).value);
    this.formWaitMs.set(Number.isFinite(n) ? n : 0);
  }

  protected onFormExpectationInput(e: Event): void {
    this.formExpectation.set((e.target as HTMLTextAreaElement).value);
  }

  protected resetForm(): void {
    this.editingId.set(null);
    this.formName.set('');
    this.formKind.set('navigate');
    this.formUrl.set('');
    this.formSelector.set('');
    this.formMatchText.set('');
    this.formValue.set('');
    this.formWaitMs.set(1000);
    this.formExpectation.set('');
  }

  protected startEdit(a: TestActionDto): void {
    this.editingId.set(a.id);
    this.formName.set(a.name);
    this.formKind.set(a.kind);
    this.formUrl.set(a.config.url ?? '');
    this.formSelector.set(a.config.selector ?? '');
    this.formMatchText.set(a.config.matchText ?? '');
    this.formValue.set(a.config.value != null ? String(a.config.value) : '');
    this.formWaitMs.set(typeof a.config.waitMs === 'number' ? a.config.waitMs : 1000);
    this.formExpectation.set(a.expectation ?? '');
  }

  private buildConfigFromForm(): TestActionDto['config'] {
    const k = this.formKind();
    switch (k) {
      case 'navigate':
        return { url: this.formUrl().trim() };
      case 'click_selector':
        return { selector: this.formSelector().trim() };
      case 'click_text':
        return { matchText: this.formMatchText().trim() };
      case 'type':
        return { selector: this.formSelector().trim(), value: this.formValue() };
      case 'wait':
        return { waitMs: Math.max(0, Math.floor(this.formWaitMs())) };
      default:
        return {};
    }
  }

  protected saveAction(): void {
    const name = this.formName().trim() || this.kindLabel(this.formKind());
    const config = this.buildConfigFromForm();
    const expectation = this.formExpectation().trim();
    const editId = this.editingId();
    const testCaseId = this.selectedTestCaseId();
    if (!testCaseId) {
      this.actionsError.set('Chưa chọn test case');
      return;
    }

    if (editId) {
      this.http
        .put<{ ok: boolean; action?: TestActionDto; error?: string }>(
          `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/actions/${editId}`,
          { name, kind: this.formKind(), config, expectation },
        )
        .subscribe({
          next: (body) => {
            if (body.ok) {
              this.closeEditStep();
              this.loadActions();
            } else {
              this.actionsError.set(body.error ?? 'Cập nhật thất bại');
            }
          },
          error: (e: HttpErrorResponse) =>
            this.actionsError.set(e.error?.error ?? e.message ?? 'Lỗi cập nhật'),
        });
      return;
    }

    this.http
      .post<{ ok: boolean; action?: TestActionDto; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/actions`,
        { name, kind: this.formKind(), config, expectation, enabled: true },
      )
      .subscribe({
        next: (body) => {
          if (body.ok) {
            this.closeAddStep();
            this.resetForm();
            this.loadActions();
          } else {
            this.actionsError.set(body.error ?? 'Thêm thất bại');
          }
        },
        error: (e: HttpErrorResponse) =>
          this.actionsError.set(e.error?.error ?? e.message ?? 'Lỗi thêm'),
      });
  }

  protected confirmDelete(): void {
    const id = this.deleteTargetId();
    if (!id) return;
    const testCaseId = this.selectedTestCaseId();
    if (!testCaseId) return;
    this.http
      .delete<{ ok: boolean; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/actions/${id}`,
      )
      .subscribe({
        next: (body) => {
          if (body.ok) {
            if (this.editingId() === id) this.resetForm();
            this.closeDeleteStep();
            this.loadActions();
          } else {
            this.actionsError.set(body.error ?? 'Xóa thất bại');
          }
        },
        error: (e: HttpErrorResponse) =>
          this.actionsError.set(e.error?.error ?? e.message ?? 'Lỗi xóa'),
      });
  }

  protected toggleEnabled(a: TestActionDto): void {
    const testCaseId = this.selectedTestCaseId();
    if (!testCaseId) return;
    this.http
      .put<{ ok: boolean; action?: TestActionDto; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/actions/${a.id}`,
        { enabled: !a.enabled },
      )
      .subscribe({
        next: (body) => {
          if (body.ok) {
            this.loadActions();
            this.closeMenu();
          } else {
            this.actionsError.set(body.error ?? 'Không cập nhật được trạng thái');
          }
        },
        error: (e: HttpErrorResponse) =>
          this.actionsError.set(e.error?.error ?? e.message ?? 'Lỗi cập nhật trạng thái'),
      });
  }

  protected moveAction(id: string, delta: number): void {
    const testCaseId = this.selectedTestCaseId();
    if (!testCaseId) return;
    const list = [...this.actions()].sort((a, b) => a.order - b.order);
    const i = list.findIndex((a) => a.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) {
      return;
    }
    const ids = list.map((a) => a.id);
    const t = ids[i];
    ids[i] = ids[j]!;
    ids[j] = t!;
    this.http
      .put<{ ok: boolean; actions?: TestActionDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/actions-order`,
        { orderedIds: ids },
      )
      .subscribe({
        next: (body) => {
          if (body.ok && body.actions) {
            this.actions.set([...body.actions].sort((a, b) => a.order - b.order));
          } else {
            this.actionsError.set(body.error ?? 'Sắp xếp thất bại');
          }
        },
        error: (e: HttpErrorResponse) =>
          this.actionsError.set(e.error?.error ?? e.message ?? 'Lỗi sắp xếp'),
      });
  }

  protected runTest(): void {
    if (!isPlatformBrowser(this.platformId) || this.runLoading()) {
      return;
    }
    const testCaseId = this.selectedTestCaseId();
    if (!testCaseId) {
      this.runError.set('Chưa chọn test case');
      return;
    }
    this.runLoading.set(true);
    this.runError.set(null);
    this.runResult.set(null);
    this.runPanelTab.set('overview');
    this.selectedShotIndex.set(0);
    this.runAnalysisText.set(null);
    this.runAnalysisError.set(null);

    this.http
      .post<{ ok: boolean; result?: RunResultDto; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/run`,
        {},
      )
      .subscribe({
        next: (body) => {
          this.runLoading.set(false);
          const label = this.selectedTestCaseLabel();
          if (body.result) {
            this.runResult.set(body.result);
            const failedIdx = body.result.steps.findIndex((s) => s.status === 'failed');
            const lastOk = body.result.steps.length - 1;
            this.selectedShotIndex.set(failedIdx >= 0 ? failedIdx : lastOk >= 0 ? lastOk : 0);
            this.loadRunHistory();
            const failed = !body.result.ok || body.result.overallStatus === 'failed';
            const errMsg = failed
              ? body.result.error ??
                  body.result.steps.find((s) => s.status === 'failed')?.message ??
                  'Test thất bại'
              : undefined;
            this.runError.set(failed ? errMsg ?? null : null);
            this.enqueueRunToast(testCaseId, label, !failed, failed ? errMsg : undefined);
            this.loadNotifications(false);
          } else {
            this.runResult.set(null);
            const msg = body.error ?? 'Không có kết quả chạy';
            this.runError.set(msg);
            this.enqueueRunToast(testCaseId, label, false, msg);
            this.loadNotifications(false);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.runLoading.set(false);
          const payload = err.error as { error?: string } | undefined;
          const msg =
            typeof payload?.error === 'string'
              ? payload.error
              : err.message || 'Lỗi khi chạy test';
          this.runError.set(msg);
          this.enqueueRunToast(testCaseId, this.selectedTestCaseLabel(), false, msg);
        },
      });
  }

  protected selectedShotDataUrl(): string | null {
    const steps = this.runResult()?.steps ?? [];
    const i = this.selectedShotIndex();
    const s = steps[i];
    if (!s?.screenshotBase64) {
      return null;
    }
    return `data:image/png;base64,${s.screenshotBase64}`;
  }

  protected pickShot(index: number): void {
    this.selectedShotIndex.set(index);
    this.runPanelTab.set('shots');
  }

  protected setRunTab(tab: 'overview' | 'steps' | 'shots' | 'log'): void {
    this.runPanelTab.set(tab);
  }

  protected setTestCaseTab(tab: 'steps' | 'data' | 'settings' | 'history'): void {
    this.testCaseTab.set(tab);
    if (tab === 'history') {
      this.loadRunHistory();
    }
  }

  protected loadRunHistory(): void {
    const testCaseId = this.selectedTestCaseId();
    if (!testCaseId) {
      this.runHistory.set([]);
      return;
    }
    if (this.runHistoryLoading()) return;
    this.runHistoryLoading.set(true);
    this.runHistoryError.set(null);
    this.http
      .get<{ ok: boolean; runs?: TestRunSummaryDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/runs?limit=50`,
      )
      .subscribe({
        next: (body) => {
          this.runHistoryLoading.set(false);
          if (body.ok && Array.isArray(body.runs)) {
            this.runHistory.set(body.runs);
          } else {
            this.runHistoryError.set(body.error ?? 'Không tải được lịch sử chạy');
          }
        },
        error: (e: HttpErrorResponse) => {
          this.runHistoryLoading.set(false);
          this.runHistoryError.set(e.error?.error ?? e.message ?? 'Lỗi tải lịch sử chạy');
        },
      });
  }

  protected openHistoryDetail(runId: string): void {
    if (!runId || this.historyDetailLoading()) return;
    this.historyDetailOpen.set(true);
    this.historyDetailLoading.set(true);
    this.historyDetailError.set(null);
    this.historyDetail.set(null);

    this.http
      .get<{ ok: boolean; run?: TestRunDetailDto; error?: string }>(`${QC_API_BASE_URL}/api/test-runs/${runId}`)
      .subscribe({
        next: (body) => {
          this.historyDetailLoading.set(false);
          if (body.ok && body.run) {
            this.historyDetail.set(body.run);
          } else {
            this.historyDetailError.set(body.error ?? 'Không tải được chi tiết lịch sử');
          }
        },
        error: (e: HttpErrorResponse) => {
          this.historyDetailLoading.set(false);
          this.historyDetailError.set(e.error?.error ?? e.message ?? 'Lỗi tải chi tiết lịch sử');
        },
      });
  }

  protected closeHistoryDetail(): void {
    this.historyDetailOpen.set(false);
    this.historyDetailError.set(null);
    this.historyDetail.set(null);
    this.historyDetailLoading.set(false);
  }

  protected runStats(): { passed: number; failed: number; total: number } {
    const steps = this.runResult()?.steps ?? [];
    return {
      passed: steps.filter((s) => s.status === 'passed').length,
      failed: steps.filter((s) => s.status === 'failed').length,
      total: steps.length,
    };
  }

  protected runProgressWidth(): string {
    const { passed, total } = this.runStats();
    if (!total) return '0%';
    return `${Math.round((passed / total) * 100)}%`;
  }

  protected buildTestCaseContext(): string {
    const testCaseId = this.selectedTestCaseId();
    const lines = this.actions()
      .sort((a, b) => a.order - b.order)
      .map((a, i) => `${i + 1}. [${a.kind}] ${a.name}: ${this.actionDetailRow(a)}`);
    return [
      `Project: ${this.selectedProjectName()} / Feature: ${this.selectedFeatureName()}`,
      `Test case: ${this.selectedTestCaseLabel()} (${testCaseId ?? '-'})`,
      'Danh sách hành động hiện tại:',
      lines.join('\n') || '(chưa có bước)',
    ].join('\n');
  }

  // ======================
  // CRUD helpers
  // ======================

  protected openCreateProject(): void {
    this.openCrudModal('project', 'create');
  }

  protected openEditProject(p: ProjectDto): void {
    if (!this.projectCanManage()) return;
    this.openCrudModal('project', 'edit', p.id, {
      key: p.key ?? '',
      name: p.name,
      description: p.description ?? '',
    });
  }

  protected openDeleteProject(p: ProjectDto): void {
    this.openCrudModal('project', 'delete', p.id, {
      name: p.name,
    });
  }

  protected openCreateFeature(): void {
    this.openCrudModal('feature', 'create');
  }

  protected openEditFeature(f: FeatureDto): void {
    this.openCrudModal('feature', 'edit', f.id, {
      key: f.key ?? '',
      name: f.name,
      description: f.description ?? '',
    });
  }

  protected openDeleteFeature(f: FeatureDto): void {
    this.openCrudModal('feature', 'delete', f.id, { name: f.name });
  }

  protected openCreateTestCase(): void {
    this.openCrudModal('testcase', 'create');
  }

  protected openEditTestCase(tc: TestCaseDto): void {
    this.openCrudModal('testcase', 'edit', tc.id, {
      id: tc.id,
      key: tc.key ?? '',
      name: tc.name,
      description: tc.description ?? '',
      status: tc.status ?? 'active',
      priority: tc.priority ?? 'medium',
      featureId: tc.featureId ?? undefined,
    });
  }

  protected openDeleteTestCase(tc: TestCaseDto): void {
    this.openCrudModal('testcase', 'delete', tc.id, {
      id: tc.id,
      name: tc.name,
      featureId: tc.featureId ?? undefined,
    });
  }

  private openCrudModal(
    entity: 'project' | 'feature' | 'testcase',
    mode: 'create' | 'edit' | 'delete',
    editingId?: string,
    preset?: Partial<{
      id: string;
      key: string;
      name: string;
      description: string;
      status: string;
      priority: string;
      featureId: string | null;
    }>,
  ): void {
    this.crudEntity.set(entity);
    this.crudMode.set(mode);
    this.crudEditingId.set(editingId ?? null);
    this.crudError.set(null);
    this.crudLoading.set(false);

    if (entity === 'testcase') {
      this.crudTestCaseFeatureId.set(
        mode === 'create' ? null : (preset?.featureId !== undefined ? preset.featureId : null),
      );
    } else {
      this.crudTestCaseFeatureId.set(null);
    }

    this.crudFormId.set(preset?.id ?? '');
    this.crudFormKey.set(preset?.key ?? '');
    this.crudFormName.set(preset?.name ?? '');
    this.crudFormDescription.set(preset?.description ?? '');
    this.crudFormStatus.set(preset?.status ?? 'active');
    this.crudFormPriority.set(preset?.priority ?? 'medium');

    this.crudModalOpen.set(true);
  }

  protected closeCrudModal(): void {
    this.crudModalOpen.set(false);
    this.crudEntity.set(null);
    this.crudEditingId.set(null);
    this.crudError.set(null);
    this.crudTestCaseFeatureId.set(null);
  }

  protected onCrudFormIdInput(e: Event): void {
    this.crudFormId.set((e.target as HTMLInputElement).value);
  }
  protected onCrudFormKeyInput(e: Event): void {
    this.crudFormKey.set((e.target as HTMLInputElement).value);
  }
  protected onCrudFormNameInput(e: Event): void {
    this.crudFormName.set((e.target as HTMLInputElement).value);
  }
  protected onCrudFormDescriptionInput(e: Event): void {
    this.crudFormDescription.set((e.target as HTMLTextAreaElement).value);
  }
  protected onCrudFormStatusChange(e: Event): void {
    this.crudFormStatus.set((e.target as HTMLSelectElement).value);
  }
  protected onCrudFormPriorityChange(e: Event): void {
    this.crudFormPriority.set((e.target as HTMLSelectElement).value);
  }

  protected submitCrud(): void {
    if (this.crudLoading()) return;
    const entity = this.crudEntity();
    if (!entity) return;
    const mode = this.crudMode();

    const pid = this.selectedProjectId();
    const fid = this.selectedFeatureId();
    const editId = this.crudEditingId();

    this.crudLoading.set(true);
    this.crudError.set(null);

    const key = this.crudFormKey().trim() || null;
    const name = this.crudFormName().trim();
    const description = this.crudFormDescription().trim();

    const done = () => this.crudLoading.set(false);

    // PROJECT
    if (entity === 'project') {
      if (mode === 'create') {
        if (!name) {
          done();
          this.crudError.set('Thiếu tên dự án');
          return;
        }
        this.http
          .post<{ ok: boolean; project?: ProjectDto; error?: string }>(`${QC_API_BASE_URL}/api/projects`, {
            key,
            name,
            description,
          })
          .subscribe({
            next: (body) => {
              done();
              if (!body.ok || !body.project) {
                this.crudError.set(body.error ?? 'Tạo dự án thất bại');
                return;
              }
              this.projects.set([body.project, ...this.projects()]);
              this.selectProject(body.project);
              this.closeCrudModal();
            },
            error: (e: HttpErrorResponse) => {
              done();
              this.crudError.set(e.error?.error ?? e.message ?? 'Lỗi tạo dự án');
            },
          });
        return;
      }

      if (mode === 'edit') {
        if (!editId) {
          done();
          this.crudError.set('Thiếu id dự án');
          return;
        }
        this.http
          .put<{ ok: boolean; project?: ProjectDto; error?: string }>(
            `${QC_API_BASE_URL}/api/projects/${editId}`,
            { key, name: name || undefined, description: description || undefined },
          )
          .subscribe({
            next: (body) => {
              done();
              if (!body.ok || !body.project) {
                this.crudError.set(body.error ?? 'Cập nhật dự án thất bại');
                return;
              }
              this.projects.set(this.projects().map((p) => (p.id === editId ? body.project! : p)));
              this.closeCrudModal();
            },
            error: (e: HttpErrorResponse) => {
              done();
              this.crudError.set(e.error?.error ?? e.message ?? 'Lỗi cập nhật dự án');
            },
          });
        return;
      }

      // delete
      if (!editId) {
        done();
        this.crudError.set('Thiếu id dự án');
        return;
      }
      this.http.delete<{ ok: boolean; error?: string }>(`${QC_API_BASE_URL}/api/projects/${editId}`).subscribe({
        next: (body) => {
          done();
          if (!body.ok) {
            this.crudError.set(body.error ?? 'Xóa dự án thất bại');
            return;
          }
          const next = this.projects().filter((p) => p.id !== editId);
          this.projects.set(next);
          if (this.selectedProjectId() === editId) {
            const pick = next[0] ?? null;
            this.selectedProjectId.set(pick?.id ?? null);
            this.selectedFeatureId.set(null);
            this.selectedTestCaseId.set(null);
            this.features.set([]);
            this.testCases.set([]);
            this.actions.set([]);
            if (pick) this.loadFeatures(pick.id);
          }
          this.closeCrudModal();
        },
        error: (e: HttpErrorResponse) => {
          done();
          this.crudError.set(e.error?.error ?? e.message ?? 'Lỗi xóa dự án');
        },
      });
      return;
    }

    // FEATURE
    if (entity === 'feature') {
      if (!pid) {
        done();
        this.crudError.set('Chưa chọn dự án');
        return;
      }

      if (mode === 'create') {
        if (!name) {
          done();
          this.crudError.set('Thiếu tên feature');
          return;
        }
        this.http
          .post<{ ok: boolean; feature?: FeatureDto; error?: string }>(
            `${QC_API_BASE_URL}/api/projects/${pid}/features`,
            { key, name, description },
          )
          .subscribe({
            next: (body) => {
              done();
              if (!body.ok || !body.feature) {
                this.crudError.set(body.error ?? 'Tạo feature thất bại');
                return;
              }
              this.features.set([body.feature, ...this.features()]);
              this.selectFeature(body.feature);
              this.closeCrudModal();
            },
            error: (e: HttpErrorResponse) => {
              done();
              this.crudError.set(e.error?.error ?? e.message ?? 'Lỗi tạo feature');
            },
          });
        return;
      }

      if (mode === 'edit') {
        if (!editId) {
          done();
          this.crudError.set('Thiếu id feature');
          return;
        }
        this.http
          .put<{ ok: boolean; feature?: FeatureDto; error?: string }>(
            `${QC_API_BASE_URL}/api/projects/${pid}/features/${editId}`,
            { key, name: name || undefined, description: description || undefined },
          )
          .subscribe({
            next: (body) => {
              done();
              if (!body.ok || !body.feature) {
                this.crudError.set(body.error ?? 'Cập nhật feature thất bại');
                return;
              }
              this.features.set(this.features().map((f) => (f.id === editId ? body.feature! : f)));
              this.closeCrudModal();
            },
            error: (e: HttpErrorResponse) => {
              done();
              this.crudError.set(e.error?.error ?? e.message ?? 'Lỗi cập nhật feature');
            },
          });
        return;
      }

      // delete
      if (!editId) {
        done();
        this.crudError.set('Thiếu id feature');
        return;
      }
      this.http
        .delete<{ ok: boolean; error?: string }>(`${QC_API_BASE_URL}/api/projects/${pid}/features/${editId}`)
        .subscribe({
          next: (body) => {
            done();
            if (!body.ok) {
              this.crudError.set(body.error ?? 'Xóa feature thất bại');
              return;
            }
            const next = this.features().filter((f) => f.id !== editId);
            this.features.set(next);
            const byFeature = { ...this.testCasesByFeature() };
            delete byFeature[editId];
            this.testCasesByFeature.set(byFeature);
            if (this.selectedFeatureId() === editId) {
              this.selectedFeatureId.set(null);
              this.selectedTestCaseId.set(null);
              this.testCases.set([]);
              this.actions.set([]);
              const pick = next[0] ?? null;
              if (pick) this.selectFeature(pick);
            }
            this.closeCrudModal();
          },
          error: (e: HttpErrorResponse) => {
            done();
            this.crudError.set(e.error?.error ?? e.message ?? 'Lỗi xóa feature');
          },
        });
      return;
    }

    // TESTCASE
    if (entity === 'testcase') {
      const tcFeatureId =
        mode === 'create'
          ? this.selectedFeatureId()
          : this.crudTestCaseFeatureId() ?? this.selectedFeatureId();

      if (!pid || !tcFeatureId) {
        done();
        this.crudError.set('Chưa chọn dự án/feature');
        return;
      }

      const tcId = this.crudFormId().trim();
      const status = this.crudFormStatus().trim() || 'active';
      const priority = this.crudFormPriority().trim() || 'medium';

      if (mode === 'create') {
        if (!tcId) {
          done();
          this.crudError.set('Thiếu id test case (ví dụ: tc-001)');
          return;
        }
        if (!name) {
          done();
          this.crudError.set('Thiếu tên test case');
          return;
        }
        this.http
          .post<{ ok: boolean; testCase?: TestCaseDto; error?: string }>(
            `${QC_API_BASE_URL}/api/projects/${pid}/features/${tcFeatureId}/test-cases`,
            { id: tcId, key, name, description, status, priority },
          )
          .subscribe({
            next: (body) => {
              done();
              if (!body.ok || !body.testCase) {
                this.crudError.set(body.error ?? 'Tạo test case thất bại');
                return;
              }
              this.testCases.set([body.testCase, ...this.testCases()]);
              const byF = this.testCasesByFeature();
              const cur = byF[tcFeatureId] ?? [];
              this.testCasesByFeature.set({ ...byF, [tcFeatureId]: [body.testCase, ...cur] });
              this.selectTestCase(body.testCase);
              this.closeCrudModal();
            },
            error: (e: HttpErrorResponse) => {
              done();
              this.crudError.set(e.error?.error ?? e.message ?? 'Lỗi tạo test case');
            },
          });
        return;
      }

      if (mode === 'edit') {
        if (!editId) {
          done();
          this.crudError.set('Thiếu id test case');
          return;
        }
        this.http
          .put<{ ok: boolean; testCase?: TestCaseDto; error?: string }>(
            `${QC_API_BASE_URL}/api/projects/${pid}/features/${tcFeatureId}/test-cases/${editId}`,
            {
              key,
              name: name || undefined,
              description: description || undefined,
              status,
              priority,
            },
          )
          .subscribe({
            next: (body) => {
              done();
              if (!body.ok || !body.testCase) {
                this.crudError.set(body.error ?? 'Cập nhật test case thất bại');
                return;
              }
              this.testCases.set(this.testCases().map((t) => (t.id === editId ? body.testCase! : t)));
              const byFeat = this.testCasesByFeature();
              const row = byFeat[tcFeatureId] ?? [];
              this.testCasesByFeature.set({
                ...byFeat,
                [tcFeatureId]: row.map((t) => (t.id === editId ? body.testCase! : t)),
              });
              this.closeCrudModal();
            },
            error: (e: HttpErrorResponse) => {
              done();
              this.crudError.set(e.error?.error ?? e.message ?? 'Lỗi cập nhật test case');
            },
          });
        return;
      }

      // delete
      if (!editId) {
        done();
        this.crudError.set('Thiếu id test case');
        return;
      }
      this.http
        .delete<{ ok: boolean; error?: string }>(
          `${QC_API_BASE_URL}/api/projects/${pid}/features/${tcFeatureId}/test-cases/${editId}`,
        )
        .subscribe({
          next: (body) => {
            done();
            if (!body.ok) {
              this.crudError.set(body.error ?? 'Xóa test case thất bại');
              return;
            }
            const next = this.testCases().filter((t) => t.id !== editId);
            this.testCases.set(next);
            const byFeature = this.testCasesByFeature();
            const cached = byFeature[tcFeatureId] ?? null;
            if (cached) {
              this.testCasesByFeature.set({
                ...byFeature,
                [tcFeatureId]: cached.filter((t) => t.id !== editId),
              });
            }
            this.batchSelectedTcIds.set(this.batchSelectedTcIds().filter((id) => id !== editId));
            this.scheduleFormSelectedTcIds.set(
              this.scheduleFormSelectedTcIds().filter((id) => id !== editId),
            );
            this.loadSchedulePickerTestCases();
            this.actions.set([]);
            if (this.selectedTestCaseId() === editId) {
              const pick = next[0] ?? null;
              this.selectedTestCaseId.set(pick?.id ?? null);
              if (pick) this.loadActions();
            }
            this.closeCrudModal();
          },
          error: (e: HttpErrorResponse) => {
            done();
            this.crudError.set(e.error?.error ?? e.message ?? 'Lỗi xóa test case');
          },
        });
      return;
    }
  }
}
