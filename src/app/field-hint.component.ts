import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

/** Nút «?» — mô tả hiện khi hover hoặc khi nhấn (giữ đến khi nhấn lại / click ra ngoài / Escape). */
@Component({
  selector: 'app-field-hint',
  standalone: true,
  template: `
    <span
      class="relative inline-flex items-center align-middle"
      (mouseenter)="onHoverEnter()"
      (mouseleave)="onHoverLeave()"
    >
      <button
        type="button"
        class="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full border border-gray-600 bg-gray-800/90 px-1 text-[11px] font-semibold leading-none text-gray-400 hover:border-dashboard-primary hover:text-dashboard-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-primary/50"
        (click)="togglePin($event)"
        [attr.aria-expanded]="showPopover()"
        aria-label="Thông tin thêm"
      >
        ?
      </button>
      @if (showPopover()) {
        <div
          role="tooltip"
          class="pointer-events-auto absolute left-1/2 top-full z-[450] mt-1 w-max max-w-[min(288px,calc(100vw-24px))] -translate-x-1/2 rounded-lg border border-dashboard-border bg-[#1a2330] px-3 py-2 text-left text-[11px] leading-relaxed text-gray-300 shadow-xl"
          (click)="$event.stopPropagation()"
        >
          {{ hintText() }}
        </div>
      }
    </span>
  `,
})
export class FieldHintComponent {
  readonly hintText = input.required<string>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  private readonly pinOpen = signal(false);
  private readonly hoverOpen = signal(false);
  private hoverClearTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly showPopover = computed(() => this.pinOpen() || this.hoverOpen());

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.hoverClearTimer) {
        clearTimeout(this.hoverClearTimer);
      }
    });
  }

  protected onHoverEnter(): void {
    if (this.hoverClearTimer) {
      clearTimeout(this.hoverClearTimer);
      this.hoverClearTimer = null;
    }
    this.hoverOpen.set(true);
  }

  protected onHoverLeave(): void {
    if (this.pinOpen()) return;
    if (this.hoverClearTimer) clearTimeout(this.hoverClearTimer);
    this.hoverClearTimer = setTimeout(() => {
      this.hoverOpen.set(false);
      this.hoverClearTimer = null;
    }, 160);
  }

  protected togglePin(ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.pinOpen.update((p) => !p);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (!this.pinOpen()) return;
    const t = ev.target as Node;
    if (this.host.nativeElement.contains(t)) return;
    this.pinOpen.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape') return;
    this.pinOpen.set(false);
    this.hoverOpen.set(false);
  }
}
