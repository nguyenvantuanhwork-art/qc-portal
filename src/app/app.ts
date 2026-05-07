import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { forkJoin } from 'rxjs';
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
import { FieldHintComponent } from './field-hint.component';
import { UserGuideComponent } from './user-guide.component';

type ChatResponse = { ok: true; text: string; model?: string } | { ok: false; error: string };

export interface AiFillItemDto {
  actionId: string;
  value: string;
  confidence?: number;
  notes?: string;
}

export type ActionKind =
  | 'navigate'
  | 'click_selector'
  | 'click_text'
  | 'click_id'
  | 'click_name'
  | 'click_xpath'
  | 'type'
  | 'type_id'
  | 'type_name'
  | 'type_xpath'
  | 'wait';

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
    /** Bật: chụp cả bước của gói/tiên quyết chạy trước. Tắt: chỉ chụp bước thuộc testcase đang chạy. */
    screenshotPrerequisiteSteps: boolean;
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

export interface ProjectGroupDto {
  id: string;
  name: string;
  description: string;
  memberCount: string;
  featureCount: string;
  testCaseCount: string;
  createdAt: string;
  updatedAt: string;
  /** Chủ dự án / admin, hoặc user là thành viên nhóm — mới được lọc testcase theo nhóm trong explorer. */
  canUseGroupTestScope: boolean;
}

export interface ProjectGroupMemberDto {
  userId: string;
  username: string;
  createdAt: string;
}

export interface ProjectGroupAssignmentsDto {
  features: Array<{ id: string; name: string; key: string | null }>;
  testCases: Array<{ id: string; name: string; featureId: string | null; featureName: string | null }>;
  assignedFeatureIds: string[];
  assignedTestCaseIds: string[];
  canManage: boolean;
}

export interface ProjectGroupStatsDto {
  effectiveTestCases: number;
  directTestCases: number;
  assignedFeatures: number;
  members: number;
  runs7d: number;
  passed7d: number;
  failed7d: number;
  passRate7d: number;
  lastRunAt: string | null;
  completedMarked: number;
}

export interface ProjectGroupDetailDto {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectGroupDetailTestCaseDto {
  id: string;
  name: string;
  featureId: string | null;
  featureName: string | null;
  completed: boolean;
  note: string;
  progressUpdatedAt: string | null;
  lastRun: { id: string; finishedAt: string | null; overallStatus: string | null } | null;
}

export interface ProjectGroupRunRowDto {
  id: string;
  testCaseId: string;
  testCaseName: string;
  featureName: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  overallStatus: string;
  triggeredByUsername: string | null;
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
  /** Gói thao tác (đóng gói từ testcase khác). */
  isOperationPackage?: boolean;
  packedAt?: string | null;
  packedByUsername?: string | null;
  packedFromTestCaseId?: string | null;
}

/** Một gói chạy trước (tiên quyết) gắn với testcase — có thể thuộc feature khác trong cùng dự án. */
export interface PrerequisiteEntryDto {
  testCaseId: string;
  order: number;
  name: string;
  key: string | null;
  featureId: string | null;
  featureName: string | null;
}

/** Dòng danh sách Gói thao tác (sidebar). */
export interface OperationPackageRowDto {
  id: string;
  featureId: string;
  key: string | null;
  name: string;
  description: string;
  packedAt: string | null;
  packedFromTestCaseId: string | null;
  packedByUsername: string | null;
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
    xpath?: string;
    matchText?: string;
    id?: string;
    name?: string;
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

/** Bản nháp testcase/bước từ AI — khớp qc-api `AiGeneratedDraft`. */
export interface AiDesignDraftDto {
  testCase: {
    id: string;
    key: string | null;
    name: string;
    description: string;
    status: string;
    priority: string;
  };
  actions: Array<{
    kind: ActionKind;
    name: string;
    config: TestActionDto['config'];
    expectation?: string;
    enabled: boolean;
    validationError?: string;
  }>;
  notes?: string;
}

type AiTestCaseFromPromptResponse =
  | {
      ok: true;
      mode: 'preview';
      draft: AiDesignDraftDto;
      warnings: string[];
      model?: string;
    }
  | {
      ok: true;
      mode: 'apply';
      testCase: TestCaseDto;
      actions: TestActionDto[];
    }
  | {
      ok: true;
      mode: 'apply';
      appendToTestCaseId: string;
      actionsCreated: TestActionDto[];
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
  /** Presigned GET từ R2 — ưu tiên hơn base64. */
  screenshotUrl?: string;
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
  cancelled?: boolean;
}

/** Dòng log kết quả chạy — dùng cho tab Log. */
export type RunLogLine = {
  key: string;
  level: 'meta' | 'step-pass' | 'step-fail' | 'step-skip' | 'fatal';
  text: string;
};

export type BatchRunJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

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

/** GET /api/runs/active */
export interface ActiveRunRowDto {
  testCaseId: string;
  startedAt: string;
  triggeredByUserId: string | null;
  triggeredByUsername: string | null;
  source: 'manual' | 'schedule';
  progress: {
    stepOrdinal: number;
    totalSteps: number;
    stepName: string;
    stepKind: ActionKind;
  };
  testCaseName: string | null;
  testCaseKey: string | null;
  featureId: string | null;
  featureName: string | null;
  projectId: string | null;
  projectName: string | null;
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
  imports: [DatePipe, FieldHintComponent, UserGuideComponent],
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
    | 'groups'
    | 'settings'
    | 'feature'
    | 'testcase'
    | 'operationpackages'
    | 'runhistory'
    | 'runningtests'
    | 'schedules'
    | 'reports'
    | 'explorer'
    | 'documentation'
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
  protected readonly aiFillLoading = signal(false);
  protected readonly aiFillError = signal<string | null>(null);
  protected readonly aiFillDraft = signal<{ fills: AiFillItemDto[]; model?: string } | null>(null);
  protected readonly aiFillUseDom = signal(false);

  /** TestFlow AI: trò chuyện vs thiết kế testcase từ prompt. */
  protected readonly aiAssistantTab = signal<'chat' | 'design'>('chat');
  protected readonly aiDesignPrompt = signal('');
  /** Gợi ý thêm cho AI (tiền điều kiện, URL đặc biệt) — tùy chọn. */
  protected readonly aiDesignContextExtra = signal('');
  protected readonly aiDesignDraft = signal<AiDesignDraftDto | null>(null);
  protected readonly aiDesignWarnings = signal<string[]>([]);
  protected readonly aiDesignModel = signal<string | null>(null);
  protected readonly aiDesignLoading = signal(false);
  protected readonly aiDesignError = signal<string | null>(null);
  protected readonly aiDesignApplyLoading = signal(false);
  /** Chỉ thêm các bước vào testcase đang mở (không tạo testcase mới). */
  protected readonly aiDesignAppendOnly = signal(false);

  protected readonly actions = signal<TestActionDto[]>([]);
  protected readonly actionsLoading = signal(false);
  protected readonly actionsError = signal<string | null>(null);

  /** Gói chạy trước (cấu hình trực tiếp); khi chạy, backend mở rộng cả cây phụ thuộc. */
  protected readonly testCasePrerequisites = signal<PrerequisiteEntryDto[]>([]);
  protected readonly testCasePrerequisitesSaving = signal(false);
  protected readonly testCasePrerequisitesError = signal<string | null>(null);
  protected readonly prerequisitePickerOpen = signal(false);

  protected readonly operationPackages = signal<OperationPackageRowDto[]>([]);
  protected readonly operationPackagesLoading = signal(false);
  protected readonly operationPackagesError = signal<string | null>(null);
  protected readonly operationPackageModalOpen = signal(false);
  protected readonly operationPackageSaving = signal(false);
  protected readonly operationPackageError = signal<string | null>(null);
  protected readonly operationPackageFormName = signal('');
  protected readonly operationPackageFormDescription = signal('');
  protected readonly operationPackageFormTargetFeatureId = signal('');

  /** Chỉnh sửa gói thao tác (popup), không mở testcase trong explorer. */
  protected readonly operationPackageEditModalOpen = signal(false);
  protected readonly packageEditorTestCaseId = signal<string | null>(null);
  protected readonly operationPackageEditFeatureId = signal<string | null>(null);
  protected readonly operationPackageEditName = signal('');
  protected readonly operationPackageEditDescription = signal('');
  protected readonly operationPackageEditActions = signal<TestActionDto[]>([]);
  protected readonly operationPackageEditLoading = signal(false);
  protected readonly operationPackageEditSavingMeta = signal(false);
  protected readonly operationPackageEditError = signal<string | null>(null);
  protected readonly operationPackageEditActionsError = signal<string | null>(null);
  /** Bảng bước nào đang mở menu «⋯» (trang chính vs modal gói). */
  protected readonly stepMenuContext = signal<'main' | 'package'>('main');

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
  protected readonly formXpath = signal('');
  protected readonly formMatchText = signal('');
  protected readonly formDomId = signal('');
  protected readonly formDomName = signal('');
  protected readonly formValue = signal('');
  protected readonly formWaitMs = signal(1000);
  protected readonly formExpectation = signal('');

  /** Test case đang chờ POST /run từ nút «Chạy test» (có thể nhiều TC song song khi đổi testcase). */
  protected readonly manualRunInFlightTcIds = signal<ReadonlySet<string>>(new Set());
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
  protected readonly testCaseTab = signal<'steps' | 'data' | 'history'>('steps');

  // Run history (per test case)
  /** Theo dõi request lịch sử chạy để tránh race khi đổi testcase nhanh hoặc gọi chồng. */
  private runHistoryFetchGen = 0;

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

  protected readonly activeRuns = signal<ActiveRunRowDto[]>([]);
  protected readonly activeRunsLoading = signal(false);
  protected readonly activeRunsError = signal<string | null>(null);
  private activeRunsPollTimer: ReturnType<typeof setInterval> | null = null;

  // Project groups (owner-managed)
  protected readonly groups = signal<ProjectGroupDto[]>([]);
  protected readonly groupsLoading = signal(false);
  protected readonly groupsError = signal<string | null>(null);
  protected readonly groupsCanManage = signal(false);
  protected readonly selectedGroupId = signal<string | null>(null);

  protected readonly groupEditorName = signal('');
  protected readonly groupEditorDescription = signal('');
  protected readonly groupEditorBusy = signal(false);

  protected readonly groupMembers = signal<ProjectGroupMemberDto[]>([]);
  protected readonly groupMembersLoading = signal(false);
  protected readonly groupMembersError = signal<string | null>(null);
  protected readonly groupMemberSelectedUserId = signal('');
  protected readonly groupMemberBusy = signal(false);


  protected readonly groupAssignments = signal<ProjectGroupAssignmentsDto | null>(null);
  protected readonly groupAssignmentsLoading = signal(false);
  protected readonly groupAssignmentsError = signal<string | null>(null);
  protected readonly groupAssignedFeatureIds = signal<ReadonlySet<string>>(new Set());
  protected readonly groupAssignedTestCaseIds = signal<ReadonlySet<string>>(new Set());
  protected readonly groupAssignmentsBusy = signal(false);

  protected readonly groupWorkspaceTab = signal<'overview' | 'cases' | 'history' | 'settings'>('overview');
  protected readonly groupDetail = signal<{
    group: ProjectGroupDetailDto;
    overview: ProjectGroupStatsDto | null;
    testCases: ProjectGroupDetailTestCaseDto[];
    canManage: boolean;
  } | null>(null);
  protected readonly groupDetailLoading = signal(false);
  protected readonly groupDetailError = signal<string | null>(null);
  protected readonly groupRuns = signal<ProjectGroupRunRowDto[]>([]);
  protected readonly groupRunsLoading = signal(false);
  protected readonly groupRunsError = signal<string | null>(null);
  protected readonly groupRunsHasMore = signal(false);
  protected readonly groupRunsLoadMoreBusy = signal(false);
  private groupRunsOffset = 0;
  private readonly groupRunsPageSize = 40;
  protected readonly groupProgressPatchBusy = signal<ReadonlySet<string>>(new Set());

  protected readonly createGroupModalOpen = signal(false);
  protected readonly createGroupModalName = signal('');
  protected readonly createGroupModalDescription = signal('');
  protected readonly createGroupModalBusy = signal(false);
  protected readonly createGroupModalError = signal<string | null>(null);

  /** Explorer trong tab testcase: rỗng = tất cả TC; uuid = chỉ TC được gán cho nhóm. */
  protected readonly explorerGroupFilterId = signal('');
  protected readonly explorerGroupFilterTcIds = signal<ReadonlySet<string> | null>(null);
  protected readonly explorerGroupFilterFeatureIds = signal<ReadonlySet<string> | null>(null);
  protected readonly explorerGroupFilterLoading = signal(false);
  protected readonly explorerGroupFilterError = signal<string | null>(null);

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
  /** Điều hướng panel cài đặt (kiểu VS Code). */
  protected readonly projectSettingsNav = signal<'runner' | 'ai'>('runner');
  protected readonly projectSettingsSearchQuery = signal('');

  protected readonly notificationPanelOpen = signal(false);
  protected readonly notifications = signal<NotificationItemDto[]>([]);
  protected readonly notificationsUnreadCount = signal(0);
  protected readonly notificationsLoading = signal(false);
  protected readonly notificationsError = signal<string | null>(null);

