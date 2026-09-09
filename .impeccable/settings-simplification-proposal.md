# 设置精简建议（待用户确认，未实施）

2026-09-07。用户明确要求先商量；此次只调整设置页材质，未删改设置项或导航分类。

## 代码核查

以下五项在客户端生产代码中只出现在设置类型、默认值及表单读写中，没有消费该设置值的功能代码：

| 当前设置 | 存储字段 | 建议 |
| --- | --- | --- |
| 通知 | enableNotifications | 删除无效开关，不声称关闭了通知功能 |
| 自动保存 | autoSave | 删除无效开关；聊天等模块有独立自动保存逻辑，不受它控制 |
| 侧边栏宽度 | sidebarWidth | 删除下拉框；保留拖拽及实际的 leftSidebarWidth 持久化 |
| 显示文件扩展名 | showFileExtensions | 删除无效开关；目前文件名一直含扩展名 |
| Markdown 预览 | enableMarkdownPreview | 删除无效开关；预览由预览工厂按文件类型决定 |

证据：`apps/client/src/components/settings/shared.tsx`、`GeneralSettings.tsx`、`ExplorerSettings.tsx`；
对五个字段进行了排除测试和语言文件的全客户端引用搜索。
侧栏实际宽度由 `apps/client/src/hooks/use-layout-state.ts` 的 UI_STATE.leftSidebarWidth 保存。

“动画”和“减少动态效果”分别写 enableAnimations / reducedMotion，
但 `components/weather/SkySync.tsx` 最终使用 reducedMotion || !enableAnimations 合并。
建议合为一个“减少动态效果”，保留系统偏好支持，避免两个相反开关。

“扩展自动更新”有效：`lib/extension-host.ts` 的 checkForUpdatesAndNotify 读取
AUTO_UPDATE_EXTENSIONS 并执行 applyExtensionUpdate，应保留。
索引、文件关联、右键规则、备份、审计和版本历史都有实际模块；低频不等于无用。
Mac 上 SystemIntegrationSettings 返回 null，外层“系统集成”标题仍显示；建议按平台隐藏空分组。

## 推荐信息架构：12 类变 5 类

1. 常用：语言、字体、天气、减少动态/透明度、焦点与对比度。
2. 文件：默认视图、隐藏文件、文件夹大小、文件关联。
3. 快捷键：键位与配置。
4. 高级：索引、右键菜单规则、扩展更新、备份；审计与版本历史保留入口。
5. 关于：版本、支持；教程与重置放这里或高级末尾。

建议第一步只移除无效开关、合并重复控制、收起高级功能，不删除实际功能或用户数据。
以上所有内容仍需用户确认。
