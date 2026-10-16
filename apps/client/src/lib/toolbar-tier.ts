/**
 * Finder 式工具栏降级阶梯（#1/#3）。
 *
 * 旧的 OperationBar 用三档布尔阈值（compact≤600 / hideCreateFolder≤480 /
 * collapseBrowse≤360）整批隐藏控件，≤360px 时排序+视图整行消失是能力断崖。
 * 这里换成逐能力牺牲的阶梯：窄→宽的牺牲顺序固定为
 *   ①排序下拉收进 ⋯ ②分组图例收进 ⋯ ③视图切换塌成「当前视图图标弹钮」
 *   ④新建文档/创建文件夹收进 ⋯ ⑤AirDrop/分享收进 ⋯
 * 放大时严格逆序恢复，一次只归还一个能力。
 *
 * 纯函数按「保留集是否放得下」逐级牺牲，因此断点由按钮宽度表推导而出，
 * 不是手写魔法数；宽度表建模的是容器 <760px 的图标态（文字标签已由
 * container-collapse.css 的容器查询收起），阶梯只在该区间起作用。
 */

/** 可被牺牲的工具栏能力（牺牲顺序见 SACRIFICE_ORDER）。 */
export type ToolbarCapability =
  | 'sortDropdown'
  | 'groupAccessory'
  | 'viewLabel'
  | 'createActions'
  | 'shareActions';

/** 永不牺牲的骨架控件：视图图标弹钮与 ⋯ 菜单（#3 的二态塌缩形态）。 */
export type ToolbarChrome = 'viewPopover' | 'moreMenu' | 'barChrome';

export interface ToolbarButton {
  id: ToolbarCapability | ToolbarChrome;
  /** 该控件占用的工具栏宽度（px，含自身间距）。 */
  width: number;
  /** 骨架控件标记：永不进入牺牲集。 */
  persistent?: boolean;
}

export interface ToolbarTier {
  /** 当前宽度下必须收进 ⋯ 菜单的能力。 */
  sacrificed: Set<ToolbarCapability>;
  /** 牺牲到极限后保留集是否仍放得下（false = 只剩骨架控件，允许溢出）。 */
  fits: boolean;
}

/** 窄→宽的牺牲顺序：索引越靠前越先被收进 ⋯；恢复严格逆序。 */
export const SACRIFICE_ORDER: readonly ToolbarCapability[] = [
  'sortDropdown',
  'groupAccessory',
  'viewLabel',
  'createActions',
  'shareActions',
];

/**
 * 默认宽度表（px）。icon 态实测估值：32px 图标钮 + 8px 间距为基本单位，
 * 排序/视图触发器含 chevron 与内边距，分组图例是 FolderColorLegend 整行。
 * 调整这里即可移动断点，无需改组件。
 */
export const TOOLBAR_BUTTON_WIDTHS = {
  viewPopover: 40,
  moreMenu: 36,
  barChrome: 56,
  sortDropdown: 64,
  groupAccessory: 144,
  viewLabel: 28,
  createActions: 84,
  shareActions: 120,
} as const;

/**
 * 组装当前实例的按钮清单。骨架控件恒在；分组图例仅在宿主传入
 * statusAccessory 时占宽（无图例的窗格断点整体前移，不会留空档）。
 */
export const buildToolbarButtons = ({
  hasGroupAccessory = false,
}: { hasGroupAccessory?: boolean } = {}): ToolbarButton[] => [
  { id: 'viewPopover', width: TOOLBAR_BUTTON_WIDTHS.viewPopover, persistent: true },
  { id: 'moreMenu', width: TOOLBAR_BUTTON_WIDTHS.moreMenu, persistent: true },
  { id: 'barChrome', width: TOOLBAR_BUTTON_WIDTHS.barChrome, persistent: true },
  { id: 'sortDropdown', width: TOOLBAR_BUTTON_WIDTHS.sortDropdown },
  ...(hasGroupAccessory
    ? [{ id: 'groupAccessory' as ToolbarCapability, width: TOOLBAR_BUTTON_WIDTHS.groupAccessory }]
    : []),
  { id: 'viewLabel', width: TOOLBAR_BUTTON_WIDTHS.viewLabel },
  { id: 'createActions', width: TOOLBAR_BUTTON_WIDTHS.createActions },
  { id: 'shareActions', width: TOOLBAR_BUTTON_WIDTHS.shareActions },
];

/**
 * 计算 `availableWidthPx` 宽度下的牺牲集：从完整保留集出发，按
 * SACRIFICE_ORDER 逐个收进 ⋯，直到保留集放得下或无能力可牺牲。
 * 单调且每级只翻转一个能力，因此放大恢复严格逆序。
 */
export const computeToolbarTier = (
  availableWidthPx: number,
  buttons: ToolbarButton[],
): ToolbarTier => {
  const widths = new Map(buttons.map((button) => [button.id, button.width]));
  const persistentWidth = buttons
    .filter((button) => button.persistent)
    .reduce((total, button) => total + button.width, 0);
  const sacrificed = new Set<ToolbarCapability>();
  const keptWidth = buttons
    .filter((button) => !button.persistent)
    .reduce((total, button) => total + button.width, 0);
  let used = persistentWidth + keptWidth;

  for (const capability of SACRIFICE_ORDER) {
    if (used <= availableWidthPx) break;
    const width = widths.get(capability);
    if (width === undefined) continue;
    sacrificed.add(capability);
    used -= width;
  }

  return { sacrificed, fits: used <= availableWidthPx };
};
