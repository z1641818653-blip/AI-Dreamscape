# 资料检索能力回补清单

统一入口为 `research.html`。旧界面不再发布；旧地址仅跳转新版。以下是经验与后续任务，不表示新版已具备全部能力。

## 优先回补

| 优先级 | 能力 | 可复用实现 | 新版验收要求 |
|---|---|---|---|
| P1 | 多项目、命名与检索历史 | research-projects.js；旧项目隔离、配额回滚测试 | 需求澄清、结果、反馈、译文按项目隔离；切换不覆盖运行任务 |
| P1 | 收藏、备注与清单导出 | research-projects.js；research.js 的导出流程 | 单条及批量选择，CSV/Markdown/JSON；保持来源与审核依据 |
| P1 | 原数据迁移 | dreamscape_research_projects_v1 / dreamscape_research_v1 | 用户预览确认后迁移；不删除原键；迁移失败回滚；旧审核状态需按新需求复核 |
| P1 | 文件发现、可下载性核验 | research-download.js；server/research-service.cjs | 验证真实响应，拒绝 HTML 假 PDF；明确版权/受限状态与发表版本 |
| P2 | 多类型与更多来源 | research-sources.js；research-source-manager.js | 恢复数据集、视频、图书、音频、代码；按需求选择兼容来源，按 DOI/URL 去重 |
| P2 | 声明式自定义来源 | research-source-manager.js | 不执行代码；限制 HTTPS/私网；真实请求预览通过后启用 |
| P2 | 批量下载与 ZIP | research-download.js；现有服务下载接口 | 有大小、并发和取消上限；保留文件扩展名；部分失败不损坏成功文件 |
| P2 | 分页、重试与增量采集 | research-collection.js | 来源各自游标；失败不推进游标；预算包含实际请求；重复运行复用已采集结果 |

## 保留的经验

- 不能以网站图标、缩略图或来源图标代替用户需要的图片。
- 不能以候选数量冒充审核通过数量；信息不足需待确认。
- 来源内容不可信；模型不能生成不存在的链接或资源 ID。
- 证据可追溯不等于事实正确，关键词同名要消歧。
- Key 只由全局配置管理，默认备份与项目导出不能包含 Key。
- 文件下载要识别文章正式版、作者接受稿和预印本，不能混淆。
- 配额错误、取消、来源失败必须保留成功结果并允许恢复。

原实现保留在 Git 历史和功能模块中；退役 UI 放在 `tests/fixtures/`，仅由测试服务器提供。生产 Node 服务禁止访问 tests 路径。GitHub Pages 不发布该目录（`_config.yml` 明确排除）。

Render 的旧检索地址由服务端 302 跳转到正式 GitHub Pages 检索入口，模型/API 服务继续保留，不改变全局 Key 的归属域名。