  /** Cấu hình công khai (đăng ký/banner) từ GET /api/system/public-config — dùng màn đăng nhập. */
  protected readonly publicSystemConfig = signal<{
    registrationOpen: boolean;
    maintenanceBanner: string;
  } | null>(null);

  /** Modal cài đặt tài khoản / hệ thống (header, kiểu VS Code). */
  protected readonly appSettingsModalOpen = signal(false);
  protected readonly globalSettingsNav = signal<'account' | 'system'>('account');
  protected readonly globalSettingsSearchQuery = signal('');
  protected readonly globalSystemDraft = signal<{
    registrationOpen: boolean;
    maintenanceBanner: string;
  } | null>(null);
  protected readonly globalSystemLoading = signal(false);
  protected readonly globalSystemSaving = signal(false);
  protected readonly globalSystemError = signal<string | null>(null);
  protected readonly passwordCurrent = signal('');
  protected readonly passwordNew = signal('');
  protected readonly passwordConfirm = signal('');
  protected readonly passwordBusy = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly passwordOk = signal<string | null>(null);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadPublicSystemConfig();
    this.auth.refreshMe(() => {
      if (this.auth.user()) this.afterLoginBootstrap();
    });
  }

  ngOnDestroy(): void {
    this.stopActiveRunsPolling();
    this.stopNotificationPolling();
    this.destroyReportCharts();
    for (const t of this.runToastTimers.values()) {
      clearTimeout(t);
    }
    this.runToastTimers.clear();
  }

  protected setAuthTab(tab: 'login' | 'register'): void {
    let t = tab;
    if (t === 'register' && !this.publicRegistrationOpen()) t = 'login';
    this.authTab.set(t);
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

  protected setRunnerScreenshotPrerequisiteSteps(ev: Event): void {
    this.patchProjectSettingsRunner(
      'screenshotPrerequisiteSteps',
      (ev.target as HTMLInputElement).checked,
    );
  }

  protected setAiEnabled(ev: Event): void {
    const d = this.projectSettingsDraft();
    if (!d) return;
    const enabled = (ev.target as HTMLInputElement).checked;
    this.projectSettingsDraft.set({ ...d, ai: { ...d.ai, enabled } });
  }

  protected setProjectSettingsNav(id: 'runner' | 'ai'): void {
    this.projectSettingsNav.set(id);
  }

  protected onProjectSettingsSearchInput(ev: Event): void {
    this.projectSettingsSearchQuery.set((ev.target as HTMLInputElement).value);
  }

  protected clearProjectSettingsSearch(): void {
    this.projectSettingsSearchQuery.set('');
  }

  private projectSettingsNormalizeSearch(s: string): string {
    return s
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
  }

  /** Một dòng cài đặt hiển thị khi không tìm kiếm hoặc khi nhãn khớp truy vấn. */
  protected projectSettingsRowVisible(label: string): boolean {
    const raw = this.projectSettingsSearchQuery().trim();
    if (!raw) return true;
    const q = this.projectSettingsNormalizeSearch(raw);
    return this.projectSettingsNormalizeSearch(label).includes(q);
  }

  protected projectSettingsIsSearching(): boolean {
    return this.projectSettingsSearchQuery().trim().length > 0;
  }

  protected projectSettingsShowRunnerSection(): boolean {
    if (!this.projectSettingsIsSearching()) {
      return this.projectSettingsNav() === 'runner';
    }
    const sectionTitle = 'Chạy test tự động';
    if (this.projectSettingsRowVisible(sectionTitle)) return true;
    const labels = [
      'Timeout bước (click/type/chờ selector), ms',
      'Timeout navigate, ms',
      'Tối đa «Chờ» (wait), ms',
      'Số lần chạy lại khi fail (retry)',
      'Chụp màn hình',
      'Chụp ảnh các bước gói chạy trước',
      'Chạy trình duyệt headless',
      'Viewport rộng',
      'Viewport cao',
      'Base URL mặc định (URL navigate tương đối)',
    ];
    return labels.some((l) => this.projectSettingsRowVisible(l));
  }

  protected projectSettingsShowAiSection(): boolean {
    if (!this.projectSettingsIsSearching()) {
      return this.projectSettingsNav() === 'ai';
    }
    const sectionTitle = 'Gợi ý giá trị trường';
    if (this.projectSettingsRowVisible(sectionTitle)) return true;
    return this.projectSettingsRowVisible('Cho phép xem trước gợi ý khi điền bước «Gõ text»');
  }

  protected projectSettingsSearchHasNoMatches(): boolean {
    if (!this.projectSettingsIsSearching()) return false;
    return !this.projectSettingsShowRunnerSection() && !this.projectSettingsShowAiSection();
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

  /** Để hiện tab Đăng ký — mặc định mở nếu chưa tải public-config. */
  protected publicRegistrationOpen(): boolean {
    const c = this.publicSystemConfig();
    if (!c) return true;
    return c.registrationOpen;
  }

  protected loadPublicSystemConfig(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.http
      .get<{
        ok: boolean;
        registrationOpen?: boolean;
        maintenanceBanner?: string;
      }>(`${QC_API_BASE_URL}/api/system/public-config`)
      .subscribe({
        next: (b) => {
          if (b.ok && typeof b.registrationOpen === 'boolean') {
            this.publicSystemConfig.set({
              registrationOpen: b.registrationOpen,
              maintenanceBanner: typeof b.maintenanceBanner === 'string' ? b.maintenanceBanner : '',
            });
          }
        },
        error: () => {
          /* bỏ qua — không chặn đăng ký */
        },
      });
  }

  /** Mở modal cài đặt tài khoản và hệ thống (ghi đè mật khẩu, cấu hình public). */
  protected openAppSettingsModal(): void {
    if (!this.auth.user()) return;
    this.closeNotificationsPanel();
    this.projectPickerOpen.set(false);
    this.featurePickerOpen.set(false);
    this.globalSettingsNav.set('account');
    this.globalSettingsSearchQuery.set('');
    this.globalSystemError.set(null);
    this.passwordError.set(null);
    this.passwordOk.set(null);
    this.passwordCurrent.set('');
    this.passwordNew.set('');
    this.passwordConfirm.set('');
    this.passwordBusy.set(false);

    this.globalSystemLoading.set(true);
    this.globalSystemDraft.set(null);
    this.http
      .get<{
        ok: boolean;
        settings?: { registrationOpen: boolean; maintenanceBanner: string };
        error?: string;
      }>(`${QC_API_BASE_URL}/api/system/settings`)
      .subscribe({
        next: (body) => {
          this.globalSystemLoading.set(false);
          if (!body.ok || !body.settings) {
            this.globalSystemError.set(body.error ?? 'Không tải được cài đặt hệ thống.');
            return;
          }
          this.globalSystemDraft.set({
            registrationOpen: body.settings.registrationOpen !== false,
            maintenanceBanner:
              typeof body.settings.maintenanceBanner === 'string' ? body.settings.maintenanceBanner : '',
          });
        },
        error: (e: HttpErrorResponse) => {
          this.globalSystemLoading.set(false);
          this.globalSystemError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message || 'Không đọc được cài đặt.',
          );
        },
      });

    this.appSettingsModalOpen.set(true);
  }

  protected closeAppSettingsModal(): void {
    this.appSettingsModalOpen.set(false);
  }

  protected setGlobalSettingsNav(nav: 'account' | 'system'): void {
    this.globalSettingsNav.set(nav);
  }

  protected onGlobalSettingsSearchInput(ev: Event): void {
    this.globalSettingsSearchQuery.set((ev.target as HTMLInputElement).value);
  }

  protected clearGlobalSettingsSearch(): void {
    this.globalSettingsSearchQuery.set('');
  }

  private globalSettingsNormalizeSearch(s: string): string {
    return s
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
  }

  protected globalSettingsRowVisible(label: string): boolean {
    const raw = this.globalSettingsSearchQuery().trim();
    if (!raw) return true;
    const q = this.globalSettingsNormalizeSearch(raw);
    return this.globalSettingsNormalizeSearch(label).includes(q);
  }

  protected globalSettingsIsSearching(): boolean {
    return this.globalSettingsSearchQuery().trim().length > 0;
  }

  protected globalSettingsShowAccountPanel(): boolean {
    if (!this.globalSettingsIsSearching()) return this.globalSettingsNav() === 'account';
    const titles = ['Tài khoản của bạn', 'Username', 'Vai trò', 'Đổi mật khẩu'];
    const fields = ['Mật khẩu hiện tại', 'Mật khẩu mới', 'Xác nhận mật khẩu'];
    return titles.some((t) => this.globalSettingsRowVisible(t)) || fields.some((f) => this.globalSettingsRowVisible(f));
  }

  protected globalSettingsShowSystemPanel(): boolean {
    if (!this.globalSettingsIsSearching()) return this.globalSettingsNav() === 'system';
    const labels = ['Hệ thống', 'Cho phép đăng ký tài khoản mới', 'Thông báo trên trang đăng nhập'];
    return labels.some((l) => this.globalSettingsRowVisible(l));
  }

  protected globalSettingsSearchHasNoMatches(): boolean {
    if (!this.globalSettingsIsSearching()) return false;
    return !this.globalSettingsShowAccountPanel() && !this.globalSettingsShowSystemPanel();
  }

  protected toggleGlobalRegistrationOpen(ev: Event): void {
    const d = this.globalSystemDraft();
    if (!d) return;
    this.globalSystemDraft.set({
      ...d,
      registrationOpen: (ev.target as HTMLInputElement).checked,
    });
  }

  protected onGlobalMaintenanceBannerInput(ev: Event): void {
    const d = this.globalSystemDraft();
    if (!d) return;
    this.globalSystemDraft.set({
      ...d,
      maintenanceBanner: (ev.target as HTMLTextAreaElement).value,
    });
  }

  protected saveGlobalSystemSettings(): void {
    const draft = this.globalSystemDraft();
    const user = this.auth.user();
    if (!draft || !user || user.role !== 'admin' || !isPlatformBrowser(this.platformId)) return;
    this.globalSystemSaving.set(true);
    this.globalSystemError.set(null);
    this.http
      .put<{
        ok: boolean;
        settings?: { registrationOpen: boolean; maintenanceBanner: string };
        error?: string;
      }>(`${QC_API_BASE_URL}/api/system/settings`, {
        registrationOpen: draft.registrationOpen,
        maintenanceBanner: draft.maintenanceBanner,
      })
      .subscribe({
        next: (body) => {
          this.globalSystemSaving.set(false);
          if (!body.ok || !body.settings) {
            this.globalSystemError.set(body.error ?? 'Không lưu được.');
            return;
          }
          this.globalSystemDraft.set({
            registrationOpen: body.settings.registrationOpen !== false,
            maintenanceBanner:
              typeof body.settings.maintenanceBanner === 'string' ? body.settings.maintenanceBanner : '',
          });
          this.loadPublicSystemConfig();
        },
        error: (e: HttpErrorResponse) => {
          this.globalSystemSaving.set(false);
          this.globalSystemError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message || 'Lỗi mạng',
          );
        },
      });
  }

  protected onPasswordCurrentInput(ev: Event): void {
    this.passwordCurrent.set((ev.target as HTMLInputElement).value);
  }

  protected onPasswordNewInput(ev: Event): void {
    this.passwordNew.set((ev.target as HTMLInputElement).value);
  }

  protected onPasswordConfirmInput(ev: Event): void {
    this.passwordConfirm.set((ev.target as HTMLInputElement).value);
  }

  protected submitAccountPasswordChange(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const cur = this.passwordCurrent();
    const neu = this.passwordNew();
    const conf = this.passwordConfirm();
    this.passwordOk.set(null);
    this.passwordError.set(null);

    if (!cur || !neu) {
      this.passwordError.set('Nhập mật khẩu hiện tại và mới.');
      return;
    }
    if (neu !== conf) {
      this.passwordError.set('Xác nhận mật khẩu không khớp.');
      return;
    }
    if (neu.length < 4) {
      this.passwordError.set('Mật khẩu mới tối thiểu 4 ký tự.');
      return;
    }

    this.passwordBusy.set(true);
    this.http
      .put<{ ok: boolean; error?: string }>(`${QC_API_BASE_URL}/api/auth/password`, {
        currentPassword: cur,
        newPassword: neu,
      })
      .subscribe({
        next: (body) => {
          this.passwordBusy.set(false);
          if (!body.ok) {
            this.passwordError.set(body.error ?? 'Đổi mật khẩu thất bại.');
            return;
          }
          this.passwordCurrent.set('');
          this.passwordNew.set('');
          this.passwordConfirm.set('');
          this.passwordOk.set('Đã cập nhật mật khẩu.');
        },
        error: (e: HttpErrorResponse) => {
          this.passwordBusy.set(false);
          this.passwordError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message || 'Lỗi mạng.',
          );
        },
      });
  }

  /** Màn hình hướng dẫn (sidebar Documentation / nút header cạnh thông báo). */
  protected openDocumentation(): void {
    this.closeAppSettingsModal();
    this.closeNotificationsPanel();
    this.projectPickerOpen.set(false);
    this.featurePickerOpen.set(false);
    this.openSidebarSection('documentation');
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

  private loadTestCases(
    projectId: string,
    featureId: string,
    opts?: { selectTestCaseId?: string },
  ): void {
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
          const pickId = opts?.selectTestCaseId?.trim();
          const preferred = pickId
            ? (body.testCases.find((t) => t.id === pickId) ?? null)
            : (body.testCases.find((t) => t.id === 'tc-001') ??
              body.testCases.find((t) => t.id === 'tc-google-search') ??
              body.testCases[0] ??
              null);
          const prevTc = this.selectedTestCaseId();
          const tcId = preferred?.id ?? null;
          this.selectedTestCaseId.set(tcId);
          if (prevTc !== tcId) {
            this.syncRunPanelToSelectedTestCase();
          }
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
    this.syncRunPanelToSelectedTestCase();
    this.loadProjectMembers(p.id);
    this.loadFeatures(p.id);
    this.selectedGroupId.set(null);
    this.groupDetail.set(null);
    this.groupRuns.set([]);
    this.groupMembers.set([]);
    this.groupAssignments.set(null);
    this.groupWorkspaceTab.set('overview');
    this.explorerGroupFilterId.set('');
    this.explorerGroupFilterTcIds.set(null);
    this.explorerGroupFilterFeatureIds.set(null);
    this.explorerGroupFilterLoading.set(false);
    this.explorerGroupFilterError.set(null);
    void this.loadProjectGroups(p.id, { preserveSelection: true });
  }

  protected selectFeature(f: FeatureDto): void {
    this.currentSidebarSection.set('feature');
    this.selectedFeatureId.set(f.id);
    this.selectedTestCaseId.set(null);
    this.testCases.set([]);
    this.actions.set([]);
    this.syncRunPanelToSelectedTestCase();
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
    this.syncRunPanelToSelectedTestCase();
    const pid = this.selectedProjectId();
    if (!pid) return;
    this.loadTestCases(pid, f.id);
  }

  protected selectTestCase(tc: TestCaseDto): void {
    const prevTc = this.selectedTestCaseId();
    this.currentSidebarSection.set('testcase');
    this.selectedTestCaseId.set(tc.id);
    this.menuOpenForId.set(null);
    if (prevTc !== tc.id) {
      this.syncRunPanelToSelectedTestCase();
      this.runHistory.set([]);
      this.runHistoryError.set(null);
    }
    this.loadActions();
    this.loadTestCasePrerequisitesDetail();
    if (prevTc !== tc.id) {
      this.loadLatestRunResultFromDb();
    }
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

    const prevTc = this.selectedTestCaseId();
    this.selectedTestCaseId.set(tc.id);
    this.menuOpenForId.set(null);
    if (prevTc !== tc.id) {
      this.syncRunPanelToSelectedTestCase();
      this.runHistory.set([]);
      this.runHistoryError.set(null);
    }
    this.loadActions();
    this.loadTestCasePrerequisitesDetail();
    if (prevTc !== tc.id) {
      this.loadLatestRunResultFromDb();
    }
    if (this.testCaseTab() === 'history') {
      this.loadRunHistory();
    }
  }

  /** Lấy record chạy mới nhất từ DB và hiển thị ở panel phải. */
  protected loadLatestRunResultFromDb(): void {
    const testCaseId = this.selectedTestCaseId();
    if (!testCaseId) {
      this.runResult.set(null);
      return;
    }
    // Nếu đang có lần chạy in-flight cho testcase đang mở, ưu tiên trạng thái "RUNNING" hiện tại.
    if (this.runPanelBusyForSelectedTestCase()) return;

    this.http
      .get<{ ok: boolean; runs?: TestRunSummaryDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/runs?limit=1`,
      )
      .subscribe({
        next: (body) => {
          if (!body.ok || !Array.isArray(body.runs)) {
            // Không phá UI nếu endpoint lỗi; giữ nguyên runResult hiện tại.
            return;
          }
          const latest = body.runs[0];
          if (!latest?.id) {
            this.runResult.set(null);
            this.runError.set(null);
            return;
          }
          this.http
            .get<{ ok: boolean; run?: TestRunDetailDto; error?: string }>(
              `${QC_API_BASE_URL}/api/test-runs/${latest.id}`,
            )
            .subscribe({
              next: (r2) => {
                if (!r2.ok || !r2.run?.result) return;
                // Tránh race: user đã chuyển testcase khác trong lúc request.
                if (this.selectedTestCaseId() !== testCaseId) return;
                this.runResult.set(r2.run.result);
                this.runError.set(null);
                const steps = r2.run.result.steps ?? [];
                const failedIdx = steps.findIndex((s) => s.status === 'failed');
                const lastIdx = steps.length - 1;
                this.selectedShotIndex.set(failedIdx >= 0 ? failedIdx : lastIdx >= 0 ? lastIdx : 0);
                this.runPanelTab.set('overview');
              },
            });
        },
      });
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
      | 'groups'
      | 'settings'
      | 'feature'
      | 'testcase'
      | 'operationpackages'
      | 'runhistory'
      | 'runningtests'
      | 'schedules'
      | 'reports'
      | 'documentation',
  ): void {
    const prev = this.currentSidebarSection();
    this.currentSidebarSection.set(section);
    if (section === 'documentation') {
      this.closeNotificationsPanel();
    }
    if (section === 'runningtests') {
      this.loadActiveRuns();
      this.startActiveRunsPolling();
    } else {
      this.stopActiveRunsPolling();
    }
    if (prev === 'reports' && section !== 'reports') {
      this.destroyReportCharts();
    }
    if (section === 'members') {
      const pid = this.selectedProjectId();
      if (pid) this.loadProjectMembers(pid);
    }
    if (section === 'groups') {
      const pid = this.selectedProjectId();
      if (pid) {
        this.loadProjectGroups(pid, { preserveSelection: true });
        // UX: để chọn member từ danh sách thành viên dự án
        this.loadProjectMembers(pid);
      }
    }
    if (section === 'settings') {
      this.projectSettingsNav.set('runner');
      this.projectSettingsSearchQuery.set('');
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
    if (section === 'operationpackages') {
      const pid = this.selectedProjectId();
      if (pid) this.loadOperationPackages(pid);
    }
    if (section === 'testcase') {
      const pid = this.selectedProjectId();
      if (pid) this.loadProjectGroups(pid, { preserveSelection: true });
    }
  }

  /** Nhóm mà user hiện tại được lọc testcase trong explorer (chủ dự án hoặc thành viên nhóm). */
  protected explorerSelectableGroupsForTestScope(): ProjectGroupDto[] {
    return this.groups().filter((g) => g.canUseGroupTestScope === true);
  }

  private clearExplorerGroupScopeFilter(): void {
    this.explorerGroupFilterId.set('');
    this.explorerGroupFilterTcIds.set(null);
    this.explorerGroupFilterFeatureIds.set(null);
    this.explorerGroupFilterLoading.set(false);
    this.explorerGroupFilterError.set(null);
  }

  /** Gỡ bộ lọc nhóm trong explorer khi không còn được phép scope tới nhóm đang chọn. */
  private syncExplorerGroupFilterWithPermissions(groups: ProjectGroupDto[]): void {
    const cur = this.explorerGroupFilterId().trim();
    if (!cur) return;
    const row = groups.find((g) => g.id === cur);
    if (!row || row.canUseGroupTestScope !== true) {
      this.clearExplorerGroupScopeFilter();
    }
  }

  // ---------- Groups ----------
  protected loadProjectGroups(projectId: string, opts?: { preserveSelection?: boolean }): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const preserve = opts?.preserveSelection === true;
    const prevSel = this.selectedGroupId();
    this.groupsLoading.set(true);
    this.groupsError.set(null);
    this.groups.set([]);
    this.groupsCanManage.set(false);
    if (!preserve) {
      this.selectedGroupId.set(null);
      this.groupDetail.set(null);
      this.groupRuns.set([]);
      this.groupMembers.set([]);
      this.groupAssignments.set(null);
      this.groupWorkspaceTab.set('overview');
    }
    this.http
      .get<
        | { ok: true; groups: ProjectGroupDto[]; canManage: boolean }
        | { ok: false; error?: string }
      >(`${QC_API_BASE_URL}/api/projects/${projectId}/groups`)
      .subscribe({
        next: (body) => {
          this.groupsLoading.set(false);
          if (!body.ok) {
            this.groupsError.set('error' in body && typeof body.error === 'string' ? body.error : 'Không tải được nhóm');
            return;
          }
          const list = body.groups ?? [];
          this.groups.set(list);
          this.groupsCanManage.set(Boolean(body.canManage));
          this.syncExplorerGroupFilterWithPermissions(list);
          if (preserve && prevSel && list.some((g) => g.id === prevSel)) {
            const g = list.find((x) => x.id === prevSel);
            if (g) this.selectGroup(g);
          } else if (!preserve) {
            this.selectedGroupId.set(null);
          }
        },
        error: (e: HttpErrorResponse) => {
          this.groupsLoading.set(false);
          this.groupsError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
        },
      });
  }

  protected selectGroup(g: ProjectGroupDto): void {
    this.selectedGroupId.set(g.id);
    this.groupEditorName.set(g.name ?? '');
    this.groupEditorDescription.set(g.description ?? '');
    this.groupWorkspaceTab.set('overview');
    const pid = this.selectedProjectId();
    if (!pid) return;
    this.loadGroupDetail(pid, g.id);
    this.loadGroupRuns(pid, g.id, false);
    this.loadGroupMembers(pid, g.id);
    this.loadGroupAssignments(pid, g.id);
  }

  protected setGroupWorkspaceTab(tab: 'overview' | 'cases' | 'history' | 'settings'): void {
    this.groupWorkspaceTab.set(tab);
    const pid = this.selectedProjectId();
    const gid = this.selectedGroupId();
    if (tab === 'history' && pid && gid && !this.groupRunsLoading() && this.groupRuns().length === 0) {
      this.loadGroupRuns(pid, gid, false);
    }
  }

  protected loadGroupDetail(projectId: string, groupId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.groupDetailLoading.set(true);
    this.groupDetailError.set(null);
    this.http
      .get<
        | {
            ok: true;
            group: ProjectGroupDetailDto;
            overview: ProjectGroupStatsDto | null;
            testCases: ProjectGroupDetailTestCaseDto[];
            canManage: boolean;
          }
        | { ok: false; error?: string }
      >(`${QC_API_BASE_URL}/api/projects/${projectId}/groups/${groupId}/detail`)
      .subscribe({
        next: (body) => {
          this.groupDetailLoading.set(false);
          if (!body.ok) {
            this.groupDetailError.set(
              'error' in body && typeof body.error === 'string' ? body.error : 'Không tải chi tiết nhóm',
            );
            return;
          }
          const { ok: _ok, ...rest } = body;
          this.groupDetail.set({
            group: rest.group,
            overview: rest.overview ?? null,
            testCases: rest.testCases ?? [],
            canManage: Boolean(rest.canManage),
          });
          this.groupEditorName.set(rest.group.name);
          this.groupEditorDescription.set(rest.group.description);
        },
        error: (e: HttpErrorResponse) => {
          this.groupDetailLoading.set(false);
          this.groupDetailError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
        },
      });
  }

  protected loadGroupRuns(projectId: string, groupId: string, append: boolean): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const page = this.groupRunsPageSize;
    if (!append) {
      this.groupRunsOffset = 0;
      this.groupRuns.set([]);
      this.groupRunsLoading.set(true);
      this.groupRunsHasMore.set(false);
    } else {
      this.groupRunsLoadMoreBusy.set(true);
    }
    this.groupRunsError.set(null);
    const off = this.groupRunsOffset;
    const params = new HttpParams().set('limit', String(page)).set('offset', String(off));
    this.http
      .get<
        | { ok: true; runs: ProjectGroupRunRowDto[]; limit: number; offset: number }
        | { ok: false; error?: string }
      >(`${QC_API_BASE_URL}/api/projects/${projectId}/groups/${groupId}/runs`, { params })
      .subscribe({
        next: (body) => {
          if (!append) this.groupRunsLoading.set(false);
          else this.groupRunsLoadMoreBusy.set(false);
          if (!body.ok) {
            this.groupRunsError.set(
              'error' in body && typeof body.error === 'string' ? body.error : 'Không tải lịch sử chạy nhóm',
            );
            return;
          }
          const rows = body.runs ?? [];
          if (append) this.groupRuns.set([...this.groupRuns(), ...rows]);
          else this.groupRuns.set(rows);
          this.groupRunsOffset = off + rows.length;
          this.groupRunsHasMore.set(rows.length >= page);
        },
        error: (e: HttpErrorResponse) => {
          if (!append) this.groupRunsLoading.set(false);
          else this.groupRunsLoadMoreBusy.set(false);
          this.groupRunsError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
        },
      });
  }

  protected loadMoreGroupRuns(): void {
    const pid = this.selectedProjectId();
    const gid = this.selectedGroupId();
    if (!pid || !gid || this.groupRunsLoadMoreBusy() || !this.groupRunsHasMore()) return;
    this.loadGroupRuns(pid, gid, true);
  }

  private updateBusySet(testCaseId: string, busy: boolean): void {
    const s = new Set(this.groupProgressPatchBusy());
    if (busy) s.add(testCaseId);
    else s.delete(testCaseId);
    this.groupProgressPatchBusy.set(s);
  }

  protected patchGroupTestProgress(
    testCaseId: string,
    patch: { completed?: boolean; note?: string },
  ): void {
    const pid = this.selectedProjectId();
    const gid = this.selectedGroupId();
    if (!pid || !gid) return;
    this.updateBusySet(testCaseId, true);
    this.http
      .patch<{ ok: boolean; progress?: { testCaseId: string; completed: boolean; note: string } }>(`${QC_API_BASE_URL}/api/projects/${pid}/groups/${gid}/progress`, {
        testCaseId,
        ...patch,
      })
      .subscribe({
        next: (body) => {
          this.updateBusySet(testCaseId, false);
          if (!body.ok || !body.progress) return;
          const pr = body.progress;
          const d = this.groupDetail();
          if (!d) return;
          const was = d.testCases.find((t) => t.id === testCaseId);
          const wasDone = was?.completed ?? false;
          const nowDone = pr.completed;
          const tcs = d.testCases.map((t) =>
            t.id === testCaseId
              ? {
                  ...t,
                  completed: pr.completed,
                  note: pr.note,
                  progressUpdatedAt: new Date().toISOString(),
                }
              : t,
          );
          let overview = d.overview;
          if (overview && wasDone !== nowDone) {
            const delta = nowDone ? 1 : -1;
            overview = {
              ...overview,
              completedMarked: Math.max(0, (overview.completedMarked ?? 0) + delta),
            };
          }
          this.groupDetail.set({ ...d, testCases: tcs, overview });
        },
        error: (e: HttpErrorResponse) => {
          this.updateBusySet(testCaseId, false);
          this.groupsError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
        },
      });
  }

  protected onGroupTcCompleteChange(tc: ProjectGroupDetailTestCaseDto, e: Event): void {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked === tc.completed) return;
    this.patchGroupTestProgress(tc.id, { completed: checked });
  }

  protected onGroupTcNoteBlur(tc: ProjectGroupDetailTestCaseDto, raw: string): void {
    const note = raw;
    if (note === tc.note) return;
    this.patchGroupTestProgress(tc.id, { note });
  }

  protected focusGroupAssignedTestCase(tc: ProjectGroupDetailTestCaseDto): void {
    const pid = this.selectedProjectId();
    const fid = tc.featureId;
    if (!pid || !fid) return;
    this.currentSidebarSection.set('testcase');
    this.selectedFeatureId.set(fid);
    this.loadTestCases(pid, fid, { selectTestCaseId: tc.id });
  }

  protected clearGroupSelection(): void {
    this.selectedGroupId.set(null);
    this.groupDetail.set(null);
    this.groupRuns.set([]);
    this.groupRunsOffset = 0;
    this.groupRunsHasMore.set(false);
    this.groupMembers.set([]);
    this.groupAssignments.set(null);
    this.groupWorkspaceTab.set('overview');
  }

  protected refreshProjectGroups(): void {
    const pid = this.selectedProjectId();
    if (!pid) return;
    this.loadProjectGroups(pid, { preserveSelection: true });
  }

  protected loadGroupMembers(projectId: string, groupId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.groupMembersLoading.set(true);
    this.groupMembersError.set(null);
    this.groupMembers.set([]);
    this.http
      .get<
        | { ok: true; members: ProjectGroupMemberDto[]; canManage: boolean }
        | { ok: false; error?: string }
      >(`${QC_API_BASE_URL}/api/projects/${projectId}/groups/${groupId}/members`)
      .subscribe({
        next: (body) => {
          this.groupMembersLoading.set(false);
          if (!body.ok) {
            this.groupMembersError.set(
              'error' in body && typeof body.error === 'string' ? body.error : 'Không tải được thành viên nhóm',
            );
            return;
          }
          this.groupMembers.set(body.members ?? []);
        },
        error: (e: HttpErrorResponse) => {
          this.groupMembersLoading.set(false);
          this.groupMembersError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
        },
      });
  }

  protected loadGroupAssignments(projectId: string, groupId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.groupAssignmentsLoading.set(true);
    this.groupAssignmentsError.set(null);
    this.groupAssignments.set(null);
    this.groupAssignedFeatureIds.set(new Set());
    this.groupAssignedTestCaseIds.set(new Set());
    this.http
      .get<
        | ({ ok: true } & ProjectGroupAssignmentsDto)
        | { ok: false; error?: string }
      >(`${QC_API_BASE_URL}/api/projects/${projectId}/groups/${groupId}/assignments`)
      .subscribe({
        next: (body) => {
          this.groupAssignmentsLoading.set(false);
          if (!body.ok) {
            this.groupAssignmentsError.set(
              'error' in body && typeof body.error === 'string' ? body.error : 'Không tải được phân công',
            );
            return;
          }
          const { ok: _ok, ...dto } = body;
          this.groupAssignments.set(dto);
          this.groupAssignedFeatureIds.set(new Set(dto.assignedFeatureIds ?? []));
          this.groupAssignedTestCaseIds.set(new Set(dto.assignedTestCaseIds ?? []));
        },
        error: (e: HttpErrorResponse) => {
          this.groupAssignmentsLoading.set(false);
          this.groupAssignmentsError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
        },
      });
  }

  protected openCreateGroupModal(): void {
    if (!this.groupsCanManage()) return;
    this.createGroupModalError.set(null);
    this.createGroupModalName.set('');
    this.createGroupModalDescription.set('');
    this.createGroupModalOpen.set(true);
  }

  protected closeCreateGroupModal(): void {
    this.createGroupModalOpen.set(false);
    this.createGroupModalError.set(null);
  }

  protected onCreateGroupModalNameInput(e: Event): void {
    this.createGroupModalName.set((e.target as HTMLInputElement).value);
  }

  protected onCreateGroupModalDescriptionInput(e: Event): void {
    this.createGroupModalDescription.set((e.target as HTMLTextAreaElement).value);
  }

  protected submitCreateGroupModal(): void {
    const pid = this.selectedProjectId();
    if (!pid || this.createGroupModalBusy()) return;
    const name = this.createGroupModalName().trim();
    const description = this.createGroupModalDescription().trim();
    if (!name) {
      this.createGroupModalError.set('Tên nhóm là bắt buộc.');
      return;
    }
    this.createGroupModalBusy.set(true);
    this.createGroupModalError.set(null);
    this.http
      .post<{ ok: boolean; error?: string }>(`${QC_API_BASE_URL}/api/projects/${pid}/groups`, {
        name,
        description,
      })
      .subscribe({
        next: (body) => {
          this.createGroupModalBusy.set(false);
          if (!body.ok) {
            this.createGroupModalError.set(body.error ?? 'Tạo nhóm thất bại');
            return;
          }
          this.closeCreateGroupModal();
          this.loadProjectGroups(pid, { preserveSelection: true });
        },
        error: (e: HttpErrorResponse) => {
          this.createGroupModalBusy.set(false);
          this.createGroupModalError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
        },
      });
  }

  /** Select trong explorer (tab testcase): rỗng = tất cả; hoặc id nhóm. */
  protected onExplorerGroupFilterSelectChange(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    const pid = this.selectedProjectId();
    if (!v.trim()) {
      this.explorerGroupFilterId.set(v);
      this.explorerGroupFilterTcIds.set(null);
      this.explorerGroupFilterFeatureIds.set(null);
      this.explorerGroupFilterLoading.set(false);
      this.explorerGroupFilterError.set(null);
      return;
    }
    const grp = this.groups().find((x) => x.id === v);
    if (!grp || grp.canUseGroupTestScope !== true) {
      this.clearExplorerGroupScopeFilter();
      this.explorerGroupFilterError.set('Chỉ chủ dự án hoặc thành viên trong nhóm mới được lọc testcase theo nhóm đó.');
      (e.target as HTMLSelectElement).value = '';
      return;
    }
    this.explorerGroupFilterError.set(null);
    this.explorerGroupFilterId.set(v);
    if (!pid) return;
    this.applyExplorerGroupFilterFromDetail(pid, v);
  }

  private applyExplorerGroupFilterFromDetail(projectId: string, groupId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.explorerGroupFilterLoading.set(true);
    this.explorerGroupFilterError.set(null);
    this.http
      .get<
        | {
            ok: true;
            testCases?: ProjectGroupDetailTestCaseDto[];
          }
        | { ok: false; error?: string }
      >(`${QC_API_BASE_URL}/api/projects/${projectId}/groups/${groupId}/detail`)
      .subscribe({
        next: (body) => {
          this.explorerGroupFilterLoading.set(false);
          if (!body.ok) {
            this.explorerGroupFilterId.set('');
            this.explorerGroupFilterTcIds.set(null);
            this.explorerGroupFilterFeatureIds.set(null);
            this.explorerGroupFilterError.set(
              'error' in body && typeof body.error === 'string' ? body.error : 'Không tải phạm vi nhóm',
            );
            return;
          }
          const tcs = body.testCases ?? [];
          const tcIds = new Set(tcs.map((t) => t.id));
          const featureIds = new Set(
            tcs.map((t) => t.featureId).filter((x): x is string => typeof x === 'string' && Boolean(x.trim())),
          );
          this.explorerGroupFilterTcIds.set(tcIds);
          this.explorerGroupFilterFeatureIds.set(featureIds);
          for (const fid of featureIds) {
            this.ensureFeatureTestCasesLoaded(fid);
          }
          const expanded = new Set(this.explorerExpandedFeatureIds());
          for (const fid of featureIds) expanded.add(fid);
          this.explorerExpandedFeatureIds.set([...expanded]);
          const sel = this.selectedTestCaseId();
          if (sel && !tcIds.has(sel)) {
            this.selectedTestCaseId.set(null);
            this.actions.set([]);
            this.syncRunPanelToSelectedTestCase();
          }
        },
        error: (e: HttpErrorResponse) => {
          this.explorerGroupFilterLoading.set(false);
          this.explorerGroupFilterId.set('');
          this.explorerGroupFilterTcIds.set(null);
          this.explorerGroupFilterFeatureIds.set(null);
          this.explorerGroupFilterError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng',
          );
        },
      });
  }

  protected onGroupEditorNameInput(e: Event): void {
    this.groupEditorName.set((e.target as HTMLInputElement).value);
  }

  protected onGroupEditorDescriptionInput(e: Event): void {
    this.groupEditorDescription.set((e.target as HTMLTextAreaElement).value);
  }

  protected saveGroupEdits(): void {
    const pid = this.selectedProjectId();
    const gid = this.selectedGroupId();
    if (!pid || !gid || this.groupEditorBusy()) return;
    const name = this.groupEditorName().trim();
    const description = this.groupEditorDescription().trim();
    if (!name) {
      this.groupsError.set('Tên nhóm là bắt buộc.');
      return;
    }
    this.groupEditorBusy.set(true);
    this.groupsError.set(null);
    this.http
      .put<{ ok: boolean; group?: unknown; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${pid}/groups/${gid}`,
        { name, description },
      )
      .subscribe({
        next: (body) => {
          this.groupEditorBusy.set(false);
          if (!body.ok) {
            this.groupsError.set(body.error ?? 'Cập nhật nhóm thất bại');
            return;
          }
          this.loadProjectGroups(pid, { preserveSelection: true });
        },
        error: (e: HttpErrorResponse) => {
          this.groupEditorBusy.set(false);
          this.groupsError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
        },
      });
  }

  protected deleteSelectedGroup(): void {
    const pid = this.selectedProjectId();
    const gid = this.selectedGroupId();
    if (!pid || !gid || this.groupEditorBusy()) return;
    if (!confirm('Xóa nhóm này? Các phân công và thành viên trong nhóm sẽ bị gỡ.')) return;
    this.groupEditorBusy.set(true);
    this.http.delete<{ ok: boolean; error?: string }>(`${QC_API_BASE_URL}/api/projects/${pid}/groups/${gid}`).subscribe({
      next: (body) => {
        this.groupEditorBusy.set(false);
        if (!body.ok) {
          this.groupsError.set(body.error ?? 'Xóa nhóm thất bại');
          return;
        }
        if (this.explorerGroupFilterId() === gid) {
          this.explorerGroupFilterId.set('');
          this.explorerGroupFilterTcIds.set(null);
          this.explorerGroupFilterFeatureIds.set(null);
          this.explorerGroupFilterLoading.set(false);
          this.explorerGroupFilterError.set(null);
        }
        this.clearGroupSelection();
        this.loadProjectGroups(pid);
      },
      error: (e: HttpErrorResponse) => {
        this.groupEditorBusy.set(false);
        this.groupsError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
      },
    });
  }

  protected onGroupMemberSelectUserId(e: Event): void {
    this.groupMemberSelectedUserId.set((e.target as HTMLSelectElement).value);
  }

  protected addGroupMember(): void {
    const pid = this.selectedProjectId();
    const gid = this.selectedGroupId();
    if (!pid || !gid || this.groupMemberBusy()) return;
    const userId = this.groupMemberSelectedUserId().trim();
    if (!userId) return;
    this.groupMemberBusy.set(true);
    this.groupMembersError.set(null);
    this.http
      .post<{ ok: boolean; error?: string }>(`${QC_API_BASE_URL}/api/projects/${pid}/groups/${gid}/members`, { userId })
      .subscribe({
        next: (body) => {
          this.groupMemberBusy.set(false);
          if (!body.ok) {
            this.groupMembersError.set(body.error ?? 'Thêm thành viên thất bại');
            return;
          }
          this.groupMemberSelectedUserId.set('');
          this.loadGroupMembers(pid, gid);
          this.loadGroupDetail(pid, gid);
          this.loadProjectGroups(pid, { preserveSelection: true });
        },
        error: (e: HttpErrorResponse) => {
          this.groupMemberBusy.set(false);
          this.groupMembersError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
        },
      });
  }

  protected removeGroupMember(userId: string): void {
    const pid = this.selectedProjectId();
    const gid = this.selectedGroupId();
    if (!pid || !gid || this.groupMemberBusy()) return;
    if (!confirm('Gỡ thành viên khỏi nhóm?')) return;
    this.groupMemberBusy.set(true);
    this.http
      .delete<{ ok: boolean; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${pid}/groups/${gid}/members/${userId}`,
      )
      .subscribe({
        next: (body) => {
          this.groupMemberBusy.set(false);
          if (!body.ok) {
            this.groupMembersError.set(body.error ?? 'Gỡ thành viên thất bại');
            return;
          }
          this.loadGroupMembers(pid, gid);
          this.loadGroupDetail(pid, gid);
          this.loadProjectGroups(pid, { preserveSelection: true });
        },
        error: (e: HttpErrorResponse) => {
          this.groupMemberBusy.set(false);
          this.groupMembersError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
        },
      });
  }

  protected toggleAssignedFeature(id: string): void {
    const set = new Set(this.groupAssignedFeatureIds());
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.groupAssignedFeatureIds.set(set);
  }

  protected toggleAssignedTestCase(id: string): void {
    const set = new Set(this.groupAssignedTestCaseIds());
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.groupAssignedTestCaseIds.set(set);
  }

  protected saveGroupAssignments(): void {
    const pid = this.selectedProjectId();
    const gid = this.selectedGroupId();
    if (!pid || !gid || this.groupAssignmentsBusy()) return;
    const dto = this.groupAssignments();
    if (!dto?.canManage) return;
    this.groupAssignmentsBusy.set(true);
    this.groupAssignmentsError.set(null);
    this.http
      .put<{ ok: boolean; error?: string }>(`${QC_API_BASE_URL}/api/projects/${pid}/groups/${gid}/assignments`, {
        featureIds: [...this.groupAssignedFeatureIds()],
        testCaseIds: [...this.groupAssignedTestCaseIds()],
      })
      .subscribe({
        next: (body) => {
          this.groupAssignmentsBusy.set(false);
          if (!body.ok) {
            this.groupAssignmentsError.set(body.error ?? 'Lưu phân công thất bại');
            return;
          }
          this.loadGroupAssignments(pid, gid);
          this.loadGroupDetail(pid, gid);
          this.loadGroupRuns(pid, gid, false);
          this.loadProjectGroups(pid, { preserveSelection: true });
        },
        error: (e: HttpErrorResponse) => {
          this.groupAssignmentsBusy.set(false);
          this.groupAssignmentsError.set(typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng');
        },
      });
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

  private startActiveRunsPolling(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.stopActiveRunsPolling();
    this.activeRunsPollTimer = setInterval(() => {
      if (this.currentSidebarSection() !== 'runningtests') {
        this.stopActiveRunsPolling();
        return;
      }
      this.loadActiveRuns(false);
    }, 2000);
  }

  private stopActiveRunsPolling(): void {
    if (this.activeRunsPollTimer != null) {
      clearInterval(this.activeRunsPollTimer);
      this.activeRunsPollTimer = null;
    }
  }

  protected loadActiveRuns(showLoading = true): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (showLoading) this.activeRunsLoading.set(true);
    this.activeRunsError.set(null);
    this.http
      .get<{ ok: boolean; runs?: ActiveRunRowDto[]; error?: string }>(`${QC_API_BASE_URL}/api/runs/active`)
      .subscribe({
        next: (body) => {
          if (showLoading) this.activeRunsLoading.set(false);
          if (!body.ok || !body.runs) {
            this.activeRunsError.set(body.error ?? 'Không tải được danh sách');
            this.activeRuns.set([]);
            return;
          }
          this.activeRuns.set(body.runs);
        },
        error: (e: HttpErrorResponse) => {
          if (showLoading) this.activeRunsLoading.set(false);
          this.activeRunsError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng',
          );
          this.activeRuns.set([]);
        },
      });
  }

  protected cancelServerActiveRun(testCaseId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.http
      .post<{ ok: boolean; error?: string }>(`${QC_API_BASE_URL}/api/test-cases/${testCaseId}/run/cancel`, {})
      .subscribe({
        next: (body) => {
          if (!body.ok) {
            this.activeRunsError.set(body.error ?? 'Không dừng được');
            return;
          }
          this.loadActiveRuns(false);
        },
        error: (e: HttpErrorResponse) => {
          this.activeRunsError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi mạng',
          );
        },
      });
  }

  protected cancelCurrentTestRun(): void {
    const id = this.selectedTestCaseId();
    if (!id) return;
    this.cancelServerActiveRun(id);
  }

  protected activeRunProgressPercent(row: ActiveRunRowDto): number {
    const t = row.progress.totalSteps;
    if (t <= 0) return 0;
    if (row.progress.stepOrdinal <= 0) return 0;
    return Math.min(100, Math.round((row.progress.stepOrdinal / t) * 100));
  }

  protected activeRunStepLine(row: ActiveRunRowDto): string {
    const p = row.progress;
    if (p.totalSteps <= 0) return '—';
    if (p.stepOrdinal <= 0) return `Khởi động · ${p.totalSteps} bước`;
    const name = p.stepName?.trim() ? p.stepName : this.kindLabel(p.stepKind);
    return `${p.stepOrdinal}/${p.totalSteps} · ${name}`;
  }

  protected activeRunBreadcrumb(row: ActiveRunRowDto): string {
    const parts = [row.projectName, row.featureName, row.testCaseName].filter(Boolean);
    return parts.length ? parts.join(' · ') : row.testCaseId;
  }

  protected openActiveRunInEditor(row: ActiveRunRowDto): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const pid = row.projectId?.trim();
    const fid = row.featureId?.trim();
    const tcid = row.testCaseId?.trim();
    if (!pid || !fid || !tcid) return;
    this.currentSidebarSection.set('testcase');
    if (this.selectedProjectId() !== pid) {
      this.selectedProjectId.set(pid);
      this.selectedFeatureId.set(null);
      this.testCases.set([]);
      this.actions.set([]);
      this.testCasesByFeature.set({});
      this.loadProjectMembers(pid);
    }
    this.http
      .get<{ ok: boolean; features?: FeatureDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${pid}/features`,
      )
      .subscribe({
        next: (body) => {
          if (!body.ok || !body.features) return;
          this.features.set(body.features);
          this.selectedFeatureId.set(fid);
          this.loadTestCases(pid, fid, { selectTestCaseId: tcid });
        },
        error: (e: HttpErrorResponse) =>
          this.actionsError.set(
            typeof e.error?.error === 'string' ? e.error.error : e.message ?? 'Lỗi tải feature',
          ),
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
    let list = this.features();
    const scopeFids = this.explorerGroupFilterFeatureIds();
    if (scopeFids !== null && scopeFids.size > 0) {
      list = list.filter((f) => scopeFids.has(f.id));
    } else if (scopeFids !== null && scopeFids.size === 0) {
      list = [];
    }
    const byFeature = this.testCasesByFeature();
    if (!q) return list;
    return list.filter((f) => {
      const hay = `${f.key ?? ''} ${f.name} ${f.description ?? ''}`.toLowerCase();
      if (hay.includes(q)) return true;
      const tcs = byFeature[f.id] ?? [];
      const allowed = this.explorerGroupFilterTcIds();
      return tcs.some((tc) => {
        if (tc.isOperationPackage) return false;
        if (allowed && !allowed.has(tc.id)) return false;
        return `${tc.key ?? ''} ${tc.id} ${tc.name} ${tc.description ?? ''}`.toLowerCase().includes(q);
      });
    });
  }

  protected explorerTestCasesForFeature(featureId: string): TestCaseDto[] {
    const q = this.explorerQuery().trim().toLowerCase();
    const allowed = this.explorerGroupFilterTcIds();
    let list = this.testCasesByFeature()[featureId] ?? [];
    list = list.filter((tc) => !tc.isOperationPackage);
    if (allowed !== null) {
      list = list.filter((tc) => allowed.has(tc.id));
    }
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

  /** Test case đang mở (từ cache explorer / danh sách hiện tại; có fallback gói thao tác). */
  protected selectedTestCase(): TestCaseDto | null {
    const id = this.selectedTestCaseId();
    if (!id) return null;
    return (
      this.findTestCaseById(id) ??
      this.testCases().find((x) => x.id === id) ??
      ((): TestCaseDto | null => {
        const row = this.operationPackages().find((p) => p.id === id);
        if (!row) return null;
        return {
          id: row.id,
          featureId: row.featureId,
          key: row.key,
          name: row.name,
          description: row.description,
          status: 'active',
          priority: 'medium',
          isOperationPackage: true,
          packedAt: row.packedAt ?? null,
          packedByUsername: row.packedByUsername ?? null,
          packedFromTestCaseId: row.packedFromTestCaseId ?? null,
        };
      })()
    );
  }

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
    if (!id) return '—';
    const tc =
      this.findTestCaseById(id) ??
      this.testCases().find((x) => x.id === id) ??
      ((): TestCaseDto | null => {
        const row = this.operationPackages().find((p) => p.id === id);
        if (!row) return null;
        return {
          id: row.id,
          featureId: row.featureId,
          key: row.key,
          name: row.name,
          description: row.description,
          status: 'active',
          priority: 'medium',
          isOperationPackage: true,
        };
      })();
    if (!tc) return id;
    return `${tc.key ?? tc.id} - ${tc.name}`;
  }

  /** Nhãn ổn định khi bắt đầu chạy (trước khi đổi testcase). */
  private labelSnapshotForTestCaseId(testCaseId: string): string {
    const fromCache = this.findTestCaseById(testCaseId);
    const tc =
      fromCache ??
      this.testCases().find((x) => x.id === testCaseId) ??
      ((): TestCaseDto | null => {
        const row = this.operationPackages().find((p) => p.id === testCaseId);
        if (!row) return null;
        return {
          id: row.id,
          featureId: row.featureId,
          key: row.key,
          name: row.name,
          description: row.description,
          status: 'active',
          priority: 'medium',
          isOperationPackage: true,
        };
      })();
    if (!tc) return testCaseId;
    return `${tc.key ?? tc.id} - ${tc.name}`;
  }

  private addManualRunTc(testCaseId: string): void {
    this.manualRunInFlightTcIds.update((s) => new Set(s).add(testCaseId));
  }

  private removeManualRunTc(testCaseId: string): void {
    this.manualRunInFlightTcIds.update((s) => {
      const n = new Set(s);
      n.delete(testCaseId);
      return n;
    });
  }

  protected manualRunInFlightForTestCase(testCaseId: string): boolean {
    return this.manualRunInFlightTcIds().has(testCaseId);
  }

  /** Panel phải hiển thị trạng thái «đang chạy» cho testcase đang mở. */
  protected runPanelBusyForSelectedTestCase(): boolean {
    const id = this.selectedTestCaseId();
    if (!id) return false;
    if (this.manualRunInFlightForTestCase(id)) return true;
    return this.batchRunningJob()?.testCaseId === id;
  }

  protected runTestButtonDisabledForSelected(): boolean {
    const id = this.selectedTestCaseId();
    if (!id) return true;
    if (this.manualRunInFlightForTestCase(id)) return true;
    if (this.batchRunningJob()?.testCaseId === id) return true;
    return false;
  }

  /** Nút Dừng trên toolbar: chỉ khi đúng TC đang chạy (thủ công hoặc lô). */
  protected showToolbarStopForSelectedTestCase(): boolean {
    const id = this.selectedTestCaseId();
    if (!id) return false;
    if (this.manualRunInFlightForTestCase(id)) return true;
    return this.batchRunningJob()?.testCaseId === id;
  }

  protected floatingManualRunProgressVisible(): boolean {
    const id = this.selectedTestCaseId();
    return Boolean(id && this.manualRunInFlightForTestCase(id));
  }

  /** Ẩn panel phải ở THỰC THI / BÁO CÁO / CẤU HÌNH (giữ layout bằng invisible). */
  protected rightRunPanelVisible(): boolean {
    const s = this.currentSidebarSection();
    // THỰC THI
    if (s === 'runningtests' || s === 'runhistory' || s === 'schedules') return false;
    // BÁO CÁO
    if (s === 'reports') return false;
    // CẤU HÌNH
    if (s === 'settings' || s === 'members' || s === 'groups') return false;
    if (s === 'operationpackages') return false;
    if (s === 'documentation') return false;
    return true;
  }

  /** Có POST /run thủ công đang chờ trên testcase khác với ô đang mở. */
  protected manualRunInFlightOnAnotherTestCase(): boolean {
    const sel = this.selectedTestCaseId();
    const set = this.manualRunInFlightTcIds();
    if (set.size === 0) return false;
    if (!sel) return true;
    return [...set].some((id) => id !== sel);
  }

  /** Gọi khi `selectedTestCaseId` đổi sang giá trị khác (hoặc về null). */
  private syncRunPanelToSelectedTestCase(): void {
    const sel = this.selectedTestCaseId();
    if (!sel) {
      this.runResult.set(null);
      this.runError.set(null);
      return;
    }
    const r = this.runResult();
    if (r && r.testCaseId !== sel) {
      this.runResult.set(null);
      this.runError.set(null);
      return;
    }
    if (!r) {
      this.runError.set(null);
    }
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
    const ids = [...new Set(this.batchSelectedTcIds())].filter(
      (id) => !this.manualRunInFlightForTestCase(id),
    );
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
      .post<{
        ok: boolean;
        result?: RunResultDto;
        error?: string;
        cancelled?: boolean;
      }>(`${QC_API_BASE_URL}/api/test-cases/${job.testCaseId}/run`, {})
      .subscribe({
        next: (body) => {
          const cancelled = Boolean(body.cancelled || body.result?.cancelled);
          const failed =
            !body.result ||
            (!cancelled &&
              (body.result.overallStatus === 'failed' || body.result.ok === false));
          const errMsg = cancelled
            ? (body.result?.error ?? 'Đã dừng')
            : failed
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
                    status: cancelled
                      ? ('cancelled' as const)
                      : failed
                        ? ('error' as const)
                        : ('done' as const),
                    errorMessage: failed || cancelled ? errMsg : undefined,
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
            this.loadRunHistory();
          }

          this.enqueueRunToast(
            job.testCaseId,
            job.testCaseLabel,
            !failed && !cancelled,
            failed || cancelled ? errMsg : undefined,
          );
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
    const done = jobs.filter(
      (j) => j.status === 'done' || j.status === 'error' || j.status === 'cancelled',
    ).length;
    return Math.round((done / jobs.length) * 100);
  }

  protected batchSummaryLine(): string {
    const jobs = this.batchJobs();
    const n = jobs.length;
    const done = jobs.filter(
      (j) => j.status === 'done' || j.status === 'error' || j.status === 'cancelled',
    ).length;
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
    return this.batchJobs().some(
      (j) => j.status === 'done' || j.status === 'error' || j.status === 'cancelled',
    );
  }

  protected batchDismissPanelDisabled(): boolean {
    return this.batchRunnerBusy() || this.batchJobs().some((j) => j.status === 'queued' || j.status === 'running');
  }

  protected kindLabel(kind: ActionKind): string {
    const m: Record<ActionKind, string> = {
      navigate: 'Navigate',
      click_selector: 'Click (selector)',
      click_text: 'Click (theo chữ)',
      click_id: 'Click (theo id)',
      click_name: 'Click (theo name)',
      click_xpath: 'Click (XPath)',
      type: 'Gõ text',
      type_id: 'Gõ text (theo id)',
      type_name: 'Gõ text (theo name)',
      type_xpath: 'Gõ text (XPath)',
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
      case 'click_id':
        return `id: ${a.config.id ?? '—'}`;
      case 'click_name':
        return `name: ${a.config.name ?? '—'}`;
      case 'click_xpath':
        return a.config.xpath ?? '—';
      case 'type':
        return `Sel: ${a.config.selector ?? '—'} → "${a.config.value ?? ''}"`;
      case 'type_id':
        return `id: ${a.config.id ?? '—'} → "${a.config.value ?? ''}"`;
      case 'type_name':
        return `name: ${a.config.name ?? '—'} → "${a.config.value ?? ''}"`;
      case 'type_xpath':
        return `XPath: ${a.config.xpath ?? '—'} → "${a.config.value ?? ''}"`;
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
                `Không kết nối được máy chủ API (đảm bảo qc-api đang chạy và cấu hình proxy đúng cổng).`;
          this.aiError.set(msg);
        },
      });
  }

  protected setAiAssistantTab(tab: 'chat' | 'design'): void {
    this.aiAssistantTab.set(tab);
  }

  protected onAiDesignPromptInput(e: Event): void {
    this.aiDesignPrompt.set((e.target as HTMLTextAreaElement).value);
  }

  protected onAiDesignContextExtraInput(e: Event): void {
    this.aiDesignContextExtra.set((e.target as HTMLTextAreaElement).value);
  }

  protected setAiDesignQuickPrompt(text: string): void {
    this.aiDesignPrompt.set(text);
    this.aiDesignError.set(null);
  }

  /** Ngữ cảnh gửi kèm khi thiết kế: ghi chú người dùng + (nếu có) testcase/bước hiện tại. */
  protected buildAiDesignContext(): string {
    const parts: string[] = [];
    const extra = this.aiDesignContextExtra().trim();
    if (extra) {
      parts.push(extra);
    }
    if (this.selectedTestCaseId()) {
      parts.push(this.buildTestCaseContext());
    }
    return parts.join('\n\n---\n');
  }

  protected patchAiDesignTestCase(
    field: 'id' | 'name' | 'key' | 'description' | 'priority' | 'status',
    raw: string,
  ): void {
    const d = this.aiDesignDraft();
    if (!d) {
      return;
    }
    const t = { ...d.testCase };
    const v = raw.trim();
    if (field === 'id') {
      t.id = v
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 120);
    } else if (field === 'key') {
      t.key = v.length ? v : null;
    } else {
      (t as Record<string, string>)[field] = v;
    }
    this.aiDesignDraft.set({ ...d, testCase: t });
  }

  protected clearAiDesignDraft(): void {
    this.aiDesignDraft.set(null);
    this.aiDesignWarnings.set([]);
    this.aiDesignModel.set(null);
  }

  /** Xem trước: gọi Gemini, nhận JSON — chưa ghi DB. */
  protected previewAiTestCaseDesign(): void {
    if (!isPlatformBrowser(this.platformId) || this.aiDesignLoading()) {
      return;
    }
    const projectId = this.selectedProjectId();
    const featureId = this.selectedFeatureId();
    const prompt = this.aiDesignPrompt().trim();
    if (!projectId || !featureId) {
      this.aiDesignError.set('Chọn dự án và feature trước khi thiết kế testcase.');
      return;
    }
    if (!prompt) {
      this.aiDesignError.set('Nhập mô tả / prompt cho testcase.');
      return;
    }
    this.aiDesignLoading.set(true);
    this.aiDesignError.set(null);
    this.clearAiDesignDraft();

    this.http
      .post<AiTestCaseFromPromptResponse>(
        `${QC_API_BASE_URL}/api/projects/${projectId}/features/${featureId}/ai/test-case-from-prompt`,
        { mode: 'preview', prompt, context: this.buildAiDesignContext() },
      )
      .subscribe({
        next: (body) => {
          this.aiDesignLoading.set(false);
          if (!body.ok) {
            this.aiDesignError.set(body.error ?? 'Xem trước thất bại');
            return;
          }
          if (body.mode !== 'preview') {
            this.aiDesignError.set('Phản hồi không hợp lệ');
            return;
          }
          this.aiDesignDraft.set(body.draft);
          this.aiDesignWarnings.set(body.warnings ?? []);
          this.aiDesignModel.set(body.model ?? null);
        },
        error: (err: HttpErrorResponse) => {
          this.aiDesignLoading.set(false);
          const payload = err.error as { error?: string } | undefined;
          this.aiDesignError.set(
            typeof payload?.error === 'string'
              ? payload.error
              : err.message || 'Lỗi khi gọi API thiết kế testcase',
          );
        },
      });
  }

  /** Áp dụng bản nháp hiện tại vào DB (tạo testcase mới hoặc chỉ thêm bước). */
  protected applyAiTestCaseDesign(): void {
    if (!isPlatformBrowser(this.platformId) || this.aiDesignApplyLoading()) {
      return;
    }
    const projectId = this.selectedProjectId();
    const featureId = this.selectedFeatureId();
    const draft = this.aiDesignDraft();
    if (!projectId || !featureId) {
      this.aiDesignError.set('Chọn dự án và feature.');
      return;
    }
    if (!draft) {
      this.aiDesignError.set('Chưa có bản nháp — bấm «Xem trước» trước.');
      return;
    }
    const append = this.aiDesignAppendOnly();
    const selTc = this.selectedTestCaseId();
    if (append && !selTc) {
      this.aiDesignError.set('Bật «Chỉ thêm bước» cần đang chọn một testcase.');
      return;
    }

    this.aiDesignApplyLoading.set(true);
    this.aiDesignError.set(null);

    const body: Record<string, unknown> = {
      mode: 'apply',
      draft,
    };
    if (append && selTc) {
      body['appendToTestCaseId'] = selTc;
    }

    this.http
      .post<AiTestCaseFromPromptResponse>(
        `${QC_API_BASE_URL}/api/projects/${projectId}/features/${featureId}/ai/test-case-from-prompt`,
        body,
      )
      .subscribe({
        next: (resp) => {
          this.aiDesignApplyLoading.set(false);
          if (!resp.ok) {
            this.aiDesignError.set(resp.error ?? 'Áp dụng thất bại');
            return;
          }
          if ('appendToTestCaseId' in resp && resp.appendToTestCaseId) {
            this.loadActions();
            this.clearAiDesignDraft();
            this.aiDesignPrompt.set('');
            return;
          }
          if ('testCase' in resp && resp.testCase?.id) {
            const newId = resp.testCase.id;
            this.loadTestCases(projectId, featureId, { selectTestCaseId: newId });
            this.clearAiDesignDraft();
            this.aiDesignPrompt.set('');
          }
        },
        error: (err: HttpErrorResponse) => {
          this.aiDesignApplyLoading.set(false);
          const payload = err.error as { error?: string } | undefined;
          this.aiDesignError.set(
            typeof payload?.error === 'string'
              ? payload.error
              : err.message || 'Lỗi áp dụng testcase',
          );
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
            this.aiFillError.set(body.error ?? 'Gợi ý điền thất bại');
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
              : err.message || 'Lỗi khi gọi gợi ý điền',
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
      this.testCasePrerequisites.set([]);
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

  /** Testcase / gói mà các API `actions` đang thao tác — khi modal sửa gói mở thì là id gói. */
  protected effectiveActionsParentTestCaseId(): string | null {
    if (this.operationPackageEditModalOpen() && this.packageEditorTestCaseId()) {
      return this.packageEditorTestCaseId();
    }
    return this.selectedTestCaseId();
  }

  private setActionsMutationError(msg: string): void {
    if (this.operationPackageEditModalOpen()) {
      this.operationPackageEditActionsError.set(msg);
    } else {
      this.actionsError.set(msg);
    }
  }

  private refreshActionsAfterMutation(): void {
    if (this.operationPackageEditModalOpen() && this.packageEditorTestCaseId()) {
      this.loadOperationPackageEditorActions();
      return;
    }
    this.loadActions();
  }

  private loadOperationPackageEditorActions(): void {
    const testCaseId = this.packageEditorTestCaseId();
    if (!testCaseId) {
      this.operationPackageEditActions.set([]);
      return;
    }
    this.http
      .get<{ ok: boolean; actions?: TestActionDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/actions`,
      )
      .subscribe({
        next: (body) => {
          if (body.ok && body.actions) {
            this.operationPackageEditActions.set(
              [...body.actions].sort((a, b) => a.order - b.order),
            );
          } else {
            this.operationPackageEditActionsError.set(body.error ?? 'Không tải được bước');
          }
        },
        error: (err: HttpErrorResponse) => {
          this.operationPackageEditActionsError.set(
            err.message || 'Lỗi mạng khi tải bước',
          );
        },
      });
  }

  protected loadTestCasePrerequisitesDetail(): void {
    const testCaseId = this.selectedTestCaseId();
    const featureId = this.selectedFeatureId();
    const projectId = this.selectedProjectId();
    if (!testCaseId || !featureId || !projectId) {
      this.testCasePrerequisites.set([]);
      this.testCasePrerequisitesError.set(null);
      return;
    }
    this.testCasePrerequisitesError.set(null);
    this.http
      .get<{
        ok: boolean;
        prerequisites?: PrerequisiteEntryDto[];
        error?: string;
      }>(
        `${QC_API_BASE_URL}/api/projects/${projectId}/features/${featureId}/test-cases/${testCaseId}`,
      )
      .subscribe({
        next: (body) => {
          if (body.ok && Array.isArray(body.prerequisites)) {
            this.testCasePrerequisites.set(body.prerequisites);
          } else {
            this.testCasePrerequisites.set([]);
            if (!body.ok && body.error) {
              this.testCasePrerequisitesError.set(body.error);
            }
          }
        },
        error: (err: HttpErrorResponse) => {
          this.testCasePrerequisites.set([]);
          this.testCasePrerequisitesError.set(err.message || 'Không tải được gói tiên quyết');
        },
      });
  }

  protected sortedPrerequisites(): PrerequisiteEntryDto[] {
    return [...this.testCasePrerequisites()].sort((a, b) => a.order - b.order);
  }

  protected openPrerequisitePicker(): void {
    if (!this.selectedTestCaseId()) return;
    this.prerequisitePickerOpen.set(true);
    this.loadSchedulePickerTestCases();
  }

  protected closePrerequisitePicker(): void {
    this.prerequisitePickerOpen.set(false);
  }

  protected pickPrerequisite(tc: SchedulePickerTcDto): void {
    const sel = this.selectedTestCaseId();
    if (!sel || tc.id === sel) return;
    const cur = this.sortedPrerequisites();
    if (cur.some((p) => p.testCaseId === tc.id)) return;
    const next = this.reindexPrerequisiteOrders([
      ...cur,
      {
        testCaseId: tc.id,
        order: cur.length,
        name: tc.testCaseName,
        key: null,
        featureId: tc.featureId,
        featureName: tc.featureName,
      },
    ]);
    this.testCasePrerequisites.set(next);
  }

  protected removePrerequisite(testCaseId: string): void {
    const next = this.reindexPrerequisiteOrders(
      this.sortedPrerequisites().filter((p) => p.testCaseId !== testCaseId),
    );
    this.testCasePrerequisites.set(next);
  }

  protected isPrerequisiteAlreadyListed(testCaseId: string): boolean {
    return this.sortedPrerequisites().some((p) => p.testCaseId === testCaseId);
  }

  protected movePrerequisite(testCaseId: string, delta: number): void {
    const list = this.sortedPrerequisites();
    const i = list.findIndex((p) => p.testCaseId === testCaseId);
    if (i < 0) return;
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    const swap = [...list];
    const t = swap[i]!;
    swap[i] = swap[j]!;
    swap[j] = t;
    this.testCasePrerequisites.set(this.reindexPrerequisiteOrders(swap));
  }

  private reindexPrerequisiteOrders(list: PrerequisiteEntryDto[]): PrerequisiteEntryDto[] {
    return list.map((p, idx) => ({ ...p, order: idx }));
  }

  protected savePrerequisitesToServer(): void {
    const projectId = this.selectedProjectId();
    const featureId = this.selectedFeatureId();
    const testCaseId = this.selectedTestCaseId();
    if (!projectId || !featureId || !testCaseId) return;
    const ids = this.sortedPrerequisites().map((p) => p.testCaseId);
    this.testCasePrerequisitesSaving.set(true);
    this.testCasePrerequisitesError.set(null);
    this.http
      .put<{ ok: boolean; prerequisites?: PrerequisiteEntryDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${projectId}/features/${featureId}/test-cases/${testCaseId}/prerequisites`,
        { prerequisiteTestCaseIds: ids },
      )
      .subscribe({
        next: (body) => {
          this.testCasePrerequisitesSaving.set(false);
          if (body.ok && body.prerequisites) {
            this.testCasePrerequisites.set(body.prerequisites);
          } else {
            this.testCasePrerequisitesError.set(body.error ?? 'Lưu thất bại');
          }
        },
        error: (err: HttpErrorResponse) => {
          this.testCasePrerequisitesSaving.set(false);
          this.testCasePrerequisitesError.set(
            typeof err.error?.error === 'string' ? err.error.error : err.message || 'Lỗi mạng',
          );
        },
      });
  }

  protected loadOperationPackages(projectId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.operationPackagesLoading.set(true);
    this.operationPackagesError.set(null);
    this.http
      .get<{ ok: boolean; packages?: OperationPackageRowDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${projectId}/operation-packages`,
      )
      .subscribe({
        next: (body) => {
          this.operationPackagesLoading.set(false);
          if (!body.ok || !body.packages) {
            this.operationPackagesError.set(body.error ?? 'Không tải được danh sách');
            this.operationPackages.set([]);
            return;
          }
          this.operationPackages.set(body.packages);
        },
        error: (e: HttpErrorResponse) => {
          this.operationPackagesLoading.set(false);
          this.operationPackages.set([]);
          this.operationPackagesError.set(e.message || 'Lỗi mạng');
        },
      });
  }

  protected openOperationPackageFromTestCase(): void {
    const tcId = this.selectedTestCaseId();
    if (!tcId) return;
    let tc = this.findTestCaseById(tcId);
    if (!tc) {
      tc = {
        id: tcId,
        featureId: this.selectedFeatureId(),
        key: null,
        name: this.selectedTestCaseLabel(),
        description: '',
        status: 'active',
        priority: 'medium',
      };
    }
    this.operationPackageFormName.set(`${tc.name} — Gói thao tác`);
    this.operationPackageFormDescription.set(
      tc.description?.trim()
        ? `Đóng gói từ: ${tc.description.trim()}`
        : `Gói thao tác tách từ testcase «${tc.name}».`,
    );
    this.operationPackageFormTargetFeatureId.set(this.selectedFeatureId() ?? '');
    this.operationPackageError.set(null);
    this.operationPackageModalOpen.set(true);
  }

  protected closeOperationPackageModal(): void {
    this.operationPackageModalOpen.set(false);
    this.operationPackageSaving.set(false);
  }

  protected submitOperationPackage(): void {
    const projectId = this.selectedProjectId();
    const featureId = this.selectedFeatureId();
    const sourceId = this.selectedTestCaseId();
    if (!projectId || !featureId || !sourceId) return;
    const name = this.operationPackageFormName().trim();
    const description = this.operationPackageFormDescription().trim();
    const targetFeatureId = this.operationPackageFormTargetFeatureId().trim() || featureId;
    if (!name) {
      this.operationPackageError.set('Cần tên cho gói thao tác.');
      return;
    }
    this.operationPackageSaving.set(true);
    this.operationPackageError.set(null);
    this.http
      .post<{
        ok: boolean;
        testCase?: TestCaseDto;
        actionsCopied?: number;
        error?: string;
      }>(
        `${QC_API_BASE_URL}/api/projects/${projectId}/features/${featureId}/test-cases/${sourceId}/operation-package`,
        {
          name,
          description,
          targetFeatureId,
        },
      )
      .subscribe({
        next: (body) => {
          this.operationPackageSaving.set(false);
          if (!body.ok) {
            this.operationPackageError.set(body.error ?? 'Tạo gói thất bại');
            return;
          }
          this.closeOperationPackageModal();
          this.invalidateFeatureTestCasesCache(targetFeatureId);
          this.ensureFeatureTestCasesLoaded(targetFeatureId);
          if (this.currentSidebarSection() === 'operationpackages') {
            this.loadOperationPackages(projectId);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.operationPackageSaving.set(false);
          this.operationPackageError.set(
            typeof err.error?.error === 'string' ? err.error.error : err.message || 'Lỗi mạng',
          );
        },
      });
  }

  /** Xóa cache testcase theo feature để explorer tải lại danh sách. */
  private invalidateFeatureTestCasesCache(featureId: string): void {
    const c = { ...this.testCasesByFeature() };
    delete c[featureId];
    this.testCasesByFeature.set(c);
  }

  protected openOperationPackageEditor(pkg: OperationPackageRowDto): void {
    const projectId = this.selectedProjectId();
    if (!isPlatformBrowser(this.platformId) || !projectId) return;

    this.closeMenu();
    this.packageEditorTestCaseId.set(pkg.id);
    this.operationPackageEditFeatureId.set(pkg.featureId);
    this.operationPackageEditName.set(pkg.name);
    this.operationPackageEditDescription.set(pkg.description ?? '');
    this.operationPackageEditModalOpen.set(true);
    this.operationPackageEditError.set(null);
    this.operationPackageEditActionsError.set(null);
    this.operationPackageEditLoading.set(true);
    this.operationPackageEditActions.set([]);

    const detailUrl = `${QC_API_BASE_URL}/api/projects/${projectId}/features/${pkg.featureId}/test-cases/${pkg.id}`;
    const actionsUrl = `${QC_API_BASE_URL}/api/test-cases/${pkg.id}/actions`;

    forkJoin({
      detail: this.http.get<{ ok: boolean; testCase?: TestCaseDto; error?: string }>(detailUrl),
      actions: this.http.get<{ ok: boolean; actions?: TestActionDto[]; error?: string }>(
        actionsUrl,
      ),
    }).subscribe({
      next: ({ detail, actions }) => {
        this.operationPackageEditLoading.set(false);
        if (detail.ok && detail.testCase) {
          const tc = detail.testCase;
          this.operationPackageEditName.set(tc.name);
          this.operationPackageEditDescription.set(tc.description ?? '');
        } else if (!detail.ok && detail.error) {
          this.operationPackageEditError.set(detail.error);
        }
        if (actions.ok && actions.actions) {
          this.operationPackageEditActions.set(
            [...actions.actions].sort((a, b) => a.order - b.order),
          );
        } else {
          this.operationPackageEditActionsError.set(
            actions.error ?? 'Không tải được bước',
          );
        }
      },
      error: (err: HttpErrorResponse) => {
        this.operationPackageEditLoading.set(false);
        this.operationPackageEditError.set(err.message || 'Lỗi mạng');
      },
    });
  }

  protected closeOperationPackageEditor(): void {
    this.operationPackageEditModalOpen.set(false);
    this.packageEditorTestCaseId.set(null);
    this.operationPackageEditFeatureId.set(null);
    this.operationPackageEditActions.set([]);
    this.operationPackageEditLoading.set(false);
    this.operationPackageEditSavingMeta.set(false);
    this.operationPackageEditError.set(null);
    this.operationPackageEditActionsError.set(null);
  }

  protected saveOperationPackageMeta(): void {
    const projectId = this.selectedProjectId();
    const featureId = this.operationPackageEditFeatureId();
    const testCaseId = this.packageEditorTestCaseId();
    if (!projectId || !featureId || !testCaseId) return;
    const name = this.operationPackageEditName().trim();
    if (!name) {
      this.operationPackageEditError.set('Cần tên hiển thị.');
      return;
    }
    this.operationPackageEditSavingMeta.set(true);
    this.operationPackageEditError.set(null);
    this.http
      .put<{ ok: boolean; testCase?: TestCaseDto; error?: string }>(
        `${QC_API_BASE_URL}/api/projects/${projectId}/features/${featureId}/test-cases/${testCaseId}`,
        {
          name,
          description: this.operationPackageEditDescription().trim(),
        },
      )
      .subscribe({
        next: (body) => {
          this.operationPackageEditSavingMeta.set(false);
          if (!body.ok) {
            this.operationPackageEditError.set(body.error ?? 'Lưu thất bại');
            return;
          }
          if (body.testCase) {
            this.operationPackageEditName.set(body.testCase.name);
            this.operationPackageEditDescription.set(body.testCase.description ?? '');
          }
          const pid = this.selectedProjectId();
          if (pid) this.loadOperationPackages(pid);
        },
        error: (err: HttpErrorResponse) => {
          this.operationPackageEditSavingMeta.set(false);
          this.operationPackageEditError.set(
            typeof err.error?.error === 'string'
              ? err.error.error
              : err.message || 'Lỗi mạng',
          );
        },
      });
  }

  protected openPackageAddStep(): void {
    if (!this.operationPackageEditModalOpen() || !this.packageEditorTestCaseId()) return;
    this.stepMenuContext.set('package');
    this.resetForm();
    this.addStepOpen.set(true);
    this.menuOpenForId.set(null);
  }

  protected menuContextActions(): TestActionDto[] {
    return this.stepMenuContext() === 'package'
      ? this.operationPackageEditActions()
      : this.actions();
  }

  protected getMenuContextAction(): TestActionDto | null {
    const id = this.menuOpenForId();
    if (!id) return null;
    return this.menuContextActions().find((a) => a.id === id) ?? null;
  }

  protected openEditStepFromMenu(): void {
    const a = this.getMenuContextAction();
    if (a) this.openEditStep(a);
  }

  protected toggleEnabledFromMenu(): void {
    const a = this.getMenuContextAction();
    if (!a) return;
    this.closeMenu();
    this.toggleEnabled(a);
  }

  protected featureNameById(featureId: string): string {
    const f = this.features().find((x) => x.id === featureId);
    return f?.name?.trim() ? f.name : featureId;
  }

  protected openAddStep(): void {
    this.stepMenuContext.set('main');
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

  protected toggleMenu(id: string, event?: MouseEvent, context: 'main' | 'package' = 'main'): void {
    this.stepMenuContext.set(context);
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

    const usePackage = this.operationPackageEditModalOpen();
    const rawList = usePackage ? this.operationPackageEditActions() : this.actions();
    const list = [...rawList].sort((a, b) => a.order - b.order);
    const fromIdx = list.findIndex((a) => a.id === fromId);
    const toIdx = list.findIndex((a) => a.id === targetActionId);
    if (fromIdx < 0 || toIdx < 0) return;

    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    const ids = list.map((a) => a.id);

    const testCaseId = this.effectiveActionsParentTestCaseId();
    if (!testCaseId) return;

    this.http
      .put<{ ok: boolean; actions?: TestActionDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/actions-order`,
        { orderedIds: ids },
      )
      .subscribe({
        next: (body) => {
          if (body.ok && body.actions) {
            const sorted = [...body.actions].sort((a, b) => a.order - b.order);
            if (usePackage) {
              this.operationPackageEditActions.set(sorted);
            } else {
              this.actions.set(sorted);
            }
          } else {
            this.setActionsMutationError(body.error ?? 'Sắp xếp thất bại');
          }
        },
        error: (e: HttpErrorResponse) =>
          this.setActionsMutationError(e.error?.error ?? e.message ?? 'Lỗi sắp xếp'),
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

  protected onFormXpathInput(e: Event): void {
    this.formXpath.set((e.target as HTMLInputElement).value);
  }

  protected onFormMatchTextInput(e: Event): void {
    this.formMatchText.set((e.target as HTMLInputElement).value);
  }

  protected onFormDomIdInput(e: Event): void {
    this.formDomId.set((e.target as HTMLInputElement).value);
  }

  protected onFormDomNameInput(e: Event): void {
    this.formDomName.set((e.target as HTMLInputElement).value);
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
    this.formXpath.set('');
    this.formMatchText.set('');
    this.formDomId.set('');
    this.formDomName.set('');
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
    this.formXpath.set(a.config.xpath ?? '');
    this.formMatchText.set(a.config.matchText ?? '');
    this.formDomId.set(a.config.id ?? '');
    this.formDomName.set(a.config.name ?? '');
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
      case 'click_id':
        return { id: this.formDomId().trim() };
      case 'click_name':
        return { name: this.formDomName().trim() };
      case 'click_xpath':
        return { xpath: this.formXpath().trim() };
      case 'type':
        return { selector: this.formSelector().trim(), value: this.formValue() };
      case 'type_id':
        return { id: this.formDomId().trim(), value: this.formValue() };
      case 'type_name':
        return { name: this.formDomName().trim(), value: this.formValue() };
      case 'type_xpath':
        return { xpath: this.formXpath().trim(), value: this.formValue() };
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
    const testCaseId = this.effectiveActionsParentTestCaseId();
    if (!testCaseId) {
      this.setActionsMutationError('Chưa chọn test case hoặc gói để gắn bước');
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
              this.refreshActionsAfterMutation();
            } else {
              this.setActionsMutationError(body.error ?? 'Cập nhật thất bại');
            }
          },
          error: (e: HttpErrorResponse) =>
            this.setActionsMutationError(e.error?.error ?? e.message ?? 'Lỗi cập nhật'),
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
            this.refreshActionsAfterMutation();
          } else {
            this.setActionsMutationError(body.error ?? 'Thêm thất bại');
          }
        },
        error: (e: HttpErrorResponse) =>
          this.setActionsMutationError(e.error?.error ?? e.message ?? 'Lỗi thêm'),
      });
  }

  protected confirmDelete(): void {
    const id = this.deleteTargetId();
    if (!id) return;
    const testCaseId = this.effectiveActionsParentTestCaseId();
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
            this.refreshActionsAfterMutation();
          } else {
            this.setActionsMutationError(body.error ?? 'Xóa thất bại');
          }
        },
        error: (e: HttpErrorResponse) =>
          this.setActionsMutationError(e.error?.error ?? e.message ?? 'Lỗi xóa'),
      });
  }

  protected toggleEnabled(a: TestActionDto): void {
    const testCaseId = this.effectiveActionsParentTestCaseId();
    if (!testCaseId) return;
    this.http
      .put<{ ok: boolean; action?: TestActionDto; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/actions/${a.id}`,
        { enabled: !a.enabled },
      )
      .subscribe({
        next: (body) => {
          if (body.ok) {
            this.refreshActionsAfterMutation();
            this.closeMenu();
          } else {
            this.setActionsMutationError(body.error ?? 'Không cập nhật được trạng thái');
          }
        },
        error: (e: HttpErrorResponse) =>
          this.setActionsMutationError(e.error?.error ?? e.message ?? 'Lỗi cập nhật trạng thái'),
      });
  }

  protected moveAction(id: string, delta: number): void {
    const testCaseId = this.effectiveActionsParentTestCaseId();
    if (!testCaseId) return;
    const usePackage = this.operationPackageEditModalOpen();
    const rawList = usePackage ? this.operationPackageEditActions() : this.actions();
    const list = [...rawList].sort((a, b) => a.order - b.order);
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
            const sorted = [...body.actions].sort((a, b) => a.order - b.order);
            if (usePackage) {
              this.operationPackageEditActions.set(sorted);
            } else {
              this.actions.set(sorted);
            }
          } else {
            this.setActionsMutationError(body.error ?? 'Sắp xếp thất bại');
          }
        },
        error: (e: HttpErrorResponse) =>
          this.setActionsMutationError(e.error?.error ?? e.message ?? 'Lỗi sắp xếp'),
      });
  }

  protected runTest(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const testCaseId = this.selectedTestCaseId();
    if (!testCaseId) {
      this.runError.set('Chưa chọn test case');
      return;
    }
    if (this.manualRunInFlightForTestCase(testCaseId)) {
      return;
    }
    if (this.batchRunningJob()?.testCaseId === testCaseId) {
      return;
    }

    const labelSnapshot = this.labelSnapshotForTestCaseId(testCaseId);
    this.addManualRunTc(testCaseId);
    if (this.selectedTestCaseId() === testCaseId) {
      this.runError.set(null);
      this.runResult.set(null);
    }
    this.runPanelTab.set('overview');
    this.selectedShotIndex.set(0);

    this.http
      .post<{
        ok: boolean;
        result?: RunResultDto;
        error?: string;
        cancelled?: boolean;
      }>(`${QC_API_BASE_URL}/api/test-cases/${testCaseId}/run`, {})
      .subscribe({
        next: (body) => {
          this.removeManualRunTc(testCaseId);
          const stillHere = this.selectedTestCaseId() === testCaseId;
          const cancelled = Boolean(body.cancelled || body.result?.cancelled);
          if (body.result) {
            const failed = !cancelled && (!body.result.ok || body.result.overallStatus === 'failed');
            const errMsg = cancelled
              ? (body.result.error ?? 'Đã dừng')
              : failed
                ? body.result.error ??
                  body.result.steps.find((s) => s.status === 'failed')?.message ??
                  'Test thất bại'
                : undefined;
            if (stillHere) {
              this.runResult.set(body.result);
              const failedIdx = body.result.steps.findIndex((s) => s.status === 'failed');
              const lastOk = body.result.steps.length - 1;
              this.selectedShotIndex.set(failedIdx >= 0 ? failedIdx : lastOk >= 0 ? lastOk : 0);
              this.loadRunHistory();
              this.runError.set(failed ? errMsg ?? null : null);
            }
            this.enqueueRunToast(
              testCaseId,
              labelSnapshot,
              !failed && !cancelled,
              failed || cancelled ? errMsg : undefined,
            );
            this.loadNotifications(false);
          } else {
            if (stillHere) {
              this.runResult.set(null);
              const msg = body.error ?? 'Không có kết quả chạy';
              this.runError.set(msg);
            }
            this.enqueueRunToast(
              testCaseId,
              labelSnapshot,
              false,
              body.error ?? 'Không có kết quả chạy',
            );
            this.loadNotifications(false);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.removeManualRunTc(testCaseId);
          const stillHere = this.selectedTestCaseId() === testCaseId;
          const payload = err.error as { error?: string } | undefined;
          const msg =
            typeof payload?.error === 'string'
              ? payload.error
              : err.message || 'Lỗi khi chạy test';
          if (stillHere) {
            this.runError.set(msg);
          }
          this.enqueueRunToast(testCaseId, labelSnapshot, false, msg);
        },
      });
  }

  protected selectedShotDataUrl(): string | null {
    const steps = this.runResult()?.steps ?? [];
    const i = this.selectedShotIndex();
    const s = steps[i];
    return this.stepScreenshotSrc(s ?? null);
  }

  /** Nguồn ảnh cho một bước: URL (R2 presigned) hoặc data URL base64 (dữ liệu cũ / khi không bật R2). */
  protected stepScreenshotSrc(s: RunStepDto | null | undefined): string | null {
    if (!s) return null;
    const u = s.screenshotUrl?.trim();
    if (u) return u;
    const b = s.screenshotBase64?.trim();
    return b ? `data:image/png;base64,${b}` : null;
  }

  protected stepHasScreenshot(s: RunStepDto | null | undefined): boolean {
    return this.stepScreenshotSrc(s) !== null;
  }

  /** Chọn ảnh theo chỉ số bước (không đổi tab — phù hợp carousel ở Tổng quan). */
  protected selectRunShot(index: number): void {
    this.selectedShotIndex.set(index);
  }

  protected setRunTab(tab: 'overview' | 'steps' | 'shots' | 'log'): void {
    this.runPanelTab.set(tab);
  }

  protected runLogEntries(): RunLogLine[] {
    const out: RunLogLine[] = [];
    if (this.runPanelBusyForSelectedTestCase()) {
      out.push({ key: 'loading', level: 'meta', text: 'Đang chạy Puppeteer…' });
      return out;
    }
    const r = this.runResult();
    const httpErr = this.runError();
    if (!r && !httpErr) {
      out.push({ key: 'empty', level: 'meta', text: 'Chưa có lần chạy.' });
      return out;
    }
    if (r) {
      out.push({
        key: 'start',
        level: 'meta',
        text: `Bắt đầu: ${new Date(r.startedAt).toLocaleString()} · ${(r.durationMs / 1000).toFixed(1)}s`,
      });
      out.push({ key: 'tc', level: 'meta', text: `Test case: ${r.testCaseId}` });
      out.push({
        key: 'status',
        level: r.overallStatus === 'passed' ? 'step-pass' : 'step-fail',
        text: `Kết quả: ${r.overallStatus.toUpperCase()}`,
      });
      out.push({ key: 'sep', level: 'meta', text: '────────────────────────────────────────' });
      for (const s of r.steps) {
        const n = String(s.order + 1).padStart(2, '0');
        const kind = this.kindLabel(s.kind);
        const ms = `${s.durationMs}ms`;
        const urlBit = s.url ? ` · ${this.truncateMiddle(s.url, 48)}` : '';
        let level: RunLogLine['level'] = 'step-pass';
        if (s.status === 'failed') level = 'step-fail';
        else if (s.status === 'skipped') level = 'step-skip';
        out.push({
          key: `${s.actionId}-line`,
          level,
          text: `${n}  ${s.name}  [${kind}]  ${s.status.toUpperCase()}  ${ms}${urlBit}`,
        });
        if (s.message?.trim()) {
          out.push({ key: `${s.actionId}-msg`, level: 'step-fail', text: `    → ${s.message.trim()}` });
        }
      }
      if (r.error?.trim()) {
        out.push({ key: 'err', level: 'fatal', text: r.error.trim() });
      }
    } else if (httpErr) {
      out.push({ key: 'http', level: 'fatal', text: httpErr });
    }
    return out;
  }

  protected runLogPlain(): string {
    return this.runLogEntries()
      .map((l) => l.text)
      .join('\n');
  }

  protected copyRunLog(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const text = this.runLogPlain();
    if (!text) return;
    void navigator.clipboard.writeText(text).catch(() => {
      /* bỏ qua */
    });
  }

  protected truncateMiddle(s: string, max = 48): string {
    const t = s.trim();
    if (t.length <= max) return t;
    const edge = Math.max(4, Math.floor((max - 1) / 2));
    return `${t.slice(0, edge)}…${t.slice(-edge)}`;
  }

  protected setTestCaseTab(tab: 'steps' | 'data' | 'history'): void {
    this.testCaseTab.set(tab);
    if (tab === 'history') {
      this.loadRunHistory();
    }
  }

  protected loadRunHistory(): void {
    const testCaseId = this.selectedTestCaseId();
    if (!testCaseId) {
      this.runHistory.set([]);
      this.runHistoryError.set(null);
      this.runHistoryLoading.set(false);
      return;
    }
    const gen = ++this.runHistoryFetchGen;
    this.runHistoryLoading.set(true);
    this.runHistoryError.set(null);
    this.http
      .get<{ ok: boolean; runs?: TestRunSummaryDto[]; error?: string }>(
        `${QC_API_BASE_URL}/api/test-cases/${testCaseId}/runs?limit=50`,
      )
      .subscribe({
        next: (body) => {
          if (gen !== this.runHistoryFetchGen || this.selectedTestCaseId() !== testCaseId) {
            return;
          }
          this.runHistoryLoading.set(false);
          if (body.ok && Array.isArray(body.runs)) {
            this.runHistory.set(body.runs);
            this.runHistoryError.set(null);
          } else {
            this.runHistory.set([]);
            this.runHistoryError.set(body.error ?? 'Không tải được lịch sử chạy');
          }
        },
        error: (e: HttpErrorResponse) => {
          if (gen !== this.runHistoryFetchGen || this.selectedTestCaseId() !== testCaseId) {
            return;
          }
          this.runHistoryLoading.set(false);
          this.runHistory.set([]);
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

  protected runStats(): { passed: number; failed: number; skipped: number; total: number } {
    const steps = this.runResult()?.steps ?? [];
    return {
      passed: steps.filter((s) => s.status === 'passed').length,
      failed: steps.filter((s) => s.status === 'failed').length,
      skipped: steps.filter((s) => s.status === 'skipped').length,
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
